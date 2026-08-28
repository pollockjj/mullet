import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import { LTX25_PORTRAIT_VIDEO_TEMPLATE } from '../src/lib/portrait-video.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-video-route');
const publicOrigin = 'https://mullet.test';
const promptId = '33333333-3333-4333-8333-333333333333';
const webmBytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

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
  return {
    spec: 'mullet_portrait_video_request_v1',
    modelTemplate: 'ltx-2.5-i2v-distilled-v1',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      portraitRequestKey: 'route-test-portrait-request',
      portraitPromptId: '11111111-1111-4111-8111-111111111111',
      portraitGeneratedAt: 17,
      portraitWidth: 768,
      portraitHeight: 1152,
      portraitImageSha256: imageSha256,
      portraitSource: {
        conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
        messageCount: 4,
        messageIndex: 3,
        fingerprint: '12:1234abcd',
        expression: 'grief'
      }
    },
    aspectRatio: '2:3',
    durationSeconds: 2
  };
}

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function dynamicInfo(node, inputName, options) {
  return { [node]: { input: { required: { [inputName]: ['COMBO', { options }] } } } };
}

function capabilityResponse(node) {
  const files = LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [files.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[files.clip]],
    type: [['ltxv']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [files.videoVae, files.audioVae]);
  if (node === 'LatentUpscaleModelLoader') return dynamicInfo(node, 'model_name', [files.latentUpscaler]);
  if (node === 'KSamplerSelect') return dynamicInfo(node, 'sampler_name', ['euler_ancestral']);
  if (node === 'SaveWEBM') return dynamicInfo(node, 'codec', ['vp9']);
  if (node === 'LoadImage') return standardInfo(node, 'image', [], { image_upload: true });
  return { [node]: { input: { required: {} } } };
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
  const state = {
    mode: 'happy',
    calls: [],
    uploads: [],
    prompts: []
  };
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
        const node = decodeURIComponent(url.pathname.slice('/object_info/'.length));
        responseJson(response, 200, capabilityResponse(node));
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
        const queued = JSON.parse((await requestBytes(request)).toString('utf8'));
        state.prompts.push(queued);
        responseJson(response, 200, { prompt_id: promptId, node_errors: {} });
        return;
      }
      if (url.pathname === `/history/${promptId}`) {
        if (state.mode === 'history-error') {
          responseJson(response, 200, {
            [promptId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
          });
          return;
        }
        responseJson(response, 200, {
          [promptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              '31': {
                images: [{ filename: 'portrait-motion_00001_.webm', subfolder: 'mullet', type: 'output' }],
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
            'content-type': 'video/webm',
            'content-length': String(64 * 1024 * 1024 + 1)
          });
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': 'video/webm',
          'content-length': String(webmBytes.byteLength)
        });
        response.end(webmBytes);
        return;
      }
      if (url.pathname === `/api/jobs/${promptId}/cancel` && request.method === 'POST') {
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
  form.append('image', new Blob([imageBytes], { type: 'image/png' }), 'portrait.png');
  if (includeExtra) form.append('extra', 'forbidden');
  return form;
}

test('compiled portrait-video route enforces the fake-Comfy contract', { timeout: 120_000 }, async (context) => {
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
  process.env.COMFY_BASE_URL = comfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BODY_SIZE_LIMIT = '32M';
  process.env.BUILD_SHA = 'portrait-video-route-test';
  process.env.PUBLIC_BUILD_SHA = 'portrait-video-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);
  const routeUrl = `${appBaseUrl}/mullet/api/portrait/video`;
  const imageBytes = png(768, 1152);
  const imageSha256 = sha256(imageBytes);
  const request = motionRequest(imageSha256);
  const post = (body) => fetch(routeUrl, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body
  });

  await context.test('GET returns exact LTX 2.5 capabilities through the compiled route', async () => {
    fake.reset();
    const response = await fetch(routeUrl);
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const capabilities = JSON.parse(responseText);
    assert.equal(capabilities.spec, 'mullet_portrait_video_capabilities_v1');
    assert.equal(capabilities.template.id, 'ltx-2.5-i2v-distilled-v1');
    assert.deepEqual(capabilities.aspectRatios, [
      { aspectRatio: '2:3', width: 384, height: 576 },
      { aspectRatio: '3:4', width: 384, height: 512 },
      { aspectRatio: '4:5', width: 512, height: 640 },
      { aspectRatio: '9:16', width: 576, height: 1024 }
    ]);
    assert.deepEqual(capabilities.durations, [2]);
    const queriedNodes = fake.state.calls.map(({ path }) => decodeURIComponent(path.slice('/object_info/'.length)));
    assert.deepEqual(new Set(queriedNodes), new Set(LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes));
    assert.equal(queriedNodes.length, LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes.length);
  });

  await context.test('POST uploads exact portrait bytes and proxies the fixed WebM with provenance headers', async () => {
    fake.reset();
    const response = await post(formFor(request, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, webmBytes);
    assert.equal(response.headers.get('content-type'), 'video/webm');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-mullet-prompt-id'), promptId);
    assert.equal(response.headers.get('x-mullet-width'), '384');
    assert.equal(response.headers.get('x-mullet-height'), '576');
    assert.equal(response.headers.get('x-mullet-frames'), '49');
    assert.equal(response.headers.get('x-mullet-fps'), '24');
    assert.equal(response.headers.get('x-mullet-duration-seconds'), '2');
    assert.equal(response.headers.get('x-mullet-model-template'), 'ltx-2.5-i2v-distilled-v1');
    assert.equal(response.headers.get('x-mullet-input-sha256'), imageSha256);
    assert.equal(response.headers.get('x-mullet-video-sha256'), sha256(webmBytes));

    assert.equal(fake.state.uploads.length, 1);
    const upload = fake.state.uploads[0];
    assert.match(upload.name, /^portrait-motion-[0-9a-f-]{36}\.png$/i);
    assert.deepEqual(upload.bytes, imageBytes);
    assert.equal(upload.subfolder, 'mullet/motion-inputs');
    assert.equal(upload.type, 'input');
    assert.equal(upload.overwrite, 'false');

    assert.equal(fake.state.prompts.length, 1);
    const queued = fake.state.prompts[0];
    const seed = Number(response.headers.get('x-mullet-seed'));
    assert.equal(Number.isSafeInteger(seed), true);
    assert.equal(queued.client_id, 'mullet-portrait-video');
    assert.equal(queued.prompt['1'].inputs.image, `mullet/motion-inputs/${upload.name}`);
    assert.equal(queued.prompt['11'].inputs.width, 192);
    assert.equal(queued.prompt['11'].inputs.height, 288);
    assert.equal(queued.prompt['11'].inputs.length, 49);
    assert.equal(queued.prompt['16'].inputs.noise_seed, seed);
    assert.equal(queued.prompt['31'].inputs.codec, 'vp9');
    assert.equal(queued.prompt['31'].inputs.fps, 24);
  });

  await context.test('POST rejects mismatched hash, IHDR, and multipart shape before ComfyUI', async () => {
    fake.reset();
    const hashMismatch = motionRequest('b'.repeat(64));
    assert.equal((await post(formFor(hashMismatch, imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    const wrongDimensions = png(768, 1088);
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
    const cancellations = fake.state.calls.filter(({ method, path }) => method === 'POST' && path === `/api/jobs/${promptId}/cancel`);
    assert.equal(cancellations.length, 1);
    assert.equal(fake.state.calls.some(({ path }) => path === '/interrupt'), false);
  });

  await context.test('declared oversized WebM maps to 413 without allocating its body', async () => {
    fake.reset('oversized');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.some(({ path }) => path.startsWith('/view?')), true);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), false);
  });
});
