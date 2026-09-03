import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_TEMPLATES,
  MINIMAX_H3_REFERENCE_SCENE_TEMPLATE,
  buildInlineSceneVideoRequest,
  inlineSceneVideoReferenceName,
  inlineSceneVideoReferencesSha256,
  inlineSceneVideoSourceRequestSha256
} from '../src/lib/inline-scene-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-inline-scene-video-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
const staticPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const clipMp4Bytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73, includeAudio: false });
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
const jennaIdentity = Object.freeze({
  profileId: sceneCandidate.id,
  profileFingerprint: sceneCandidate.profileFingerprint,
  displayName: sceneCandidate.displayName,
  subject: 'Jenna Stannis',
  referenceImage: {
    name: 'jenna-stannis-v1.png',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: 'e'.repeat(64),
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  },
  bodyReferenceImage: null
});
const soloCast = Object.freeze({ kind: 'solo', identities: [jennaIdentity] });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function reference(identity, view, salt = 0) {
  return {
    profileId: identity.profileId,
    view,
    sha256: sha256(`${identity.profileId}:${view}:${salt}`),
    name: inlineSceneVideoReferenceName(identity.profileId, view, identity.profileFingerprint)
  };
}

function referencesFor(cast, views = ['face', 'threequarter', 'waistup']) {
  return cast.identities.flatMap((identity) => views.map((view) => reference(identity, view)));
}

function motionRequest(references = referencesFor(soloCast)) {
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
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: soloCast,
    lora: sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
  return buildInlineSceneVideoRequest({ conversationId, epoch, request: sceneRequest, references });
}

function capabilityResponse(nodeName) {
  const template = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE;
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
  if (nodeName === 'MiniMaxH3ReferenceToVideo') {
    required.ref_image_size = ['COMBO', { default: 'match', options: ['match', 'max'] }];
    optional.ref_images = ['COMFY_AUTOGROW_V3', {
      template: {
        input: { required: { ref_image: ['IMAGE', {}] } },
        prefix: 'ref_image_',
        min: 0,
        max: 9
      }
    }];
  }
  if (nodeName === 'KSamplerSelect') required.sampler_name = [[template.sampler], {}];
  if (nodeName === 'BasicScheduler') required.scheduler = [[template.scheduler], {}];
  if (nodeName === 'LoraLoaderModelOnly') required.lora_name = [[template.modelFiles.turboLora], {}];
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

function fakeComfy() {
  const state = { mode: 'happy', calls: [], prompts: [] };
  const reset = (mode = 'happy') => {
    state.mode = mode;
    state.calls = [];
    state.prompts = [];
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://fake-comfy');
      state.calls.push({ method: request.method, path: `${url.pathname}${url.search}` });
      if (url.pathname.startsWith('/object_info/')) {
        const nodeName = decodeURIComponent(url.pathname.slice('/object_info/'.length));
        if (state.mode === 'no-reference-node' && nodeName === 'MiniMaxH3ReferenceToVideo') {
          responseJson(response, 404, { error: 'unknown node' });
          return;
        }
        responseJson(response, 200, capabilityResponse(nodeName));
        return;
      }
      if (url.pathname === '/prompt' && request.method === 'POST') {
        const queued = JSON.parse((await requestBytes(request)).toString('utf8'));
        state.prompts.push(queued);
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
                videos: [{ filename: 'scene-motion-ref_00001_.mp4', subfolder: 'mullet', type: 'output' }],
                animated: [true]
              }
            }
          }
        });
        return;
      }
      if (url.pathname === '/view') {
        if (url.searchParams.get('subfolder') === 'mullet/identity/refpack') {
          const filename = url.searchParams.get('filename') ?? '';
          const missing = state.mode === 'reference-404'
            || (state.mode === 'second-reference-404' && filename.includes('-threequarter-'));
          if (missing) {
            responseJson(response, 404, { error: 'missing reference' });
            return;
          }
          if (state.mode === 'head-405' && request.method === 'HEAD') {
            responseJson(response, 405, { error: 'HEAD not supported' });
            return;
          }
          const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(pngBytes.byteLength)
          });
          response.end(request.method === 'HEAD' ? undefined : pngBytes);
          return;
        }
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
          'content-length': String(clipMp4Bytes.byteLength)
        });
        response.end(clipMp4Bytes);
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

