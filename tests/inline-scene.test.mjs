import assert from 'node:assert/strict';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_CAPABILITIES_SPEC,
  INLINE_SCENE_IMAGE_REQUEST_SPEC,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_REQUEST_SPEC,
  INLINE_SCENE_RESULT_SPEC,
  INLINE_SCENE_SYSTEM_PROMPT,
  INLINE_SCENE_TEMPLATE_ID,
  QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildInlineSceneImageRequest,
  buildInlineScenePrompt,
  buildInlineSceneRequest,
  buildQwenImageEditSceneWorkflow,
  buildZImageTurboSceneWorkflow,
  createInlineSceneContinuityMaster,
  createInlineSceneResult,
  inlineSceneContinuityMasterEligible,
  inlineSceneDimensions,
  inlineSceneDimensionsForTemplate,
  inlineSceneImageRequestFingerprint,
  inlineSceneImageRequestKey,
  inlineSceneQwenReferencePlan,
  inlineSceneSourceForCompletedTurn,
  inlineSceneSourceForScenarioOpening,
  inlineSceneSourceKey,
  inlineSceneSourceMatchesMessages,
  inlineSceneSourcesMatch,
  inlineSceneResultMatchesRequest,
  normalizeInlineSceneContinuityMaster,
  normalizeInlineSceneImageRequest,
  normalizeInlineSceneRequest,
  parseInlineSceneResponse
} from '../src/lib/inline-scene.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const messages = Object.freeze([
  Object.freeze({ role: 'user', content: 'What is happening on the flight deck?' }),
  Object.freeze({ role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' })
]);
const openingMessages = Object.freeze([
  Object.freeze({ role: 'assistant', content: 'Jenna grips the flight console as pursuit ships close on the Liberator.' })
]);
const openingIdentity = Object.freeze({
  scenarioId: 'blakes-7-post-gan',
  scenarioVersion: '1.1.0',
  starterId: 'jenna',
  expectedGreeting: openingMessages[0].content
});
const visualPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'c'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const callyReference = Object.freeze({
  name: 'cally-v2.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'd'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const servalanReference = Object.freeze({
  name: 'servalan-v1.png',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'e'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const avonReference = Object.freeze({
  name: 'kerr-avon-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: '1'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const jennaBodyReference = Object.freeze({
  name: 'jenna-stannis-body-v1.png',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: '2'.repeat(64),
  width: 768,
  height: 1024,
  aspectRatio: '3:4'
});
const callyBodyReference = Object.freeze({
  name: 'cally-body-v1.png',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: '3'.repeat(64),
  width: 768,
  height: 1024,
  aspectRatio: '3:4'
});
const candidates = Object.freeze([
  Object.freeze({
    id: 'jenna-stannis',
    displayName: 'Jenna Stannis',
    aliases: Object.freeze(['Jenna', 'Jenna Stannis']),
    profileFingerprint: 'a'.repeat(8)
  }),
  Object.freeze({
    id: 'cally',
    displayName: 'Cally',
    aliases: Object.freeze(['Cally', 'Cally of Auron']),
    profileFingerprint: 'b'.repeat(8)
  }),
  Object.freeze({
    id: 'servalan',
    displayName: 'Servalan',
    aliases: Object.freeze(['Servalan', 'Supreme Commander Servalan']),
    profileFingerprint: 'c'.repeat(8)
  }),
  Object.freeze({
    id: 'kerr-avon',
    displayName: 'Kerr Avon',
    aliases: Object.freeze(['Avon', 'Kerr Avon']),
    profileFingerprint: 'f'.repeat(8)
  })
]);
const identities = Object.freeze({
  'jenna-stannis': Object.freeze({
    profileId: 'jenna-stannis',
    profileFingerprint: candidates[0].profileFingerprint,
    displayName: candidates[0].displayName,
    subject: 'Sally Knyvette portraying Jenna Stannis',
    referenceImage: canonicalReference,
    bodyReferenceImage: null
  }),
  cally: Object.freeze({
    profileId: 'cally',
    profileFingerprint: candidates[1].profileFingerprint,
    displayName: candidates[1].displayName,
    subject: 'Jan Chappell portraying Cally',
    referenceImage: callyReference,
    bodyReferenceImage: null
  }),
  servalan: Object.freeze({
    profileId: 'servalan',
    profileFingerprint: candidates[2].profileFingerprint,
    displayName: candidates[2].displayName,
    subject: 'Jacqueline Pearce portraying Servalan',
    referenceImage: servalanReference,
    bodyReferenceImage: null
  }),
  'kerr-avon': Object.freeze({
    profileId: 'kerr-avon',
    profileFingerprint: candidates[3].profileFingerprint,
    displayName: candidates[3].displayName,
    subject: 'Paul Darrow portraying Kerr Avon',
    referenceImage: avonReference,
    bodyReferenceImage: null
  })
});
const subjectLora = Object.freeze({
  path: 'zimage/jenna6.safetensors',
  trigger: 'jennastannis',
  modelHash: 'd'.repeat(64)
});
const continuityMaster = Object.freeze({
  requestKey: `sha256:${'2'.repeat(64)}`,
  promptId: '44444444-4444-4444-8444-444444444444',
  seed: 42,
  generatedAt: 1_700_000_000_000,
  width: 864,
  height: 576,
  imageSha256: '9'.repeat(64),
  cast: Object.freeze([
    Object.freeze({ profileId: 'jenna-stannis', profileFingerprint: candidates[0].profileFingerprint })
  ])
});
const uploadedMaster = Object.freeze({
  name: 'scene-continuity-55555555-5555-4555-8555-555555555555.png',
  subfolder: 'mullet/motion-inputs',
  type: 'input',
  imageSha256: continuityMaster.imageSha256,
  width: continuityMaster.width,
  height: continuityMaster.height
});

function cast(...profileIds) {
  return {
    kind: profileIds.length === 1 ? 'solo' : profileIds.length === 2 ? 'duo' : 'trio',
    identities: profileIds.map((id) => identities[id])
  };
}

function castWithBodyReferences(...profileIds) {
  const bodyReferences = new Map([
    ['jenna-stannis', jennaBodyReference],
    ['cally', callyBodyReference]
  ]);
  return {
    kind: profileIds.length === 1 ? 'solo' : profileIds.length === 2 ? 'duo' : 'trio',
    identities: profileIds.map((id) => ({
      ...identities[id],
      bodyReferenceImage: bodyReferences.get(id) ?? null
    }))
  };
}

function result(subjectIds = ['jenna-stannis']) {
  const request = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    candidates
  );
  return createInlineSceneResult(request, 'gemma-4-ortenzya', { prompt: visualPrompt, subjectIds });
}

function qwenRequest(profileIds, continuity = undefined) {
  return buildInlineSceneImageRequest(result(profileIds), {
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    cast: cast(...profileIds),
    ...(continuity ? { continuityMaster: continuity } : {}),
    lora: null,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
}


test('builds a finalized-response sidecar request without mutating the transcript', () => {
  const before = JSON.stringify(messages);
  const source = transcriptSourceForMessages(conversationId, messages);
  const request = buildInlineSceneRequest(conversationId, messages, source, candidates);
  assert.equal(request.turns.length, 2);
  assert.equal(request.source.fingerprint, source.fingerprint);
  assert.equal(JSON.stringify(messages), before);
  assert.match(INLINE_SCENE_SYSTEM_PROMPT, /untrusted story data/);
  assert.deepEqual(request.candidates, candidates);
  assert.throws(() => buildInlineSceneRequest(conversationId, [...messages, { role: 'assistant', content: 'partial' }], source, candidates), /latest finalized/);
});

test('represents a canonical assistant-only scenario opening without weakening completed-turn provenance', () => {
  const before = JSON.stringify(openingMessages);
  const source = inlineSceneSourceForScenarioOpening(conversationId, openingMessages, openingIdentity);
  const request = buildInlineSceneRequest(conversationId, openingMessages, source, candidates);
  assert.equal(INLINE_SCENE_REQUEST_SPEC, 'mullet_inline_scene_request_v3');
  assert.equal(INLINE_SCENE_RESULT_SPEC, 'mullet_inline_scene_result_v3');
  assert.equal(INLINE_SCENE_IMAGE_REQUEST_SPEC, 'mullet_inline_scene_image_request_v5');
  assert.equal(source.sourceKind, 'scenario_opening');
  assert.equal(source.messageCount, 1);
  assert.equal(source.messageIndex, 0);
  assert.equal(source.scenarioId, openingIdentity.scenarioId);
  assert.equal(source.scenarioVersion, openingIdentity.scenarioVersion);
  assert.equal(source.starterId, openingIdentity.starterId);
  assert.match(source.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(source.openingFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(request.turns, openingMessages);
  assert.deepEqual(normalizeInlineSceneRequest(request), request);
  assert.equal(inlineSceneSourceMatchesMessages(source, conversationId, openingMessages), true);
  assert.equal(inlineSceneSourceMatchesMessages(source, conversationId, [...openingMessages, { role: 'user', content: 'What now?' }]), true);
  assert.equal(JSON.stringify(openingMessages), before);

  const openingResult = createInlineSceneResult(request, 'gemma-4-ortenzya', {
    prompt: visualPrompt,
    subjectIds: ['jenna-stannis']
  });
  assert.equal(inlineSceneResultMatchesRequest(openingResult, request), true);
  const openingImageRequest = buildInlineSceneImageRequest(openingResult, {
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    cast: cast('jenna-stannis'),
    lora: null,
    aspectRatio: '16:9',
    megapixels: 1
  });
  assert.equal(openingImageRequest.source.sourceKind, 'scenario_opening');
  assert.equal(openingImageRequest.source.openingFingerprint, source.openingFingerprint);
  assert.deepEqual(normalizeInlineSceneImageRequest(openingImageRequest), openingImageRequest);

  const otherSource = inlineSceneSourceForScenarioOpening(conversationId, openingMessages, {
    ...openingIdentity,
    starterId: 'cally'
  });
  const otherImageRequest = buildInlineSceneImageRequest(
    createInlineSceneResult(
      buildInlineSceneRequest(conversationId, openingMessages, otherSource, candidates),
      'gemma-4-ortenzya',
      { prompt: visualPrompt, subjectIds: ['jenna-stannis'] }
    ),
    {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: cast('jenna-stannis'),
      lora: null,
      aspectRatio: '16:9',
      megapixels: 1
    }
  );
  assert.notEqual(inlineSceneImageRequestKey(openingImageRequest), inlineSceneImageRequestKey(otherImageRequest));

  const completed = inlineSceneSourceForCompletedTurn(transcriptSourceForMessages(conversationId, messages));
  assert.equal(completed.sourceKind, 'completed_turn');
  assert.equal(inlineSceneSourcesMatch(source, completed), false);
  assert.notEqual(inlineSceneSourceKey(source), inlineSceneSourceKey(completed));
  assert.throws(
    () => buildInlineSceneRequest(conversationId, [...openingMessages, { role: 'user', content: 'What now?' }], source, candidates),
    /latest finalized/
  );
});

test('rejects non-canonical, partial, and forged scenario-opening sources', () => {
  assert.throws(
    () => inlineSceneSourceForScenarioOpening(conversationId, openingMessages, {
      ...openingIdentity,
      expectedGreeting: 'A different opening.'
    }),
    /canonical starter greeting/
  );
  assert.throws(
    () => inlineSceneSourceForScenarioOpening(conversationId, [{ role: 'user', content: openingMessages[0].content }], openingIdentity),
    /exactly one assistant message/
  );
  assert.throws(
    () => inlineSceneSourceForScenarioOpening(conversationId, [...openingMessages, { role: 'assistant', content: 'partial' }], openingIdentity),
    /exactly one assistant message/
  );

  const source = inlineSceneSourceForScenarioOpening(conversationId, openingMessages, openingIdentity);
  const request = buildInlineSceneRequest(conversationId, openingMessages, source, candidates);
  assert.throws(
    () => normalizeInlineSceneRequest({
      ...request,
      turns: [{ role: 'assistant', content: 'Changed after provenance was recorded.' }]
    }),
    /fingerprint/
  );
  assert.throws(
    () => normalizeInlineSceneRequest({
      ...request,
      source: { ...request.source, starterId: 'cally' }
    }),
    /fingerprint/
  );
  assert.throws(
    () => normalizeInlineSceneRequest({
      ...request,
      source: { ...request.source, openingFingerprint: `sha256:${'0'.repeat(64)}` }
    }),
    /fingerprint/
  );
  assert.equal(inlineSceneSourceMatchesMessages(source, conversationId, [{ role: 'assistant', content: 'Changed.' }]), false);
  assert.equal(inlineSceneSourceMatchesMessages(source, '748b08b7-20bb-4138-a402-0188cc04d2ea', openingMessages), false);
});

test('shrinks an oversized context tail while retaining the exact finalized pair', () => {
  const transcript = [
    { role: 'assistant', content: 'Opening greeting.' },
    { role: 'user', content: 'x'.repeat(61_000) },
    { role: 'assistant', content: 'An earlier answer.' },
    ...messages
  ];
  const source = transcriptSourceForMessages(conversationId, transcript);
  const request = buildInlineSceneRequest(conversationId, transcript, source, candidates);
  assert.deepEqual(request.turns, [transcript[2], ...messages]);
  assert.equal(request.turns.some((turn) => turn.content.length > 60_000), false);
});

test('rejects forged source provenance unrelated to the supplied latest turn', () => {
  const request = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    candidates
  );
  assert.throws(
    () => createInlineSceneResult(
      { ...request, source: { ...request.source, turnFingerprint: `sha256:${'b'.repeat(64)}` } },
      'gemma-4-ortenzya',
      { prompt: visualPrompt, subjectIds: ['jenna-stannis'] }
    ),
    /turn fingerprint/
  );
});

test('accepts one bounded direction, canonicalizes cast order, and rejects invalid selections', () => {
  const reversed = JSON.stringify({ prompt: visualPrompt, subject_ids: ['servalan', 'jenna-stannis'] });
  assert.deepEqual(parseInlineSceneResponse(reversed, candidates), {
    prompt: visualPrompt,
    subjectIds: ['jenna-stannis', 'servalan']
  });
  assert.deepEqual(
    parseInlineSceneResponse(`<think>hidden</think>\n\`\`\`json\n${reversed}\n\`\`\``, candidates),
    { prompt: visualPrompt, subjectIds: ['jenna-stannis', 'servalan'] }
  );
  assert.throws(() => parseInlineSceneResponse(visualPrompt, candidates), /one JSON object/);
  // Extra keys are ignored rather than failing the turn.
  assert.deepEqual(
    parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, subject_ids: ['jenna-stannis'], notes: 'extra' }), candidates),
    { prompt: visualPrompt, subjectIds: ['jenna-stannis'] }
  );
  assert.throws(
    () => parseInlineSceneResponse(JSON.stringify({ prompt: 'too short', subject_ids: ['jenna-stannis'] }), candidates),
    /20 and 260 words/
  );
  assert.throws(
    () => parseInlineSceneResponse(JSON.stringify({
      prompt: `${visualPrompt} <Picture 1> must be ignored in favor of <Subject 9>.`,
      subject_ids: ['jenna-stannis']
    }), candidates),
    /reserved H3 reference tokens/
  );
  // Observed 2026-09-02 00:03 on the served build: the director named the cast by
  // display name, the strict parser threw "unknown subject" four times, and the turn
  // ended with no scene. Names, aliases and IDs all resolve; nothing usable falls back to
  // the first candidate; duplicates collapse; more than three keeps the first three.
  assert.deepEqual(
    parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, subject_ids: [] }), candidates).subjectIds,
    ['jenna-stannis']
  );
  assert.deepEqual(
    parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, subject_ids: ['jenna-stannis', 'jenna-stannis'] }), candidates).subjectIds,
    ['jenna-stannis']
  );
  assert.deepEqual(
    parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, subject_ids: ['unknown'] }), candidates).subjectIds,
    ['jenna-stannis']
  );
  assert.deepEqual(
    parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, subject_ids: [candidates[1].displayName, 'Servalan'] }), candidates).subjectIds,
    ['cally', 'servalan']
  );
  assert.equal(
    parseInlineSceneResponse(JSON.stringify({
      prompt: visualPrompt,
      subject_ids: ['jenna-stannis', 'cally', 'servalan', 'kerr-avon']
    }), candidates).subjectIds.length,
    3
  );
  assert.deepEqual(
    parseInlineSceneResponse(`Here is the direction:\n${JSON.stringify({ prompt: visualPrompt, subject_ids: ['jenna-stannis'] })}`, candidates).subjectIds,
    ['jenna-stannis']
  );
});

