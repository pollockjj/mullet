import assert from 'node:assert/strict';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  buildInlineSceneVideoPrompt,
  buildInlineSceneVideoRequest,
  buildLtx25InlineSceneVideoWorkflow,
  inlineSceneVideoDimensions,
  inlineSceneVideoRequestKey,
  normalizeInlineSceneVideoRequest
} from '../src/lib/inline-scene-video.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const promptId = '22222222-2222-4222-8222-222222222222';
const messages = [
  { role: 'user', content: 'What is happening on the flight deck?' },
  { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
];
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';

function staticScene(aspectRatio = '16:9', megapixels = 1) {
  const sidecarRequest = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages)
  );
  const result = createInlineSceneResult(sidecarRequest, 'gemma-4-ortenzya', prompt);
  const request = buildInlineSceneImageRequest(result, { lora: null, aspectRatio, megapixels });
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
          lora: { path: 'zimage/subject.safetensors', trigger: 'subject', modelHash: 'b'.repeat(64) }
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

test('uses the fixed live-tested landscape video envelope', () => {
  assert.deepEqual(INLINE_SCENE_VIDEO_DIMENSIONS, [
    { aspectRatio: '3:2', width: 576, height: 384 },
    { aspectRatio: '4:3', width: 512, height: 384 },
    { aspectRatio: '5:4', width: 640, height: 512 },
    { aspectRatio: '16:9', width: 1024, height: 576 }
  ]);
  for (const entry of INLINE_SCENE_VIDEO_DIMENSIONS) {
    const dimensions = inlineSceneVideoDimensions(entry.aspectRatio);
    assert.equal(dimensions.width, entry.width);
    assert.equal(dimensions.height, entry.height);
    assert.equal(dimensions.width % LTX25_INLINE_SCENE_VIDEO_TEMPLATE.multiple, 0);
    assert.equal(dimensions.height % LTX25_INLINE_SCENE_VIDEO_TEMPLATE.multiple, 0);
    assert.equal(dimensions.frames, 49);
    assert.equal(dimensions.fps, 24);
  }
});

test('builds a landscape I2V graph that preserves the static prompt and namespace', () => {
  const request = buildInlineSceneVideoRequest(staticScene('3:2', 0.5));
  const input = {
    name: 'scene-motion-33333333-3333-4333-8333-333333333333.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: request.source.sceneImageSha256
  };
  const graph = buildLtx25InlineSceneVideoWorkflow(request, input, 42);
  assert.deepEqual(graph['11'].inputs, { width: 288, height: 192, length: 49, batch_size: 1 });
  assert.equal(graph['31'].inputs.filename_prefix, 'mullet/scene-motion');
  assert.equal(graph['31'].inputs.fps, 24);
  assert.match(graph['8'].inputs.text, /damaged starship flight deck/);
  assert.match(graph['8'].inputs.text, /preserving every visible subject/);
  assert.match(buildInlineSceneVideoPrompt(request), /final pose returns close to the first pose/);
  assert.throws(
    () => buildLtx25InlineSceneVideoWorkflow(request, { ...input, imageSha256: 'b'.repeat(64) }, 42),
    /input reference/
  );
});
