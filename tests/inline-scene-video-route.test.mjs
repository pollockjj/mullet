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
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_TEMPLATES,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE,
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
const previewMp4Bytes = buildH264AacMp4Fixture({ width: 960, height: 544 });
const ltxMp4Bytes = buildH264AacMp4Fixture({ width: 1344, height: 768, frames: 121, includeAudio: false });
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
const bodyReferenceBytes = png(512, 768);
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
    livingHistorySourceForMessages(conversationId, messages),
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

function capabilityResponse(nodeName) {
  const ltx = LTX25_INLINE_SCENE_VIDEO_TEMPLATE;
  const minimax = MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE;
  const preview = MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE;
  const required = {};
  const optional = {};
  if (nodeName === 'UNETLoader') required.unet_name = [[ltx.modelFiles.unet, minimax.modelFiles.unet], {}];
  if (nodeName === 'CLIPLoader') {
    required.clip_name = [[ltx.modelFiles.clip, minimax.modelFiles.clip], {}];
    required.type = [['ltxv', 'minimax'], {}];
  }
  if (nodeName === 'VAELoader') {
    required.vae_name = [[ltx.modelFiles.videoVae, ltx.modelFiles.audioVae, minimax.modelFiles.videoVae, minimax.modelFiles.audioVae], {}];
  }
  if (nodeName === 'LatentUpscaleModelLoader') required.model_name = [[ltx.modelFiles.latentUpscaler], {}];
  if (nodeName === 'MiniMaxH3ReferenceToVideo') {
    required.ref_image_size = [['match', 'max'], {}];
    optional.ref_images = ['COMFY_AUTOGROW_V3', {
      template: {
        input: { required: { ref_image: ['IMAGE', {}] } },
        prefix: 'ref_image_',
        min: 0,
        max: 9
      }
    }];
  }
  if (nodeName === 'KSamplerSelect') required.sampler_name = [[ltx.sampler, minimax.sampler, preview.sampler], {}];
  if (nodeName === 'BasicScheduler') required.scheduler = [[minimax.scheduler, preview.scheduler], {}];
  if (nodeName === 'LoraLoaderModelOnly') required.lora_name = [[preview.modelFiles.lora], {}];
  if (nodeName === 'LoadImage') required.image = [['uploaded.png'], { image_upload: true }];
  if (nodeName === 'SaveVideo') {
    required.format = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'mp4' }, { key: 'auto' }] }];
    optional.codec = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'h264' }, { key: 'auto' }] }];
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
  const state = { mode: 'happy', calls: [], uploads: [], prompts: [], selectedModel: 'ltx' };
  const reset = (mode = 'happy') => {
    state.mode = mode;
    state.calls = [];
    state.uploads = [];
    state.prompts = [];
    state.selectedModel = 'ltx';
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
        state.selectedModel = queued.prompt['36'] ? 'ltx' : queued.prompt['30'] ? 'preview' : 'minimax';
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
        const isLtx = state.selectedModel === 'ltx';
        responseJson(response, 200, {
          [comfyPromptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              [isLtx ? '36' : '29']: {
                [isLtx ? 'videos' : 'images']: [{
                  filename: isLtx ? 'scene-motion-loop-flf_00001_.mp4' : 'scene-motion_00001_.mp4',
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
          const expectedBytes = url.searchParams.get('filename') === 'jenna-stannis-body-v1.png'
            ? bodyReferenceBytes
            : identityReferenceBytes;
          const bytes = state.mode === 'identity-hash'
            ? new Uint8Array([...identityReferenceBytes, 0])
            : state.mode === 'body-hash' && url.searchParams.get('filename') === 'jenna-stannis-body-v1.png'
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
        const isLtx = state.selectedModel === 'ltx';
        const bytes = isLtx ? ltxMp4Bytes : state.selectedModel === 'preview' ? previewMp4Bytes : mp4Bytes;
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

function formFor(request, imageBytes, includeExtra = false, masterBytes = null) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('image', new Blob([imageBytes], { type: 'image/png' }), 'scene.png');
  if (masterBytes) form.append('master', new Blob([masterBytes], { type: 'image/png' }), 'master.png');
  if (includeExtra) form.append('extra', 'forbidden');
  return form;
}

test('compiled inline-scene-video route enforces the additive LTX-default and MiniMax contracts', { timeout: 120_000 }, async (context) => {
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

  await context.test('GET returns exact installed LTX and MiniMax capabilities', async () => {
    fake.reset();
    const response = await fetch(routeUrl);
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const capabilities = JSON.parse(responseText);
    assert.equal(capabilities.spec, 'mullet_inline_scene_video_capabilities_v6');
    assert.deepEqual(capabilities.templates.map(({ template, available }) => [template.id, available]), [
      ['ltx-2.5-distilled-scene-v2', true],
      ['minimax-h3-ref2va-scene-v1', true],
      ['minimax-h3-ref2va-lightx-preview-v1', true]
    ]);
    assert.deepEqual(capabilities.aspectRatios, [
      { aspectRatio: '3:2', width: 1152, height: 768 },
      { aspectRatio: '4:3', width: 1024, height: 768 },
      { aspectRatio: '5:4', width: 960, height: 768 },
      { aspectRatio: '16:9', width: 1344, height: 768 }
    ]);
    assert.deepEqual(capabilities.durations, [5]);
    const queriedNodes = fake.state.calls.map(({ path }) => decodeURIComponent(path.slice('/object_info/'.length)));
    const expectedNodes = new Set(INLINE_SCENE_VIDEO_TEMPLATES.flatMap(({ requiredNodes }) => requiredNodes));
    assert.deepEqual(new Set(queriedNodes), expectedNodes);
    assert.equal(queriedNodes.length, expectedNodes.size);
  });

  await context.test('POST defaults to exact silent LTX first/last-frame H.264 MP4 with provenance', async () => {
    fake.reset();
    const response = await post(formFor(request, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, ltxMp4Bytes);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-mullet-prompt-id'), comfyPromptId);
    assert.equal(response.headers.get('x-mullet-width'), '1344');
    assert.equal(response.headers.get('x-mullet-height'), '768');
    assert.equal(response.headers.get('x-mullet-frames'), '121');
    assert.equal(response.headers.get('x-mullet-fps'), '24');
    assert.equal(request.durationSeconds, 5);
    assert.equal(response.headers.get('x-mullet-duration-seconds'), String(121 / 24));
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '0');
    assert.equal(response.headers.get('x-mullet-model-template'), 'ltx-2.5-distilled-scene-v2');
    assert.equal(response.headers.get('x-mullet-video-mode'), 'flf2v_loop');
    assert.equal(response.headers.get('x-mullet-source-prompt-id'), staticPromptId);
    assert.equal(response.headers.get('x-mullet-source-seed'), '42');
    assert.equal(response.headers.get('x-mullet-source-request-sha256'), inlineSceneVideoSourceRequestSha256(request));
    assert.equal(response.headers.get('x-mullet-input-sha256'), imageSha256);
    assert.equal(response.headers.get('x-mullet-video-sha256'), sha256(ltxMp4Bytes));

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
    assert.equal(queued.prompt['3'].inputs.unet_name, LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet);
    assert.equal(queued.prompt['1'].inputs.image, `mullet/motion-inputs/${upload.name}`);
    assert.equal(queued.prompt['11'].inputs.width, 672);
    assert.equal(queued.prompt['11'].inputs.height, 384);
    assert.equal(queued.prompt['11'].inputs.length, 121);
    assert.equal(queued.prompt['17'].inputs.noise_seed, seed);
    assert.equal(queued.prompt['12'].inputs.frame_idx, 0);
    assert.equal(queued.prompt['13'].inputs.frame_idx, -1);
    assert.equal(queued.prompt['24'].inputs.frame_idx, 0);
    assert.equal(queued.prompt['25'].inputs.frame_idx, -1);
    assert.equal(queued.prompt['35'].inputs.fps, 24);
    assert.equal('audio' in queued.prompt['35'].inputs, false);
    assert.equal(queued.prompt['35'].inputs.bit_depth, 8);
    assert.deepEqual(queued.prompt['36'].inputs.video, ['35', 0]);
    assert.equal(queued.prompt['36'].inputs.format, 'mp4');
    assert.equal(queued.prompt['36'].inputs.codec, 'h264');
  });

  await context.test('POST keeps MiniMax H3 Ref2VA as a selectable canonical-reference native-audio MP4', async () => {
    fake.reset();
    const minimaxRequest = motionRequest(imageSha256, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    const response = await post(formFor(minimaxRequest, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, mp4Bytes);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('x-mullet-model-template'), MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    assert.equal(response.headers.get('x-mullet-video-mode'), 'ref2va');
    assert.equal(response.headers.get('x-mullet-frames'), '124');
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '1');
    assert.equal(response.headers.get('x-mullet-duration-seconds'), String(124 / 24));
    const identityViewIndex = fake.state.calls.findIndex(({ path }) => path.includes('subfolder=mullet%2Fidentity'));
    const promptIndex = fake.state.calls.findIndex(({ path }) => path === '/prompt');
    assert.ok(identityViewIndex >= 0 && identityViewIndex < promptIndex);
    const identityViews = fake.state.calls.filter(({ path }) => path.includes('subfolder=mullet%2Fidentity'));
    assert.equal(identityViews.length, 2);
    assert.ok(identityViews.every(({ path }) => fake.state.calls.findIndex((call) => call.path === path) < promptIndex));
    assert.equal(fake.state.uploads.length, 1);
    const queued = fake.state.prompts[0];
    assert.equal(queued.prompt['1'].inputs.unet_name, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet);
    assert.equal(queued.prompt['6'].inputs.image, 'mullet/identity/jenna-stannis-v1.png');
    assert.equal(queued.prompt['7'].inputs.image, 'mullet/identity/jenna-stannis-body-v1.png');
    assert.equal(queued.prompt['20'].inputs.length, 124);
    assert.equal(queued.prompt['20'].inputs.ref_image_size, 'match');
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_2'], ['7', 0]);
    assert.deepEqual(queued.prompt['28'].inputs.audio, ['27', 0]);
    assert.equal(queued.prompt['29'].inputs.filename_prefix, 'mullet/scene-motion');
    assert.equal(JSON.stringify(queued).includes('fl2va'), false);
    assert.equal(JSON.stringify(queued).includes('i2v'), false);
    assert.equal(JSON.stringify(queued).includes('turbo'), false);
  });

  await context.test('POST keeps the published LightX Ref2VA profile as a separate 544p preview', async () => {
    fake.reset();
    const previewRequest = motionRequest(imageSha256, MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    const response = await post(formFor(previewRequest, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, previewMp4Bytes);
    assert.equal(response.headers.get('x-mullet-model-template'), MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    assert.equal(response.headers.get('x-mullet-width'), '960');
    assert.equal(response.headers.get('x-mullet-height'), '544');
    assert.equal(response.headers.get('x-mullet-frames'), '124');
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '1');
    const queued = fake.state.prompts[0];
    assert.equal(queued.prompt['20'].inputs.width, 960);
    assert.equal(queued.prompt['20'].inputs.height, 544);
    assert.equal(queued.prompt['22'].inputs.sampler_name, 'euler');
    assert.equal(queued.prompt['23'].inputs.scheduler, 'simple');
    assert.equal(queued.prompt['23'].inputs.steps, 4);
    assert.deepEqual(queued.prompt['23'].inputs.model, ['1', 0]);
    assert.equal(queued.prompt['30'].inputs.lora_name, MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.lora);
    assert.equal(queued.prompt['30'].inputs.strength_model, 1);
    assert.deepEqual(queued.prompt['31'].inputs, {
      model: ['30', 0],
      shift_video: 12,
      shift_audio: 3
    });
    assert.deepEqual(queued.prompt['21'].inputs.model, ['31', 0]);
  });

  await context.test('POST binds a byte-verified prior master between the current scene and canonical identity', async () => {
    fake.reset();
    const continuedRequest = motionRequest(
      imageSha256,
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
      priorMaster
    );
    const response = await post(formFor(continuedRequest, imageBytes, false, priorMasterBytes));
    assert.equal(response.status, 200, await response.text());
    assert.equal(fake.state.uploads.length, 2);
    const [currentUpload, masterUpload] = fake.state.uploads;
    assert.match(currentUpload.name, /^scene-motion-[0-9a-f-]{36}\.png$/i);
    assert.match(masterUpload.name, /^scene-motion-prior-[0-9a-f-]{36}\.png$/i);
    assert.deepEqual(masterUpload.bytes, priorMasterBytes);
    assert.equal(masterUpload.subfolder, 'mullet/motion-inputs');
    assert.equal(masterUpload.type, 'input');
    assert.equal(masterUpload.overwrite, 'false');
    const queued = fake.state.prompts[0];
    assert.equal(queued.prompt['5'].inputs.image, `mullet/motion-inputs/${currentUpload.name}`);
    assert.equal(queued.prompt['6'].inputs.image, `mullet/motion-inputs/${masterUpload.name}`);
    assert.equal(queued.prompt['7'].inputs.image, 'mullet/identity/jenna-stannis-v1.png');
    assert.equal(queued.prompt['8'].inputs.image, 'mullet/identity/jenna-stannis-body-v1.png');
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_2'], ['7', 0]);
    assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_3'], ['8', 0]);
    assert.match(queued.prompt['20'].inputs.prompt, /<Picture 2> is the verified prior scene master/);
    assert.match(queued.prompt['20'].inputs.prompt, /<Subject 1> is Jenna Stannis;[\s\S]*<Picture 3>[\s\S]*<Picture 4>/);
  });

  await context.test('POST omits a non-overlapping prior master and rejects an unplanned master upload', async () => {
    const noOverlapMaster = {
      ...priorMaster,
      cast: [{ profileId: 'other-person', profileFingerprint: 'b'.repeat(64) }]
    };
    const noOverlapRequest = motionRequest(
      imageSha256,
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
      noOverlapMaster
    );
    fake.reset();
    const response = await post(formFor(noOverlapRequest, imageBytes));
    assert.equal(response.status, 200, await response.text());
    assert.equal(fake.state.uploads.length, 1);
    const queued = fake.state.prompts[0];
    assert.equal(queued.prompt['6'].inputs.image, 'mullet/identity/jenna-stannis-v1.png');
    assert.equal(queued.prompt['7'].inputs.image, 'mullet/identity/jenna-stannis-body-v1.png');
    assert.equal(queued.prompt['8'], undefined);
    assert.doesNotMatch(queued.prompt['20'].inputs.prompt, /verified prior scene master/);

    fake.reset();
    const extraMasterResponse = await post(formFor(noOverlapRequest, imageBytes, false, priorMasterBytes));
    assert.equal(extraMasterResponse.status, 400);
    assert.equal(fake.state.calls.length, 0);
  });

  await context.test('POST rejects missing, extra, or tampered prior masters and canonical identities before queue', async () => {
    const noMasterRequest = motionRequest(imageSha256, MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
    const continuedRequest = motionRequest(
      imageSha256,
      MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
      priorMaster
    );
    const ltxRequest = motionRequest(imageSha256);
    const tamperedMaster = new Uint8Array([...priorMasterBytes, 0]);
    for (const [mode, body] of [
      ['happy', formFor(continuedRequest, imageBytes)],
      ['happy', formFor(noMasterRequest, imageBytes, false, priorMasterBytes)],
      ['happy', formFor(ltxRequest, imageBytes, false, priorMasterBytes)],
      ['happy', formFor(continuedRequest, imageBytes, false, tamperedMaster)],
      ['identity-hash', formFor(noMasterRequest, imageBytes)],
      ['body-hash', formFor(noMasterRequest, imageBytes)],
      ['identity-dimensions', formFor(noMasterRequest, imageBytes)],
      ['identity-404', formFor(noMasterRequest, imageBytes)]
    ]) {
      fake.reset(mode);
      const response = await post(body);
      assert.notEqual(response.status, 200, `${mode} unexpectedly succeeded`);
      assert.equal(fake.state.prompts.length, 0);
      assert.equal(fake.state.calls.some(({ path }) => path === '/prompt'), false);
    }
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

  await context.test('declared oversized output maps to 413 without allocating its body', async () => {
    fake.reset('oversized');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.some(({ path }) => path.startsWith('/view?')), true);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), true);
  });
});