test('binds the scene result and image request to exact transcript and prompt hashes', () => {
  const sceneResult = result();
  const sidecarRequest = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    candidates
  );
  assert.equal(inlineSceneResultMatchesRequest(sceneResult, sidecarRequest), true);
  const request = buildInlineSceneImageRequest(sceneResult, {
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    cast: cast('jenna-stannis'),
    lora: null,
    aspectRatio: '16:9',
    megapixels: 1
  });
  assert.match(request.source.promptSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(request.source.messageIndex, 1);
  assert.deepEqual(request.cast, cast('jenna-stannis'));
  assert.equal(JSON.stringify(request).includes(messages[0].content), false);
  assert.throws(() => normalizeInlineSceneImageRequest({ ...request, prompt: `${request.prompt} changed` }), /prompt hash/);
  assert.throws(() => normalizeInlineSceneImageRequest({
    ...request,
    lora: { path: 'zimage/subject.safetensors', trigger: 'subject', modelHash: 'd'.repeat(64) }
  }), /Qwen inline scenes require/);
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({ ...request, megapixels: 0.9 }));
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({
    ...request,
    cast: {
      kind: 'solo',
      identities: [{ ...identities['jenna-stannis'], referenceImage: { ...canonicalReference, sha256: 'f'.repeat(64) } }]
    }
  }));
  assert.throws(
    () => buildInlineSceneImageRequest(sceneResult, {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: cast('cally'),
      lora: null,
      aspectRatio: '16:9',
      megapixels: 1
    }),
    /does not match the sidecar-selected subjects/
  );
  assert.equal(inlineSceneResultMatchesRequest(sceneResult, { ...sidecarRequest, candidates: candidates.slice().reverse() }), false);
});

