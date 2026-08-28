import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_VIDEO_DURATION_SECONDS,
  PORTRAIT_VIDEO_FPS,
  PORTRAIT_VIDEO_FRAMES,
  PORTRAIT_VIDEO_MODE_I2V,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_MODE_LOOP_FLF,
  PORTRAIT_VIDEO_MODES,
  PORTRAIT_VIDEO_REQUEST_SPEC,
  PORTRAIT_VIDEO_TEMPLATE_ID,
  QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
  buildPortraitEndFramePrompt,
  buildPortraitVideoPrompt,
  buildPortraitVideoRequest,
  buildLtx25PortraitVideoWorkflow,
  buildQwenPortraitEndFrameWorkflow,
  normalizePortraitVideoRequest,
  portraitVideoDimensions,
  portraitVideoEndFrameSeed,
  portraitVideoOutputNode,
  portraitVideoRequestKey
} from '../src/lib/portrait-video.ts';

function portrait(overrides = {}) {
  return {
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
    generatedAt: 17,
    ...overrides
  };
}

function request(overrides = {}) {
  const built = buildPortraitVideoRequest(portrait(), '2:3', 'a'.repeat(64));
  return { ...built, ...overrides };
}

test('maps every portrait ratio to an exact rendered divisible-by-64 two-second video', () => {
  assert.deepEqual(portraitVideoDimensions('2:3'), { width: 384, height: 576, frames: 49, fps: 24 });
  for (const aspectRatio of ['2:3', '3:4', '4:5', '9:16']) {
    const dimensions = portraitVideoDimensions(aspectRatio);
    assert.equal(dimensions.width % 64, 0);
    assert.equal(dimensions.height % 64, 0);
    assert.equal(dimensions.frames, PORTRAIT_VIDEO_FRAMES);
    assert.equal((dimensions.frames - 1) / PORTRAIT_VIDEO_FPS, PORTRAIT_VIDEO_DURATION_SECONDS);
  }
});

