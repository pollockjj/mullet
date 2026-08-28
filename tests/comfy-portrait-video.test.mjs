import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_MODE_I2V,
  PORTRAIT_VIDEO_MODE_LOOP_FLF,
  MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
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
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

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
  width: 704,
  height: 704,
  generatedAt: 17
};

const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageSha256 = await sha256Hex(imageBytes);
const requests = {
  i2v: buildPortraitVideoRequest(portrait, '1:1', imageSha256, PORTRAIT_VIDEO_MODE_I2V),
  loop: buildPortraitVideoRequest(portrait, '1:1', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF),
  loopFive: buildPortraitVideoRequest(portrait, '1:1', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 5),
  generated: buildPortraitVideoRequest(portrait, '1:1', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF)
};
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
const mp4 = buildH264AacMp4Fixture({
  width: 768,
  height: 768,
  frames: 73,
  includeAudio: false
});
const mp4Five = buildH264AacMp4Fixture({ width: 768, height: 768, frames: 124, includeAudio: false });

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, section, inputName, options) {
  return { [node]: { input: { [section]: {
    [inputName]: ['COMFY_DYNAMICCOMBO_V3', { options: options.map((key) => ({ key })) }]
  } } } };
}

function capabilityResponse(node, includeLastFrame = true, lengthStep = 17, lengthMaximum = 3600) {
  const files = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [files.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[files.clip, endFiles.clip]],
    type: [['minimax', 'mage']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [files.videoVae, endFiles.vae]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [files.turboLora]);
  if (node === 'KSampler') return { [node]: { input: { required: {
    sampler_name: [['euler']],
    scheduler: [['simple']]
  } } } };
  if (node === 'KSamplerSelect') return standardInfo(node, 'sampler_name', ['res_multistep']);
  if (node === 'BasicScheduler') return standardInfo(node, 'scheduler', ['simple']);
  if (node === 'SaveVideo') return { [node]: { input: {
    required: { format: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }, { key: 'mp4' }] }] },
    optional: { codec: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }, { key: 'h264' }] }] }
  } } };
  if (node === 'MiniMaxH3ImageToVideo') return { [node]: { input: {
    required: {
      width: ['INT', { min: 32, max: 16384, step: 32 }],
      height: ['INT', { min: 32, max: 16384, step: 32 }],
      length: ['INT', { min: 5, max: lengthMaximum, step: lengthStep }]
    },
    optional: {
      first_frame: ['IMAGE', {}],
      ...(includeLastFrame ? { last_frame: ['IMAGE', {}] } : {})
    }
  } } };
  if (node === 'LoadImage') return standardInfo(node, 'image', [], { image_upload: true });
  return { [node]: { input: { required: {} } } };
}

test('requires the exact installed H3 FL2VA stack and native first/last-frame inputs', async () => {
  const fetcher = async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node));
  };
  const capabilities = await loadPortraitVideoCapabilities(fetcher, 'http://comfy');
  assert.equal(capabilities.spec, 'mullet_portrait_video_capabilities_v5');
  assert.equal(capabilities.template.id, 'minimax-h3-fl2va-portrait-v1');
  assert.equal(capabilities.endFrameTemplate?.id, 'mage-flow-edit-turbo-4step-v1');
  assert.deepEqual(capabilities.modes.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.deepEqual(capabilities.durations, [3, 5]);

  await assert.rejects(loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, false));
  }, 'http://comfy'), /last_frame metadata/);

  await assert.rejects(loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, true, 16));
  }, 'http://comfy'), /MiniMaxH3ImageToVideo\.length cannot represent 73/);

  await assert.rejects(loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, true, 17, 100));
  }, 'http://comfy'), /MiniMaxH3ImageToVideo\.length cannot represent 124/);

  const withoutEndFrame = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'KSampler') return new Response('missing', { status: 404 });
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
  view.setUint32(16, 704, false);
  view.setUint32(20, 704, false);
  assert.doesNotThrow(() => validatePortraitVideoPng(png, 704, 704));
  assert.throws(() => validatePortraitVideoPng(png, 768, 704), /dimensions do not match/);
});

