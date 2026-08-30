import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE
} from '../src/lib/portrait-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';
import { buildVp9WebmFixture } from './webm-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-video-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const videoPromptId = '33333333-3333-4333-8333-333333333333';
const endFramePromptId = '44444444-4444-4444-8444-444444444444';
const webmBytes = buildVp9WebmFixture({ width: 576, height: 1024, frames: 49, fps: 24 });
const audioWebmBytes = buildVp9WebmFixture({ width: 576, height: 1024, frames: 49, fps: 24, includeAudio: true });
const mp4Bytes = buildH264AacMp4Fixture({
  width: 576,
  height: 1024,
  frames: 73,
  includeAudio: false
});
const mp4FiveBytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 124, includeAudio: false });
const audioMp4Bytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 73 });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function png(width, height, marker = 0) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[8] = marker;
  return bytes;
}

function motionRequest(imageSha256, {
  modelTemplate = LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
  mode = 'flf2v_loop',
  durationSeconds = modelTemplate === LTX25_PORTRAIT_VIDEO_TEMPLATE_ID ? 2 : 3
} = {}) {
  return {
    spec: 'mullet_portrait_video_request_v7',
    modelTemplate,
    endFrameModelTemplate: mode === 'flf2v_generated' ? 'flux2-klein-9b-distilled-end-frame-v1' : null,
    mode,
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      portraitRequestKey: 'route-test-portrait-request',
      portraitPromptId: '11111111-1111-4111-8111-111111111111',
      portraitSeed: 41,
      portraitGeneratedAt: 17,
      portraitWidth: 576,
      portraitHeight: 1024,
      portraitImageSha256: imageSha256,
      portraitSource: {
        conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
        messageCount: 4,
        messageIndex: 3,
        fingerprint: '12:1234abcd',
        expression: 'grief'
      }
    },
    aspectRatio: '9:16',
    durationSeconds
  };
}

function standardInfo(node, inputName, options, metadata = {}) {
  return { [node]: { input: { required: { [inputName]: [options, metadata] } } } };
}

