import assert from 'node:assert/strict';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  inlineSceneSourceForScenarioOpening
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
  buildLtx25InlineSceneVideoWorkflow,
  buildInlineSceneVideoPrompt,
  buildInlineSceneVideoRequest,
  buildMiniMaxH3InlineSceneVideoWorkflow,
  inlineSceneMasterToggleEnabled,
  inlineSceneVideoDecodeFailureTransition,
  inlineSceneVideoDimensions,
  inlineSceneVideoMasterToggleAction,
  inlineSceneVideoReconciliationAllowed,
  inlineSceneVideoRequestKey,
  normalizeInlineSceneVideoRequest,
  parseInlineSceneVideoIntegerHeader,
  parseInlineSceneVideoNumberHeader
} from '../src/lib/inline-scene-video.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const promptId = '22222222-2222-4222-8222-222222222222';
const messages = [
  { role: 'user', content: 'What is happening on the flight deck?' },
  { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
];
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'c'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});

function staticScene(aspectRatio = '16:9', megapixels = 1) {
  const sidecarRequest = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages)
  );
  const result = createInlineSceneResult(sidecarRequest, 'gemma-4-ortenzya', prompt);
  const request = buildInlineSceneImageRequest(result, {
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio,
    megapixels
  });
  const dimensions = inlineSceneDimensions(aspectRatio, megapixels);
  return {
    conversationId,
    epoch,
    requestKey: inlineSceneImageRequestKey(request),
    request,
    promptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 123456789,
    imageSha256: 'a'.repeat(64)
  };
}

function openingStaticScene(aspectRatio = '16:9', megapixels = 1) {
  const opening = [{
    role: 'assistant',
    content: 'Jenna steadies herself beside the Liberator flight console as the ship emerges from hyperspace.'
  }];
  const source = inlineSceneSourceForScenarioOpening(conversationId, opening, {
    scenarioId: 'blakes-7-after-false-control',
    scenarioVersion: '3.0',
    starterId: 'jenna',
    expectedGreeting: opening[0].content
  });
  const result = createInlineSceneResult({
    spec: 'mullet_inline_scene_request_v2',
    kind: 'inline_scene',
    source,
    turns: opening
  }, 'gemma-4-ortenzya', prompt);
  const request = buildInlineSceneImageRequest(result, {
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio,
    megapixels
  });
  const dimensions = inlineSceneDimensions(aspectRatio, megapixels);
  return {
    conversationId,
    epoch,
    requestKey: inlineSceneImageRequestKey(request),
    request,
    promptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 123456789,
    imageSha256: 'a'.repeat(64)
  };
}

test('binds motion to every static-scene provenance field', () => {
  const scene = staticScene();
  const request = buildInlineSceneVideoRequest(scene);
  assert.equal(request.spec, 'mullet_inline_scene_video_request_v4');
  assert.equal(request.modelTemplate, LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID);
  assert.equal(request.mode, 'flf2v_loop');
  assert.equal(request.source.sceneRequestKey, scene.requestKey);
  assert.equal(request.source.sceneSeed, 42);
  assert.equal(request.source.sceneRequest.source.promptSha256, scene.request.source.promptSha256);
  assert.equal(request.durationSeconds, INLINE_SCENE_VIDEO_DURATION_SECONDS);
  assert.throws(
    () => normalizeInlineSceneVideoRequest({
      ...request,
      source: { ...request.source, sceneRequestKey: 'forged' }
    }),
    /source provenance/
  );
  assert.throws(
    () => normalizeInlineSceneVideoRequest({
      ...request,
      source: {
        ...request.source,
        sceneRequest: {
          ...request.source.sceneRequest,
          referenceImage: { ...canonicalReference, sha256: 'b'.repeat(64) }
        }
      }
    }),
    /source provenance/
  );
  assert.notEqual(
    inlineSceneVideoRequestKey(request),
    inlineSceneVideoRequestKey({ ...request, source: { ...request.source, sceneImageSha256: 'c'.repeat(64) } })
  );
  assert.notEqual(
    inlineSceneVideoRequestKey(request),
    inlineSceneVideoRequestKey({ ...request, source: { ...request.source, sceneSeed: 43 } })
  );
});

