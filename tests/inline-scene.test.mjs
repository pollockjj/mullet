import assert from 'node:assert/strict';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_IMAGE_REQUEST_SPEC,
  INLINE_SCENE_REQUEST_SPEC,
  INLINE_SCENE_RESULT_SPEC,
  INLINE_SCENE_SYSTEM_PROMPT,
  QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  buildQwenImageEditSceneWorkflow,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  inlineSceneSourceForCompletedTurn,
  inlineSceneSourceForScenarioOpening,
  inlineSceneSourceKey,
  inlineSceneSourceMatchesMessages,
  inlineSceneSourcesMatch,
  inlineSceneResultMatchesRequest,
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

function result() {
  const request = buildInlineSceneRequest(conversationId, messages, livingHistorySourceForMessages(conversationId, messages));
  return createInlineSceneResult(request, 'gemma-4-ortenzya', visualPrompt);
}

test('builds a finalized-response sidecar request without mutating the transcript', () => {
  const before = JSON.stringify(messages);
  const source = livingHistorySourceForMessages(conversationId, messages);
  const request = buildInlineSceneRequest(conversationId, messages, source);
  assert.equal(request.turns.length, 2);
  assert.equal(request.source.fingerprint, source.fingerprint);
  assert.equal(JSON.stringify(messages), before);
  assert.match(INLINE_SCENE_SYSTEM_PROMPT, /untrusted story data/);
  assert.throws(() => buildInlineSceneRequest(conversationId, [...messages, { role: 'assistant', content: 'partial' }], source), /latest finalized/);
});

test('represents a canonical assistant-only scenario opening without weakening completed-turn provenance', () => {
  const before = JSON.stringify(openingMessages);
  const source = inlineSceneSourceForScenarioOpening(conversationId, openingMessages, openingIdentity);
  const request = buildInlineSceneRequest(conversationId, openingMessages, source);
  assert.equal(INLINE_SCENE_REQUEST_SPEC, 'mullet_inline_scene_request_v2');
  assert.equal(INLINE_SCENE_RESULT_SPEC, 'mullet_inline_scene_result_v2');
  assert.equal(INLINE_SCENE_IMAGE_REQUEST_SPEC, 'mullet_inline_scene_image_request_v3');
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

  const openingResult = createInlineSceneResult(request, 'gemma-4-ortenzya', visualPrompt);
  assert.equal(inlineSceneResultMatchesRequest(openingResult, request), true);
  const openingImageRequest = buildInlineSceneImageRequest(openingResult, {
    referenceImage: canonicalReference,
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
      buildInlineSceneRequest(conversationId, openingMessages, otherSource),
      'gemma-4-ortenzya',
      visualPrompt
    ),
    { referenceImage: canonicalReference, lora: null, aspectRatio: '16:9', megapixels: 1 }
  );
  assert.notEqual(inlineSceneImageRequestKey(openingImageRequest), inlineSceneImageRequestKey(otherImageRequest));

  const completed = inlineSceneSourceForCompletedTurn(livingHistorySourceForMessages(conversationId, messages));
  assert.equal(completed.sourceKind, 'completed_turn');
  assert.equal(inlineSceneSourcesMatch(source, completed), false);
  assert.notEqual(inlineSceneSourceKey(source), inlineSceneSourceKey(completed));
  assert.throws(
    () => buildInlineSceneRequest(conversationId, [...openingMessages, { role: 'user', content: 'What now?' }], source),
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
  const request = buildInlineSceneRequest(conversationId, openingMessages, source);
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
  const source = livingHistorySourceForMessages(conversationId, transcript);
  const request = buildInlineSceneRequest(conversationId, transcript, source);
  assert.deepEqual(request.turns, [transcript[2], ...messages]);
  assert.equal(request.turns.some((turn) => turn.content.length > 60_000), false);
});

test('rejects forged source provenance unrelated to the supplied latest turn', () => {
  const request = buildInlineSceneRequest(conversationId, messages, livingHistorySourceForMessages(conversationId, messages));
  assert.throws(
    () => createInlineSceneResult({ ...request, source: { ...request.source, turnFingerprint: `sha256:${'b'.repeat(64)}` } }, 'gemma-4-ortenzya', visualPrompt),
    /turn fingerprint/
  );
});

test('accepts exactly one bounded JSON prompt and rejects prose or extra keys', () => {
  assert.equal(parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt })), visualPrompt);
  assert.equal(parseInlineSceneResponse(`<think>hidden</think>\n\`\`\`json\n${JSON.stringify({ prompt: visualPrompt })}\n\`\`\``), visualPrompt);
  assert.throws(() => parseInlineSceneResponse(visualPrompt), /one JSON object/);
  assert.throws(() => parseInlineSceneResponse(JSON.stringify({ prompt: visualPrompt, notes: 'extra' })), /exactly one prompt/);
  assert.throws(() => parseInlineSceneResponse(JSON.stringify({ prompt: 'too short' })), /40 and 160 words/);
});