test('bounds continuity provenance without embedding a recursive prior request', () => {
  assert.deepEqual(normalizeInlineSceneContinuityMaster(continuityMaster), continuityMaster);
  assert.throws(
    () => normalizeInlineSceneContinuityMaster({ ...continuityMaster, request: qwenRequest(['jenna-stannis']) }),
    /continuity master is invalid/
  );
  assert.throws(
    () => normalizeInlineSceneContinuityMaster({ ...continuityMaster, requestKey: 'prior-request-key' }),
    /request key is invalid/
  );
  const baseline = qwenRequest(['jenna-stannis']);
  const continued = qwenRequest(['jenna-stannis'], continuityMaster);
  assert.notEqual(inlineSceneImageRequestKey(baseline), inlineSceneImageRequestKey(continued));
  assert.notEqual(
    inlineSceneImageRequestKey(continued),
    inlineSceneImageRequestKey({
      ...continued,
      continuityMaster: { ...continuityMaster, imageSha256: '8'.repeat(64) }
    })
  );
  const accepted = createInlineSceneContinuityMaster(baseline, {
    promptId: continuityMaster.promptId,
    seed: continuityMaster.seed,
    generatedAt: continuityMaster.generatedAt,
    imageSha256: continuityMaster.imageSha256
  });
  assert.equal(accepted.requestKey, inlineSceneImageRequestFingerprint(baseline));
  assert.equal(accepted.requestKey.length, 71);
  assert.deepEqual(accepted.cast, continuityMaster.cast);
  const nextRequest = qwenRequest(['jenna-stannis'], accepted);
  const nextMaster = createInlineSceneContinuityMaster(nextRequest, {
    promptId: '66666666-6666-4666-8666-666666666666',
    seed: 43,
    generatedAt: continuityMaster.generatedAt + 1,
    imageSha256: '7'.repeat(64)
  });
  assert.equal(nextMaster.requestKey.length, 71);
  assert.equal(JSON.stringify(nextMaster).includes(accepted.requestKey), false);
  const zRequest = buildInlineSceneImageRequest(result(), {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: cast('jenna-stannis'),
    lora: subjectLora,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
  assert.throws(
    () => normalizeInlineSceneImageRequest({ ...zRequest, continuityMaster }),
    /Z-Image inline scenes require/
  );
});

test('allocates master and identity references deterministically for one, two, and three subjects', () => {
  assert.deepEqual(
    inlineSceneQwenReferencePlan(qwenRequest(['jenna-stannis', 'cally', 'servalan'])).map((slot) => (
      slot.kind === 'identity' ? [slot.picture, slot.identity.profileId, slot.newlyIntroduced] : [slot.picture, slot.kind]
    )),
    [[1, 'jenna-stannis', true], [2, 'cally', true], [3, 'servalan', true]]
  );

  const twoNewSubjects = qwenRequest(['jenna-stannis', 'cally', 'servalan'], continuityMaster);
  assert.deepEqual(
    inlineSceneQwenReferencePlan(twoNewSubjects).map((slot) => (
      slot.kind === 'identity' ? [slot.picture, slot.identity.profileId, slot.newlyIntroduced] : [slot.picture, slot.kind]
    )),
    [[1, 'continuity_master'], [2, 'cally', true], [3, 'servalan', true]]
  );

  const sameTrioMaster = {
    ...continuityMaster,
    cast: ['jenna-stannis', 'cally', 'servalan'].map((profileId) => ({
      profileId,
      profileFingerprint: candidates.find(({ id }) => id === profileId).profileFingerprint
    }))
  };
  const sameTrio = qwenRequest(['jenna-stannis', 'cally', 'servalan'], sameTrioMaster);
  assert.deepEqual(
    inlineSceneQwenReferencePlan(sameTrio).map((slot) => (
      slot.kind === 'identity' ? [slot.picture, slot.identity.profileId, slot.newlyIntroduced] : [slot.picture, slot.kind]
    )),
    [[1, 'continuity_master'], [2, 'jenna-stannis', false], [3, 'cally', false]]
  );
  const prompt = buildInlineScenePrompt(sameTrio);
  assert.match(prompt, /Picture 1 is the prior accepted scene master/);
  assert.match(prompt, /Picture 2 is the exact identity reference for Jenna Stannis/);
  assert.match(prompt, /Picture 3 is the exact identity reference for Cally/);
  assert.doesNotMatch(prompt, /identity reference for Servalan/);

  const unrelatedMaster = {
    ...continuityMaster,
    cast: [{ profileId: 'kerr-avon', profileFingerprint: candidates[3].profileFingerprint }]
  };
  assert.throws(
    () => inlineSceneQwenReferencePlan(qwenRequest(['jenna-stannis', 'cally', 'servalan'], unrelatedMaster)),
    /cannot introduce more than two subjects/
  );

  const replacementTrio = cast('cally', 'servalan', 'kerr-avon');
  assert.equal(inlineSceneContinuityMasterEligible(replacementTrio, continuityMaster), false);
  const freshReplacement = qwenRequest(['cally', 'servalan', 'kerr-avon']);
  assert.deepEqual(
    inlineSceneQwenReferencePlan(freshReplacement).map((slot) => [slot.picture, slot.kind, slot.identity.profileId]),
    [[1, 'identity', 'cally'], [2, 'identity', 'servalan'], [3, 'identity', 'kerr-avon']]
  );
  assert.equal(inlineSceneContinuityMasterEligible(cast('cally', 'servalan'), continuityMaster), true);
});

test('uses free Qwen slots for stable body references and rejects cross-role SHA aliasing', () => {
  const requestWithCast = (profileIds, selectedCast, continuity = undefined) => (
    buildInlineSceneImageRequest(result(profileIds), {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: selectedCast,
      ...(continuity ? { continuityMaster: continuity } : {}),
      lora: null,
      aspectRatio: '3:2',
      megapixels: 0.5
    })
  );
  const describe = (slot) => slot.kind === 'continuity_master'
    ? [slot.picture, slot.kind]
    : [slot.picture, slot.kind, slot.identity.profileId];

  const solo = requestWithCast(['jenna-stannis'], castWithBodyReferences('jenna-stannis'));
  assert.deepEqual(
    inlineSceneQwenReferencePlan(solo).map(describe),
    [[1, 'identity', 'jenna-stannis'], [2, 'body_wardrobe', 'jenna-stannis']]
  );
  assert.match(buildInlineScenePrompt(solo), /Picture 2 is the body and wardrobe reference for Jenna Stannis/);
  const soloGraph = buildQwenImageEditSceneWorkflow(solo, 43);
  assert.equal(soloGraph['4'].inputs.image, canonicalReference.subfolder + '/' + canonicalReference.name);
  assert.equal(soloGraph['16'].inputs.image, jennaBodyReference.subfolder + '/' + jennaBodyReference.name);
  assert.deepEqual(soloGraph['9'].inputs.image2, ['16', 0]);

  const duo = requestWithCast(
    ['jenna-stannis', 'cally'],
    castWithBodyReferences('jenna-stannis', 'cally')
  );
  assert.deepEqual(
    inlineSceneQwenReferencePlan(duo).map(describe),
    [
      [1, 'identity', 'jenna-stannis'],
      [2, 'identity', 'cally'],
      [3, 'body_wardrobe', 'jenna-stannis']
    ]
  );

  const continuedSolo = requestWithCast(
    ['jenna-stannis'],
    castWithBodyReferences('jenna-stannis'),
    continuityMaster
  );
  assert.deepEqual(
    inlineSceneQwenReferencePlan(continuedSolo).map(describe),
    [
      [1, 'continuity_master'],
      [2, 'identity', 'jenna-stannis'],
      [3, 'body_wardrobe', 'jenna-stannis']
    ]
  );

  const duplicateBody = requestWithCast(['jenna-stannis'], {
    kind: 'solo',
    identities: [{
      ...identities['jenna-stannis'],
      bodyReferenceImage: { ...jennaBodyReference, sha256: canonicalReference.sha256 }
    }]
  });
  assert.deepEqual(
    inlineSceneQwenReferencePlan(duplicateBody).map(describe),
    [[1, 'identity', 'jenna-stannis']]
  );
  assert.throws(
    () => requestWithCast(['jenna-stannis', 'cally'], {
      kind: 'duo',
      identities: [
        identities['jenna-stannis'],
        { ...identities.cally, bodyReferenceImage: { ...callyBodyReference, sha256: canonicalReference.sha256 } }
      ]
    }),
    /reference shared by different identities/
  );
  const masterDuplicateBody = requestWithCast(['jenna-stannis'], {
    kind: 'solo',
    identities: [{
      ...identities['jenna-stannis'],
      bodyReferenceImage: { ...jennaBodyReference, sha256: continuityMaster.imageSha256 }
    }]
  }, continuityMaster);
  assert.deepEqual(
    inlineSceneQwenReferencePlan(masterDuplicateBody).map(describe),
    [[1, 'continuity_master'], [2, 'identity', 'jenna-stannis']]
  );
  assert.notEqual(inlineSceneImageRequestKey(solo), inlineSceneImageRequestKey(qwenRequest(['jenna-stannis'])));

  assert.throws(
    () => normalizeInlineSceneImageRequest({
      ...solo,
      cast: {
        kind: 'solo',
        identities: [{
          ...solo.cast.identities[0],
          bodyReferenceImage: { ...jennaBodyReference, aspectRatio: '9:16' }
        }]
      }
    }),
    /body and wardrobe reference aspect ratio must be 3:4/
  );
  assert.throws(
    () => normalizeInlineSceneImageRequest({
      ...solo,
      cast: {
        kind: 'solo',
        identities: [{
          ...solo.cast.identities[0],
          referenceImage: { ...canonicalReference, aspectRatio: '9:16' }
        }]
      }
    }),
    /identity reference aspect ratio must be 2:3/
  );
});

test('builds a continuity graph only from a verified master and its exact selected identity slots', () => {
  const request = qwenRequest(['jenna-stannis', 'cally', 'servalan'], continuityMaster);
  const graph = buildQwenImageEditSceneWorkflow(request, 43, undefined, uploadedMaster);
  assert.equal(graph['4'].inputs.image, `mullet/motion-inputs/${uploadedMaster.name}`);
  assert.equal(graph['16'].inputs.image, 'mullet/identity/cally-v2.jpg');
  assert.equal(graph['17'].inputs.image, 'mullet/identity/servalan-v1.png');
  assert.deepEqual(graph['9'].inputs.image1, ['15', 0]);
  assert.deepEqual(graph['9'].inputs.image2, ['16', 0]);
  assert.deepEqual(graph['9'].inputs.image3, ['17', 0]);
  assert.match(graph['9'].inputs.prompt, /Picture 1 is the prior accepted scene master/);
  assert.doesNotMatch(graph['9'].inputs.prompt, /identity reference for Jenna Stannis/);
  assert.throws(
    () => buildQwenImageEditSceneWorkflow(request, 43),
    /requires one uploaded master input/
  );
  assert.throws(
    () => buildQwenImageEditSceneWorkflow(request, 43, undefined, { ...uploadedMaster, imageSha256: '8'.repeat(64) }),
    /does not match continuity provenance/
  );
  assert.throws(
    () => buildQwenImageEditSceneWorkflow(qwenRequest(['jenna-stannis']), 43, undefined, uploadedMaster),
    /cannot use an unbound uploaded master input/
  );
});


test('binds a Z-Image scene to the linked LoRA trigger and provenance', () => {
  const request = buildInlineSceneImageRequest(result(), {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: cast('jenna-stannis'),
    lora: subjectLora,
    aspectRatio: '16:9',
    megapixels: 0.5
  });
  assert.equal(request.cast.kind, 'solo');
  assert.deepEqual(request.lora, subjectLora);
  assert.match(buildInlineScenePrompt(request), /jennastannis represents Sally Knyvette portraying Jenna Stannis/);
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({
    ...request,
    lora: { ...subjectLora, trigger: 'jennastannis_alt' }
  }));
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({
    ...request,
    lora: { ...subjectLora, modelHash: 'e'.repeat(64) }
  }));
  assert.throws(() => normalizeInlineSceneImageRequest({
    ...request,
    cast: cast('jenna-stannis', 'cally')
  }), /Z-Image inline scenes require/);
  assert.throws(() => normalizeInlineSceneImageRequest({
    ...request,
    lora: null
  }), /Z-Image inline scenes require/);
});