test('binds scenario-opening identity into the motion request key', () => {
  const completed = buildInlineSceneVideoRequest(staticScene());
  const opening = buildInlineSceneVideoRequest(openingStaticScene());
  assert.equal(opening.source.sceneRequest.source.sourceKind, 'scenario_opening');
  assert.equal(opening.source.sceneRequest.source.scenarioId, 'blakes-7-after-false-control');
  assert.equal(opening.source.sceneRequest.source.scenarioVersion, '3.0');
  assert.equal(opening.source.sceneRequest.source.starterId, 'jenna');
  assert.notEqual(inlineSceneVideoRequestKey(opening), inlineSceneVideoRequestKey(completed));
  assert.throws(
    () => normalizeInlineSceneVideoRequest({
      ...opening,
      source: {
        ...opening.source,
        sceneRequest: {
          ...opening.source.sceneRequest,
          source: { ...opening.source.sceneRequest.source, starterId: 'cally' }
        }
      }
    }),
    /source provenance/
  );
});

test('uses the fixed live-tested landscape envelopes with LTX as the default', () => {
  assert.deepEqual(INLINE_SCENE_VIDEO_DIMENSIONS, [
    { aspectRatio: '3:2', width: 1152, height: 768 },
    { aspectRatio: '4:3', width: 1024, height: 768 },
    { aspectRatio: '5:4', width: 960, height: 768 },
    { aspectRatio: '16:9', width: 1344, height: 768 }
  ]);
  for (const entry of INLINE_SCENE_VIDEO_DIMENSIONS) {
    const dimensions = inlineSceneVideoDimensions(entry.aspectRatio);
    assert.equal(dimensions.width, entry.width);
    assert.equal(dimensions.height, entry.height);
    assert.equal(dimensions.width % LTX25_INLINE_SCENE_VIDEO_TEMPLATE.multiple, 0);
    assert.equal(dimensions.height % LTX25_INLINE_SCENE_VIDEO_TEMPLATE.multiple, 0);
    assert.ok(dimensions.width * dimensions.height <= MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.maxPixels);
    assert.equal(dimensions.frames, 121);
    assert.equal(dimensions.fps, 24);
    const minimax = inlineSceneVideoDimensions(entry.aspectRatio, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    assert.equal(minimax.frames, 124);
    assert.equal(minimax.fps, 24);
  }
});

test('blocks replacement generation until persisted motion restoration finishes', () => {
  const ready = {
    scenesEnabled: true,
    motionEnabled: true,
    capabilitiesReady: true,
    persistenceReady: true,
    persistenceAvailable: true,
    restorationPending: false,
    streaming: false,
    sceneBusy: false,
    videoBusy: false,
    videoError: false,
    requestReady: true,
    current: false
  };
  assert.equal(inlineSceneVideoReconciliationAllowed(ready), true);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, restorationPending: true }), false);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, videoError: true }), false);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, current: true }), false);
});

test('maps teardown and decode failure to non-generating playback states', () => {
  const request = buildInlineSceneVideoRequest(staticScene());
  assert.deepEqual(
    inlineSceneVideoDecodeFailureTransition(true, request),
    { action: 'ignore' }
  );
  assert.deepEqual(
    inlineSceneVideoDecodeFailureTransition(false, request),
    {
      action: 'show-static-fallback',
      error: 'The generated scene motion could not be decoded; showing the static scene.',
      attemptKey: inlineSceneVideoRequestKey(request)
    }
  );
  assert.equal(
    inlineSceneVideoDecodeFailureTransition(false, null).attemptKey,
    null
  );
});

test('restores persisted motion when the master scene toggle is re-enabled', () => {
  assert.equal(inlineSceneVideoMasterToggleAction(false, true, true), 'abort');
  assert.equal(inlineSceneVideoMasterToggleAction(true, true, true), 'restore');
  assert.equal(inlineSceneVideoMasterToggleAction(true, false, true), 'none');
  assert.equal(inlineSceneVideoMasterToggleAction(true, true, false), 'none');
});

test('blocks the master scene toggle while a motion persistence operation is queued', () => {
  assert.equal(inlineSceneMasterToggleEnabled(true, true, true), true);
  assert.equal(inlineSceneMasterToggleEnabled(true, true, false), false);
  assert.equal(inlineSceneMasterToggleEnabled(false, true, true), false);
  assert.equal(inlineSceneMasterToggleEnabled(true, false, true), false);
});