test('binds portrait motion to one generated portrait without transcript text', () => {
  const built = request();
  assert.equal(built.spec, PORTRAIT_VIDEO_REQUEST_SPEC);
  assert.equal(built.modelTemplate, PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(built.mode, PORTRAIT_VIDEO_MODE_I2V);
  assert.equal(built.endFrameModelTemplate, null);
  assert.equal(built.source.portraitRequestKey, 'opaque-portrait-request-key');
  assert.equal(built.source.portraitPromptId, '11111111-1111-4111-8111-111111111111');
  assert.equal(built.source.portraitSeed, 41);
  assert.equal(built.source.portraitSource.expression, 'grief');
  assert.equal(JSON.stringify(built).includes('assistant'), false);
  assert.equal(JSON.stringify(built).includes('transcript'), false);
});

test('builds a fixed motion prompt from expression metadata only', () => {
  const promptText = buildPortraitVideoPrompt(request());
  assert.match(promptText, /restrained grief expression/);
  assert.match(promptText, /seamless loop/);
  assert.match(promptText, /No camera movement, no cuts/);
  assert.equal(promptText.includes('opaque-portrait-request-key'), false);
});

test('compiles the fixed LTX 2.5 distilled I2V workflow', () => {
  const graph = buildLtx25PortraitVideoWorkflow(request(), {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'a'.repeat(64)
  }, 42);
  assert.deepEqual(graph['1'].inputs, { image: 'mullet/motion-inputs/portrait-motion-22222222-2222-4222-8222-222222222222.png' });
  assert.equal(graph['3'].inputs.unet_name, 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors');
  assert.equal(graph['4'].inputs.clip_name, 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors');
  assert.equal(graph['5'].inputs.vae_name, 'ltx-2.5-video-vae-bf16.safetensors');
  assert.equal(graph['6'].inputs.vae_name, 'ltx-2.5-audio-vae-bf16.safetensors');
  assert.equal(graph['11'].inputs.width, 192);
  assert.equal(graph['11'].inputs.height, 288);
  assert.equal(graph['11'].inputs.length, 49);
  assert.equal(graph['16'].inputs.noise_seed, 42);
  assert.equal(graph['31'].inputs.codec, 'vp9');
  assert.equal(graph['31'].inputs.fps, 24);
  assert.equal(portraitVideoOutputNode(request()), '31');
});

test('compiles a true identical first/last-frame looping workflow in both passes', () => {
  const loopRequest = buildPortraitVideoRequest(portrait(), '2:3', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_LOOP_FLF);
  const graph = buildLtx25PortraitVideoWorkflow(loopRequest, {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'a'.repeat(64)
  }, 42);
  assert.deepEqual(PORTRAIT_VIDEO_MODES.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.equal(graph['12'].class_type, 'LTXVAddGuide');
  assert.equal(graph['12'].inputs.frame_idx, 0);
  assert.equal(graph['12'].inputs.strength, 0.7);
  assert.deepEqual(graph['12'].inputs.image, ['2', 0]);
  assert.equal(graph['13'].class_type, 'LTXVAddGuide');
  assert.equal(graph['13'].inputs.frame_idx, -1);
  assert.deepEqual(graph['13'].inputs.image, ['2', 0]);
  assert.deepEqual(graph['22'].inputs.latent, ['21', 0]);
  assert.equal(graph['22'].class_type, 'LTXVCropGuides');
  assert.equal(graph['24'].inputs.frame_idx, 0);
  assert.equal(graph['25'].inputs.frame_idx, -1);
  assert.deepEqual(graph['24'].inputs.image, ['2', 0]);
  assert.deepEqual(graph['25'].inputs.image, ['2', 0]);
  assert.equal(graph['33'].class_type, 'LTXVCropGuides');
  assert.deepEqual(graph['34'].inputs.samples, ['33', 2]);
  assert.equal(graph['35'].inputs.codec, 'vp9');
  assert.equal(graph['35'].inputs.fps, 24);
  assert.equal(portraitVideoOutputNode(loopRequest), '35');
  assert.match(buildPortraitVideoPrompt(loopRequest), /identical supplied portrait is the first and final keyframe/);
});

test('compiles the proven Qwen edit followed by distinct first/end-frame FLF guides', () => {
  const generatedRequest = buildPortraitVideoRequest(
    portrait(),
    '2:3',
    'a'.repeat(64),
    PORTRAIT_VIDEO_MODE_GENERATED_FLF
  );
  const firstInput = {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'a'.repeat(64)
  };
  const endInput = {
    name: 'portrait-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'b'.repeat(64)
  };
  assert.equal(generatedRequest.endFrameModelTemplate, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.id);
  assert.equal(portraitVideoEndFrameSeed(42), 43);
  assert.equal(portraitVideoEndFrameSeed(Number.MAX_SAFE_INTEGER), 0);
  assert.match(buildPortraitEndFramePrompt(generatedRequest), /exact same subject/);
  assert.match(buildPortraitVideoPrompt(generatedRequest), /distinct final pose/);
  assert.doesNotMatch(buildPortraitVideoPrompt(generatedRequest), /seamless loop/);

  const endGraph = buildQwenPortraitEndFrameWorkflow(generatedRequest, firstInput, 43);
  assert.equal(endGraph['1'].inputs.unet_name, 'qwen_image_edit_2511_int8_convrot.safetensors');
  assert.equal(endGraph['2'].inputs.clip_name, 'qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(endGraph['2'].inputs.type, 'qwen_image');
  assert.equal(endGraph['3'].inputs.vae_name, 'qwen_image_vae.safetensors');
  assert.equal(endGraph['8'].inputs.lora_name, 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
  assert.equal(endGraph['12'].inputs.seed, 43);
  assert.equal(endGraph['12'].inputs.steps, 4);
  assert.equal(endGraph['12'].inputs.sampler_name, 'euler');
  assert.deepEqual(endGraph['14'].inputs.images, ['15', 0]);
  assert.equal(endGraph['15'].inputs.width, 768);
  assert.equal(endGraph['15'].inputs.height, 1152);

  const graph = buildLtx25PortraitVideoWorkflow(generatedRequest, firstInput, 42, endInput);
  assert.deepEqual(graph['12'].inputs.image, ['2', 0]);
  assert.deepEqual(graph['13'].inputs.image, ['37', 0]);
  assert.deepEqual(graph['24'].inputs.image, ['2', 0]);
  assert.deepEqual(graph['25'].inputs.image, ['37', 0]);
  assert.equal(graph['36'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.deepEqual(graph['37'].inputs.image, ['36', 0]);
  assert.equal(graph['35'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');
  assert.equal(portraitVideoOutputNode(generatedRequest), '35');
});

test('rejects arbitrary templates, durations, paths, and mismatched portrait dimensions', () => {
  const built = request();
  assert.throws(() => normalizePortraitVideoRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait-video model/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, durationSeconds: 5 }), /unsupported portrait-video duration/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, mode: 'anything' }), /unsupported portrait-video mode/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, endFrameModelTemplate: 'anything' }), /end-frame template/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, source: { ...built.source, portraitWidth: 832 } }), /dimensions do not match/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(built, {
    name: '../escape.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: built.source.portraitImageSha256
  }, 1), /input reference is invalid/);
  const generated = buildPortraitVideoRequest(portrait(), '2:3', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(generated, {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'a'.repeat(64)
  }, 1), /end-frame input is required/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(built, {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'b'.repeat(64)
  }, 1), /input reference is invalid/);
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait({ generatedAt: 18 }), '2:3', 'a'.repeat(64))));
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait(), '2:3', 'b'.repeat(64))));
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait(), '2:3', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_LOOP_FLF)));
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(generated));
  assert.notEqual(
    portraitVideoRequestKey(built),
    portraitVideoRequestKey({
      ...built,
      source: {
        ...built.source,
        portraitSource: { ...built.source.portraitSource, expression: 'joy' }
      }
    })
  );
});
