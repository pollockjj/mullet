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
  QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneContinuityMaster,
  createInlineSceneResult
} from '../src/lib/inline-scene.ts';
import { buildPngFixture } from './png-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-inline-scene-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const promptId = '33333333-3333-4333-8333-333333333333';
const visualPrompt = 'A damaged starship flight deck tilts beneath Jenna as she braces against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Jenna in the foreground, the main display and streaking stars behind her, with hard directional light, visible smoke, exact period attire, and a tense cinematic composition.';
const referenceBytes = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x02, 0x58,
  0x01, 0x90,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
]);
const reference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(referenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const candidate = Object.freeze({
  id: 'jenna-stannis',
  displayName: 'Jenna Stannis',
  aliases: Object.freeze(['Jenna']),
  profileFingerprint: 'a'.repeat(8)
});
const cast = Object.freeze({
  kind: 'solo',
  identities: Object.freeze([Object.freeze({
    profileId: candidate.id,
    profileFingerprint: candidate.profileFingerprint,
    displayName: candidate.displayName,
    subject: 'Sally Knyvette portraying Jenna Stannis',
    referenceImage: reference
  })])
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function png(width = 864, height = 576) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

const managedPng = buildPngFixture;

const bodyReferenceBytes = managedPng(576, 1024);
const bodyReferenceSha256 = sha256(bodyReferenceBytes);
const bodyReference = Object.freeze({
  name: `body-jenna-stannis-${candidate.profileFingerprint}-${bodyReferenceSha256}.png`,
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: bodyReferenceSha256,
  width: 576,
  height: 1024,
  aspectRatio: '9:16'
});
const castWithBody = Object.freeze({
  kind: 'solo',
  identities: Object.freeze([Object.freeze({
    ...cast.identities[0],
    bodyReferenceImage: bodyReference
  })])
});
const sceneLora = Object.freeze({
  path: 'zimage/unused.safetensors',
  trigger: 'jennastannis',
  modelHash: 'c'.repeat(64)
});


function node(name, required = {}, optional = {}) {
  return { [name]: { input: { required, optional } } };
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
  const outputBytes = png();
  const h3OutputBytes = png(960, 544);
  const state = { mode: 'happy', calls: [], uploads: [], prompts: [] };
  const reset = (mode = 'happy') => {
    state.mode = mode;
    state.calls = [];
    state.uploads = [];
    state.prompts = [];
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://fake-comfy');
      state.calls.push({ method: request.method, path: url.pathname });
      if (url.pathname.startsWith('/object_info/')) {
        responseJson(response, 200, capabilityResponse(decodeURIComponent(url.pathname.slice('/object_info/'.length))));
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
        responseJson(response, 200, { name: upload.name, subfolder: upload.subfolder, type: upload.type });
        return;
      }
      if (url.pathname === '/prompt' && request.method === 'POST') {
        state.prompts.push(JSON.parse((await requestBytes(request)).toString('utf8')));
        responseJson(response, 200, { prompt_id: promptId, node_errors: {} });
        return;
      }
      if (url.pathname === `/history/${promptId}`) {
        const h3 = Boolean(state.prompts.at(-1)?.prompt?.['28']);
        responseJson(response, 200, {
          [promptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              [h3 ? '28' : '14']: {
                images: [{ filename: 'scene_00001_.png', subfolder: 'mullet', type: 'output' }]
              }
            }
          }
        });
        return;
      }
      if (url.pathname === '/view') {
        const filename = url.searchParams.get('filename');
        if (filename === reference.name) {
          response.writeHead(200, { 'content-type': 'image/jpeg' });
          response.end(referenceBytes);
          return;
        }
        if (filename === bodyReference.name && url.searchParams.get('subfolder') === bodyReference.subfolder) {
          const uploaded = state.uploads.find((entry) => (
            entry.name === bodyReference.name && entry.subfolder === bodyReference.subfolder
          ));
          if (state.mode === 'managed-body-missing' && !uploaded) {
            responseJson(response, 404, { error: 'missing managed body reference' });
            return;
          }
          const bytes = uploaded?.bytes ?? bodyReferenceBytes;
          response.writeHead(200, { 'content-type': 'image/png' });
          response.end(bytes);
          return;
        }
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(state.prompts.at(-1)?.prompt?.['28'] ? h3OutputBytes : outputBytes);
        return;
      }
      responseJson(response, 404, { error: `unexpected ${url.pathname}` });
    } catch (cause) {
      responseJson(response, 500, { error: cause instanceof Error ? cause.message : 'fake Comfy failure' });
    }
  });
  return { server, state, reset, outputBytes, h3OutputBytes };
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

function formFor(request, master, mutation) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  if (master) form.append('master', new Blob([master], { type: 'image/png' }), 'master.png');
  mutation?.(form);
  return form;
}

