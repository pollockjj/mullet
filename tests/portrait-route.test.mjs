import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  MINIMAX_H3_PORTRAIT_STILL_TEMPLATE,
  PORTRAIT_H3_REFERENCE_TEMPLATE_ID
} from '../src/lib/portrait.ts';
import { buildPngFixture } from './png-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const ownedPromptId = '77777777-7777-4777-8777-777777777777';
const canonicalBytes = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x02, 0x58,
  0x01, 0x90,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
]);
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(canonicalBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const managedBodyBytes = buildPngFixture(576, 1024);
const managedBodySha256 = createHash('sha256').update(managedBodyBytes).digest('hex');
const managedBodyReference = Object.freeze({
  name: `body-jenna-stannis-1234abcd-${managedBodySha256}.png`,
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: managedBodySha256,
  width: 576,
  height: 1024,
  aspectRatio: '9:16'
});
const portraitOutputBytes = buildPngFixture(576, 1024);

function node(name, required = {}, optional = {}, output = undefined) {
  return { [name]: { input: { required, optional }, ...(output ? { output } : {}) } };
}

function capabilityResponse(name) {
  const h3 = MINIMAX_H3_PORTRAIT_STILL_TEMPLATE;
  if (name === 'UNETLoader') return node(name, { unet_name: [[h3.modelFiles.unet]] });
  if (name === 'CLIPLoader') return node(name, {
    clip_name: [[h3.modelFiles.clip]],
    type: [['minimax']]
  });
  if (name === 'VAELoader') return node(name, {
    vae_name: [[h3.modelFiles.videoVae, h3.modelFiles.audioVae]]
  });
  if (name === 'LoraLoader') return node(name, { lora_name: [[]] });
  if (name === 'KSamplerSelect') return node(name, { sampler_name: [[h3.sampler]] });
  if (name === 'BasicScheduler') return node(name, { scheduler: [[h3.scheduler]] });
  if (name === 'MiniMaxH3ReferenceToVideo') return node(name, {
    length: ['INT', { min: 5, max: 3600, step: 17 }],
    ref_image_size: [[h3.referenceImageSize, 'max']]
  }, {
    ref_images: ['COMFY_AUTOGROW_V3', { template: {
      input: { required: { ref_image: ['IMAGE'] } },
      prefix: 'ref_image_',
      min: 0,
      max: 9
    } }]
  }, ['CONDITIONING', 'LATENT']);
  if (name === 'MiniMaxH3SigmaShift') return node(name, {
    shift_video: ['FLOAT', { min: 1, max: 100 }],
    shift_audio: ['FLOAT', { min: 1, max: 100 }]
  }, {}, ['MODEL']);
  if (name === 'ImageFromBatch') return node(name, {
    batch_index: ['INT', { min: 0, max: 8192 }],
    length: ['INT', { min: 1, max: 4096 }]
  }, {}, ['IMAGE']);
  return node(name);
}

function h3Request(bodyReferenceImage = managedBodyReference) {
  return {
    spec: 'mullet_portrait_request_v6',
    modelTemplate: PORTRAIT_H3_REFERENCE_TEMPLATE_ID,
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: '4:1234abcd',
      expression: 'fear',
      characterId: 'jenna-stannis',
      profileFingerprint: '1234abcd'
    },
    subject: 'Sally Knyvette portraying Jenna Stannis',
    setting: 'the Liberator flight deck',
    attire: 'a burgundy and silver-grey leather tunic',
    lora: null,
    referenceImage: canonicalReference,
    bodyReferenceImage,
    promptOverride: 'Create the same Jenna Stannis with a fearful expression on the Liberator flight deck.',
    aspectRatio: '9:16',
    megapixels: 0.5,
    seed: 17
  };
}

function h3Form(request = h3Request(), reference = managedBodyBytes) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  if (reference) form.append('reference', new Blob([reference], { type: 'image/png' }), 'untrusted.png');
  return form;
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

