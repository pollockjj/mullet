import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  buildPortraitVideoRequest
} from '../src/lib/portrait-video.ts';
import {
  ComfyPortraitVideoOutputTooLargeError,
  loadPortraitVideoCapabilities,
  runComfyPortraitVideo,
  sha256Hex,
  uploadPortraitVideoInput
} from '../src/lib/server/comfy-portrait-video.ts';

const portrait = {
  conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
  requestKey: 'opaque-portrait-request-key',
  source: {
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    messageCount: 4,
    messageIndex: 3,
    fingerprint: '12:1234abcd',
    expression: 'grief'
  },
  promptId: '11111111-1111-4111-8111-111111111111',
  width: 768,
  height: 1152,
  generatedAt: 17
};

const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageSha256 = await sha256Hex(imageBytes);
const request = buildPortraitVideoRequest(portrait, '2:3', imageSha256);
const input = {
  name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
  subfolder: 'mullet/motion-inputs',
  type: 'input',
  imageSha256
};

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, inputName, options) {
  return { [node]: { input: { required: { [inputName]: ['COMBO', { options }] } } } };
}

function capabilityResponse(node) {
  const files = LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [files.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[files.clip]],
    type: [['ltxv']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [files.videoVae, files.audioVae]);
  if (node === 'LatentUpscaleModelLoader') return dynamicInfo(node, 'model_name', [files.latentUpscaler]);
  if (node === 'KSamplerSelect') return dynamicInfo(node, 'sampler_name', ['euler_ancestral']);
  if (node === 'SaveWEBM') return dynamicInfo(node, 'codec', ['vp9']);
  if (node === 'LoadImage') return standardInfo(node, 'image', [], { image_upload: true });
  return { [node]: { input: { required: {} } } };
}

test('requires every exact LTX asset, node, sampler, codec, and upload surface', async () => {
  const fetcher = async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node));
  };
  const capabilities = await loadPortraitVideoCapabilities(fetcher, 'http://comfy');
  assert.equal(capabilities.template.id, 'ltx-2.5-i2v-distilled-v1');
  assert.equal(capabilities.aspectRatios.length, 4);

  await assert.rejects(loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'LatentUpscaleModelLoader') return Response.json(dynamicInfo(node, 'model_name', []));
    return Response.json(capabilityResponse(node));
  }, 'http://comfy'), /latent upscaler/);
});

test('uploads only digest-matched PNG bytes to the fixed input location', async () => {
  let observed;
  const result = await uploadPortraitVideoInput(async (_url, init) => {
    observed = init.body;
    const file = observed.get('image');
    return Response.json({ name: file.name, subfolder: observed.get('subfolder'), type: observed.get('type') });
  }, 'http://comfy', imageBytes, imageSha256);
  assert.match(result.name, /^portrait-motion-[0-9a-f-]{36}\.png$/i);
  assert.equal(result.subfolder, 'mullet/motion-inputs');
  assert.equal(observed.get('overwrite'), 'false');
  await assert.rejects(uploadPortraitVideoInput(async () => assert.fail('uploaded mismatched bytes'), 'http://comfy', imageBytes, 'a'.repeat(64)), /does not match/);
});

test('queues, polls, and proxies only the fixed animated WebM output', async () => {
  const observed = [];
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' },
        outputs: { '31': { images: [{ filename: 'portrait-motion_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] } }
      }
    });
    if (value.includes('/view?')) return new Response(webm, { headers: { 'content-type': 'video/webm' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitVideo(fetcher, 'http://comfy/', request, input, 42);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait-video');
  assert.equal(queued.prompt['1'].inputs.image, `mullet/motion-inputs/${input.name}`);
  assert.equal(queued.prompt['16'].inputs.noise_seed, 42);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion_00001_.webm&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'video/webm');
  assert.deepEqual(result.bytes, webm);
  assert.equal(result.sha256, await sha256Hex(webm));
});

test('rejects unsafe history and cancels only the targeted failed job', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'error' },
        outputs: {}
      }
    });
    if (value.endsWith('/api/jobs/33333333-3333-4333-8333-333333333333/cancel')) return Response.json({ cancelled: true });
    throw new Error(`unexpected URL ${value}`);
  };
  await assert.rejects(runComfyPortraitVideo(fetcher, 'http://comfy', request, input, 42), /execution failed/);
  assert.equal(calls.at(-1).url, 'http://comfy/api/jobs/33333333-3333-4333-8333-333333333333/cancel');
  assert.equal(calls.some((call) => call.url.endsWith('/interrupt')), false);
});

test('rejects traversal, wrong animation metadata, MIME, signature, and oversized output', async () => {
  const run = (output, response) => runComfyPortraitVideo(async (url) => {
    const value = String(url);
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' },
        outputs: { '31': output }
      }
    });
    return response;
  }, 'http://comfy', request, input, 42);
  await assert.rejects(run({ images: [{ filename: '../secret.webm', subfolder: 'mullet', type: 'output' }], animated: [true] }), /unexpected portrait-video filename/);
  await assert.rejects(run({ images: [{ filename: 'portrait-motion_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [false] }), /did not mark/);
  const goodOutput = { images: [{ filename: 'portrait-motion_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] };
  await assert.rejects(run(goodOutput, new Response('no', { headers: { 'content-type': 'text/plain' } })), /not WebM/);
  await assert.rejects(run(goodOutput, new Response('nope', { headers: { 'content-type': 'video/webm' } })), /invalid WebM signature/);
  await assert.rejects(
    run(goodOutput, new Response(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), { headers: { 'content-type': 'video/webm', 'content-length': String(64 * 1024 * 1024 + 1) } })),
    ComfyPortraitVideoOutputTooLargeError
  );
});
