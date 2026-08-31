import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_CAPABILITIES_SPEC,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATES,
  QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneSourceForCompletedTurn
} from '../src/lib/inline-scene.ts';
import { loadInlineSceneCapabilities, runComfyInlineScene, validateInlineScenePng } from '../src/lib/server/comfy-inline-scene.ts';

const promptId = '33333333-3333-4333-8333-333333333333';
const visualPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const referenceBytes = Uint8Array.from([
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
  sha256: createHash('sha256').update(referenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const subjectLora = Object.freeze({
  path: 'zimage/jan6.safetensors',
  trigger: 'janpollock',
  modelHash: 'd'.repeat(64)
});

function request() {
  const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
  const turns = [{ role: 'user', content: 'What happens?' }, { role: 'assistant', content: 'The ship tilts.' }];
  const source = inlineSceneSourceForCompletedTurn(livingHistorySourceForMessages(conversationId, turns));
  const result = createInlineSceneResult(
    buildInlineSceneRequest(conversationId, turns, source),
    'gemma-4-ortenzya',
    visualPrompt
  );
  return buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    subject: 'Jan Pollock',
    referenceImage: null,
    lora: subjectLora,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
}

function qwenRequest() {
  const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
  const turns = [{ role: 'user', content: 'What happens?' }, { role: 'assistant', content: 'The ship tilts.' }];
  const source = inlineSceneSourceForCompletedTurn(livingHistorySourceForMessages(conversationId, turns));
  const result = createInlineSceneResult(
    buildInlineSceneRequest(conversationId, turns, source),
    'gemma-4-ortenzya',
    visualPrompt
  );
  return buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    subject: 'Jenna Stannis',
    referenceImage: canonicalReference,
    lora: null,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
}

function node(name, required = {}) {
  return { [name]: { input: { required } } };
}

function info(name) {
  const qwen = QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles;
  const zImage = Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles;
  if (name === 'UNETLoader') return node(name, { unet_name: [[zImage.unet, qwen.unet]] });
  if (name === 'CLIPLoader') return node(name, {
    clip_name: [[zImage.clip, qwen.clip]],
    type: [['lumina2', 'qwen_image']]
  });
  if (name === 'VAELoader') return node(name, { vae_name: [[zImage.vae, qwen.vae]] });
  if (name === 'LoraLoader') return node(name, { lora_name: [[subjectLora.path, 'other/ignored.safetensors']] });
  if (name === 'LoraLoaderModelOnly') return node(name, { lora_name: [[qwen.lora]] });
  if (name === 'KSampler') return node(name, {
    sampler_name: [[Z_IMAGE_TURBO_SCENE_TEMPLATE.sampler, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.sampler]],
    scheduler: [['simple']]
  });
  return node(name);
}

function capabilities() {
  return {
    spec: INLINE_SCENE_CAPABILITIES_SPEC,
    templates: INLINE_SCENE_TEMPLATES.map((template) => ({ template, available: true, missing: [] })),
    aspectRatios: [],
    megapixels: [],
    loras: [subjectLora.path]
  };
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

test('reports additive Z-Image and Qwen scene capabilities with the linked LoRA inventory', async () => {
  const queried = [];
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    assert.match(parsed.pathname, /^\/object_info\//);
    const name = decodeURIComponent(parsed.pathname.slice('/object_info/'.length));
    queried.push(name);
    return Response.json(info(name));
  };
  const capabilities = await loadInlineSceneCapabilities(fetcher, 'http://comfy');
  assert.equal(capabilities.spec, 'mullet_inline_scene_capabilities_v3');
  assert.deepEqual(capabilities.templates.map(({ template, available }) => [template.id, available]), [
    [INLINE_SCENE_TEMPLATE_ID, true],
    [INLINE_SCENE_QWEN_TEMPLATE_ID, true]
  ]);
  assert.equal(capabilities.templates[0].template.steps, Z_IMAGE_TURBO_SCENE_TEMPLATE.steps);
  assert.equal(capabilities.templates[1].template.modelFiles.lora, 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
  assert.deepEqual(capabilities.loras, [subjectLora.path]);
  const expectedNodes = new Set(INLINE_SCENE_TEMPLATES.flatMap((template) => [...template.requiredNodes]));
  assert.deepEqual(new Set(queried), expectedNodes);
  assert.equal(queried.length, expectedNodes.size);
});

test('keeps Z-Image available while marking the additive Qwen fallback unavailable', async () => {
  const capabilities = await loadInlineSceneCapabilities(async (url) => {
    const parsed = new URL(String(url));
    const name = decodeURIComponent(parsed.pathname.slice('/object_info/'.length));
    if (name === 'LoraLoaderModelOnly') return Response.json(node(name, { lora_name: [['other.safetensors']] }));
    return Response.json(info(name));
  }, 'http://comfy');
  const zImage = capabilities.templates.find(({ template }) => template.id === INLINE_SCENE_TEMPLATE_ID);
  const qwen = capabilities.templates.find(({ template }) => template.id === INLINE_SCENE_QWEN_TEMPLATE_ID);
  assert.equal(zImage.available, true);
  assert.equal(qwen.available, false);
  assert.deepEqual(qwen.missing, [`model:lora:${QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora}`]);
});

test('queues the Z-Image LoRA scene without fetching a reference and verifies its PNG', async () => {
  const available = capabilities();
  const observed = [];
  const bytes = png();
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    observed.push({ path: parsed.pathname, filename: parsed.searchParams.get('filename'), init });
    if (parsed.pathname === '/prompt') return Response.json({ prompt_id: promptId, node_errors: {} });
    if (parsed.pathname === `/history/${promptId}`) return Response.json({
      [promptId]: {
        status: { completed: true, status_str: 'success' },
        outputs: { '10': { images: [{ filename: 'scene_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (parsed.pathname === '/view') return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected ${parsed.pathname}`);
  };
  const output = await runComfyInlineScene(fetcher, 'http://comfy', request(), available, 42);
  const queuedCall = observed.find(({ path }) => path === '/prompt');
  assert.ok(queuedCall);
  const queued = JSON.parse(queuedCall.init.body);
  assert.equal(queued.client_id, 'mullet-inline-scene');
  assert.equal(queued.prompt['11'].inputs.lora_name, subjectLora.path);
  assert.match(queued.prompt['4'].inputs.text, /janpollock represents Jan Pollock/);
  assert.equal(queued.prompt['8'].inputs.steps, Z_IMAGE_TURBO_SCENE_TEMPLATE.steps);
  assert.equal(queued.prompt['10'].inputs.filename_prefix, 'mullet/scene');
  assert.equal(observed.some(({ path, filename }) => path === '/view' && filename === 'scene_00001_.png'), true);
  assert.equal(observed.some(({ path, filename }) => path === '/view' && filename === canonicalReference.name), false);
  assert.equal(output.promptId, promptId);
  assert.match(output.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => validateInlineScenePng(png(800, 600), 864, 576), /dimensions/);
});

test('retains Qwen reference fetching and the fixed four-step fallback graph', async () => {
  const available = capabilities();
  const observed = [];
  const bytes = png();
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    observed.push({ pathname: parsed.pathname, filename: parsed.searchParams.get('filename'), init });
    if (parsed.pathname === '/view' && parsed.searchParams.get('filename') === canonicalReference.name) {
      return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (parsed.pathname === '/prompt') return Response.json({ prompt_id: promptId, node_errors: {} });
    if (parsed.pathname === `/history/${promptId}`) return Response.json({
      [promptId]: {
        status: { completed: true, status_str: 'success' },
        outputs: { '14': { images: [{ filename: 'scene_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (parsed.pathname === '/view') return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected ${parsed.pathname}`);
  };
  await runComfyInlineScene(fetcher, 'http://comfy', qwenRequest(), available, 42);
  const queued = JSON.parse(observed.find(({ pathname }) => pathname === '/prompt').init.body);
  assert.equal(observed.some(({ pathname, filename }) => pathname === '/view' && filename === canonicalReference.name), true);
  assert.equal(queued.prompt['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(queued.prompt['8'].inputs.lora_name, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora);
  assert.equal(queued.prompt['12'].inputs.steps, 4);
  assert.equal(queued.prompt['14'].inputs.filename_prefix, 'mullet/scene');
});

test('targets only its queued Comfy job when execution fails', async () => {
  const calls = [];
  const available = capabilities();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    calls.push(parsed.pathname);
    if (parsed.pathname === '/prompt') return Response.json({ prompt_id: promptId, node_errors: {} });
    if (parsed.pathname === `/history/${promptId}`) return Response.json({
      [promptId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
    });
    if (parsed.pathname === `/api/jobs/${promptId}/cancel`) return Response.json({ cancelled: true });
    throw new Error(`unexpected ${parsed.pathname}`);
  };
  await assert.rejects(runComfyInlineScene(fetcher, 'http://comfy', request(), available, 42), /execution failed/);
  assert.ok(calls.includes(`/api/jobs/${promptId}/cancel`));
  assert.ok(!calls.includes('/interrupt'));
});
