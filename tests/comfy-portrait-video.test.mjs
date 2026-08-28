import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_MODE_LOOP_FLF,
  QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
  buildPortraitVideoRequest
} from '../src/lib/portrait-video.ts';
import {
  ComfyPortraitVideoOutputTooLargeError,
  loadPortraitVideoCapabilities,
  runComfyPortraitEndFrame,
  runComfyPortraitVideo,
  sha256Hex,
  uploadPortraitVideoInput,
  validatePortraitVideoPng
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
  seed: 41,
  width: 768,
  height: 1152,
  generatedAt: 17
};

const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageSha256 = await sha256Hex(imageBytes);
const request = buildPortraitVideoRequest(portrait, '2:3', imageSha256);
const loopRequest = buildPortraitVideoRequest(portrait, '2:3', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF);
const generatedRequest = buildPortraitVideoRequest(portrait, '2:3', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF);
const input = {
  name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
  subfolder: 'mullet/motion-inputs',
  type: 'input',
  imageSha256
};
const endInput = {
  name: 'portrait-motion-55555555-5555-4555-8555-555555555555.png',
  subfolder: 'mullet/motion-inputs',
  type: 'input',
  imageSha256: 'b'.repeat(64)
};

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, inputName, options) {
  return { [node]: { input: { required: { [inputName]: ['COMBO', { options }] } } } };
}

function capabilityResponse(node) {
  const files = LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [files.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[files.clip, endFiles.clip]],
    type: [['ltxv', 'qwen_image']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [files.videoVae, files.audioVae, endFiles.vae]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [endFiles.lora]);
  if (node === 'KSampler') return { [node]: { input: { required: {
    sampler_name: [['euler']],
    scheduler: [['simple']]
  } } } };
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
  assert.equal(capabilities.spec, 'mullet_portrait_video_capabilities_v3');
  assert.equal(capabilities.template.id, 'ltx-2.5-distilled-portrait-v3');
  assert.equal(capabilities.endFrameTemplate?.id, 'qwen-image-edit-2511-lightning-4step-v1');
  assert.deepEqual(capabilities.modes.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.equal(capabilities.aspectRatios.length, 4);

  await assert.rejects(loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'LatentUpscaleModelLoader') return Response.json(dynamicInfo(node, 'model_name', []));
    return Response.json(capabilityResponse(node));
  }, 'http://comfy'), /latent upscaler/);

  const withoutEndFrame = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'LoraLoaderModelOnly') return new Response('missing', { status: 404 });
    return Response.json(capabilityResponse(node));
  }, 'http://comfy');
  assert.equal(withoutEndFrame.endFrameTemplate, null);
  assert.deepEqual(withoutEndFrame.modes.map(({ id }) => id), ['i2v', 'flf2v_loop']);
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

test('accepts only a PNG with the exact source IHDR dimensions', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 768, false);
  view.setUint32(20, 1152, false);
  assert.doesNotThrow(() => validatePortraitVideoPng(png, 768, 1152));
  assert.throws(() => validatePortraitVideoPng(png, 864, 1152), /dimensions do not match/);
  png[0] = 0;
  assert.throws(() => validatePortraitVideoPng(png, 768, 1152), /invalid PNG header/);
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

test('queues and validates the exact Qwen portrait end-frame PNG', async () => {
  const observed = [];
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 768, false);
  view.setUint32(20, 1152, false);
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '66666666-6666-4666-8666-666666666666', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '66666666-6666-4666-8666-666666666666': {
        status: { completed: true, status_str: 'success' },
        outputs: { '14': { images: [{ filename: 'portrait-generated-end-frame_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (value.includes('/view?')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitEndFrame(fetcher, 'http://comfy/', generatedRequest, input, 43);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait-end-frame');
  assert.equal(queued.prompt['1'].inputs.unet_name, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['4'].inputs.image, `mullet/motion-inputs/${input.name}`);
  assert.equal(queued.prompt['12'].inputs.seed, 43);
  assert.deepEqual(queued.prompt['14'].inputs.images, ['15', 0]);
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(result.bytes, png);
  assert.equal(result.sha256, await sha256Hex(png));
});

test('selects and validates the loop-FLF output node and filename', async () => {
  const observed = [];
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 4, 5, 6]);
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '44444444-4444-4444-8444-444444444444', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '44444444-4444-4444-8444-444444444444': {
        status: { completed: true, status_str: 'success' },
        outputs: { '35': { images: [{ filename: 'portrait-motion-loop-flf_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] } }
      }
    });
    if (value.includes('/view?')) return new Response(webm, { headers: { 'content-type': 'video/webm' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitVideo(fetcher, 'http://comfy/', loopRequest, input, 42);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.prompt['12'].class_type, 'LTXVAddGuide');
  assert.equal(queued.prompt['13'].inputs.frame_idx, -1);
  assert.equal(queued.prompt['35'].class_type, 'SaveWEBM');
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion-loop-flf_00001_.webm&subfolder=mullet&type=output');
  assert.deepEqual(result.bytes, webm);
});

test('selects distinct generated end-frame guides and validates their FLF output', async () => {
  const observed = [];
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 7, 8, 9]);
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '77777777-7777-4777-8777-777777777777', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '77777777-7777-4777-8777-777777777777': {
        status: { completed: true, status_str: 'success' },
        outputs: { '35': { images: [{ filename: 'portrait-motion-generated-flf_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] } }
      }
    });
    if (value.includes('/view?')) return new Response(webm, { headers: { 'content-type': 'video/webm' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitVideo(fetcher, 'http://comfy/', generatedRequest, input, 42, undefined, endInput);
  const queued = JSON.parse(observed[0].init.body);
  assert.deepEqual(queued.prompt['12'].inputs.image, ['2', 0]);
  assert.deepEqual(queued.prompt['13'].inputs.image, ['37', 0]);
  assert.equal(queued.prompt['36'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion-generated-flf_00001_.webm&subfolder=mullet&type=output');
  assert.deepEqual(result.bytes, webm);
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

test('rejects output nodes and filename prefixes from the other mode', async () => {
  const runWith = (selectedRequest, outputs) => runComfyPortraitVideo(async (url) => {
    const value = String(url);
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' },
        outputs
      }
    });
    throw new Error(`unexpected URL ${value}`);
  }, 'http://comfy', selectedRequest, input, 42);
  const i2vOutput = { images: [{ filename: 'portrait-motion_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] };
  const loopOutput = { images: [{ filename: 'portrait-motion-loop-flf_00001_.webm', subfolder: 'mullet', type: 'output' }], animated: [true] };
  await assert.rejects(runWith(loopRequest, { '31': i2vOutput }), /selected output node/);
  await assert.rejects(runWith(request, { '31': loopOutput }), /unexpected portrait-video filename/);
  await assert.rejects(runWith(request, { '35': loopOutput }), /selected output node/);
});
