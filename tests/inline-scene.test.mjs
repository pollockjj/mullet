import assert from 'node:assert/strict';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_SYSTEM_PROMPT,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  buildZImageTurboSceneWorkflow,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  inlineSceneResultMatchesRequest,
  normalizeInlineSceneImageRequest,
  parseInlineSceneResponse
} from '../src/lib/inline-scene.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const messages = Object.freeze([
  Object.freeze({ role: 'user', content: 'What is happening on the flight deck?' }),
  Object.freeze({ role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' })
]);
const visualPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';

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

test('shrinks an oversized context tail while retaining the exact finalized pair', () => {
  const transcript = [
    { role: 'assistant', content: 'Opening greeting.' },
    { role: 'user', content: 'x'.repeat(61_000) },
    { role: 'assistant', content: 'An earlier answer.' },
    ...messages
  ];
  const source = livingHistorySourceForMessages(conversationId, transcript);
  const request = buildInlineSceneRequest(conversationId, transcript, source);
  assert.deepEqual(request.turns, messages);
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
  const request = buildInlineSceneImageRequest(sceneResult, { lora: null, aspectRatio: '16:9', megapixels: 1 });
  assert.match(request.source.promptSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(request.source.messageIndex, 1);
  assert.equal(JSON.stringify(request).includes(messages[0].content), false);
  assert.throws(() => normalizeInlineSceneImageRequest({ ...request, prompt: `${request.prompt} changed` }), /prompt hash/);
  assert.notEqual(inlineSceneImageRequestKey(request), inlineSceneImageRequestKey({ ...request, megapixels: 0.9 }));
});

test('independently snaps all landscape dimensions to the model multiple', () => {
  assert.deepEqual(inlineSceneDimensions('3:2', 0.5), { width: 864, height: 576, pixels: 497664 });
  assert.deepEqual(inlineSceneDimensions('4:3', 1), { width: 1152, height: 864, pixels: 995328 });
  assert.deepEqual(inlineSceneDimensions('5:4', 2), { width: 1584, height: 1264, pixels: 2002176 });
  assert.deepEqual(inlineSceneDimensions('16:9', 1), { width: 1328, height: 752, pixels: 998656 });
  for (const ratio of ['3:2', '4:3', '5:4', '16:9']) {
    for (const megapixels of [0.5, 0.75, 0.9, 1, 1.5, 2]) {
      const dimensions = inlineSceneDimensions(ratio, megapixels);
      assert.equal(dimensions.width % Z_IMAGE_TURBO_SCENE_TEMPLATE.multiple, 0);
      assert.equal(dimensions.height % Z_IMAGE_TURBO_SCENE_TEMPLATE.multiple, 0);
      assert.ok(dimensions.width <= 2048 && dimensions.height <= 2048);
    }
  }
});

test('builds the second Z-Image graph with landscape prompt, namespace, and optional LoRA trigger', () => {
  const plainRequest = buildInlineSceneImageRequest(result(), { lora: null, aspectRatio: '3:2', megapixels: 0.5 });
  const plain = buildZImageTurboSceneWorkflow(plainRequest, 42);
  assert.deepEqual(plain['7'].inputs, { width: 864, height: 576, batch_size: 1 });
  assert.equal(plain['10'].inputs.filename_prefix, 'mullet/scene');
  assert.match(plain['4'].inputs.text, /environment visible/);
  assert.equal(plain['11'], undefined);

  const loraA = { path: 'zimage/kristi6.safetensors', trigger: 'kristibentler', modelHash: 'a'.repeat(64) };
  const loraRequest = buildInlineSceneImageRequest(result(), { lora: loraA, aspectRatio: '3:2', megapixels: 0.5 });
  const capabilities = {
    spec: 'mullet_inline_scene_capabilities_v1',
    template: Z_IMAGE_TURBO_SCENE_TEMPLATE,
    aspectRatios: [],
    megapixels: [],
    loras: [loraA]
  };
  const withLora = buildZImageTurboSceneWorkflow(loraRequest, 43, capabilities);
  assert.equal(withLora['11'].inputs.lora_name, 'zimage/kristi6.safetensors');
  assert.match(withLora['4'].inputs.text, /^kristibentler,/);
  const changedTrigger = buildInlineSceneImageRequest(result(), {
    lora: { ...loraA, trigger: 'replacement-trigger' },
    aspectRatio: '3:2',
    megapixels: 0.5
  });
  const changedHash = buildInlineSceneImageRequest(result(), {
    lora: { ...loraA, modelHash: 'b'.repeat(64) },
    aspectRatio: '3:2',
    megapixels: 0.5
  });
  assert.notEqual(inlineSceneImageRequestKey(loraRequest), inlineSceneImageRequestKey(changedTrigger));
  assert.notEqual(inlineSceneImageRequestKey(loraRequest), inlineSceneImageRequestKey(changedHash));
});
