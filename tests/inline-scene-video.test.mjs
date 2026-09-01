import assert from 'node:assert/strict';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
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
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_DIMENSIONS,
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE,
  buildLtx25InlineSceneVideoWorkflow,
  buildInlineSceneVideoPrompt,
  buildInlineSceneVideoRequest,
  buildInlineSceneVideoWorkflow,
  buildMiniMaxH3InlineSceneVideoWorkflow,
  describeInlineSceneH3ReferencePlan,
  inlineSceneMasterToggleEnabled,
  inlineSceneH3ReferencePlan,
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
const sceneLora = Object.freeze({
  path: 'zimage/jenna6.safetensors',
  trigger: 'jennastannis',
  modelHash: 'c'.repeat(64)
});
const sceneCandidate = Object.freeze({
  id: 'jenna',
  displayName: 'Jenna Stannis',
  aliases: ['Jenna', 'Jenna Stannis'],
  profileFingerprint: 'd'.repeat(64)
});
const soloCast = Object.freeze({
  kind: 'solo',
  identities: [{
    profileId: sceneCandidate.id,
    profileFingerprint: sceneCandidate.profileFingerprint,
    displayName: sceneCandidate.displayName,
    subject: 'Jenna Stannis',
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: 'e'.repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: {
      name: 'jenna-stannis-body-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: '4'.repeat(64),
      width: 512,
      height: 768,
      aspectRatio: '2:3'
    }
  }]
});
const trioCandidates = Object.freeze([
  sceneCandidate,
  Object.freeze({
    id: 'cally',
    displayName: 'Cally',
    aliases: ['Cally'],
    profileFingerprint: 'f'.repeat(64)
  }),
  Object.freeze({
    id: 'servalan',
    displayName: 'Servalan',
    aliases: ['Servalan'],
    profileFingerprint: '9'.repeat(64)
  })
]);
const trioCast = Object.freeze({
  kind: 'trio',
  identities: trioCandidates.map((candidate, index) => ({
    profileId: candidate.id,
    profileFingerprint: candidate.profileFingerprint,
    displayName: candidate.displayName,
    subject: candidate.displayName,
    referenceImage: {
      name: `${candidate.id}-canonical.png`,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: String(index + 1).repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: {
      name: `${candidate.id}-body.png`,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: String(index + 4).repeat(64),
      width: 512,
      height: 768,
      aspectRatio: '2:3'
    }
  }))
});

function castForCount(count) {
  const identities = trioCast.identities.slice(0, count);
  return {
    kind: count === 1 ? 'solo' : count === 2 ? 'duo' : 'trio',
    identities
  };
}

function continuityMasterFor(cast) {
  return {
    requestKey: `sha256:${'8'.repeat(64)}`,
    promptId: '44444444-4444-4444-8444-444444444444',
    seed: 41,
    generatedAt: 123456788,
    width: 1328,
    height: 752,
    imageSha256: '7'.repeat(64),
    cast: cast.identities.map(({ profileId, profileFingerprint }) => ({ profileId, profileFingerprint }))
  };
}

function priorMasterInput(master) {
  return {
    name: 'scene-motion-prior-55555555-5555-4555-8555-555555555555.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: master.imageSha256,
    width: master.width,
    height: master.height
  };
}

function staticScene(
  aspectRatio = '16:9',
  megapixels = 1,
  { candidates = [sceneCandidate], cast = soloCast, continuityMaster } = {}
) {
  const sidecarRequest = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages),
    candidates
  );
  const result = createInlineSceneResult(sidecarRequest, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: candidates.map(({ id }) => id)
  });
  const usesQwen = cast.kind !== 'solo' || Boolean(continuityMaster);
  const request = buildInlineSceneImageRequest(result, {
    modelTemplate: usesQwen ? INLINE_SCENE_QWEN_TEMPLATE_ID : INLINE_SCENE_TEMPLATE_ID,
    cast,
    ...(continuityMaster ? { continuityMaster } : {}),
    lora: usesQwen ? null : sceneLora,
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
    spec: 'mullet_inline_scene_request_v3',
    kind: 'inline_scene',
    source,
    turns: opening,
    candidates: [sceneCandidate]
  }, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: [sceneCandidate.id]
  });
  const request = buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: soloCast,
    lora: sceneLora,
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
  assert.equal(request.spec, 'mullet_inline_scene_video_request_v6');
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
          lora: { ...sceneLora, modelHash: 'b'.repeat(64) }
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
  assert.throws(
    () => normalizeInlineSceneVideoRequest({ ...request, spec: 'mullet_inline_scene_video_request_v5' }),
    /request spec/
  );
  const h3 = buildInlineSceneVideoRequest(scene, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
  assert.equal(h3.modelTemplate, 'minimax-h3-ref2va-scene-v1');
  assert.equal(h3.mode, 'ref2va');
  assert.throws(
    () => normalizeInlineSceneVideoRequest({ ...h3, mode: 'i2v' }),
    /mode/
  );
  assert.throws(
    () => normalizeInlineSceneVideoRequest({ ...h3, modelTemplate: 'minimax-h3-fl2va-i2v-turbo-v1' }),
    /model template/
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
  assert.deepEqual(MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_DIMENSIONS, [
    { aspectRatio: '3:2', width: 832, height: 544 },
    { aspectRatio: '4:3', width: 736, height: 544 },
    { aspectRatio: '5:4', width: 672, height: 544 },
    { aspectRatio: '16:9', width: 960, height: 544 }
  ]);
  for (const entry of MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_DIMENSIONS) {
    assert.deepEqual(
      inlineSceneVideoDimensions(entry.aspectRatio, MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID),
      { width: entry.width, height: entry.height, frames: 124, fps: 24 }
    );
    assert.equal(entry.width % 32, 0);
    assert.equal(entry.height % 32, 0);
    assert.equal(entry.height, 544);
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

test('builds one deterministic deduped H3 Ref2VA reference plan for one, two, and three subjects', () => {
  const input = {
    name: 'scene-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: 'a'.repeat(64)
  };
  for (const count of [1, 2, 3]) {
    const cast = castForCount(count);
    const candidates = trioCandidates.slice(0, count);
    const request = buildInlineSceneVideoRequest(
      staticScene('3:2', 0.5, { candidates, cast }),
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
    );
    const plan = inlineSceneH3ReferencePlan(request);
    assert.deepEqual(plan.map(({ picture, kind }) => ({ picture, kind })), [
      { picture: 1, kind: 'current_scene' },
      ...Array.from({ length: count }, (_unused, index) => ({ picture: index + 2, kind: 'canonical_identity' })),
      ...Array.from({ length: count }, (_unused, index) => ({ picture: count + index + 2, kind: 'body_identity' }))
    ]);
    assert.equal(
      describeInlineSceneH3ReferencePlan(request),
      `${count * 2 + 1} refs · P1 scene · ${candidates.map((candidate, index) => (
        `${candidate.displayName} P${index + 2} face/P${count + index + 2} body`
      )).join(' · ')}`
    );
    assert.ok(plan.length <= MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.maxReferenceImages);
    const graph = buildMiniMaxH3InlineSceneVideoWorkflow(request, input, 42);
    assert.equal(graph['1'].inputs.unet_name, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors');
    assert.equal(graph['2'].inputs.type, 'minimax');
    for (let index = 0; index < count; index += 1) {
      const nodeId = String(6 + index);
      const bodyNodeId = String(6 + count + index);
      assert.equal(graph[nodeId].inputs.image, `mullet/identity/${candidates[index].id}-canonical.png`);
      assert.equal(graph[bodyNodeId].inputs.image, `mullet/identity/${candidates[index].id}-body.png`);
      assert.deepEqual(graph['20'].inputs[`ref_images.ref_image_${index + 1}`], [nodeId, 0]);
      assert.deepEqual(graph['20'].inputs[`ref_images.ref_image_${count + index + 1}`], [bodyNodeId, 0]);
      assert.match(graph['20'].inputs.prompt, new RegExp(`<Subject ${index + 1}> is .*<Picture ${index + 2}>.*<Picture ${count + index + 2}>`));
    }
    assert.deepEqual(graph['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
    assert.equal(Object.keys(graph['20'].inputs).filter((key) => key.startsWith('ref_images.ref_image_')).length, count * 2 + 1);
    assert.equal(graph['20'].inputs.ref_image_size, 'match');
    assert.equal(graph['20'].inputs.width, 1152);
    assert.equal(graph['20'].inputs.height, 768);
    assert.equal(graph['20'].inputs.length, 124);
    assert.equal(graph['22'].inputs.sampler_name, 'res_multistep');
    assert.deepEqual(graph['23'].inputs, { model: ['1', 0], scheduler: 'beta', steps: 20, denoise: 1 });
    assert.deepEqual(graph['28'].inputs.audio, ['27', 0]);
    assert.equal(Object.hasOwn(graph['28'].inputs, 'bit_depth'), false);
    assert.equal(graph['29'].inputs.filename_prefix, 'mullet/scene-motion');
    assert.equal(graph['29'].inputs.format, 'auto');
    assert.equal(Object.values(graph).some((node) => node.class_type === 'LoraLoaderModelOnly'), false);
    assert.doesNotMatch(graph['20'].inputs.prompt, /opens exactly on the supplied first frame/i);
    assert.doesNotMatch(graph['20'].inputs.prompt, /body and wardrobe appearance/);
    assert.match(graph['20'].inputs.prompt, /body proportions, hair silhouette, and invariant accessories/);
    assert.match(graph['20'].inputs.prompt, /attire and placement established in <Picture 1>/);
    assert.doesNotMatch(graph['20'].inputs.prompt, /selectively_preserved/);
    const initialRetention = graph['20'].inputs.prompt
      .split('retention_analysis:\n')[1]
      .split('\n\ndetailed_description:')[0]
      .split('\n');
    assert.equal(initialRetention.filter((line) => line.startsWith('<Picture ')).length, 1);
    assert.equal(initialRetention.filter((line) => line.startsWith('<Subject ')).length, count);
    for (let index = 0; index < count; index += 1) {
      assert.match(
        initialRetention[index + 1],
        new RegExp(`^<Subject ${index + 1}> \\(appears in \\[Shot 1\\]\\): fully_preserved -`)
      );
    }

    const master = continuityMasterFor(cast);
    const continuedRequest = buildInlineSceneVideoRequest(
      staticScene('3:2', 0.5, { candidates, cast, continuityMaster: master }),
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
    );
    const masterInput = priorMasterInput(master);
    const continuedPlan = inlineSceneH3ReferencePlan(continuedRequest);
    assert.deepEqual(continuedPlan.map(({ picture, kind }) => ({ picture, kind })), [
      { picture: 1, kind: 'current_scene' },
      { picture: 2, kind: 'prior_master' },
      ...Array.from({ length: count }, (_unused, index) => ({ picture: index + 3, kind: 'canonical_identity' })),
      ...Array.from({ length: count }, (_unused, index) => ({ picture: count + index + 3, kind: 'body_identity' }))
    ]);
    assert.equal(
      describeInlineSceneH3ReferencePlan(continuedRequest),
      `${count * 2 + 2} refs · P1 scene · P2 prior · ${candidates.map((candidate, index) => (
        `${candidate.displayName} P${index + 3} face/P${count + index + 3} body`
      )).join(' · ')}`
    );
    const continuedGraph = buildMiniMaxH3InlineSceneVideoWorkflow(continuedRequest, input, 43, masterInput);
    assert.equal(continuedGraph['6'].inputs.image, `mullet/motion-inputs/${masterInput.name}`);
    assert.deepEqual(continuedGraph['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
    assert.deepEqual(continuedGraph['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
    for (let index = 0; index < count; index += 1) {
      const nodeId = String(7 + index);
      const bodyNodeId = String(7 + count + index);
      assert.deepEqual(continuedGraph['20'].inputs[`ref_images.ref_image_${index + 2}`], [nodeId, 0]);
      assert.deepEqual(continuedGraph['20'].inputs[`ref_images.ref_image_${count + index + 2}`], [bodyNodeId, 0]);
      assert.match(continuedGraph['20'].inputs.prompt, new RegExp(`<Subject ${index + 1}> is .*<Picture ${index + 3}>.*<Picture ${count + index + 3}>`));
    }
    assert.equal(Object.keys(continuedGraph['20'].inputs).filter((key) => key.startsWith('ref_images.ref_image_')).length, count * 2 + 2);
    assert.match(continuedGraph['20'].inputs.prompt, /<Picture 2> is the verified prior scene master/);
    assert.doesNotMatch(continuedGraph['20'].inputs.prompt, /opens exactly on the supplied first frame/i);
    assert.doesNotMatch(continuedGraph['20'].inputs.prompt, /selectively_preserved/);
    const continuedRetention = continuedGraph['20'].inputs.prompt
      .split('retention_analysis:\n')[1]
      .split('\n\ndetailed_description:')[0]
      .split('\n');
    assert.equal(continuedRetention.filter((line) => line.startsWith('<Picture ')).length, 2);
    assert.equal(continuedRetention.filter((line) => line.startsWith('<Subject ')).length, count);
    assert.match(continuedRetention[1], /^<Picture 2> .*: partially_preserved -/);
    for (let index = 0; index < count; index += 1) {
      assert.match(
        continuedRetention[index + 2],
        new RegExp(`^<Subject ${index + 1}> \\(appears in \\[Shot 1\\]\\): fully_preserved -`)
      );
    }
    assert.throws(
      () => buildMiniMaxH3InlineSceneVideoWorkflow(continuedRequest, input, 43),
      /prior master input presence/
    );
    assert.throws(
      () => buildMiniMaxH3InlineSceneVideoWorkflow(continuedRequest, input, 43, {
        ...masterInput,
        imageSha256: '6'.repeat(64)
      }),
      /prior master input/
    );
    assert.throws(
      () => buildMiniMaxH3InlineSceneVideoWorkflow(request, input, 43, masterInput),
      /prior master input presence/
    );
  }
  const request = buildInlineSceneVideoRequest(
    staticScene('3:2', 0.5, { candidates: trioCandidates, cast: trioCast }),
    MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
  );
  const refPrompt = buildInlineSceneVideoPrompt(request);
  assert.match(refPrompt, /^subject_definitions:/);
  assert.match(refPrompt, /detailed_description:[\s\S]*damaged starship flight deck/);
  assert.match(refPrompt, /overall_soundscape:[\s\S]*native stereo room tone/);
  assert.match(refPrompt, /non_diegetic_music:\nN\/A\. No music/);
  assert.match(refPrompt, /No dialogue, voices, narration, singing, or speech-like sound/);
  assert.throws(
    () => buildMiniMaxH3InlineSceneVideoWorkflow(request, { ...input, imageSha256: 'b'.repeat(64) }, 42),
    /input reference/
  );

  const noOverlapMaster = {
    ...continuityMasterFor(soloCast),
    cast: [{ profileId: 'not-jenna', profileFingerprint: 'b'.repeat(64) }]
  };
  const noOverlapRequest = buildInlineSceneVideoRequest(
    staticScene('3:2', 0.5, { continuityMaster: noOverlapMaster }),
    MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
  );
  assert.equal(inlineSceneH3ReferencePlan(noOverlapRequest).some(({ kind }) => kind === 'prior_master'), false);
  assert.doesNotThrow(() => buildMiniMaxH3InlineSceneVideoWorkflow(noOverlapRequest, input, 42));
  assert.throws(
    () => buildMiniMaxH3InlineSceneVideoWorkflow(noOverlapRequest, input, 42, priorMasterInput(noOverlapMaster)),
    /presence/
  );

  const sameHashMaster = { ...continuityMasterFor(soloCast), imageSha256: input.imageSha256 };
  const sameHashRequest = buildInlineSceneVideoRequest(
    staticScene('3:2', 0.5, { continuityMaster: sameHashMaster }),
    MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
  );
  assert.equal(inlineSceneH3ReferencePlan(sameHashRequest).some(({ kind }) => kind === 'prior_master'), false);

  const duplicateReference = trioCast.identities[0].referenceImage;
  const dedupedCast = {
    kind: 'duo',
    identities: trioCast.identities.slice(0, 2).map((identity) => ({
      ...identity,
      bodyReferenceImage: duplicateReference
    }))
  };
  assert.throws(
    () => buildInlineSceneVideoRequest(
      staticScene('3:2', 0.5, {
        candidates: trioCandidates.slice(0, 2),
        cast: dedupedCast
      }),
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID
    ),
    /reference shared by different identities/
  );
});

test('builds the exact additive LightX Ref2VA four-step preview without changing quality H3', () => {
  const scene = staticScene('16:9', 0.5);
  const qualityRequest = buildInlineSceneVideoRequest(scene, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
  const previewRequest = buildInlineSceneVideoRequest(
    scene,
    MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID
  );
  const input = {
    name: 'scene-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: previewRequest.source.sceneImageSha256
  };
  assert.notEqual(inlineSceneVideoRequestKey(previewRequest), inlineSceneVideoRequestKey(qualityRequest));
  assert.deepEqual(
    inlineSceneH3ReferencePlan(previewRequest).map(({ picture, kind }) => ({ picture, kind })),
    [
      { picture: 1, kind: 'current_scene' },
      { picture: 2, kind: 'canonical_identity' },
      { picture: 3, kind: 'body_identity' }
    ]
  );
  const graph = buildInlineSceneVideoWorkflow(previewRequest, input, 42);
  assert.equal(graph['20'].inputs.width, 960);
  assert.equal(graph['20'].inputs.height, 544);
  assert.equal(graph['20'].inputs.length, 124);
  assert.equal(graph['20'].inputs.ref_image_size, 'match');
  assert.equal(graph['22'].inputs.sampler_name, 'euler');
  assert.deepEqual(graph['23'].inputs, { model: ['1', 0], scheduler: 'simple', steps: 4, denoise: 1 });
  assert.deepEqual(graph['30'].inputs, {
    model: ['1', 0],
    lora_name: MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.lora,
    strength_model: 1
  });
  assert.deepEqual(graph['31'].inputs, { model: ['30', 0], shift_video: 12, shift_audio: 3 });
  assert.deepEqual(graph['21'].inputs.model, ['31', 0]);
  assert.equal(Object.hasOwn(graph['28'].inputs, 'bit_depth'), false);
  const qualityGraph = buildInlineSceneVideoWorkflow(qualityRequest, input, 42);
  assert.equal('30' in qualityGraph, false);
  assert.equal('31' in qualityGraph, false);
  assert.equal(qualityGraph['22'].inputs.sampler_name, 'res_multistep');
  assert.deepEqual(qualityGraph['23'].inputs, { model: ['1', 0], scheduler: 'beta', steps: 20, denoise: 1 });
  assert.equal(Object.hasOwn(qualityGraph['28'].inputs, 'bit_depth'), false);
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
  assert.equal(graph['35'].class_type, 'CreateVideo');
  assert.equal('audio' in graph['35'].inputs, false);
  assert.equal(graph['35'].inputs.bit_depth, 8);
  assert.equal(graph['36'].class_type, 'SaveVideo');
  assert.equal(graph['36'].inputs.format, 'mp4');
  assert.equal(graph['36'].inputs.codec, 'h264');
  assert.deepEqual(graph['36'].inputs.video, ['35', 0]);
  assert.match(buildInlineSceneVideoPrompt(request), /Silent video only/);
  assert.match(buildInlineSceneVideoPrompt(request), /no talking, no lip or mouth movement/);
  assert.match(buildInlineSceneVideoPrompt(request), /opens exactly on the supplied first frame/);
  const master = continuityMasterFor(soloCast);
  assert.throws(
    () => buildInlineSceneVideoWorkflow(request, input, 42, priorMasterInput(master)),
    /does not accept a prior master/
  );
});
