import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
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
  INLINE_SCENE_VIDEO_TEMPLATES,
  MINIMAX_H3_SCENE_LOOP_TEMPLATE,
  buildInlineSceneVideoRequest,
  inlineSceneVideoSourceRequestSha256
} from '../src/lib/inline-scene-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';
import { buildPngFixture } from './png-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-inline-scene-video-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const staticPromptId = '22222222-2222-4222-8222-222222222222';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
const staticPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const mp4Bytes = buildH264AacMp4Fixture();
const previewMp4Bytes = buildH264AacMp4Fixture({ width: 960, height: 544 });
const loopMp4Bytes = buildH264AacMp4Fixture({ width: 1344, height: 768, frames: 121, includeAudio: false });
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
const identityReferenceSha256 = sha256(identityReferenceBytes);
const bodyReferenceBytes = buildPngFixture(576, 1024);
const bodyReferenceSha256 = sha256(bodyReferenceBytes);
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
      name: `body-jenna-stannis-1234abcd-${bodyReferenceSha256}.png`,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: bodyReferenceSha256,
      width: 576,
      height: 1024,
      aspectRatio: '9:16'
    }
  }]
});
const priorMasterBytes = new Uint8Array([...png(1328, 752), 1]);
const priorMaster = Object.freeze({
  requestKey: `sha256:${'8'.repeat(64)}`,
  promptId: '44444444-4444-4444-8444-444444444444',
  seed: 41,
  generatedAt: 16,
  width: 1328,
  height: 752,
  imageSha256: sha256(priorMasterBytes),
  cast: [{ profileId: sceneCandidate.id, profileFingerprint: sceneCandidate.profileFingerprint }]
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function motionRequest(imageSha256, modelTemplate, continuityMaster) {
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
    prompt: staticPrompt,
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
    promptId: staticPromptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 17,
    imageSha256
  };
  return modelTemplate ? buildInlineSceneVideoRequest(scene, modelTemplate) : buildInlineSceneVideoRequest(scene);
}


function responseJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.byteLength)
  });
  response.end(body);
}

async function requestBytes(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function webHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function fakeComfy() {
  const state = { mode: 'happy', calls: [], uploads: [], prompts: [], selectedModel: 'loop' };
  const reset = (mode = 'happy') => {
    state.mode = mode;
    state.calls = [];
    state.uploads = [];
    state.prompts = [];
    state.selectedModel = 'loop';
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://fake-comfy');
      state.calls.push({ method: request.method, path: `${url.pathname}${url.search}` });
      if (url.pathname.startsWith('/object_info/')) {
        const nodeName = decodeURIComponent(url.pathname.slice('/object_info/'.length));
        responseJson(response, 200, capabilityResponse(nodeName));
        return;
      }
      if (url.pathname === '/upload/image' && request.method === 'POST') {
        const multipart = new Request(url, {
          method: 'POST',
          headers: webHeaders(request),
          body: request,
          duplex: 'half'
        });
        const form = await multipart.formData();
        const image = form.get('image');
        assert.ok(image instanceof Blob);
        const upload = {
          name: image.name,
          bytes: new Uint8Array(await image.arrayBuffer()),
          subfolder: form.get('subfolder'),
          type: form.get('type'),
          overwrite: form.get('overwrite')
        };
        state.uploads.push(upload);
        responseJson(response, 200, {
          name: upload.name,
          subfolder: upload.subfolder,
          type: upload.type
        });
        return;
      }
      if (url.pathname === '/prompt' && request.method === 'POST') {
        const queued = JSON.parse((await requestBytes(request)).toString('utf8'));
        state.prompts.push(queued);
        state.selectedModel = queued.prompt['30'] ? 'preview' : 'loop';
        responseJson(response, 200, { prompt_id: comfyPromptId, node_errors: {} });
        return;
      }
      if (url.pathname === `/history/${comfyPromptId}`) {
        if (state.mode === 'history-error') {
          responseJson(response, 200, {
            [comfyPromptId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
          });
          return;
        }
        const isLoop = state.selectedModel === 'loop';
        responseJson(response, 200, {
          [comfyPromptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              [isLoop ? '15' : '29']: {
                ['videos']: [{
                  filename: isLoop ? 'scene-motion-loop_00001_.mp4' : 'scene-motion_00001_.mp4',
                  subfolder: 'mullet',
                  type: 'output'
                }],
                animated: [true]
              }
            }
          }
        });
        return;
      }
      if (url.pathname === '/view') {
        if (url.searchParams.get('subfolder') === 'mullet/identity') {
          if (state.mode === 'identity-404') {
            responseJson(response, 404, { error: 'missing identity' });
            return;
          }
          const isBodyReference = url.searchParams.get('filename') === soloCast.identities[0].bodyReferenceImage.name;
          const uploaded = state.uploads.find((entry) => (
            entry.name === soloCast.identities[0].bodyReferenceImage.name && entry.subfolder === 'mullet/identity'
          ));
          if (state.mode === 'managed-body-missing' && isBodyReference && !uploaded) {
            responseJson(response, 404, { error: 'missing managed body reference' });
            return;
          }
          const expectedBytes = isBodyReference
            ? bodyReferenceBytes
            : identityReferenceBytes;
          const bytes = uploaded && isBodyReference
            ? uploaded.bytes
            : state.mode === 'identity-hash'
            ? new Uint8Array([...identityReferenceBytes, 0])
            : state.mode === 'body-hash' && url.searchParams.get('filename') === soloCast.identities[0].bodyReferenceImage.name
              ? new Uint8Array([...bodyReferenceBytes, 0])
            : state.mode === 'identity-dimensions'
              ? png(416, 600)
              : expectedBytes;
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(bytes.byteLength)
          });
          response.end(bytes);
          return;
        }
        const isLoop = state.selectedModel === 'loop';
        const bytes = isLoop ? loopMp4Bytes : previewMp4Bytes;
        const contentType = 'video/mp4';
        if (state.mode === 'oversized') {
          response.writeHead(200, {
            'content-type': contentType,
            'content-length': String(64 * 1024 * 1024 + 1)
          });
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': contentType,
          'content-length': String(bytes.byteLength)
        });
        response.end(bytes);
        return;
      }
      if (url.pathname === `/api/jobs/${comfyPromptId}/cancel` && request.method === 'POST') {
        responseJson(response, 200, { cancelled: true });
        return;
      }
      responseJson(response, 404, { error: 'unexpected fake-Comfy request' });
    } catch (cause) {
      responseJson(response, 500, { error: cause instanceof Error ? cause.message : 'fake-Comfy failure' });
    }
  });
  return { reset, server, state };
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolveClose, reject) => {
    server.close((cause) => cause ? reject(cause) : resolveClose());
  });
  server.closeAllConnections();
  await closed;
}

function formFor(request, imageBytes, includeExtra = false, masterBytes = null, references = []) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('image', new Blob([imageBytes], { type: 'image/png' }), 'scene.png');
  if (masterBytes) form.append('master', new Blob([masterBytes], { type: 'image/png' }), 'master.png');
  references.forEach((reference, index) => form.append('reference', reference, `reference-${index}.png`));
  if (includeExtra) form.append('extra', 'forbidden');
  return form;
}

