import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
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
import { buildVp9WebmFixture } from './webm-fixture.mjs';

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
  ltxI2v: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_I2V, 2, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  ltxLoop: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 2, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  ltxGenerated: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF, 2, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  i2v: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_I2V, 3, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  loop: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 3, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  loopFive: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_LOOP_FLF, 5, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ),
  generated: buildPortraitVideoRequest(
    portrait, '9:16', imageSha256, PORTRAIT_VIDEO_MODE_GENERATED_FLF, 3, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
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
  frames: 73,
  includeAudio: false
});
const mp4Five = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 124, includeAudio: false });
const webm = buildVp9WebmFixture({ width: 576, height: 1024, frames: 49, fps: 24 });

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, section, inputName, options) {
  return { [node]: { input: { [section]: {
    [inputName]: ['COMFY_DYNAMICCOMBO_V3', { options: options.map((key) => ({ key })) }]
  } } } };
}

function capabilityResponse(node, includeLastFrame = true, lengthStep = 17, lengthMaximum = 3600) {
  const ltxFiles = LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const minimaxFiles = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [ltxFiles.unet, minimaxFiles.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[ltxFiles.clip, minimaxFiles.clip, endFiles.clip]],
    type: [['ltxv', 'minimax', 'qwen_image']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [
    ltxFiles.videoVae, ltxFiles.audioVae, minimaxFiles.videoVae, endFiles.vae
  ]);
  if (node === 'LatentUpscaleModelLoader') return standardInfo(node, 'model_name', [ltxFiles.latentUpscaler]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [minimaxFiles.turboLora, endFiles.lora]);
  if (node === 'KSamplerSelect') return standardInfo(node, 'sampler_name', ['euler_ancestral', 'res_multistep', 'euler']);
  if (node === 'KSampler') return { [node]: { input: { required: {
    sampler_name: [['euler']],
    scheduler: [['simple']]
  } } } };
  if (node === 'BasicScheduler') return standardInfo(node, 'scheduler', ['simple']);
  if (node === 'SaveWEBM') return standardInfo(node, 'codec', ['vp9']);
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

test('reports additive LTX and MiniMax capabilities with exact per-template diagnostics', async () => {
  const fetcher = async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node));
  };
  const capabilities = await loadPortraitVideoCapabilities(fetcher, 'http://video-comfy', 'http://image-comfy');
  assert.equal(capabilities.spec, 'mullet_portrait_video_capabilities_v8');
  assert.deepEqual(capabilities.templates.map(({ template }) => template.id), [
    LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
    MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  ]);
  assert.equal(capabilities.endFrameTemplate?.id, 'qwen-image-edit-2511-end-frame-v1');
  const ltx = templateCapability(capabilities, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  const minimax = templateCapability(capabilities, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(ltx.available, true);
  assert.equal(minimax.available, true);
  assert.deepEqual(ltx.modes.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.deepEqual(ltx.modes.map(({ missing }) => missing), [[], [], []]);
  assert.deepEqual(minimax.modes.map(({ missing }) => missing), [[], [], []]);
  assert.deepEqual(ltx.durations, [2]);
  assert.deepEqual(minimax.durations, [3, 5]);

  const withoutLtxUnet = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'UNETLoader') return Response.json(standardInfo(node, 'unet_name', [
      MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet,
      QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet
    ]));
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  const ltxWithoutUnet = templateCapability(withoutLtxUnet, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(ltxWithoutUnet.available, false);
  assert.deepEqual(ltxWithoutUnet.missing, [
    `model:unet:${LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet}`
  ]);
  assert.deepEqual(ltxWithoutUnet.modes.map(({ missing }) => missing), [
    [`model:unet:${LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet}`],
    [`model:unet:${LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet}`],
    [`model:unet:${LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet}`]
  ]);
  assert.equal(templateCapability(withoutLtxUnet, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID).available, true);

  const withoutMinimaxUnet = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'UNETLoader') return Response.json(standardInfo(node, 'unet_name', [
      LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet,
      QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet
    ]));
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  assert.equal(templateCapability(withoutMinimaxUnet, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID).available, true);
  assert.deepEqual(templateCapability(withoutMinimaxUnet, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID).missing, [
    `model:unet:${MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet}`
  ]);

  const withoutLtxI2vNode = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'LTXVImgToVideoInplace') return new Response('missing', { status: 404 });
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  const ltxWithoutI2vNode = templateCapability(withoutLtxI2vNode, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(ltxWithoutI2vNode.available, true);
  assert.deepEqual(ltxWithoutI2vNode.modes.map(({ missing }) => missing), [
    ['node:LTXVImgToVideoInplace'],
    [],
    []
  ]);

  const withoutLtxGuide = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'LTXVAddGuide') return new Response('missing', { status: 404 });
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  const ltxWithoutGuide = templateCapability(withoutLtxGuide, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(ltxWithoutGuide.available, true);
  assert.deepEqual(ltxWithoutGuide.modes.map(({ missing }) => missing), [
    [],
    ['node:LTXVAddGuide'],
    ['node:LTXVAddGuide']
  ]);

  const withoutLastFrame = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, false));
  }, 'http://video-comfy', 'http://image-comfy');
  const minimaxWithoutLastFrame = templateCapability(withoutLastFrame, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(minimaxWithoutLastFrame.modes[0].available, true);
  assert.deepEqual(minimaxWithoutLastFrame.modes[1].missing, ['node-input:MiniMaxH3ImageToVideo.last_frame']);
  assert.deepEqual(minimaxWithoutLastFrame.modes[2].missing, ['node-input:MiniMaxH3ImageToVideo.last_frame']);

  const wrongLengthGrid = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, true, 16));
  }, 'http://video-comfy', 'http://image-comfy');
  assert.deepEqual(templateCapability(wrongLengthGrid, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID).modes[0].missing, [
    'node-input:MiniMaxH3ImageToVideo.length:73',
    'node-input:MiniMaxH3ImageToVideo.length:124'
  ]);

  const missingLongDuration = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    return Response.json(capabilityResponse(node, true, 17, 100));
  }, 'http://video-comfy', 'http://image-comfy');
  assert.deepEqual(
    templateCapability(missingLongDuration, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID).modes[0].missing,
    ['node-input:MiniMaxH3ImageToVideo.length:124']
  );

  const withoutEndFrame = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'TextEncodeQwenImageEditPlus') return new Response('missing', { status: 404 });
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  assert.equal(withoutEndFrame.endFrameTemplate.id, 'qwen-image-edit-2511-end-frame-v1');
  for (const capability of withoutEndFrame.templates) {
    assert.equal(capability.modes[0].available, true, capability.template.id);
    assert.equal(capability.modes[1].available, true, capability.template.id);
    assert.deepEqual(capability.modes[2], {
      id: 'flf2v_generated',
      label: 'Generated second-frame FLF',
      available: false,
      missing: ['node:TextEncodeQwenImageEditPlus']
    }, capability.template.id);
  }

  const withoutQwenModel = await loadPortraitVideoCapabilities(async (url) => {
    const node = decodeURIComponent(String(url).split('/').at(-1));
    if (node === 'UNETLoader') {
      return Response.json(standardInfo(node, 'unet_name', [
        LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet,
        MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet
      ]));
    }
    return Response.json(capabilityResponse(node));
  }, 'http://video-comfy', 'http://image-comfy');
  for (const capability of withoutQwenModel.templates) {
    assert.equal(capability.modes[0].available, true, capability.template.id);
    assert.equal(capability.modes[1].available, true, capability.template.id);
    assert.deepEqual(capability.modes[2].missing, [
      `model:unet:${QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet}`
    ], capability.template.id);
  }
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
  view.setUint32(16, 576, false);
  view.setUint32(20, 1024, false);
  assert.doesNotThrow(() => validatePortraitVideoPng(png, 576, 1024));
  assert.throws(() => validatePortraitVideoPng(png, 576, 768), /dimensions do not match/);
});