function capabilityResponse(node) {
  const ltxFiles = LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const minimaxFiles = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [ltxFiles.unet, minimaxFiles.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[ltxFiles.clip, minimaxFiles.clip, endFiles.clip]],
    type: [['ltxv', 'minimax', 'flux2']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [ltxFiles.videoVae, ltxFiles.audioVae, minimaxFiles.videoVae, endFiles.vae]);
  if (node === 'LatentUpscaleModelLoader') return standardInfo(node, 'model_name', [ltxFiles.latentUpscaler]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [minimaxFiles.turboLora]);
  if (node === 'KSamplerSelect') return standardInfo(node, 'sampler_name', ['euler_ancestral', 'res_multistep', 'euler']);
  if (node === 'BasicScheduler') return standardInfo(node, 'scheduler', ['simple']);
  if (node === 'SaveWEBM') return standardInfo(node, 'codec', ['vp9']);
  if (node === 'SaveVideo') return { [node]: { input: {
    required: { format: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }, { key: 'mp4' }] }] },
    optional: { codec: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto' }, { key: 'h264' }] }] }
  } } };
  if (node === 'MiniMaxH3ImageToVideo') return { [node]: { input: {
    required: {
      width: ['INT', { min: 32, max: 16384, step: 32 }],
      height: ['INT', { min: 32, max: 16384, step: 32 }],
      length: ['INT', { min: 5, max: 3600, step: 17 }]
    },
    optional: { first_frame: ['IMAGE', {}], last_frame: ['IMAGE', {}] }
  } } };
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
        queued.assignedPromptId = queued.client_id === 'mullet-portrait-end-frame' ? endFramePromptId : videoPromptId;
        state.prompts.push(queued);
        responseJson(response, 200, { prompt_id: queued.assignedPromptId, node_errors: {} });
        return;
      }
      if (url.pathname.startsWith('/history/')) {
        const historyId = decodeURIComponent(url.pathname.slice('/history/'.length));
        const queued = state.prompts.find((prompt) => prompt.assignedPromptId === historyId);
        if (!queued) {
          responseJson(response, 404, { error: 'unknown prompt' });
          return;
        }
        if (state.mode === 'history-error' && historyId === videoPromptId) {
          responseJson(response, 200, {
            [historyId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
          });
          return;
        }
        if (historyId === endFramePromptId) {
          responseJson(response, 200, {
            [historyId]: {
              status: { completed: true, status_str: 'success' },
              outputs: {
                '18': {
                  images: [{ filename: 'portrait-generated-end-frame_00001_.png', subfolder: 'mullet', type: 'output' }]
                }
              }
            }
          });
          return;
        }
        const ltx = queued.prompt?.['3']?.inputs?.unet_name === LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet;
        const generatedFlf = ltx ? Boolean(queued.prompt?.['37']) : Boolean(queued.prompt?.['17']);
        const loopFlf = ltx
          ? queued.prompt?.['13']?.class_type === 'LTXVAddGuide' && !generatedFlf
          : Boolean(queued.prompt?.['6']?.inputs?.last_frame) && !generatedFlf;
        const outputNode = ltx ? (loopFlf || generatedFlf ? '35' : '31') : '15';
        const extension = ltx ? 'webm' : 'mp4';
        const filename = generatedFlf
          ? `portrait-motion-generated-flf_00001_.${extension}`
          : loopFlf
            ? `portrait-motion-loop-flf_00001_.${extension}`
            : `portrait-motion_00001_.${extension}`;
        responseJson(response, 200, {
          [historyId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              [outputNode]: {
                images: [{ filename, subfolder: 'mullet', type: 'output' }],
                animated: [true]
              }
            }
          }
        });
        return;
      }
      if (url.pathname === '/view') {
        if (url.searchParams.get('filename')?.endsWith('.png')) {
          const endFrameBytes = png(576, 1024, 1);
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(endFrameBytes.byteLength)
          });
          response.end(endFrameBytes);
          return;
        }
        const filename = url.searchParams.get('filename') ?? '';
        const webm = filename.endsWith('.webm');
        if (state.mode === 'oversized') {
          response.writeHead(200, {
            'content-type': webm ? 'video/webm' : 'video/mp4',
            'content-length': String(64 * 1024 * 1024 + 1)
          });
          response.end();
          return;
        }
        const queuedVideo = state.prompts.findLast((prompt) => prompt.client_id === 'mullet-portrait-video');
        const videoBytes = webm
          ? state.mode === 'audio-webm' ? audioWebmBytes : webmBytes
          : state.mode === 'audio-mp4'
            ? audioMp4Bytes
            : queuedVideo?.prompt?.['6']?.inputs?.length === 124 ? mp4FiveBytes : mp4Bytes;
        response.writeHead(200, {
          'content-type': webm ? 'video/webm' : 'video/mp4',
          'content-length': String(videoBytes.byteLength)
        });
        response.end(videoBytes);
        return;
      }
      if (
        request.method === 'POST'
        && (url.pathname === `/api/jobs/${videoPromptId}/cancel` || url.pathname === `/api/jobs/${endFramePromptId}/cancel`)
      ) {
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
  process.env.EXPRESSION_COMFY_BASE_URL = comfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BODY_SIZE_LIMIT = '32M';
  process.env.BUILD_SHA = 'portrait-video-route-test';
  process.env.PUBLIC_BUILD_SHA = 'portrait-video-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);
  const routeUrl = `${appBaseUrl}/mullet/api/portrait/video`;
  const imageBytes = png(576, 1024);
  const imageSha256 = sha256(imageBytes);
  const request = motionRequest(imageSha256);
  const post = (body) => fetch(routeUrl, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body
  });

  await context.test('GET returns both exact expression-video template capabilities', async () => {
    fake.reset();
    const response = await fetch(routeUrl);
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const capabilities = JSON.parse(responseText);
    assert.equal(capabilities.spec, 'mullet_portrait_video_capabilities_v7');
    assert.deepEqual(
      capabilities.templates.map(({ template }) => template.id),
      [LTX25_PORTRAIT_VIDEO_TEMPLATE_ID, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID]
    );
    assert.deepEqual(capabilities.templates[0].durations, [2]);
    assert.deepEqual(capabilities.templates[1].durations, [3, 5]);
    for (const templateCapability of capabilities.templates) {
      assert.equal(templateCapability.available, true);
      assert.deepEqual(templateCapability.missing, []);
      assert.deepEqual(templateCapability.modes.map(({ id }) => id), ['i2v', 'flf2v_loop', 'flf2v_generated']);
      assert.equal(templateCapability.modes.every(({ available }) => available), true);
    }
    assert.equal(capabilities.endFrameTemplate.id, 'flux2-klein-9b-distilled-end-frame-v1');
    assert.deepEqual(capabilities.aspectRatios, [
      { aspectRatio: '9:16', width: 576, height: 1024 }
    ]);
    const queriedNodes = fake.state.calls.map(({ path }) => decodeURIComponent(path.slice('/object_info/'.length)));
    assert.deepEqual(
      new Set(queriedNodes),
      new Set([
        ...LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes,
        ...MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.requiredNodes,
        ...FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.requiredNodes
      ])
    );
    assert.equal(
      queriedNodes.length,
      new Set([
        ...LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes,
        ...MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.requiredNodes,
        ...FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.requiredNodes
      ]).size
    );
  });

  await context.test('POST defaults to the two-second silent LTX identical-frame loop WebM', async () => {
    fake.reset();
    const response = await post(formFor(request, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, webmBytes);
    assert.equal(response.headers.get('content-type'), 'video/webm');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-mullet-prompt-id'), videoPromptId);
    assert.equal(response.headers.get('x-mullet-width'), '576');
    assert.equal(response.headers.get('x-mullet-height'), '1024');
    assert.equal(response.headers.get('x-mullet-frames'), '49');
    assert.equal(response.headers.get('x-mullet-fps'), '24');
    assert.equal(response.headers.get('x-mullet-duration-seconds'), '2');
    assert.equal(response.headers.get('x-mullet-encoded-duration-seconds'), '2.042');
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '0');
    assert.equal(response.headers.get('x-mullet-model-template'), LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
    assert.equal(response.headers.get('x-mullet-video-mode'), 'flf2v_loop');
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
    assert.equal(queued.prompt['3'].inputs.unet_name, LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet);
    assert.equal(queued.prompt['4'].inputs.clip_name, LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip);
    assert.deepEqual(queued.prompt['11'].inputs, { width: 288, height: 512, length: 49, batch_size: 1 });
    assert.equal(queued.prompt['12'].class_type, 'LTXVAddGuide');
    assert.equal(queued.prompt['12'].inputs.frame_idx, 0);
    assert.deepEqual(queued.prompt['12'].inputs.image, ['2', 0]);
    assert.equal(queued.prompt['13'].class_type, 'LTXVAddGuide');
    assert.equal(queued.prompt['13'].inputs.frame_idx, -1);
    assert.deepEqual(queued.prompt['13'].inputs.image, ['2', 0]);
    assert.equal(queued.prompt['17'].inputs.noise_seed, seed);
    assert.equal(queued.prompt['24'].inputs.frame_idx, 0);
    assert.deepEqual(queued.prompt['24'].inputs.image, ['2', 0]);
    assert.equal(queued.prompt['25'].inputs.frame_idx, -1);
    assert.deepEqual(queued.prompt['25'].inputs.image, ['2', 0]);
    assert.equal(queued.prompt['35'].class_type, 'SaveWEBM');
    assert.equal(queued.prompt['35'].inputs.codec, 'vp9');
    assert.equal(queued.prompt['35'].inputs.fps, 24);
    assert.equal(Object.hasOwn(queued.prompt['35'].inputs, 'audio'), false);
  });

  await context.test('POST retains selectable MiniMax H3 three- and five-second MP4 loops', async () => {
    fake.reset();
    const minimaxThree = motionRequest(imageSha256, { modelTemplate: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID });
    const response = await post(formFor(minimaxThree, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, mp4Bytes);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('x-mullet-model-template'), MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
    assert.equal(response.headers.get('x-mullet-video-mode'), 'flf2v_loop');
    assert.equal(response.headers.get('x-mullet-duration-seconds'), '3');
    assert.equal(response.headers.get('x-mullet-audio-tracks'), '0');
    const queued = fake.state.prompts[0];
    assert.equal(queued.prompt['6'].class_type, 'MiniMaxH3ImageToVideo');
    assert.deepEqual(queued.prompt['6'].inputs.first_frame, ['5', 0]);
    assert.deepEqual(queued.prompt['6'].inputs.last_frame, ['5', 0]);
    assert.equal(queued.prompt['6'].inputs.length, 73);
    assert.equal(Object.hasOwn(queued.prompt['14'].inputs, 'audio'), false);
    assert.equal(queued.prompt['15'].class_type, 'SaveVideo');

    fake.reset();
    const selected = motionRequest(imageSha256, {
      modelTemplate: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
      durationSeconds: 5
    });
    const responseFive = await post(formFor(selected, imageBytes));
    const responseFiveBytes = new Uint8Array(await responseFive.arrayBuffer());
    assert.equal(responseFive.status, 200, new TextDecoder().decode(responseFiveBytes));
    assert.deepEqual(responseFiveBytes, mp4FiveBytes);
    assert.equal(responseFive.headers.get('x-mullet-frames'), '124');
    assert.equal(responseFive.headers.get('x-mullet-fps'), '24');
    assert.equal(responseFive.headers.get('x-mullet-duration-seconds'), '5');
    assert.equal(responseFive.headers.get('x-mullet-encoded-duration-seconds'), String(124 / 24));
    const queuedFive = fake.state.prompts[0];
    assert.equal(queuedFive.prompt['6'].inputs.length, 124);
    assert.deepEqual(queuedFive.prompt['6'].inputs.first_frame, ['5', 0]);
    assert.deepEqual(queuedFive.prompt['6'].inputs.last_frame, ['5', 0]);
  });

  await context.test('POST generates a FLUX.2 Klein end frame before queuing distinct-frame FLF motion', async () => {
    fake.reset();
    const generatedRequest = motionRequest(imageSha256, { mode: 'flf2v_generated' });
    const response = await post(formFor(generatedRequest, imageBytes));
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, new TextDecoder().decode(responseBytes));
    assert.deepEqual(responseBytes, webmBytes);
    assert.equal(response.headers.get('content-type'), 'video/webm');
    assert.equal(response.headers.get('x-mullet-video-mode'), 'flf2v_generated');
    assert.equal(response.headers.get('x-mullet-end-frame-model-template'), 'flux2-klein-9b-distilled-end-frame-v1');
    assert.equal(response.headers.get('x-mullet-end-frame-prompt-id'), endFramePromptId);
    assert.equal(response.headers.get('x-mullet-end-frame-width'), '576');
    assert.equal(response.headers.get('x-mullet-end-frame-height'), '1024');
    assert.equal(response.headers.get('x-mullet-end-frame-sha256'), sha256(png(576, 1024, 1)));
    const videoSeed = Number(response.headers.get('x-mullet-seed'));
    const endFrameSeed = Number(response.headers.get('x-mullet-end-frame-seed'));
    assert.equal(endFrameSeed, videoSeed === Number.MAX_SAFE_INTEGER ? 0 : videoSeed + 1);

    assert.equal(fake.state.uploads.length, 2);
    assert.deepEqual(fake.state.uploads[0].bytes, imageBytes);
    assert.deepEqual(fake.state.uploads[1].bytes, png(576, 1024, 1));
    assert.equal(fake.state.prompts.length, 2);
    const endFramePrompt = fake.state.prompts[0];
    const videoPrompt = fake.state.prompts[1];
    assert.equal(endFramePrompt.client_id, 'mullet-portrait-end-frame');
    assert.equal(FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet, 'flux-2-klein-9b-kv-int8-convrot.safetensors');
    assert.equal(endFramePrompt.prompt['1'].inputs.unet_name, FLUX2_KLEIN_9B_PORTRAIT_END_FRAME_TEMPLATE.modelFiles.unet);
    assert.equal(endFramePrompt.prompt['4'].inputs.image, `mullet/motion-inputs/${fake.state.uploads[0].name}`);
    assert.equal(endFramePrompt.prompt['5'].class_type, 'ImageScaleToTotalPixels');
    assert.equal(endFramePrompt.prompt['5'].inputs.megapixels, 0.5);
    assert.deepEqual(endFramePrompt.prompt['11'].inputs, { width: 576, height: 1024, batch_size: 1 });
    assert.equal(endFramePrompt.prompt['12'].inputs.noise_seed, endFrameSeed);
    assert.deepEqual(endFramePrompt.prompt['18'].inputs.images, ['17', 0]);
    assert.equal(videoPrompt.client_id, 'mullet-portrait-video');
    assert.equal(videoPrompt.prompt['1'].inputs.image, `mullet/motion-inputs/${fake.state.uploads[0].name}`);
    assert.equal(videoPrompt.prompt['36'].inputs.image, `mullet/motion-inputs/${fake.state.uploads[1].name}`);
    assert.deepEqual(videoPrompt.prompt['13'].inputs.image, ['37', 0]);
    assert.deepEqual(videoPrompt.prompt['25'].inputs.image, ['37', 0]);
    assert.equal(videoPrompt.prompt['35'].inputs.filename_prefix, 'mullet/portrait-motion-generated-flf');
  });

  await context.test('POST rejects mismatched hash, IHDR, and multipart shape before ComfyUI', async () => {
    fake.reset();
    const hashMismatch = motionRequest('b'.repeat(64));
    assert.equal((await post(formFor(hashMismatch, imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    const wrongDimensions = png(576, 768);
    assert.equal((await post(formFor(motionRequest(sha256(wrongDimensions)), wrongDimensions))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    assert.equal((await post(formFor(request, imageBytes, true))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    assert.equal((await post(formFor({ ...request, mode: 'unsupported' }, imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    assert.equal((await post(formFor({ ...request, durationSeconds: 4 }, imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);

    fake.reset();
    assert.equal((await post(formFor({ ...request, aspectRatio: '3:4' }, imageBytes))).status, 400);
    assert.equal(fake.state.calls.length, 0);
  });

  await context.test('history failure maps to 502 and cancels only its prompt', async () => {
    fake.reset('history-error');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 502, await response.text());
    const cancellations = fake.state.calls.filter(({ method, path }) => method === 'POST' && path === `/api/jobs/${videoPromptId}/cancel`);
    assert.equal(cancellations.length, 1);
    assert.equal(fake.state.calls.some(({ path }) => path === '/interrupt'), false);
  });

  await context.test('audio-bearing LTX WebM maps to 502 and cancels only its prompt', async () => {
    fake.reset('audio-webm');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 502, await response.text());
    const cancellations = fake.state.calls.filter(({ method, path }) => method === 'POST' && path === `/api/jobs/${videoPromptId}/cancel`);
    assert.equal(cancellations.length, 1);
    assert.equal(fake.state.calls.some(({ path }) => path === '/interrupt'), false);
  });

  await context.test('audio-bearing MiniMax MP4 maps to 502 and cancels only its prompt', async () => {
    fake.reset('audio-mp4');
    const minimaxRequest = motionRequest(imageSha256, { modelTemplate: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID });
    const response = await post(formFor(minimaxRequest, imageBytes));
    assert.equal(response.status, 502, await response.text());
    const cancellations = fake.state.calls.filter(({ method, path }) => method === 'POST' && path === `/api/jobs/${videoPromptId}/cancel`);
    assert.equal(cancellations.length, 1);
  });

  await context.test('declared oversized WebM maps to 413 without allocating its body', async () => {
    fake.reset('oversized');
    const response = await post(formFor(request, imageBytes));
    assert.equal(response.status, 413, await response.text());
    assert.equal(fake.state.calls.some(({ path }) => path.startsWith('/view?')), true);
    const cancellations = fake.state.calls.filter(({ method, path }) => method === 'POST' && path === `/api/jobs/${videoPromptId}/cancel`);
    assert.equal(cancellations.length, 1);
  });
});