test('compiled portrait route rejects stale selectable expression contracts before ComfyUI', { timeout: 120_000 }, async (context) => {
  execFileSync(process.execPath, [resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BASE_PATH: '/mullet',
      BUILD_OUTPUT_DIR: buildDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const comfyState = {
    calls: [],
    bodyResident: false,
    uploads: 0,
    prompts: [],
    cancellations: [],
    badOutput: false
  };
  const comfyServer = createServer(async (incoming, response) => {
    const url = new URL(incoming.url ?? '/', 'http://fake-comfy');
    comfyState.calls.push({ path: url.pathname, method: incoming.method ?? 'GET' });
    const sendJson = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (url.pathname.startsWith('/object_info/')) {
      sendJson(200, capabilityResponse(decodeURIComponent(url.pathname.slice('/object_info/'.length))));
      return;
    }
    if (url.pathname === '/view') {
      const filename = url.searchParams.get('filename');
      if (filename === canonicalReference.name) {
        response.writeHead(200, { 'content-type': 'image/jpeg' });
        response.end(canonicalBytes);
        return;
      }
      if (filename === managedBodyReference.name) {
        if (!comfyState.bodyResident) {
          sendJson(404, { error: 'missing managed reference' });
          return;
        }
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(managedBodyBytes);
        return;
      }
      if (filename === 'portrait-h3_00001_.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(portraitOutputBytes);
        return;
      }
      sendJson(404, { error: 'unexpected view' });
      return;
    }
    if (url.pathname === '/upload/image' && incoming.method === 'POST') {
      for await (const _chunk of incoming) { /* consume multipart body */ }
      comfyState.uploads += 1;
      comfyState.bodyResident = true;
      sendJson(200, {
        name: managedBodyReference.name,
        subfolder: managedBodyReference.subfolder,
        type: managedBodyReference.type
      });
      return;
    }
    if (url.pathname === '/prompt' && incoming.method === 'POST') {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      comfyState.prompts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      sendJson(200, { prompt_id: ownedPromptId });
      return;
    }
    if (url.pathname === `/history/${ownedPromptId}`) {
      const image = { filename: 'portrait-h3_00001_.png', subfolder: 'mullet', type: 'output' };
      sendJson(200, {
        [ownedPromptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: { '28': { images: comfyState.badOutput ? [image, image] : [image] } }
        }
      });
      return;
    }
    if (url.pathname === `/api/jobs/${ownedPromptId}/cancel` && incoming.method === 'POST') {
      comfyState.cancellations.push(url.pathname);
      sendJson(200, { cancelled: true });
      return;
    }
    sendJson(500, { error: 'unexpected fake-Comfy request' });
  });
  let appServer;
  context.after(async () => {
    await close(appServer);
    await close(comfyServer);
  });
  const comfyBaseUrl = await listen(comfyServer);
  process.env.IMAGE_COMFY_BASE_URL = comfyBaseUrl;
  process.env.VIDEO_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.EXPRESSION_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BUILD_SHA = 'portrait-route-test';
  process.env.PUBLIC_BUILD_SHA = 'portrait-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);

  const requestBody = {
    spec: 'mullet_portrait_request_v6',
    modelTemplate: 'z-image-turbo-v1',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: '4:1234abcd',
      expression: 'joy'
    },
    subject: 'Jenna Stannis',
    setting: 'the Liberator flight deck',
    attire: 'a rust-red and deep maroon Liberator tunic',
    lora: null,
    referenceImage: null,
    bodyReferenceImage: null,
    aspectRatio: '1:1',
    megapixels: 0.5
  };
  const response = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicOrigin
    },
    body: JSON.stringify(requestBody)
  });
  assert.equal(response.status, 400, await response.text());

  const legacyResponse = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicOrigin
    },
    body: JSON.stringify({ ...requestBody, spec: 'mullet_portrait_request_v5', aspectRatio: '9:16' })
  });
  assert.equal(legacyResponse.status, 400, await legacyResponse.text());
  assert.equal(comfyState.calls.length, 0);

  const jsonH3 = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: publicOrigin },
    body: JSON.stringify(h3Request())
  });
  assert.equal(jsonH3.status, 400, await jsonH3.text());
  assert.equal(comfyState.calls.length, 0);

  const wrongReference = new Uint8Array(managedBodyBytes);
  wrongReference[wrongReference.length - 1] ^= 0xff;
  const wrongAttachment = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body: h3Form(h3Request(), wrongReference)
  });
  assert.equal(wrongAttachment.status, 400, await wrongAttachment.text());
  assert.equal(comfyState.calls.length, 0);

  const capabilitiesResponse = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    headers: { origin: publicOrigin }
  });
  const capabilitiesText = await capabilitiesResponse.text();
  assert.equal(capabilitiesResponse.status, 200, capabilitiesText);
  const capabilities = JSON.parse(capabilitiesText);
  assert.equal(capabilities.spec, 'mullet_portrait_capabilities_v6');
  const h3Capability = capabilities.templates.find(({ template }) => template.id === PORTRAIT_H3_REFERENCE_TEMPLATE_ID);
  assert.equal(h3Capability.available, true, JSON.stringify(h3Capability.missing));

  const generated = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body: h3Form()
  });
  assert.equal(generated.status, 200, await generated.text());
  assert.equal(generated.headers.get('content-type'), 'image/png');
  assert.equal(generated.headers.get('x-mullet-model-template'), PORTRAIT_H3_REFERENCE_TEMPLATE_ID);
  assert.equal(generated.headers.get('x-mullet-width'), '576');
  assert.equal(generated.headers.get('x-mullet-height'), '1024');
  assert.equal(comfyState.uploads, 1);
  assert.equal(comfyState.prompts.length, 1);
  const queued = comfyState.prompts[0];
  assert.equal(queued.client_id, 'mullet-portrait');
  assert.equal(queued.prompt['1'].inputs.unet_name, MINIMAX_H3_PORTRAIT_STILL_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['20'].inputs.length, 5);
  assert.equal(queued.prompt['20'].inputs.width, 576);
  assert.equal(queued.prompt['20'].inputs.height, 1024);
  assert.equal(queued.prompt['20'].inputs.ref_image_size, 'match');
  assert.equal(queued.prompt['20'].inputs.prompt.split('subject_definitions:').length, 2);
  assert.deepEqual(queued.prompt['27'].inputs, { image: ['26', 0], batch_index: 0, length: 1 });
  assert.equal(comfyState.cancellations.length, 0);

  comfyState.badOutput = true;
  const invalidOutput = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: { origin: publicOrigin },
    body: h3Form()
  });
  assert.equal(invalidOutput.status, 502, await invalidOutput.text());
  assert.deepEqual(comfyState.cancellations, [`/api/jobs/${ownedPromptId}/cancel`]);
  assert.equal(comfyState.calls.some(({ path }) => path === '/interrupt'), false);
});