function refpackPath(name) {
  return `/view?${new URLSearchParams({ filename: name, subfolder: 'mullet/identity/refpack', type: 'input' })}`;
}

test('compiled inline-scene-video route serves one JSON-driven MiniMax H3 reference clip', { timeout: 180_000 }, async (context) => {
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
  // Scene motion reads its own lane; every other lane points at a dead server so the
  // route is proven to touch only the scene-video lane.
  process.env.SCENE_VIDEO_COMFY_BASE_URL = comfyBaseUrl;
  process.env.SCENE_STILL_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.PORTRAIT_STILL_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.PORTRAIT_VIDEO_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.EXPRESSION_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.IMAGE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.VIDEO_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BODY_SIZE_LIMIT = '32M';
  process.env.BUILD_SHA = 'inline-scene-video-route-test';
  process.env.PUBLIC_BUILD_SHA = 'inline-scene-video-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);
  const routeUrl = `${appBaseUrl}/mullet/api/scene/video`;
  const request = motionRequest();
  const referenceNames = request.source.references.map(({ name }) => name);
  const post = (body, headers = {}) => fetch(routeUrl, {
    method: 'POST',
    headers: { origin: publicOrigin, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body)
  });
  const promptCalls = () => fake.state.calls.filter(({ path }) => path === '/prompt');
  const refpackCalls = () => fake.state.calls.filter(({ path }) => path.includes('subfolder=mullet%2Fidentity%2Frefpack'));

  await context.test('GET returns the exact installed reference-clip capability', async () => {
    fake.reset();
    const response = await fetch(routeUrl);
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const capabilities = JSON.parse(responseText);
    assert.equal(capabilities.spec, 'mullet_inline_scene_video_capabilities_v7');
    assert.deepEqual(capabilities.templates.map(({ template, available, missing }) => [template.id, available, missing]), [
      ['minimax-h3-ref2va-scene-v1', true, []]
    ]);
    assert.equal(capabilities.templates[0].template.mode, 'ref2v');
    assert.deepEqual(capabilities.aspectRatios, INLINE_SCENE_VIDEO_DIMENSIONS.map((entry) => ({ ...entry })));
    assert.deepEqual(capabilities.durations, [3]);
    const queriedNodes = fake.state.calls.map(({ path }) => decodeURIComponent(path.slice('/object_info/'.length)));
    const expectedNodes = new Set(INLINE_SCENE_VIDEO_TEMPLATES.flatMap(({ requiredNodes }) => requiredNodes));
    assert.deepEqual(new Set(queriedNodes), expectedNodes);
    assert.equal(queriedNodes.length, expectedNodes.size);
    assert.equal(fake.state.calls.every(({ path }) => path.startsWith('/object_info/')), true);
  });

  await context.test('POST JSON returns the silent H.264 reference clip with full provenance headers', async () => {
    fake.reset();
    const response = await post({ request });
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, clipMp4Bytes);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-mullet-prompt-id'), comfyPromptId);
    const seed = Number(response.headers.get('x-mullet-seed'));
    assert.equal(Number.isSafeInteger(seed) && seed >= 0, true);
    assert.equal(response.headers.get('x-mullet-width'), '1024');
    assert.equal(response.headers.get('x-mullet-height'), '576');
    assert.equal(response.headers.get('x-mullet-frames'), '73');
    assert.equal(response.headers.get('x-mullet-fps'), '24');
    assert.equal(response.headers.get('x-mullet-duration-seconds'), String(73 / 24));
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '0');
    assert.equal(response.headers.get('x-mullet-model-template'), 'minimax-h3-ref2va-scene-v1');
    assert.equal(response.headers.get('x-mullet-video-mode'), 'ref2v');
    assert.equal(response.headers.get('x-mullet-source-request-sha256'), inlineSceneVideoSourceRequestSha256(request));
    assert.equal(response.headers.get('x-mullet-references-sha256'), inlineSceneVideoReferencesSha256(request));
    assert.equal(response.headers.get('x-mullet-video-sha256'), sha256(clipMp4Bytes));
    assert.equal(response.headers.get('x-mullet-input-sha256'), null);
    assert.equal(response.headers.get('x-mullet-source-prompt-id'), null);
    assert.equal(response.headers.get('x-mullet-source-seed'), null);

    // Every reference is confirmed on the lane before the graph is queued. The probe is a
    // GET whose body is dropped: ComfyUI's /view does not answer HEAD consistently.
    const heads = refpackCalls();
    assert.deepEqual(heads.map(({ method }) => method), ['GET', 'GET', 'GET']);
    assert.deepEqual(heads.map(({ path }) => path), referenceNames.map(refpackPath));
    assert.equal(heads[0].path, `/view?filename=jenna-face-${'d'.repeat(16)}.png&subfolder=mullet%2Fidentity%2Frefpack&type=input`);
    const promptIndex = fake.state.calls.findIndex(({ path }) => path === '/prompt');
    assert.ok(promptIndex > 0);
    assert.ok(heads.every((head) => fake.state.calls.indexOf(head) < promptIndex));
    assert.ok(fake.state.calls.slice(0, promptIndex).some(({ path }) => path.startsWith('/object_info/')));
    assert.equal(fake.state.calls.some(({ path }) => path === '/upload/image'), false);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('subfolder=mullet%2Fmotion-inputs')), false);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), false);

    assert.equal(fake.state.prompts.length, 1);
    const queued = fake.state.prompts[0];
    assert.equal(queued.client_id, 'mullet-inline-scene-video');
    assert.equal(queued.prompt['1'].inputs.unet_name, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.unet);
    assert.equal(queued.prompt['16'].inputs.lora_name, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.turboLora);
    assert.equal(queued.prompt['6'].class_type, 'MiniMaxH3ReferenceToVideo');
    assert.equal(queued.prompt['6'].inputs.width, 1024);
    assert.equal(queued.prompt['6'].inputs.height, 576);
    assert.equal(queued.prompt['6'].inputs.length, 73);
    assert.equal(queued.prompt['6'].inputs.ref_image_size, 'max');
    assert.deepEqual(queued.prompt['6'].inputs.ref_images, { ref_image_0: ['20', 0], ref_image_1: ['21', 0], ref_image_2: ['22', 0] });
    assert.match(queued.prompt['6'].inputs.prompt, /Jenna Stannis is the person in <Picture 1> face, <Picture 2> three-quarter view, <Picture 3> clothing from the waist up/);
    referenceNames.forEach((name, index) => {
      assert.equal(queued.prompt[String(20 + index)].inputs.image, `mullet/identity/refpack/${name}`);
    });
    assert.equal(queued.prompt['10'].inputs.noise_seed, seed);
    assert.equal(queued.prompt['14'].inputs.fps, 24);
    assert.equal(queued.prompt['15'].inputs.filename_prefix, 'mullet/scene-motion-ref');
    assert.equal(JSON.stringify(queued).includes('motion-inputs'), false);
    assert.equal(JSON.stringify(queued).includes('fl2v'), false);
    const outputFetches = fake.state.calls.filter(({ path }) => path === '/view?filename=scene-motion-ref_00001_.mp4&subfolder=mullet&type=output');
    assert.equal(outputFetches.length, 1);
    assert.equal(fake.state.calls.indexOf(outputFetches[0]) > promptIndex, true);
  });

  await context.test('POST rejects non-JSON, multipart, malformed, and invalid requests before touching ComfyUI', async () => {
    const form = new FormData();
    form.append('request', JSON.stringify(request));
    form.append('image', new Blob([new Uint8Array(24)], { type: 'image/png' }), 'scene.png');
    const foreign = {
      ...request,
      source: { ...request.source, references: [...request.source.references, reference({ profileId: 'cally', profileFingerprint: 'f'.repeat(64) }, 'face')] }
    };
    const misnamed = {
      ...request,
      source: {
        ...request.source,
        references: [{ ...request.source.references[0], name: inlineSceneVideoReferenceName('jenna', 'face', 'a'.repeat(64)) }]
      }
    };
    const stale = { ...request, spec: 'mullet_inline_scene_video_request_v6' };
    const rejected = [
      ['multipart form', () => post(form, { 'content-type': undefined }), /must be JSON/],
      ['text body', () => post(JSON.stringify({ request }), { 'content-type': 'text/plain' }), /must be JSON/],
      ['octet stream', () => post(JSON.stringify({ request }), { 'content-type': 'application/octet-stream' }), /must be JSON/],
      ['unparseable JSON', () => post('{not json'), /body is invalid/],
      ['JSON array', () => post('[1]'), /body is invalid/],
      ['missing request', () => post({}), /must be an object/],
      ['stale spec', () => post({ request: stale }), /spec/],
      ['foreign reference', () => post({ request: foreign }), /does not belong to the scene cast/],
      ['misnamed reference', () => post({ request: misnamed }), /subject fingerprint/],
      ['no references', () => post({ request: { ...request, source: { ...request.source, references: [] } } }), /between 1 and 9/],
      ['wrong aspect ratio', () => post({ request: { ...request, aspectRatio: '3:2' } }), /aspect ratio/]
    ];
    for (const [label, send, expected] of rejected) {
      fake.reset();
      const response = await send();
      const text = await response.text();
      assert.equal(response.status, 400, `${label}: ${text}`);
      assert.match(text, expected, label);
      assert.equal(fake.state.calls.length, 0, label);
    }
  });

  await context.test('POST rejects an oversized declared body with 413 before reading it', async () => {
    fake.reset();
    const padded = JSON.stringify({ request, padding: 'x'.repeat(200_001) });
    assert.ok(Buffer.byteLength(padded) > 200_000);
    const response = await post(padded);
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.length, 0);
    fake.reset();
    const withinLimit = await post({ request });
    assert.equal(withinLimit.status, 200, await withinLimit.text());
  });

  await context.test('POST answers 409 when a reference is not prepared on the lane and never queues', async () => {
    for (const mode of ['reference-404', 'second-reference-404']) {
      fake.reset(mode);
      const response = await post({ request });
      const text = await response.text();
      assert.equal(response.status, 409, `${mode}: ${text}`);
      const missingName = mode === 'reference-404' ? referenceNames[0] : referenceNames[1];
      assert.match(text, /not prepared on the loop lane/);
      assert.ok(text.includes(missingName), `${mode}: ${text}`);
      assert.equal(promptCalls().length, 0, mode);
      assert.equal(refpackCalls().length, mode === 'reference-404' ? 1 : 2, mode);
      assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), false, mode);
    }
  });

  await context.test('POST answers 503 naming the missing capability when the reference node is absent', async () => {
    fake.reset('no-reference-node');
    const response = await post({ request });
    const text = await response.text();
    assert.equal(response.status, 503, text);
    assert.match(text, /unavailable/);
    assert.match(text, /node:MiniMaxH3ReferenceToVideo/);
    assert.equal(refpackCalls().length, 0);
    assert.equal(promptCalls().length, 0);

    fake.reset('no-reference-node');
    const capabilities = await (await fetch(routeUrl)).json();
    assert.deepEqual(capabilities.templates.map(({ available, missing }) => [available, missing]), [
      [false, ['node:MiniMaxH3ReferenceToVideo']]
    ]);
  });

  await context.test('history failure maps to 502 and cancels only its prompt', async () => {
    fake.reset('history-error');
    const response = await post({ request });
    assert.equal(response.status, 502, await response.text());
    const cancels = fake.state.calls.filter(({ method, path }) => (
      method === 'POST' && path === `/api/jobs/${comfyPromptId}/cancel`
    ));
    assert.equal(cancels.length, 1);
    assert.equal(promptCalls().length, 1);
    assert.equal(fake.state.calls.some(({ path }) => path === '/interrupt' || path === '/queue' || path === '/free'), false);
  });

  await context.test('declared oversized output maps to 413 without allocating its body', async () => {
    fake.reset('oversized');
    const response = await post({ request });
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.some(({ path }) => path.startsWith('/view?filename=scene-motion-ref')), true);
    assert.equal(fake.state.calls.some(({ path }) => path.includes('/cancel')), true);
  });
});
