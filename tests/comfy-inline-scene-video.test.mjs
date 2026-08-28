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
import { buildInlineSceneVideoRequest } from '../src/lib/inline-scene-video.ts';
import {
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes,
  uploadInlineSceneVideoInput,
  validateInlineSceneVideoPng
} from '../src/lib/server/comfy-inline-scene-video.ts';
import { buildVp9WebmFixture } from './webm-fixture.mjs';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const promptId = '22222222-2222-4222-8222-222222222222';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';

function request() {
  const messages = [
    { role: 'user', content: 'What is happening on the flight deck?' },
    { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
  ];
  const sidecar = buildInlineSceneRequest(conversationId, messages, livingHistorySourceForMessages(conversationId, messages));
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', prompt);
  const sceneRequest = buildInlineSceneImageRequest(result, { lora: null, aspectRatio: '16:9', megapixels: 1 });
  const dimensions = inlineSceneDimensions('16:9', 1);
  return buildInlineSceneVideoRequest({
    conversationId,
    epoch: '11111111-1111-4111-8111-111111111111',
    requestKey: inlineSceneImageRequestKey(sceneRequest),
    request: sceneRequest,
    promptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 123456789,
    imageSha256: 'a'.repeat(64)
  });
}

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

test('uploads only digest-matched static scene bytes to the isolated input namespace', async () => {
  const bytes = png(1328, 752);
  const digest = await sha256InlineSceneVideoBytes(bytes);
  let upload;
  const input = await uploadInlineSceneVideoInput(async (_url, init) => {
    upload = init.body;
    const image = upload.get('image');
    return Response.json({ name: image.name, subfolder: upload.get('subfolder'), type: upload.get('type') });
  }, 'http://comfy', bytes, digest);
  assert.match(input.name, /^scene-motion-[0-9a-f-]+\.png$/i);
  assert.equal(input.subfolder, 'mullet/motion-inputs');
  assert.equal(upload.get('overwrite'), 'false');
  await assert.rejects(
    uploadInlineSceneVideoInput(async () => Response.json({}), 'http://comfy', bytes, 'b'.repeat(64)),
    /does not match/
  );
});

test('accepts only PNG bytes with the exact static scene dimensions', () => {
  validateInlineSceneVideoPng(png(1328, 752), 1328, 752);
  assert.throws(() => validateInlineSceneVideoPng(png(1328, 752), 864, 576), /dimensions/);
  assert.throws(() => validateInlineSceneVideoPng(new Uint8Array(24), 1328, 752), /PNG header/);
});

test('queues and returns only the fixed animated scene-motion WebM', async () => {
  const videoRequest = request();
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const webm = buildVp9WebmFixture();
  let queued;
  const result = await runComfyInlineSceneVideo(async (inputUrl, init = {}) => {
    const url = String(inputUrl);
    if (url.endsWith('/prompt')) {
      queued = JSON.parse(init.body);
      return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
    }
    if (url.endsWith('/history/' + comfyPromptId)) {
      return Response.json({
        [comfyPromptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: {
            '31': {
              images: [{ filename: 'scene-motion_00001_.webm', subfolder: 'mullet', type: 'output' }],
              animated: [true]
            }
          }
        }
      });
    }
    if (url.includes('/view?')) return new Response(webm, { headers: { 'content-type': 'video/webm' } });
    throw new Error('unexpected URL ' + url);
  }, 'http://comfy', videoRequest, input, 42);
  assert.equal(queued.client_id, 'mullet-inline-scene-video');
  assert.equal(queued.prompt['31'].inputs.filename_prefix, 'mullet/scene-motion');
  assert.equal(result.contentType, 'video/webm');
  assert.equal(result.sha256, await sha256InlineSceneVideoBytes(webm));
});

test('rejects unsafe history and cancels only its own incomplete prompt', async () => {
  const videoRequest = request();
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const cancelled = [];
  await assert.rejects(
    runComfyInlineSceneVideo(async (inputUrl) => {
      const url = String(inputUrl);
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
      if (url.endsWith('/history/' + comfyPromptId)) {
        return Response.json({
          [comfyPromptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              '31': {
                images: [{ filename: '../secret.webm', subfolder: 'mullet', type: 'output' }],
                animated: [true]
              }
            }
          }
        });
      }
      if (url.endsWith('/api/jobs/' + comfyPromptId + '/cancel')) {
        cancelled.push(url);
        return new Response(null, { status: 204 });
      }
      throw new Error('unexpected URL ' + url);
    }, 'http://comfy', videoRequest, input, 42),
    /filename/
  );
  assert.deepEqual(cancelled, ['http://comfy/api/jobs/' + comfyPromptId + '/cancel']);
});
