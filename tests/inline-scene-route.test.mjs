import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE,
  MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID,
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

function sceneRequest(
  continuityMaster,
  modelTemplate = INLINE_SCENE_QWEN_TEMPLATE_ID,
  selectedCast = cast,
  lora = null
) {
  const messages = [
    { role: 'user', content: 'What happens on the flight deck?' },
    { role: 'assistant', content: 'Jenna braces against the console as the Liberator pitches under fire.' }
  ];
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages),
    [candidate]
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt: visualPrompt,
    subjectIds: [candidate.id]
  });
  return buildInlineSceneImageRequest(result, {
    modelTemplate,
    cast: selectedCast,
    ...(continuityMaster ? { continuityMaster } : {}),
    lora,
    aspectRatio: modelTemplate === MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID ? '16:9' : '3:2',
    megapixels: 0.5
  });
}

function node(name, required = {}, optional = {}) {
  return { [name]: { input: { required, optional } } };
}

function capabilityResponse(name) {
  const qwen = QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles;
  const zImage = Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles;
  const h3 = MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE;
  if (name === 'UNETLoader') return node(name, { unet_name: [[zImage.unet, qwen.unet, h3.modelFiles.unet]] });
  if (name === 'CLIPLoader') return node(name, {
    clip_name: [[zImage.clip, qwen.clip, h3.modelFiles.clip]],
    type: [['lumina2', 'qwen_image', 'minimax']]
  });
  if (name === 'VAELoader') return node(name, {
    vae_name: [[zImage.vae, qwen.vae, h3.modelFiles.videoVae, h3.modelFiles.audioVae]]
  });
  if (name === 'LoraLoader') return node(name, { lora_name: [['zimage/unused.safetensors']] });
  if (name === 'LoraLoaderModelOnly') return node(name, { lora_name: [[qwen.lora]] });
  if (name === 'KSampler') return node(name, {
    sampler_name: [[Z_IMAGE_TURBO_SCENE_TEMPLATE.sampler, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.sampler]],
    scheduler: [['simple']]
  });
  if (name === 'TextEncodeQwenImageEditPlus') return node(name, {}, {
    image1: ['IMAGE'],
    image2: ['IMAGE'],
    image3: ['IMAGE']
  });
  if (name === 'KSamplerSelect') return node(name, { sampler_name: [[h3.sampler]] });
  if (name === 'BasicScheduler') return node(name, { scheduler: [[h3.scheduler]] });
  if (name === 'MiniMaxH3SigmaShift') {
    const result = node(name, {
      model: ['MODEL'],
      shift_video: ['FLOAT', { min: 1, max: 100 }],
      shift_audio: ['FLOAT', { min: 1, max: 100 }]
    });
    result[name].output = ['MODEL'];
    return result;
  }
  if (name === 'ImageFromBatch') {
    const result = node(name, {
      image: ['IMAGE'],
      batch_index: ['INT', { min: -8192, max: 8192 }],
      length: ['INT', { min: 1, max: 4096 }]
    });
    result[name].output = ['IMAGE'];
    return result;
  }
  if (name === 'MiniMaxH3ReferenceToVideo') {
    const result = node(name, {
      length: ['INT', { min: 5, max: 3600, step: 17 }],
      ref_image_size: [[h3.referenceImageSize, 'max']]
    }, {
      ref_images: ['COMFY_AUTOGROW_V3', {
        template: {
          input: { required: { ref_image: ['IMAGE'] } },
          prefix: 'ref_image_',
          min: 0,
          max: h3.maxReferenceImages
        }
      }]
    });
    result[name].output = ['CONDITIONING', 'LATENT'];
    return result;
  }
  return node(name);
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

test('compiled inline-scene route binds exact optional continuity-master bytes before queueing', { timeout: 120_000 }, async (context) => {
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
  process.env.IMAGE_COMFY_BASE_URL = comfyBaseUrl;
  process.env.VIDEO_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.EXPRESSION_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BODY_SIZE_LIMIT = '32M';
  process.env.BUILD_SHA = 'inline-scene-route-test';
  process.env.PUBLIC_BUILD_SHA = 'inline-scene-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);
  const routeUrl = `${appBaseUrl}/mullet/api/scene`;
  const post = (body, headers = { origin: publicOrigin }) => fetch(routeUrl, { method: 'POST', headers, body });
  const first = sceneRequest();
  const h3First = sceneRequest(undefined, MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID);
  const masterBytes = png();
  const continuityMaster = createInlineSceneContinuityMaster(first, {
    promptId: '44444444-4444-4444-8444-444444444444',
    seed: 42,
    generatedAt: 1_700_000_000_000,
    imageSha256: sha256(masterBytes)
  });
  const continued = sceneRequest(continuityMaster);

  await context.test('a first scene sends only request and identity references', async () => {
    fake.reset();
    const response = await post(formFor(first));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, fake.outputBytes);
    assert.equal(fake.state.uploads.length, 0);
    assert.equal(fake.state.prompts.length, 1);
    assert.equal(fake.state.prompts[0].prompt['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  });

  await context.test('the H3 keeper route returns frame zero from its native five-frame packet', async () => {
    fake.reset();
    const response = await post(formFor(h3First));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, fake.h3OutputBytes);
    assert.equal(response.headers.get('x-mullet-model-template'), MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID);
    assert.equal(response.headers.get('x-mullet-width'), '960');
    assert.equal(response.headers.get('x-mullet-height'), '544');
    assert.equal(fake.state.uploads.length, 0);
    assert.equal(fake.state.prompts.length, 1);
    const graph = fake.state.prompts[0].prompt;
    assert.equal(graph['20'].class_type, 'MiniMaxH3ReferenceToVideo');
    assert.deepEqual(graph['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
    assert.equal(graph['20'].inputs.length, 5);
    assert.equal(graph['20'].inputs.ref_image_size, 'match');
    assert.deepEqual(graph['19'].inputs, { model: ['1', 0], shift_video: 12, shift_audio: 3 });
    assert.deepEqual(graph['21'].inputs.conditioning, ['20', 0]);
    assert.deepEqual(graph['23'].inputs, { model: ['19', 0], scheduler: 'simple', steps: 20, denoise: 1 });
    assert.deepEqual(graph['25'].inputs.latent_image, ['20', 1]);
    assert.deepEqual(graph['27'].inputs, { image: ['26', 0], batch_index: 0, length: 1 });
    assert.equal(graph['28'].class_type, 'SaveImage');
  });

  await context.test('Qwen and H3 still upload and reverify only their planner-selected managed body reference', async () => {
    for (const modelTemplate of [INLINE_SCENE_QWEN_TEMPLATE_ID, MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID]) {
      fake.reset('managed-body-missing');
      const request = sceneRequest(undefined, modelTemplate, castWithBody);
      const response = await post(formFor(request, null, (form) => {
        form.append('reference', new Blob([bodyReferenceBytes], { type: 'image/png' }), 'untrusted-client-name.png');
      }));
      assert.equal(response.status, 200, await response.text());
      const bodyUploads = fake.state.uploads.filter(({ subfolder }) => subfolder === 'mullet/identity');
      assert.equal(bodyUploads.length, 1);
      assert.equal(bodyUploads[0].name, bodyReference.name);
      assert.deepEqual(bodyUploads[0].bytes, bodyReferenceBytes);
      assert.equal(bodyUploads[0].type, 'input');
      assert.equal(bodyUploads[0].overwrite, 'false');
      const promptIndex = fake.state.calls.findIndex(({ path }) => path === '/prompt');
      const uploadIndex = fake.state.calls.findIndex(({ path }) => path === '/upload/image');
      const bodyViews = fake.state.calls.filter(({ path }) => path === '/view');
      assert.ok(uploadIndex >= 0 && uploadIndex < promptIndex);
      assert.ok(bodyViews.length >= 2);
      assert.ok(JSON.stringify(fake.state.prompts[0].prompt).includes(bodyReference.name));
    }
  });

  await context.test('managed reference multipart rejects Z-image, unplanned, duplicate, malformed, over-count, and oversized inputs before ComfyUI', async () => {
    const qwenBodyRequest = sceneRequest(undefined, INLINE_SCENE_QWEN_TEMPLATE_ID, castWithBody);
    const zImageRequest = sceneRequest(undefined, INLINE_SCENE_TEMPLATE_ID, castWithBody, sceneLora);
    const otherPng = managedPng(576, 1024, 1);
    const referencePart = () => new Blob([bodyReferenceBytes], { type: 'image/png' });
    const rejected = [
      formFor(zImageRequest, null, (form) => form.append('reference', referencePart(), 'body.png')),
      formFor(qwenBodyRequest, null, (form) => form.append('reference', new Blob([otherPng], { type: 'image/png' }), 'other.png')),
      formFor(qwenBodyRequest, null, (form) => {
        form.append('reference', referencePart(), 'body-1.png');
        form.append('reference', referencePart(), 'body-2.png');
      }),
      formFor(qwenBodyRequest, null, (form) => form.append('reference', new Blob([bodyReferenceBytes], { type: 'text/plain' }), 'body.txt')),
      formFor(qwenBodyRequest, null, (form) => {
        for (let index = 0; index < 4; index += 1) form.append('reference', referencePart(), `body-${index}.png`);
      })
    ];
    for (const body of rejected) {
      fake.reset();
      const response = await post(body);
      assert.equal(response.status, 400, await response.text());
      assert.equal(fake.state.calls.length, 0);
    }

    fake.reset();
    const oversized = formFor(qwenBodyRequest, null, (form) => {
      const large = new Blob([bodyReferenceBytes, new Uint8Array(11 * 1024 * 1024)], { type: 'image/png' });
      form.append('reference', large, 'large-1.png');
      form.append('reference', large, 'large-2.png');
    });
    const oversizedResponse = await post(oversized);
    assert.equal(oversizedResponse.status, 413, await oversizedResponse.text());
    assert.equal(fake.state.calls.length, 0);
  });

  await context.test('a continued scene uploads and binds the exact verified master', async () => {
    fake.reset();
    const response = await post(formFor(continued, masterBytes));
    assert.equal(response.status, 200, await response.text());
    assert.equal(fake.state.uploads.length, 1);
    assert.deepEqual(fake.state.uploads[0].bytes, masterBytes);
    assert.equal(fake.state.uploads[0].subfolder, 'mullet/motion-inputs');
    assert.equal(fake.state.uploads[0].type, 'input');
    assert.equal(fake.state.uploads[0].overwrite, 'false');
    const uploadedName = fake.state.uploads[0].name;
    assert.match(uploadedName, /^scene-continuity-[0-9a-f-]{36}\.png$/i);
    assert.equal(fake.state.prompts[0].prompt['4'].inputs.image, `mullet/motion-inputs/${uploadedName}`);
    assert.equal(fake.state.prompts[0].prompt['16'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  });

  await context.test('missing, extra, duplicate, tampered, and wrong-size masters never reach ComfyUI', async () => {
    const rejected = [
      formFor(continued),
      formFor(first, masterBytes),
      formFor(continued, masterBytes, (form) => form.append('master', new Blob([masterBytes], { type: 'image/png' }), 'duplicate.png')),
      formFor(continued, masterBytes, (form) => form.append('extra', 'forbidden')),
      formFor(continued, (() => { const bytes = masterBytes.slice(); bytes[8] = 1; return bytes; })()),
      formFor(continued, png(848, 576))
    ];
    for (const body of rejected) {
      fake.reset();
      const response = await post(body);
      assert.equal(response.status, 400, await response.text());
      assert.equal(fake.state.calls.length, 0);
    }
  });

  await context.test('legacy JSON is rejected before ComfyUI', async () => {
    fake.reset();
    const response = await post(JSON.stringify(first), {
      origin: publicOrigin,
      'content-type': 'application/json'
    });
    assert.equal(response.status, 400, await response.text());
    assert.equal(fake.state.calls.length, 0);
  });
});