async function runMode(selectedRequest, filename, selectedEndInput, outputBytes) {
  const observed = [];
  const ltx = selectedRequest.modelTemplate === LTX25_PORTRAIT_VIDEO_TEMPLATE_ID;
  const outputNode = ltx && selectedRequest.mode !== PORTRAIT_VIDEO_MODE_I2V ? '35' : ltx ? '31' : '15';
  const contentType = ltx ? 'video/webm' : 'video/mp4';
  const selectedOutputBytes = outputBytes ?? (ltx ? webm : mp4);
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

test('queues and validates fixed two-second LTX 2.5 I2V as silent VP9 WebM', async () => {
  const { result, observed, queued } = await runMode(requests.ltxI2v, 'portrait-motion_00001_.webm');
  assert.equal(queued.client_id, 'mullet-portrait-video');
  assert.equal(queued.prompt['1'].inputs.image, `mullet/motion-inputs/${input.name}`);
  assert.equal(queued.prompt['3'].inputs.unet_name, LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['11'].inputs.length, 49);
  assert.equal(queued.prompt['16'].inputs.noise_seed, 42);
  assert.equal(queued.prompt['31'].class_type, 'SaveWEBM');
  assert.equal(queued.prompt['31'].inputs.codec, 'vp9');
  assert.equal(Object.hasOwn(queued.prompt['31'].inputs, 'audio'), false);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait-motion_00001_.webm&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'video/webm');
  assert.equal(result.durationSeconds, 2.042);
  assert.equal(result.audioTracks, 0);
  assert.deepEqual(result.bytes, webm);
});