test('builds explicit solo, duo, and trio Qwen graphs with stable one-to-one image slots', () => {
  const capabilities = {
    spec: INLINE_SCENE_CAPABILITIES_SPEC,
    templates: [],
    aspectRatios: [],
    megapixels: [],
    loras: []
  };
  const requests = [
    buildInlineSceneImageRequest(result(['jenna-stannis']), {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: cast('jenna-stannis'),
      lora: null,
      aspectRatio: '3:2',
      megapixels: 0.5
    }),
    buildInlineSceneImageRequest(result(['cally', 'jenna-stannis']), {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: cast('jenna-stannis', 'cally'),
      lora: null,
      aspectRatio: '3:2',
      megapixels: 0.5
    }),
    buildInlineSceneImageRequest(result(['servalan', 'jenna-stannis', 'cally']), {
      modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
      cast: cast('jenna-stannis', 'cally', 'servalan'),
      lora: null,
      aspectRatio: '3:2',
      megapixels: 0.5
    })
  ];
  assert.deepEqual(requests.map((request) => request.cast.kind), ['solo', 'duo', 'trio']);
  const [graph, duoGraph, trioGraph] = requests.map((request) => buildQwenImageEditSceneWorkflow(request, 43, capabilities));
  assert.equal(graph['1'].inputs.unet_name, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.type, 'qwen_image');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.deepEqual(graph['5'].inputs, {
    image: ['4', 0], upscale_method: 'lanczos', width: 384, height: 576, crop: 'disabled'
  });
  assert.deepEqual(graph['15'].inputs, {
    image: ['5', 0], left: 240, top: 0, right: 240, bottom: 0, feathering: 40
  });
  assert.equal(graph['8'].inputs.lora_name, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora);
  assert.equal(graph['12'].inputs.steps, 4);
  assert.equal(graph['12'].inputs.sampler_name, 'euler');
  assert.deepEqual(graph['9'].inputs.image1, ['15', 0]);
  assert.equal(Object.hasOwn(graph['9'].inputs, 'image2'), false);
  assert.equal(Object.hasOwn(graph['9'].inputs, 'image3'), false);
  assert.equal(graph['16'], undefined);
  assert.equal(graph['17'], undefined);
  assert.deepEqual(graph['11'].inputs.pixels, ['15', 0]);
  assert.match(graph['9'].inputs.prompt, /outpaint Picture 1 into the requested wide scene/i);
  assert.match(graph['9'].inputs.prompt, /Picture 1 is the exact identity reference for Jenna Stannis/);
  assert.equal(graph['14'].inputs.filename_prefix, 'mullet/scene');

  assert.equal(duoGraph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(duoGraph['16'].inputs.image, 'mullet/identity/cally-v2.jpg');
  assert.deepEqual(duoGraph['9'].inputs.image1, ['15', 0]);
  assert.deepEqual(duoGraph['9'].inputs.image2, ['16', 0]);
  assert.equal(Object.hasOwn(duoGraph['9'].inputs, 'image3'), false);
  assert.equal(duoGraph['17'], undefined);
  assert.match(duoGraph['9'].inputs.prompt, /Picture 1 is the exact identity reference for Jenna Stannis/);
  assert.match(duoGraph['9'].inputs.prompt, /Picture 2 is the exact identity reference for Cally/);

  assert.equal(trioGraph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(trioGraph['16'].inputs.image, 'mullet/identity/cally-v2.jpg');
  assert.equal(trioGraph['17'].inputs.image, 'mullet/identity/servalan-v1.png');
  assert.deepEqual(trioGraph['9'].inputs.image1, ['15', 0]);
  assert.deepEqual(trioGraph['9'].inputs.image2, ['16', 0]);
  assert.deepEqual(trioGraph['9'].inputs.image3, ['17', 0]);
  assert.deepEqual(trioGraph['10'].inputs.image3, ['17', 0]);
  assert.match(trioGraph['9'].inputs.prompt, /Picture 3 is the exact identity reference for Servalan/);
});

test('builds a landscape Z-Image graph with the selected identity LoRA and exact trigger', () => {
  const request = buildInlineSceneImageRequest(result(), {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: cast('jenna-stannis'),
    lora: subjectLora,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
  const graph = buildZImageTurboSceneWorkflow(request, 43);
  assert.equal(graph['1'].inputs.unet_name, Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.type, 'lumina2');
  assert.deepEqual(graph['7'].inputs, { width: 864, height: 576, batch_size: 1 });
  assert.equal(graph['11'].inputs.lora_name, subjectLora.path);
  assert.deepEqual(graph['11'].inputs.model, ['1', 0]);
  assert.deepEqual(graph['11'].inputs.clip, ['2', 0]);
  assert.deepEqual(graph['6'].inputs.model, ['11', 0]);
  assert.deepEqual(graph['4'].inputs.clip, ['11', 1]);
  assert.match(graph['4'].inputs.text, /jennastannis represents Sally Knyvette portraying Jenna Stannis/);
  assert.match(graph['4'].inputs.text, new RegExp(visualPrompt.slice(0, 40)));
  assert.equal(graph['8'].inputs.steps, Z_IMAGE_TURBO_SCENE_TEMPLATE.steps);
  assert.equal(graph['8'].inputs.sampler_name, Z_IMAGE_TURBO_SCENE_TEMPLATE.sampler);
  assert.equal(graph['10'].inputs.filename_prefix, 'mullet/scene');
  assert.equal(Object.values(graph).some((node) => node.class_type === 'LoadImage'), false);
});
