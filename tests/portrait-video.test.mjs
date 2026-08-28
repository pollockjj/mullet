import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_VIDEO_DURATION_SECONDS,
  PORTRAIT_VIDEO_FPS,
  PORTRAIT_VIDEO_FRAMES,
  PORTRAIT_VIDEO_REQUEST_SPEC,
  PORTRAIT_VIDEO_TEMPLATE_ID,
  buildPortraitVideoPrompt,
  buildPortraitVideoRequest,
  buildWanPortraitVideoWorkflow,
  normalizePortraitVideoRequest,
  portraitVideoDimensions,
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
    width: 768,
    height: 1152,
    generatedAt: 17,
    ...overrides
  };
}

function request(overrides = {}) {
  const built = buildPortraitVideoRequest(portrait(), '2:3');
  return { ...built, ...overrides };
}

test('maps every portrait ratio to an exact divisible-by-16 two-second video', () => {
  assert.deepEqual(portraitVideoDimensions('2:3'), { width: 480, height: 720, frames: 33, fps: 16 });
  for (const aspectRatio of ['2:3', '3:4', '4:5', '9:16']) {
    const dimensions = portraitVideoDimensions(aspectRatio);
    assert.equal(dimensions.width % 16, 0);
    assert.equal(dimensions.height % 16, 0);
    assert.equal(dimensions.frames, PORTRAIT_VIDEO_FRAMES);
    assert.equal((dimensions.frames - 1) / PORTRAIT_VIDEO_FPS, PORTRAIT_VIDEO_DURATION_SECONDS);
  }
});

test('binds portrait motion to one generated portrait without transcript text', () => {
  const built = request();
  assert.equal(built.spec, PORTRAIT_VIDEO_REQUEST_SPEC);
  assert.equal(built.modelTemplate, PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(built.source.portraitRequestKey, 'opaque-portrait-request-key');
  assert.equal(built.source.portraitPromptId, '11111111-1111-4111-8111-111111111111');
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

test('compiles the fixed Wan 2.1 I2V workflow', () => {
  const graph = buildWanPortraitVideoWorkflow(request(), 'mullet/portrait_00017_.png', 42);
  assert.deepEqual(graph['1'].inputs, { image: 'mullet/portrait_00017_.png' });
  assert.equal(graph['2'].inputs.unet_name, 'wan2.1_i2v_480p_14B_fp16.safetensors');
  assert.equal(graph['3'].inputs.clip_name, 'umt5_xxl_fp8_e4m3fn_scaled.safetensors');
  assert.equal(graph['4'].inputs.vae_name, 'wan_2.1_vae.safetensors');
  assert.equal(graph['5'].inputs.clip_name, 'clip_vision_h.safetensors');
  assert.equal(graph['10'].inputs.width, 480);
  assert.equal(graph['10'].inputs.height, 720);
  assert.equal(graph['10'].inputs.length, 33);
  assert.equal(graph['11'].inputs.seed, 42);
  assert.equal(graph['11'].inputs.steps, 20);
  assert.equal(graph['13'].inputs.codec, 'vp9');
  assert.equal(graph['13'].inputs.fps, 16);
});

test('rejects arbitrary templates, durations, paths, and mismatched portrait dimensions', () => {
  const built = request();
  assert.throws(() => normalizePortraitVideoRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait-video model/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, durationSeconds: 5 }), /unsupported portrait-video duration/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, source: { ...built.source, portraitWidth: 832 } }), /dimensions do not match/);
  assert.throws(() => buildWanPortraitVideoWorkflow(built, '../escape.png', 1), /input path is invalid/);
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait({ generatedAt: 18 }), '2:3')));
});
