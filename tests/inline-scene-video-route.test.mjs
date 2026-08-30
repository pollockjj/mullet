import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
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
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
  buildInlineSceneVideoRequest,
  inlineSceneVideoSourceRequestSha256
} from '../src/lib/inline-scene-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-inline-scene-video-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const staticPromptId = '22222222-2222-4222-8222-222222222222';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
const staticPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const mp4Bytes = buildH264AacMp4Fixture();
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'c'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
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

function motionRequest(imageSha256) {
  const messages = [
    { role: 'user', content: 'What is happening on the flight deck?' },
    { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
  ];
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages)
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', staticPrompt);
  const sceneRequest = buildInlineSceneImageRequest(result, {
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio: '16:9',
    megapixels: 1
  });
  const dimensions = inlineSceneDimensions('16:9', 1);
  return buildInlineSceneVideoRequest({
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
  });
}

function capabilityResponse(nodeName) {
  const template = MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE;
  const required = {};
  const optional = {};
  if (nodeName === 'UNETLoader') required.unet_name = [[template.modelFiles.unet], {}];
  if (nodeName === 'CLIPLoader') {
    required.clip_name = [[template.modelFiles.clip], {}];
    required.type = [['minimax'], {}];
  }
  if (nodeName === 'VAELoader') {
    required.vae_name = [[template.modelFiles.videoVae, template.modelFiles.audioVae], {}];
  }
  if (nodeName === 'LoraLoaderModelOnly') required.lora_name = [[template.modelFiles.turboLora], {}];
  if (nodeName === 'KSamplerSelect') required.sampler_name = [[template.sampler], {}];
  if (nodeName === 'BasicScheduler') required.scheduler = [[template.scheduler], {}];
  if (nodeName === 'LoadImage') required.image = [['uploaded.png'], { image_upload: true }];
  if (nodeName === 'SaveVideo') {
    required.format = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }] }];
    optional.codec = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }] }];
  }
  return { [nodeName]: { input: { required, optional } } };
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
        state.prompts.push(JSON.parse((await requestBytes(request)).toString('utf8')));
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
        responseJson(response, 200, {
          [comfyPromptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              '15': {
                images: [{ filename: 'scene-motion_00001_.mp4', subfolder: 'mullet', type: 'output' }],
                animated: [true]
              }
            }
          }
        });
        return;
      }
      if (url.pathname === '/view') {
        if (state.mode === 'oversized') {
          response.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': String(64 * 1024 * 1024 + 1)
          });
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': String(mp4Bytes.byteLength)
        });
        response.end(mp4Bytes);
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

function formFor(request, imageBytes, includeExtra = false) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('image', new Blob([imageBytes], { type: 'image/png' }), 'scene.png');
  if (includeExtra) form.append('extra', 'forbidden');
  return form;
}