async function runMode(selectedRequest, filename, selectedEndInput, outputBytes = mp4) {
  const observed = [];
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' },
        outputs: { '15': { images: [{ filename, subfolder: 'mullet', type: 'output' }], animated: [true] } }
      }
    });
    if (value.includes('/view?')) return new Response(outputBytes, { headers: { 'content-type': 'video/mp4' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitVideo(fetcher, 'http://comfy/', selectedRequest, input, 42, undefined, selectedEndInput);
  return { result, observed, queued: JSON.parse(observed[0].init.body) };
}

test('queues and validates MiniMax H3 I2V as H.264 video-only MP4', async () => {
  const { result, observed, queued } = await runMode(requests.i2v, 'portrait-motion_00001_.mp4');
  assert.equal(queued.client_id, 'mullet-portrait-video');
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.equal(Object.hasOwn(queued.prompt['6'].inputs, 'last_frame'), false);
  assert.equal(queued.prompt['6'].inputs.length, 73);
  assert.equal(Object.hasOwn(queued.prompt, '4'), false);
  assert.equal(Object.hasOwn(queued.prompt, '13'), false);
  assert.equal(Object.hasOwn(queued.prompt['14'].inputs, 'audio'), false);
  assert.equal(queued.prompt['15'].class_type, 'SaveVideo');
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion_00001_.mp4&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.durationSeconds, 73 / 24);
  assert.equal(result.audioTracks, 0);
  assert.deepEqual(result.bytes, mp4);
});

test('rejects every audio-bearing portrait MP4', async () => {
  const audioMp4 = buildH264AacMp4Fixture({ width: 768, height: 768, frames: 73 });
  await assert.rejects(
    runMode(requests.i2v, 'portrait-motion_00002_.mp4', undefined, audioMp4),
    /must not contain an audio track/
  );
});

test('queues the natural loop with the identical first and last H3 frame', async () => {
  const { queued, observed } = await runMode(requests.loop, 'portrait-motion-loop-flf_00001_.mp4');
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['5', 0]);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion-loop-flf_00001_.mp4&subfolder=mullet&type=output');
});

test('queues and validates the selected five-second 124-frame natural loop', async () => {
  const { result, queued } = await runMode(
    requests.loopFive,
    'portrait-motion-loop-flf_00002_.mp4',
    undefined,
    mp4Five
  );
  assert.equal(queued.prompt['6'].inputs.length, 124);
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['5', 0]);
  assert.equal(result.durationSeconds, 124 / 24);
  assert.deepEqual(result.bytes, mp4Five);
});

test('queues generated-keyframe FLF with the distinct Mage-Flow image as H3 last frame', async () => {
  const { queued, observed } = await runMode(requests.generated, 'portrait-motion-generated-flf_00001_.mp4', endInput);
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['17', 0]);
  assert.equal(queued.prompt['17'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion-generated-flf_00001_.mp4&subfolder=mullet&type=output');
});

test('queues and validates the exact Mage-Flow portrait end-frame PNG', async () => {
  const observed = [];
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 704, false);
  view.setUint32(20, 704, false);
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '66666666-6666-4666-8666-666666666666', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '66666666-6666-4666-8666-666666666666': {
        status: { completed: true, status_str: 'success' },
        outputs: { '8': { images: [{ filename: 'portrait-generated-end-frame_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (value.includes('/view?')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitEndFrame(fetcher, 'http://comfy/', requests.generated, input, 43);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait-end-frame');
  assert.equal(queued.prompt['1'].inputs.unet_name, MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['5'].class_type, 'TextEncodeMageFlowEdit');
  assert.equal(queued.prompt['6'].inputs.seed, 43);
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(result.bytes, png);
});

test('rejects unsafe history and cancels only the targeted failed job', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': { status: { completed: true, status_str: 'error' }, outputs: {} }
    });
    if (value.endsWith('/api/jobs/33333333-3333-4333-8333-333333333333/cancel')) return Response.json({ cancelled: true });
    throw new Error(`unexpected URL ${value}`);
  };
  await assert.rejects(runComfyPortraitVideo(fetcher, 'http://comfy', requests.loop, input, 42), /execution failed/);
  assert.equal(calls.at(-1).url, 'http://comfy/api/jobs/33333333-3333-4333-8333-333333333333/cancel');
});

test('rejects traversal, wrong animation metadata, MIME, signature, and oversized output', async () => {
  const run = (output, response) => runComfyPortraitVideo(async (url) => {
    const value = String(url);
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' }, outputs: { '15': output }
      }
    });
    return response;
  }, 'http://comfy', requests.i2v, input, 42);
  await assert.rejects(run({ images: [{ filename: '../secret.mp4', subfolder: 'mullet', type: 'output' }], animated: [true] }), /unexpected portrait-video filename/);
  const good = { images: [{ filename: 'portrait-motion_00001_.mp4', subfolder: 'mullet', type: 'output' }], animated: [true] };
  await assert.rejects(run(good, new Response('no', { headers: { 'content-type': 'text/plain' } })), /not MP4/);
  await assert.rejects(run(good, new Response('not-an-mp4', { headers: { 'content-type': 'video/mp4' } })), /invalid MP4 signature/);
  await assert.rejects(run(good, new Response(mp4, { headers: { 'content-type': 'video/mp4', 'content-length': String(64 * 1024 * 1024 + 1) } })), ComfyPortraitVideoOutputTooLargeError);
});
