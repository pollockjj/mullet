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
  buildLtx25PortraitVideoWorkflow,
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
});

test('rejects arbitrary templates, durations, paths, and mismatched portrait dimensions', () => {
  const built = request();
  assert.throws(() => normalizePortraitVideoRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait-video model/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, durationSeconds: 5 }), /unsupported portrait-video duration/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, source: { ...built.source, portraitWidth: 832 } }), /dimensions do not match/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(built, {
    name: '../escape.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: built.source.portraitImageSha256
  }, 1), /input reference is invalid/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(built, {
    name: 'portrait-motion-22222222-2222-4222-8222-222222222222.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'b'.repeat(64)
  }, 1), /input reference is invalid/);
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait({ generatedAt: 18 }), '2:3', 'a'.repeat(64))));
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(buildPortraitVideoRequest(portrait(), '2:3', 'b'.repeat(64))));
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
