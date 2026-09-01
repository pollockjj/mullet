import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
  LTX25_PORTRAIT_VIDEO_DURATIONS,
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
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
  buildLtx25PortraitVideoWorkflow,
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

test('keeps both expression-video templates additive with H3 as the default', () => {
  assert.equal(PORTRAIT_VIDEO_TEMPLATE_ID, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.deepEqual(
    PORTRAIT_VIDEO_TEMPLATES.map(({ id }) => id),
    [LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID]
  );
  assert.deepEqual(LTX25_PORTRAIT_VIDEO_DURATIONS, [2]);
  assert.deepEqual(MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS, [2, 3, 5]);
  assert.deepEqual(PORTRAIT_VIDEO_DURATIONS, [2, 3, 5]);
});

test('maps fixed 9:16 expression video to each template frame grid', () => {
  assert.deepEqual(portraitVideoDimensions('9:16'), { width: 576, height: 1024, frames: 56, fps: 28 });
  assert.deepEqual(
    portraitVideoDimensions('9:16', 2, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID),
    { width: 576, height: 1024, frames: 49, fps: 24 }
  );
  assert.deepEqual(portraitVideoDimensions('9:16', 3), { width: 576, height: 1024, frames: 73, fps: 24 });
  assert.deepEqual(portraitVideoDimensions('9:16', 5), { width: 576, height: 1024, frames: 124, fps: 24 });
  assert.equal(PORTRAIT_VIDEO_FRAMES / PORTRAIT_VIDEO_FPS, PORTRAIT_VIDEO_DURATION_SECONDS);
  assert.equal(PORTRAIT_VIDEO_DURATION_SECONDS, 2);
  assert.equal(PORTRAIT_VIDEO_FRAMES, 56);
  assert.equal(576 % LTX25_PORTRAIT_VIDEO_TEMPLATE.multiple, 0);
  assert.equal(1024 % LTX25_PORTRAIT_VIDEO_TEMPLATE.multiple, 0);
  assert.throws(() => portraitVideoDimensions('3:4'), /unsupported portrait-video aspect ratio/);
});

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

test('uses H3 endpoint grammar for each motion mode without changing the LTX prompt', () => {
  const ltx = requestFor(LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_LOOP_FLF);
  const unchangedLtxPrompt = 'The camera remains completely locked on the head-and-chest portrait. The subject breathes naturally, blinks once, and holds a restrained grief expression. Hair and clothing move subtly. The identical supplied portrait is the first and final keyframe; motion returns exactly to that final keyframe. Ambient idle expression motion only: no talking, no lip or mouth movement, and no speech gestures. No camera movement, no cuts, no speech, no text, no black frames. Silent video only; no dialogue, narration, music, room tone, or sound effects.';
  assert.equal(buildPortraitVideoPrompt(ltx), unchangedLtxPrompt);
  assert.equal(buildLtx25PortraitVideoWorkflow(ltx, firstInput, 42)['8'].inputs.text, unchangedLtxPrompt);

  const i2v = requestFor(MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_I2V);
  const i2vPrompt = buildMiniMaxH3PortraitVideoPrompt(i2v);
  assert.match(i2vPrompt, /^For the target video, at 0\.00 seconds.*<Picture 1>/);
  assert.doesNotMatch(i2vPrompt, /<Picture 2>/);

  const generated = requestFor(MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  const generatedPrompt = buildMiniMaxH3PortraitVideoPrompt(generated);
  assert.match(generatedPrompt, /Picture 1.*0\.00-second mark/);
  assert.match(generatedPrompt, /Picture 2.*2\.00-second mark/);
  assert.match(generatedPrompt, /moves continuously from Picture 1/);
  assert.match(generatedPrompt, /established by Picture 2 at 2\.00 seconds/);
  assert.doesNotMatch(generatedPrompt, /<Picture [12]>|\[Shot 1\].*aligns/);
  assert.equal(buildMiniMaxH3PortraitVideoWorkflow(generated, firstInput, 42, endInput)['6'].inputs.prompt, generatedPrompt);

  assert.throws(() => buildMiniMaxH3PortraitVideoPrompt(ltx), /does not select MiniMax H3/);
});

test('restores the exact LTX 2.5 INT8 ConvRot artifact contract', () => {
  assert.deepEqual(LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles, {
    unet: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
    clip: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
    videoVae: 'ltx-2.5-video-vae-bf16.safetensors',
    audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
    latentUpscaler: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'
  });
  assert.equal(LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler, 'euler_ancestral');
  assert.equal(LTX25_PORTRAIT_VIDEO_TEMPLATE.format, 'mp4');
  assert.equal(LTX25_PORTRAIT_VIDEO_TEMPLATE.codec, 'h264');
  assert.equal(LTX25_PORTRAIT_VIDEO_TEMPLATE.bitDepth, 8);
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

test('retains LTX first-frame-only I2V as a selectable mode', () => {
  const request = requestFor(LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_I2V);
  const graph = buildLtx25PortraitVideoWorkflow(request, firstInput, 42);
  assert.equal(graph['12'].class_type, 'LTXVImgToVideoInplace');
  assert.equal(graph['16'].inputs.noise_seed, 42);
  assert.equal(graph['31'].class_type, 'CreateVideo');
  assert.equal(Object.hasOwn(graph['31'].inputs, 'audio'), false);
  assert.deepEqual(graph['31'].inputs.images, ['30', 0]);
  assert.equal(graph['38'].class_type, 'SaveVideo');
  assert.deepEqual(graph['38'].inputs.video, ['31', 0]);
  assert.equal(graph['38'].inputs.filename_prefix, 'mullet/portrait-motion');
  assert.equal(portraitVideoOutputNode(request), '38');
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

test('keeps Qwen Image Edit 2511 Lightning end-frame generation and dispatches it into either generated-FLF graph', () => {
  const ltxRequest = requestFor(LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  assert.equal(ltxRequest.endFrameModelTemplate, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.id);
  assert.equal(portraitVideoEndFrameSeed(42), 43);
  assert.equal(portraitVideoEndFrameSeed(Number.MAX_SAFE_INTEGER), 0);
  assert.match(buildPortraitEndFramePrompt(ltxRequest), /exact same subject/);
  assert.match(buildPortraitVideoPrompt(ltxRequest), /distinct final pose/);

  const endGraph = buildQwenPortraitEndFrameWorkflow(ltxRequest, firstInput, 43);
  assert.deepEqual(QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles, {
    unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'
  });
  assert.equal(endGraph['1'].inputs.unet_name, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
  assert.equal(endGraph['2'].inputs.type, 'qwen_image');
  assert.equal(endGraph['4'].inputs.image, `mullet/motion-inputs/${firstInput.name}`);
  assert.deepEqual(endGraph['5'].inputs, {
    image: ['4', 0],
    upscale_method: 'lanczos',
    width: 576,
    height: 1024,
    crop: 'center'
  });
  assert.equal(endGraph['8'].inputs.lora_name, QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.lora);
  assert.equal(endGraph['8'].inputs.strength_model, 1);
  assert.equal(endGraph['12'].inputs.seed, 43);
  assert.deepEqual(endGraph['14'].inputs.images, ['13', 0]);

  const ltxGraph = buildPortraitVideoWorkflow(ltxRequest, firstInput, 42, endInput);
  assert.deepEqual(ltxGraph['13'].inputs.image, ['37', 0]);
  assert.deepEqual(ltxGraph['25'].inputs.image, ['37', 0]);
  assert.equal(ltxGraph['36'].inputs.image, `mullet/motion-inputs/${endInput.name}`);
  assert.equal(ltxGraph['38'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');

  const minimaxRequest = requestFor(MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  const minimaxGraph = buildPortraitVideoWorkflow(minimaxRequest, firstInput, 42, endInput);
  assert.deepEqual(minimaxGraph['6'].inputs.last_frame, ['17', 0]);
  assert.equal(minimaxGraph['15'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');
});

test('normalizes additive per-template capability diagnostics without removing options', () => {
  const modeCapabilities = (missing = []) => PORTRAIT_VIDEO_MODES.map((mode) => ({
    ...mode,
    available: missing.length === 0,
    missing
  }));
  const value = {
    spec: PORTRAIT_VIDEO_CAPABILITIES_SPEC,
    templates: [
      {
        template: LTX25_PORTRAIT_VIDEO_TEMPLATE,
        available: true,
        missing: [],
        modes: modeCapabilities(),
        durations: [2]
      },
      {
        template: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
        available: false,
        missing: ['model:unet:missing-minimax.safetensors'],
        modes: modeCapabilities(['model:unet:missing-minimax.safetensors']),
        durations: [2, 3, 5]
      }
    ],
    endFrameTemplate: QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
    aspectRatios: [{ aspectRatio: '9:16', width: 576, height: 1024 }]
  };
  const normalized = normalizePortraitVideoCapabilities(value);
  assert.equal(normalized.templates.length, 2);
  assert.equal(portraitVideoTemplateCapability(normalized)?.template.id, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(portraitVideoTemplateCapability(normalized, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID)?.available, false);
  assert.equal(portraitVideoModeAvailable(normalized, PORTRAIT_VIDEO_MODE_LOOP_FLF), false);
  assert.equal(
    portraitVideoModeAvailable(normalized, PORTRAIT_VIDEO_MODE_LOOP_FLF, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID),
    true
  );
  assert.equal(
    portraitVideoModeAvailable(normalized, PORTRAIT_VIDEO_MODE_LOOP_FLF, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID),
    false
  );
});

test('rejects arbitrary templates, incompatible durations, unsafe paths, and wrong graph dispatch', () => {
  const ltx = requestFor(LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  const minimax = requestFor(MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.throws(() => normalizePortraitVideoRequest({ ...ltx, modelTemplate: 'anything' }), /unsupported portrait-video model/);
  assert.throws(() => normalizePortraitVideoRequest({ ...ltx, durationSeconds: 3 }), /duration for model template/);
  assert.throws(() => normalizePortraitVideoRequest({ ...minimax, durationSeconds: 4 }), /duration for model template/);
  assert.throws(() => normalizePortraitVideoRequest({ ...ltx, aspectRatio: '3:4' }), /unsupported portrait-video aspect ratio/);
  assert.throws(() => normalizePortraitVideoRequest({ ...ltx, mode: 'anything' }), /unsupported portrait-video mode/);
  assert.throws(() => normalizePortraitVideoRequest({ ...ltx, source: { ...ltx.source, portraitWidth: 832 } }), /dimensions do not match/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(ltx, { ...firstInput, name: '../escape.png' }, 1), /input reference is invalid/);
  assert.throws(() => buildMiniMaxH3PortraitVideoWorkflow(ltx, firstInput, 1), /does not select MiniMax/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(minimax, firstInput, 1), /does not select LTX/);

  const generated = requestFor(LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(generated, firstInput, 1), /end-frame input is required/);
  assert.throws(() => buildLtx25PortraitVideoWorkflow(generated, firstInput, 1, firstInput), /must differ/);
  assert.notEqual(portraitVideoRequestKey(ltx), portraitVideoRequestKey(minimax));
  assert.notEqual(portraitVideoRequestKey(ltx), portraitVideoRequestKey(generated));
});