test('rejects missing, empty, and non-canonical integer provenance headers', () => {
  assert.equal(parseInlineSceneVideoIntegerHeader('0', 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER), 0);
  assert.equal(parseInlineSceneVideoIntegerHeader('42', 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER), 42);
  for (const value of [null, '', ' 0', '00', '+1', '1.0', '9007199254740992']) {
    assert.throws(
      () => parseInlineSceneVideoIntegerHeader(value, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
      /omitted x-mullet-seed/
    );
  }
});

test('accepts only a canonical finite encoded-duration header', () => {
  const duration = 124 / 24;
  assert.equal(parseInlineSceneVideoNumberHeader(String(duration), 'x-mullet-duration-seconds', 0.001, 3_600), duration);
  for (const value of [null, '', ' 5', '05', '+5', '5.0', '.5', '5.', '5e0', 'NaN', 'Infinity']) {
    assert.throws(
      () => parseInlineSceneVideoNumberHeader(value, 'x-mullet-duration-seconds', 0.001, 3_600),
      /omitted x-mullet-duration-seconds/
    );
  }
});

test('builds the pinned MiniMax H3 FL2VA I2V graph with native audio', () => {
  const request = buildInlineSceneVideoRequest(
    staticScene('3:2', 0.5),
    MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
  );
  const input = {
    name: 'scene-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: request.source.sceneImageSha256
  };
  const graph = buildMiniMaxH3InlineSceneVideoWorkflow(request, input, 42);
  assert.equal(graph['1'].inputs.unet_name, 'minimax_h3_fl2va_pruned_int8_convrot.safetensors');
  assert.equal(graph['2'].inputs.type, 'minimax');
  assert.deepEqual(graph['6'].inputs.first_frame, ['5', 0]);
  assert.equal(graph['6'].inputs.width, 1152);
  assert.equal(graph['6'].inputs.height, 768);
  assert.equal(graph['6'].inputs.length, 124);
  assert.equal(graph['8'].inputs.sampler_name, 'res_multistep');
  assert.deepEqual(graph['9'].inputs, { model: ['16', 0], scheduler: 'simple', steps: 4, denoise: 1 });
  assert.deepEqual(graph['14'].inputs.audio, ['13', 0]);
  assert.equal(graph['15'].inputs.filename_prefix, 'mullet/scene-motion');
  assert.equal(graph['15'].inputs.format, 'auto');
  assert.equal(graph['16'].inputs.lora_name, 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors');
  assert.match(graph['6'].inputs.prompt, /damaged starship flight deck/);
  assert.match(graph['6'].inputs.prompt, /Preserve every visible subject/);
  assert.match(buildInlineSceneVideoPrompt(request), /synchronized diegetic room tone/);
  assert.throws(
    () => buildMiniMaxH3InlineSceneVideoWorkflow(request, { ...input, imageSha256: 'b'.repeat(64) }, 42),
    /input reference/
  );
});

test('builds the pinned two-pass LTX FLF graph with identical supplied first and last frames and no output audio', () => {
  const request = buildInlineSceneVideoRequest(staticScene('16:9', 0.5));
  const input = {
    name: 'scene-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: request.source.sceneImageSha256
  };
  const graph = buildLtx25InlineSceneVideoWorkflow(request, input, 42);
  assert.equal(graph['3'].inputs.unet_name, LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(graph['4'].inputs.type, 'ltxv');
  assert.equal(graph['11'].inputs.length, 121);
  assert.deepEqual(graph['12'].inputs.image, ['2', 0]);
  assert.deepEqual(graph['24'].inputs.image, ['2', 0]);
  assert.equal(graph['12'].inputs.frame_idx, 0);
  assert.equal(graph['13'].inputs.frame_idx, -1);
  assert.equal(graph['24'].inputs.frame_idx, 0);
  assert.equal(graph['25'].inputs.frame_idx, -1);
  assert.equal(graph['35'].class_type, 'SaveWEBM');
  assert.equal(graph['35'].inputs.codec, 'vp9');
  assert.equal('audio' in graph['35'].inputs, false);
  assert.match(buildInlineSceneVideoPrompt(request), /Silent video only/);
  assert.match(buildInlineSceneVideoPrompt(request), /no talking, no lip or mouth movement/);
});
