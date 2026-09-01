import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_MODE_I2V,
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
  width: 576,
  height: 1024,
  generatedAt: 17
};

const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageSha256 = await sha256Hex(imageBytes);
const requests = {
  i2v: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_I2V, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  loopFlf: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  generatedFlf: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  i2v: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_I2V, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  loop: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  loopFive: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 5, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  generated: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF, 2, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  )
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
  width: 576,
  height: 1024,
  frames: 56,
  fps: 28,
  videoTimescale: 14_336,
  includeAudio: false
});
const mp4Five = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 124, includeAudio: false });
const h264Mp4 = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 49, includeAudio: false });

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, section, inputName, options) {
  return { [node]: { input: { [section]: {
    [inputName]: ['COMFY_DYNAMICCOMBO_V3', { options: options.map((key) => ({ key })) }]
  } } } };
}

function capabilityResponse(node, includeLastFrame = true, lengthStep = 17, lengthMaximum = 3600) {
  const minimaxFiles = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [minimaxFiles.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[minimaxFiles.clip, endFiles.clip]],
    type: [['minimax', 'qwen_image']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [
    minimaxFiles.videoVae, endFiles.vae
  ]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [minimaxFiles.turboLora, endFiles.lora]);
  if (node === 'KSamplerSelect') return standardInfo(node, 'sampler_name', ['euler_ancestral', 'res_multistep', 'euler']);
  if (node === 'KSampler') return { [node]: { input: { required: {
    sampler_name: [['euler']],
    scheduler: [['simple']]
  } } } };
  if (node === 'BasicScheduler') return { [node]: { input: { required: {
    scheduler: [['simple']],
    steps: ['INT', { min: 1, max: 10000, step: 1 }],
    denoise: ['FLOAT', { min: 0, max: 1, step: 0.01 }]
  } } } };
  if (node === 'MiniMaxH3SigmaShift') return { [node]: { input: { required: {
    model: ['MODEL', {}],
    shift_video: ['FLOAT', { min: 0.01, max: 100, step: 0.01 }],
    shift_audio: ['FLOAT', { min: 0.01, max: 100, step: 0.01 }]
  } } } };
  if (node === 'CreateVideo') return { [node]: { input: { required: {
    images: ['IMAGE', {}],
    fps: ['FLOAT', { min: 1, max: 120, step: 1 }]
  } } } };
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

function templateCapability(capabilities, id) {
  const capability = capabilities.templates.find(({ template }) => template.id === id);
  assert.ok(capability, `missing template capability ${id}`);
  return capability;
}



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
  view.setUint32(16, 576, false);
  view.setUint32(20, 1024, false);
  assert.doesNotThrow(() => validatePortraitVideoPng(png, 576, 1024));
  assert.throws(() => validatePortraitVideoPng(png, 576, 768), /dimensions do not match/);
});

async function runMode(selectedRequest, filename, selectedEndInput, outputBytes) {
  const observed = [];
  const outputNode = '15';
  const contentType = 'video/mp4';
  const selectedOutputBytes = outputBytes ?? mp4;
  const fetcher = async (url, init) => {
    const value = String(url);
    observed.push({ url: value, init });
    if (value.endsWith('/prompt')) return Response.json({ prompt_id: '33333333-3333-4333-8333-333333333333', node_errors: {} });
    if (value.includes('/history/')) return Response.json({
      '33333333-3333-4333-8333-333333333333': {
        status: { completed: true, status_str: 'success' },
        outputs: { [outputNode]: { images: [{ filename, subfolder: 'mullet', type: 'output' }], animated: [true] } }
      }
    });
    if (value.includes('/view?')) return new Response(selectedOutputBytes, { headers: { 'content-type': contentType } });
    throw new Error(`unexpected URL ${value}`);
  };
  const result = await runComfyPortraitVideo(fetcher, 'http://comfy/', selectedRequest, input, 42, undefined, selectedEndInput);
  return { result, observed, queued: JSON.parse(observed[0].init.body) };
}




test('queues and validates exact two-second MiniMax H3 I2V as H.264 video-only MP4', async () => {
  const { result, observed, queued } = await runMode(requests.i2v, 'portrait-motion_00001_.mp4');
  assert.equal(queued.client_id, 'mullet-portrait-video');
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.equal(Object.hasOwn(queued.prompt['6'].inputs, 'last_frame'), false);
  assert.equal(queued.prompt['6'].inputs.length, 56);
  assert.equal(Object.hasOwn(queued.prompt, '4'), false);
  assert.equal(Object.hasOwn(queued.prompt, '13'), false);
  assert.equal(Object.hasOwn(queued.prompt['14'].inputs, 'audio'), false);
  assert.equal(Object.hasOwn(queued.prompt['14'].inputs, 'bit_depth'), false);
  assert.equal(queued.prompt['14'].inputs.fps, 28);
  assert.deepEqual(queued.prompt['7'].inputs.model, ['18', 0]);
  assert.deepEqual(queued.prompt['9'].inputs.model, ['18', 0]);
  assert.deepEqual(queued.prompt['18'].inputs, { model: ['16', 0], shift_video: 6, shift_audio: 3 });
  assert.equal(queued.prompt['15'].class_type, 'SaveVideo');
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion_00001_.mp4&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.durationSeconds, 2);
  assert.equal(result.audioTracks, 0);
  assert.deepEqual(result.bytes, mp4);
});

test('rejects every audio-bearing portrait MP4', async () => {
  const audioMp4 = buildH264AacMp4Fixture({
    width: 576,
    height: 1024,
    frames: 56,
    fps: 28,
    videoTimescale: 14_336
  });
  await assert.rejects(
    runMode(requests.i2v, 'portrait-motion_00002_.mp4', undefined, audioMp4),
    /must not contain an audio track/
  );
});

test('queues the default exact two-second natural loop with the identical first and last H3 frame', async () => {
  const { queued, observed } = await runMode(requests.loop, 'portrait-motion-loop-flf_00001_.mp4');
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['5', 0]);
  assert.equal(queued.prompt['6'].inputs.length, 56);
  assert.equal(queued.prompt['14'].inputs.fps, 28);
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

test('queues generated-keyframe FLF with the distinct Qwen Image Edit image as H3 last frame', async () => {
  const { queued, observed } = await runMode(requests.generated, 'portrait-motion-generated-flf_00001_.mp4', endInput);
  assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['17', 0]);
  assert.equal(queued.prompt['17'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion-generated-flf_00001_.mp4&subfolder=mullet&type=output');
});

test('queues and validates the exact Qwen Image Edit 2511 Lightning portrait end-frame PNG', async () => {
  const observed = [];
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 576, false);
  view.setUint32(20, 1024, false);
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
  const result = await runComfyPortraitEndFrame(fetcher, 'http://comfy/', requests.generated, input, 43);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait-end-frame');
  assert.deepEqual(QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles, {
    unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'
  });
  assert.equal(queued.prompt['1'].inputs.unet_name, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['2'].inputs.type, 'qwen_image');
  assert.equal(queued.prompt['4'].inputs.image, `mullet/motion-inputs/${input.name}`);
  assert.deepEqual(queued.prompt['5'].inputs, {
    image: ['4', 0],
    upscale_method: 'lanczos',
    width: 576,
    height: 1024,
    crop: 'center'
  });
  assert.equal(queued.prompt['8'].inputs.lora_name, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.lora);
  assert.equal(queued.prompt['8'].inputs.strength_model, 1);
  assert.equal(queued.prompt['12'].inputs.seed, 43);
  assert.deepEqual(queued.prompt['14'].inputs.images, ['13', 0]);
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
