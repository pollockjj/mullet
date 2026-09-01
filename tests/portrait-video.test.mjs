import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  PORTRAIT_VIDEO_CAPABILITIES_SPEC,
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
  PORTRAIT_VIDEO_TEMPLATES,
  buildQwenPortraitEndFrameWorkflow,
  buildMiniMaxH3PortraitVideoPrompt,
  buildMiniMaxH3PortraitVideoWorkflow,
  buildPortraitEndFramePrompt,
  buildPortraitVideoPrompt,
  buildPortraitVideoRequest,
  buildPortraitVideoWorkflow,
  normalizePortraitVideoCapabilities,
  normalizePortraitVideoRequest,
  portraitVideoDimensions,
  portraitVideoEndFrameSeed,
  portraitVideoModeAvailable,
  portraitVideoOutputNode,
  portraitVideoRequestKey,
  portraitVideoTemplateCapability
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
    width: 576,
    height: 1024,
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

function requestFor(
  modelTemplate,
  mode = PORTRAIT_VIDEO_MODE_LOOP_FLF,
  durationSeconds
) {
  return buildPortraitVideoRequest(
    portrait(),
    '9:16',
    'a'.repeat(64),
    mode,
    durationSeconds,
    modelTemplate
  );
}



test('defaults every expression request to a two-second silent H3 identical-frame loop', () => {
  const built = buildPortraitVideoRequest(portrait(), '9:16', 'a'.repeat(64));
  assert.equal(built.spec, PORTRAIT_VIDEO_REQUEST_SPEC);
  assert.equal(built.modelTemplate, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(built.mode, PORTRAIT_VIDEO_MODE_LOOP_FLF);
  assert.equal(built.endFrameModelTemplate, null);
  assert.equal(built.durationSeconds, 2);
  assert.equal(JSON.stringify(built).includes('assistant'), false);
  assert.equal(JSON.stringify(built).includes('transcript'), false);
  const prompt = buildMiniMaxH3PortraitVideoPrompt(built);
  assert.match(prompt, /Picture 1 \(from Shot 1\).*0\.00-second mark/);
  assert.match(prompt, /Picture 2 \(from Shot 1\).*2\.00-second mark/);
  assert.doesNotMatch(prompt, /<Picture [12]>|\[Shot 1\].*aligns/);
  assert.match(prompt, /integrated_multimodal_description: \[Shot 1\]/);
  assert.match(prompt, /overall_soundscape: N\/A\. Complete silence/);
  assert.match(prompt, /non_diegetic_music: N\/A\. No music/);
  assert.match(prompt, /Nobody speaks, vocalizes, or mouths words/);
  assert.match(prompt, /no dialogue, voices, narration, singing/);
});



test('compiles the default H3 loop with all 56 native frames encoded at exactly two seconds', () => {
  const request = buildPortraitVideoRequest(portrait(), '9:16', 'a'.repeat(64));
  const graph = buildPortraitVideoWorkflow(request, firstInput, 42);
  assert.deepEqual(PORTRAIT_VIDEO_MODES.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
  assert.equal(graph['1'].inputs.unet_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip);
  assert.equal(graph['6'].inputs.length, 56);
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(graph['6'].inputs.last_frame, ['5', 0]);
  assert.equal(graph['8'].inputs.sampler_name, 'euler');
  assert.equal(graph['9'].inputs.steps, 4);
  assert.deepEqual(graph['7'].inputs.model, ['18', 0]);
  assert.deepEqual(graph['9'].inputs.model, ['18', 0]);
  assert.equal(graph['18'].class_type, 'MiniMaxH3SigmaShift');
  assert.deepEqual(graph['18'].inputs, { model: ['16', 0], shift_video: 6, shift_audio: 3 });
  assert.equal(graph['14'].class_type, 'CreateVideo');
  assert.equal(graph['14'].inputs.fps, 28);
  assert.equal(Object.hasOwn(graph['14'].inputs, 'audio'), false);
  assert.deepEqual(graph['14'].inputs.images, ['12', 0]);
  assert.equal(graph['15'].class_type, 'SaveVideo');
  assert.deepEqual(graph['15'].inputs.video, ['14', 0]);
  assert.equal(graph['15'].inputs.filename_prefix, 'mullet/portrait-motion-loop-flf');
  assert.equal(graph['15'].inputs.format, 'auto');
  assert.equal(graph['15'].inputs.codec, 'auto');
  assert.equal(portraitVideoOutputNode(request), '15');
});


test('retains longer H3 durations as explicit additive choices', () => {
  const request = requestFor(MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_LOOP_FLF);
  assert.equal(request.durationSeconds, 2);
  const graph = buildPortraitVideoWorkflow(request, firstInput, 42);
  assert.equal(graph['1'].inputs.unet_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip);
  assert.equal(graph['6'].class_type, 'MiniMaxH3ImageToVideo');
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.deepEqual(graph['6'].inputs.last_frame, ['5', 0]);
  assert.equal(graph['6'].inputs.length, 56);
  assert.equal(graph['15'].class_type, 'SaveVideo');
  assert.equal(Object.hasOwn(graph['14'].inputs, 'audio'), false);
  assert.equal(portraitVideoOutputNode(request), '15');

  const fiveSecondRequest = requestFor(
    MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
    PORTRAIT_VIDEO_MODE_LOOP_FLF,
    5
  );
  assert.equal(buildMiniMaxH3PortraitVideoWorkflow(fiveSecondRequest, firstInput, 42)['6'].inputs.length, 124);
  const threeSecondRequest = requestFor(
    MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
    PORTRAIT_VIDEO_MODE_LOOP_FLF,
    3
  );
  assert.equal(buildMiniMaxH3PortraitVideoWorkflow(threeSecondRequest, firstInput, 42)['6'].inputs.length, 73);
});