test('compiled inline-scene-video route enforces the MiniMax H3 contract', { timeout: 120_000 }, async (context) => {
  execFileSync(process.execPath, [resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BASE_PATH: '/mullet',
      BUILD_OUTPUT_DIR: buildDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const fake = fakeComfy();
  let appServer;
  context.after(async () => {
    await close(appServer);
    await close(fake.server);
  });
  const comfyBaseUrl = await listen(fake.server);
  process.env.IMAGE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.VIDEO_COMFY_BASE_URL = comfyBaseUrl;
  process.env.EXPRESSION_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BODY_SIZE_LIMIT = '32M';
  process.env.BUILD_SHA = 'inline-scene-video-route-test';
  process.env.PUBLIC_BUILD_SHA = 'inline-scene-video-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);
  const routeUrl = `${appBaseUrl}/mullet/api/scene/video`;
  const imageBytes = png(1328, 752);
  const imageSha256 = sha256(imageBytes);
  const request = motionRequest(imageSha256);
  const post = (body) => fetch(routeUrl, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body
  });

  await context.test('GET returns exact installed MiniMax H3 capabilities', async () => {
    fake.reset();
    const response = await fetch(routeUrl);
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const capabilities = JSON.parse(responseText);
    assert.equal(capabilities.spec, 'mullet_inline_scene_video_capabilities_v2');
    assert.equal(capabilities.template.id, 'minimax-h3-fl2va-i2v-turbo-v1');
    assert.deepEqual(capabilities.aspectRatios, [
      { aspectRatio: '3:2', width: 1152, height: 768 },
      { aspectRatio: '4:3', width: 1024, height: 768 },
      { aspectRatio: '5:4', width: 960, height: 768 },
      { aspectRatio: '16:9', width: 1344, height: 768 }
    ]);
    assert.deepEqual(capabilities.durations, [5]);
    const queriedNodes = fake.state.calls.map(({ path }) => decodeURIComponent(path.slice('/object_info/'.length)));
    assert.deepEqual(new Set(queriedNodes), new Set(MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.requiredNodes));
    assert.equal(queriedNodes.length, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.requiredNodes.length);
  });

  await context.test('POST uploads exact scene bytes and proxies H.264/AAC MP4 with provenance', async () => {
    fake.reset();
    const response = await post(formFor(request, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, mp4Bytes);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-mullet-prompt-id'), comfyPromptId);
    assert.equal(response.headers.get('x-mullet-width'), '1344');
    assert.equal(response.headers.get('x-mullet-height'), '768');
    assert.equal(response.headers.get('x-mullet-frames'), '124');
    assert.equal(response.headers.get('x-mullet-fps'), '24');
    assert.equal(request.durationSeconds, 5);
    assert.equal(response.headers.get('x-mullet-duration-seconds'), String(124 / 24));
    assert.equal(response.headers.get('x-mullet-model-template'), 'minimax-h3-fl2va-i2v-turbo-v1');
    assert.equal(response.headers.get('x-mullet-video-mode'), 'i2v');
    assert.equal(response.headers.get('x-mullet-source-prompt-id'), staticPromptId);
    assert.equal(response.headers.get('x-mullet-source-seed'), '42');
    assert.equal(response.headers.get('x-mullet-source-request-sha256'), inlineSceneVideoSourceRequestSha256(request));
    assert.equal(response.headers.get('x-mullet-input-sha256'), imageSha256);
    assert.equal(response.headers.get('x-mullet-video-sha256'), sha256(mp4Bytes));

    assert.equal(fake.state.uploads.length, 1);
    const upload = fake.state.uploads[0];
    assert.match(upload.name, /^scene-motion-[0-9a-f-]{36}\.png$/i);
    assert.deepEqual(upload.bytes, imageBytes);
    assert.equal(upload.subfolder, 'mullet/motion-inputs');
    assert.equal(upload.type, 'input');
    assert.equal(upload.overwrite, 'false');

    assert.equal(fake.state.prompts.length, 1);
    const queued = fake.state.prompts[0];
    const seed = Number(response.headers.get('x-mullet-seed'));
    assert.equal(Number.isSafeInteger(seed), true);
    assert.equal(queued.client_id, 'mullet-inline-scene-video');
    assert.equal(queued.prompt['1'].inputs.unet_name, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet);
    assert.equal(queued.prompt['5'].inputs.image, `mullet/motion-inputs/${upload.name}`);
    assert.equal(queued.prompt['6'].inputs.width, 1344);
    assert.equal(queued.prompt['6'].inputs.height, 768);
    assert.equal(queued.prompt['6'].inputs.length, 124);
    assert.equal(queued.prompt['10'].inputs.noise_seed, seed);
    assert.deepEqual(queued.prompt['14'].inputs.audio, ['13', 0]);
    assert.equal(queued.prompt['14'].inputs.fps, 24);
    assert.equal(queued.prompt['15'].inputs.format, 'auto');
    assert.equal(queued.prompt['15'].inputs.codec, 'auto');
  });

  await context.test('POST rejects hash, IHDR, and multipart mismatch before ComfyUI', async () => {
    fake.reset();
    assert.equal((await post(formFor(motionRequest('b'.repeat(64)), imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    const wrongDimensions = png(1328, 736);
    assert.equal((await post(formFor(motionRequest(sha256(wrongDimensions)), wrongDimensions))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    assert.equal((await post(formFor(request, imageBytes, true))).status, 400);
    assert.equal(fake.state.calls.length, 0);
  });

  await context.test('history failure maps to 502 and cancels only its prompt', async () => {
    fake.reset('history-error');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 502, await response.text());
    const cancellations = fake.state.calls.filter(({ method, path }) => (
      method === 'POST' && path === `/api/jobs/${comfyPromptId}/cancel`
    ));
    assert.equal(cancellations.length, 1);
    assert.equal(fake.state.calls.some(({ path }) => path === '/interrupt'), false);
  });

  await context.test('declared oversized MP4 maps to 413 without allocating its body', async () => {
    fake.reset('oversized');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.some(({ path }) => path.startsWith('/view?')), true);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), false);
  });
});
