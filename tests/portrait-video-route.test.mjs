import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE
} from '../src/lib/portrait-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-video-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const videoPromptId = '33333333-3333-4333-8333-333333333333';
const endFramePromptId = '44444444-4444-4444-8444-444444444444';
const h264Mp4Bytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 49, includeAudio: false });
const audioBearingMp4Bytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 49 });
const mp4Bytes = buildH264AacMp4Fixture({
  width: 576,
  height: 1024,
  frames: 56,
  fps: 28,
  videoTimescale: 14_336,
  includeAudio: false
});
const mp4ThreeBytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 73, includeAudio: false });
const mp4FiveBytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames: 124, includeAudio: false });
const audioMp4Bytes = buildH264AacMp4Fixture({
  width: 576,
  height: 1024,
  frames: 56,
  fps: 28,
  videoTimescale: 14_336
});

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
  modelTemplate = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  mode = 'flf2v_loop',
  durationSeconds = 2
} = {}) {
  return {
    spec: 'mullet_portrait_video_request_v9',
    modelTemplate,
    endFrameModelTemplate: mode === 'flf2v_generated' ? 'qwen-image-edit-2511-end-frame-v1' : null,
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
  const minimaxFiles = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.modelFiles;
  const endFiles = QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE.modelFiles;
  if (node === 'UNETLoader') return standardInfo(node, 'unet_name', [minimaxFiles.unet, endFiles.unet]);
  if (node === 'CLIPLoader') return { [node]: { input: { required: {
    clip_name: [[minimaxFiles.clip, endFiles.clip]],
    type: [['minimax', 'qwen_image']]
  } } } };
  if (node === 'VAELoader') return standardInfo(node, 'vae_name', [minimaxFiles.videoVae, endFiles.vae]);
  if (node === 'LoraLoaderModelOnly') return standardInfo(node, 'lora_name', [minimaxFiles.turboLora, endFiles.lora]);
  if (node === 'KSamplerSelect') return standardInfo(node, 'sampler_name', ['euler_ancestral', 'res_multistep', 'euler']);
  if (node === 'KSampler') return { [node]: { input: { required: {
    sampler_name: [['euler']],
    scheduler: [['simple']]
  } } } };
  if (node === 'BasicScheduler') return { [node]: { input: { required: {
    scheduler: [['simple']],
    steps: ['INT', { min: 1, max: 10000, step: 1 }],
    denoise: ['FLOAT', { min: 0, max: 1, step: 0.01 }]
  } } } };
  if (node === 'MiniMaxH3SigmaShift') return { [node]: { input: { required: {
    model: ['MODEL', {}],
    shift_video: ['FLOAT', { min: 0.01, max: 100, step: 0.01 }],
    shift_audio: ['FLOAT', { min: 0.01, max: 100, step: 0.01 }]
  } } } };
  if (node === 'CreateVideo') return { [node]: { input: { required: {
    images: ['IMAGE', {}],
    fps: ['FLOAT', { min: 1, max: 120, step: 1 }]
  } } } };
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
                '14': {
                  images: [{ filename: 'portrait-generated-end-frame_00001_.png', subfolder: 'mullet', type: 'output' }]
                }
              }
            }
          });
          return;
        }
        const generatedFlf = Boolean(queued.prompt?.['17']);
        const loopFlf = Boolean(queued.prompt?.['6']?.inputs?.last_frame) && !generatedFlf;
        const outputNode = '15';
        const extension = 'mp4';
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
        if (state.mode === 'oversized') {
          response.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': String(64 * 1024 * 1024 + 1)
          });
          response.end();
          return;
        }
        const queuedVideo = state.prompts.findLast((prompt) => prompt.client_id === 'mullet-portrait-video');
        const videoBytes = state.mode === 'audio-h264-mp4'
          ? audioBearingMp4Bytes
          : state.mode === 'audio-mp4'
            ? audioMp4Bytes
            : queuedVideo?.prompt?.['6']?.inputs?.length === 124
                ? mp4FiveBytes
                : queuedVideo?.prompt?.['6']?.inputs?.length === 73
                  ? mp4ThreeBytes
                  : mp4Bytes;
        response.writeHead(200, {
          'content-type': 'video/mp4',
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

