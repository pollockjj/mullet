import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey
} from '../src/lib/inline-scene.ts';
import {
  MINIMAX_H3_SCENE_LOOP_TEMPLATE,
  buildInlineSceneVideoRequest
} from '../src/lib/inline-scene-video.ts';
import {
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes,
  uploadInlineSceneVideoInput,
  uploadInlineSceneVideoPriorMasterInput,
  validateInlineSceneVideoPriorMasterBytes,
  validateInlineSceneVideoPng
} from '../src/lib/server/comfy-inline-scene-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const promptId = '22222222-2222-4222-8222-222222222222';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
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
const identityReferenceBytes = png(400, 600);
const identityReferenceSha256 = createHash('sha256').update(identityReferenceBytes).digest('hex');
const bodyReferenceBytes = png(512, 768);
const bodyReferenceSha256 = createHash('sha256').update(bodyReferenceBytes).digest('hex');
const soloCast = Object.freeze({
  kind: 'solo',
  identities: [{
    profileId: sceneCandidate.id,
    profileFingerprint: sceneCandidate.profileFingerprint,
    displayName: sceneCandidate.displayName,
    subject: 'Jenna Stannis',
    referenceImage: {
      name: 'jenna-stannis-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: identityReferenceSha256,
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: {
      name: 'jenna-stannis-body-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: bodyReferenceSha256,
      width: 512,
      height: 768,
      aspectRatio: '2:3'
    }
  }]
});
const priorMasterBytes = png(1328, 752);
const priorMaster = Object.freeze({
  requestKey: `sha256:${'8'.repeat(64)}`,
  promptId: '44444444-4444-4444-8444-444444444444',
  seed: 41,
  generatedAt: 123456788,
  width: 1328,
  height: 752,
  imageSha256: createHash('sha256').update(priorMasterBytes).digest('hex'),
  cast: [{ profileId: sceneCandidate.id, profileFingerprint: sceneCandidate.profileFingerprint }]
});

function request(modelTemplate, continuityMaster) {
  const messages = [
    { role: 'user', content: 'What is happening on the flight deck?' },
    { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
  ];
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    [sceneCandidate]
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: [sceneCandidate.id]
  });
  const sceneRequest = buildInlineSceneImageRequest(result, {
    modelTemplate: continuityMaster ? INLINE_SCENE_QWEN_TEMPLATE_ID : INLINE_SCENE_TEMPLATE_ID,
    cast: soloCast,
    ...(continuityMaster ? { continuityMaster } : {}),
    lora: continuityMaster ? null : sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
  const dimensions = inlineSceneDimensions('16:9', 1);
  const scene = {
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
  };
  return modelTemplate ? buildInlineSceneVideoRequest(scene, modelTemplate) : buildInlineSceneVideoRequest(scene);
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

test('uploads only a byte-verified prior master under a unique motion-input name', async () => {
  await validateInlineSceneVideoPriorMasterBytes(priorMasterBytes, priorMaster);
  let calls = 0;
  let upload;
  const input = await uploadInlineSceneVideoPriorMasterInput(async (_url, init) => {
    calls += 1;
    upload = init.body;
    const image = upload.get('image');
    return Response.json({ name: image.name, subfolder: upload.get('subfolder'), type: upload.get('type') });
  }, 'http://comfy', priorMasterBytes, priorMaster);
  assert.equal(calls, 1);
  assert.match(input.name, /^scene-motion-prior-[0-9a-f-]+\.png$/i);
  assert.equal(input.imageSha256, priorMaster.imageSha256);
  assert.equal(input.width, priorMaster.width);
  assert.equal(input.height, priorMaster.height);
  assert.equal(upload.get('subfolder'), 'mullet/motion-inputs');
  assert.equal(upload.get('overwrite'), 'false');
  calls = 0;
  await assert.rejects(
    uploadInlineSceneVideoPriorMasterInput(
      async () => { calls += 1; return Response.json({}); },
      'http://comfy',
      png(1312, 752),
      { ...priorMaster, imageSha256: await sha256InlineSceneVideoBytes(png(1312, 752)) }
    ),
    /dimensions/
  );
  assert.equal(calls, 0);
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
              '15': {
                videos: [{ filename: '../secret.mp4', subfolder: 'mullet', type: 'output' }],
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