test('dispatches LTX loop and generated-FLF output nodes and filenames independently', async () => {
  const loop = await runMode(requests.ltxLoop, 'portrait-motion-loop-flf_00001_.webm');
  assert.equal(loop.queued.prompt['12'].class_type, 'LTXVAddGuide');
  assert.deepEqual(loop.queued.prompt['13'].inputs.image, ['2', 0]);
  assert.equal(loop.queued.prompt['35'].inputs.filename_prefix, 'mullet/portrait-motion-loop-flf');
  assert.equal(loop.observed[2].url, 'http://comfy/view?filename=portrait-motion-loop-flf_00001_.webm&subfolder=mullet&type=output');

  const generated = await runMode(
    requests.ltxGenerated,
    'portrait-motion-generated-flf_00001_.webm',
    endInput
  );
  assert.equal(generated.queued.prompt['36'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.deepEqual(generated.queued.prompt['13'].inputs.image, ['37', 0]);
  assert.equal(generated.queued.prompt['35'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');
  assert.equal(generated.result.contentType, 'video/webm');
});

test('rejects audio-bearing or wrong-contract LTX WebM output', async () => {
  await assert.rejects(
    runMode(
      requests.ltxI2v,
      'portrait-motion_00002_.webm',
      undefined,
      buildVp9WebmFixture({ width: 576, height: 1024, frames: 49, fps: 24, includeAudio: true })
    ),
    /must not contain audio or extra non-video media tracks/
  );
  await assert.rejects(
    runMode(
      requests.ltxI2v,
      'portrait-motion_00003_.webm',
      undefined,
      buildVp9WebmFixture({ width: 576, height: 1024, frames: 48, fps: 24 })
    ),
    /frame count/
  );
});

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
  const audioMp4 = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 73 });
  await assert.rejects(
    runMode(requests.i2v, 'portrait-motion_00002_.mp4', undefined, audioMp4),
    /must not contain an audio track/
  );
});

test('queues the default three-second natural loop with the identical first and last H3 frame', async () => {
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