test('binds the scene result and image request to exact transcript and prompt hashes', () => {
  const sceneResult = result();
  const sidecarRequest = buildInlineSceneRequest(conversationId, messages, livingHistorySourceForMessages(conversationId, messages));
  assert.equal(inlineSceneResultMatchesRequest(sceneResult, sidecarRequest), true);
  const request = buildInlineSceneImageRequest(sceneResult, {
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio: '16:9',
    megapixels: 1
  });
  assert.match(request.source.promptSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(request.source.messageIndex, 1);
  assert.deepEqual(request.referenceImage, canonicalReference);
  assert.equal(JSON.stringify(request).includes(messages[0].content), false);
  assert.throws(() => normalizeInlineSceneImageRequest({ ...request, prompt: `${request.prompt} changed` }), /prompt hash/);
  assert.throws(() => normalizeInlineSceneImageRequest({
    ...request,
    lora: { path: 'subject.safetensors', trigger: 'subject', modelHash: 'd'.repeat(64) }
  }), /does not accept a selectable LoRA/);
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({ ...request, megapixels: 0.9 }));
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({
    ...request,
    referenceImage: { ...canonicalReference, sha256: 'd'.repeat(64) }
  }));
});

test('independently snaps all landscape dimensions to the model multiple', () => {
  assert.deepEqual(inlineSceneDimensions('3:2', 0.5), { width: 864, height: 576, pixels: 497664 });
  assert.deepEqual(inlineSceneDimensions('4:3', 1), { width: 1152, height: 864, pixels: 995328 });
  assert.deepEqual(inlineSceneDimensions('5:4', 2), { width: 1584, height: 1264, pixels: 2002176 });
  assert.deepEqual(inlineSceneDimensions('16:9', 1), { width: 1328, height: 752, pixels: 998656 });
  for (const ratio of ['3:2', '4:3', '5:4', '16:9']) {
    for (const megapixels of [0.5, 0.75, 0.9, 1, 1.5, 2]) {
      const dimensions = inlineSceneDimensions(ratio, megapixels);
      assert.equal(dimensions.width % QWEN_IMAGE_EDIT_SCENE_TEMPLATE.multiple, 0);
      assert.equal(dimensions.height % QWEN_IMAGE_EDIT_SCENE_TEMPLATE.multiple, 0);
      assert.ok(dimensions.width <= 2048 && dimensions.height <= 2048);
    }
  }
});

test('builds the Qwen landscape outpaint graph with a fixed four-step LoRA and canonical reference', () => {
  const request = buildInlineSceneImageRequest(result(), {
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
  const capabilities = {
    spec: 'mullet_inline_scene_capabilities_v2',
    template: QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
    aspectRatios: [],
    megapixels: [],
    loras: []
  };
  const graph = buildQwenImageEditSceneWorkflow(request, 43, capabilities);
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
  assert.deepEqual(graph['11'].inputs.pixels, ['15', 0]);
  assert.match(graph['9'].inputs.prompt, /outpaint it into the requested wide scene/);
  assert.equal(graph['14'].inputs.filename_prefix, 'mullet/scene');
});
