import assert from 'node:assert/strict';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
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
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_DIMENSIONS,
  buildInlineSceneVideoPrompt,
  buildInlineSceneVideoRequest,
  buildInlineSceneVideoWorkflow,
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
    transcriptSourceForMessages(conversationId, messages),
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

test('reference scene graph nests the pictures under ref_images and names them in order', async () => {
  const { buildMiniMaxH3ReferenceSceneWorkflow, buildMiniMaxH3ReferenceScenePrompt, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE } = await import('../src/lib/inline-scene-video.ts');
  const references = [
    { subject: 'Jan', view: 'face', image: 'mullet/identity/refpack/jan-pollock-face.png' },
    { subject: 'Jan', view: 'fullbody', image: 'mullet/identity/refpack/jan-pollock-fullbody.png' },
    { subject: 'Kristi', view: 'identity', image: 'mullet/identity/cabin-kristi-v1.png' }
  ];
  const prompt = buildMiniMaxH3ReferenceScenePrompt('They sit on the porch steps.', 'Jan: grey shirt.', references);
  assert.match(prompt, /Jan is the person in <Picture 1> face, <Picture 2> full body and clothing; Kristi is the person in <Picture 3> identity/);
  const graph = buildMiniMaxH3ReferenceSceneWorkflow({ prompt, references, width: 1024, height: 576, frames: 73, fps: 24, seed: 7 });
  const node = graph['6'];
  assert.equal(node.class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(node.inputs.ref_images, { ref_image_0: ['20', 0], ref_image_1: ['21', 0], ref_image_2: ['22', 0] });
  assert.equal(node.inputs.ref_image_size, 'match');
  assert.equal(graph['1'].inputs.unet_name, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['16'].inputs.lora_name, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.turboLora);
  assert.equal(graph['22'].inputs.image, 'mullet/identity/cabin-kristi-v1.png');
  assert.equal(Object.keys(graph).filter((id) => graph[id].class_type === 'LoadImage').length, 3);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt, references: [], width: 1024, height: 576, frames: 73, fps: 24, seed: 7 }), /between 1 and 9/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt, references, width: 1000, height: 576, frames: 73, fps: 24, seed: 7 }), /multiples of 32/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt, references, width: 1024, height: 576, frames: 72, fps: 24, seed: 7 }), /5 \+ 17k/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt, references: [{ subject: 'X', view: 'face', image: '../etc/passwd.png' }], width: 1024, height: 576, frames: 73, fps: 24, seed: 7 }), /mullet input namespace/);
});

