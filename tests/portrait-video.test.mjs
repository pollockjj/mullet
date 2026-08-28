import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  PORTRAIT_VIDEO_DURATION_SECONDS,
  PORTRAIT_VIDEO_DURATIONS,
  PORTRAIT_VIDEO_FPS,
  PORTRAIT_VIDEO_FRAMES,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_MODE_I2V,
  PORTRAIT_VIDEO_MODE_LOOP_FLF,
  PORTRAIT_VIDEO_MODES,
  PORTRAIT_VIDEO_REQUEST_SPEC,
  PORTRAIT_VIDEO_TEMPLATE_ID,
  FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE,
  buildFlux2Klein9BPortraitEndFrameWorkflow,
  buildMiniMaxH3PortraitVideoWorkflow,
  buildPortraitEndFramePrompt,
  buildPortraitVideoPrompt,
  buildPortraitVideoRequest,
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
    width: 704,
    height: 704,
    generatedAt: 17,
    ...overrides
  };
}

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

test('maps the fixed 1:1 expression ratio and every duration to the bounded MiniMax frame grid', () => {
  assert.deepEqual(PORTRAIT_VIDEO_DURATIONS, [3, 5]);
  assert.deepEqual(portraitVideoDimensions('1:1'), { width: 768, height: 768, frames: 73, fps: 24 });
  assert.deepEqual(portraitVideoDimensions('1:1', 5), { width: 768, height: 768, frames: 124, fps: 24 });
  for (const duration of PORTRAIT_VIDEO_DURATIONS) {
    const dimensions = portraitVideoDimensions('1:1', duration);
    assert.equal(dimensions.width % MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.multiple, 0);
    assert.equal(dimensions.height % MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.multiple, 0);
    assert.equal(Math.min(dimensions.width, dimensions.height), 768);
    assert.equal((dimensions.frames - 5) % 17, 0);
  }
  assert.throws(() => portraitVideoDimensions('3:4'), /unsupported portrait-video aspect ratio/);
  assert.equal((portraitVideoDimensions('1:1', 3).frames - 1) / PORTRAIT_VIDEO_FPS, PORTRAIT_VIDEO_DURATION_SECONDS);
  assert.equal((portraitVideoDimensions('1:1', 5).frames - 1) / PORTRAIT_VIDEO_FPS, 5.125);
  assert.equal(PORTRAIT_VIDEO_FRAMES, 73);
});

test('defaults every portrait request to the identical-frame H3 loop', () => {
  const built = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64));
  assert.equal(built.spec, PORTRAIT_VIDEO_REQUEST_SPEC);
  assert.equal(built.modelTemplate, PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(built.modelTemplate, 'minimax-h3-fl2va-portrait-v1');
  assert.equal(built.mode, PORTRAIT_VIDEO_MODE_LOOP_FLF);
  assert.equal(built.endFrameModelTemplate, null);
  assert.equal(built.durationSeconds, 3);
  assert.equal(JSON.stringify(built).includes('assistant'), false);
  assert.equal(JSON.stringify(built).includes('transcript'), false);
  assert.match(buildPortraitVideoPrompt(built), /identical supplied portrait is the first and final keyframe/);
  assert.match(buildPortraitVideoPrompt(built), /Silent video only/);
  assert.match(buildPortraitVideoPrompt(built), /no talking, no lip or mouth movement, and no speech gestures/);
});

test('compiles first-frame-only MiniMax H3 I2V with H.264 video-only output', () => {
  const request = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_I2V);
  const graph = buildMiniMaxH3PortraitVideoWorkflow(request, firstInput, 42);
  assert.equal(graph['1'].inputs.unet_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip);
  assert.equal(graph['2'].inputs.type, 'minimax');
  assert.equal(graph['3'].inputs.vae_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.videoVae);
  assert.equal(Object.hasOwn(graph, '4'), false);
  assert.equal(graph['6'].class_type, 'MiniMaxH3ImageToVideo');
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.equal(Object.hasOwn(graph['6'].inputs, 'last_frame'), false);
  assert.equal(graph['6'].inputs.width, 768);
  assert.equal(graph['6'].inputs.height, 768);
  assert.equal(graph['6'].inputs.length, 73);
  assert.equal(graph['10'].inputs.noise_seed, 42);
  assert.equal(Object.hasOwn(graph, '13'), false);
  assert.equal(Object.hasOwn(graph['14'].inputs, 'audio'), false);
  assert.equal(graph['15'].class_type, 'SaveVideo');
  assert.equal(graph['15'].inputs.format, 'auto');
  assert.equal(graph['15'].inputs.codec, 'auto');
  assert.equal(portraitVideoOutputNode(request), '15');
});

test('compiles the default loop by wiring the same image as first and last H3 frames', () => {
  const request = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64));
  const graph = buildMiniMaxH3PortraitVideoWorkflow(request, firstInput, 42);
  assert.deepEqual(PORTRAIT_VIDEO_MODES.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(graph['6'].inputs.last_frame, ['5', 0]);
  assert.equal(graph['15'].inputs.filename_prefix, 'mullet/portrait-motion-loop-flf');
  assert.equal(portraitVideoOutputNode(request), '15');
});

test('compiles the selected five-second loop as 124 identical-frame-conditioned frames', () => {
  const request = buildPortraitVideoRequest(
    portrait(),
    '1:1',
    'a'.repeat(64),
    PORTRAIT_VIDEO_MODE_LOOP_FLF,
    5
  );
  const graph = buildMiniMaxH3PortraitVideoWorkflow(request, firstInput, 42);
  assert.equal(request.durationSeconds, 5);
  assert.equal(graph['6'].inputs.length, 124);
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(graph['6'].inputs.last_frame, ['5', 0]);
});

test('compiles FLUX.2 Klein 9B end-frame generation followed by distinct H3 first/last conditioning', () => {
  const request = buildPortraitVideoRequest(
    portrait(),
    '1:1',
    'a'.repeat(64),
    PORTRAIT_VIDEO_MODE_GENERATED_FLF
  );
  assert.equal(request.endFrameModelTemplate, FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.id);
  assert.equal(portraitVideoEndFrameSeed(42), 43);
  assert.equal(portraitVideoEndFrameSeed(Number.MAX_SAFE_INTEGER), 0);
  assert.match(buildPortraitEndFramePrompt(request), /exact same subject/);
  assert.match(buildPortraitVideoPrompt(request), /distinct final pose/);

  const endGraph = buildFlux2Klein9BPortraitEndFrameWorkflow(request, firstInput, 43);
  assert.equal(endGraph['1'].inputs.unet_name, FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
  assert.equal(endGraph['2'].inputs.type, 'flux2');
  assert.equal(endGraph['5'].class_type, 'ImageScaleToTotalPixels');
  assert.deepEqual(endGraph['11'].inputs, { width: 704, height: 704, batch_size: 1 });
  assert.equal(endGraph['12'].inputs.noise_seed, 43);
  assert.deepEqual(endGraph['18'].inputs.images, ['17', 0]);

  const graph = buildMiniMaxH3PortraitVideoWorkflow(request, firstInput, 42, endInput);
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(graph['6'].inputs.last_frame, ['17', 0]);
  assert.equal(graph['17'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.equal(graph['15'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');
});

test('rejects arbitrary templates, durations, paths, and invalid end-frame usage', () => {
  const built = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64));
  assert.throws(() => normalizePortraitVideoRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait-video model/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, aspectRatio: '3:4' }), /unsupported portrait-video aspect ratio/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, durationSeconds: 4 }), /unsupported portrait-video duration/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, mode: 'anything' }), /unsupported portrait-video mode/);
  assert.throws(() => normalizePortraitVideoRequest({ ...built, source: { ...built.source, portraitWidth: 832 } }), /dimensions do not match/);
  assert.throws(() => buildMiniMaxH3PortraitVideoWorkflow(built, {
    ...firstInput,
    name: '../escape.png'
  }, 1), /input reference is invalid/);
  const generated = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  assert.throws(() => buildMiniMaxH3PortraitVideoWorkflow(generated, firstInput, 1), /end-frame input is required/);
  assert.throws(() => buildMiniMaxH3PortraitVideoWorkflow(generated, firstInput, 1, firstInput), /must differ/);
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(generated));
  const fiveSeconds = buildPortraitVideoRequest(portrait(), '1:1', 'a'.repeat(64), PORTRAIT_VIDEO_MODE_LOOP_FLF, 5);
  assert.notEqual(portraitVideoRequestKey(built), portraitVideoRequestKey(fiveSeconds));
});
