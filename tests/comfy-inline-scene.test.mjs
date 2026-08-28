import assert from 'node:assert/strict';
import test from 'node:test';

import { Z_IMAGE_TURBO_SCENE_TEMPLATE, buildInlineSceneImageRequest, createInlineSceneResult } from '../src/lib/inline-scene.ts';
import { loadInlineSceneCapabilities, runComfyInlineScene, validateInlineScenePng } from '../src/lib/server/comfy-inline-scene.ts';

const promptId = '33333333-3333-4333-8333-333333333333';
const visualPrompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';

function request() {
  const result = createInlineSceneResult({
    spec: 'mullet_inline_scene_request_v1',
    kind: 'inline_scene',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: `sha256:${'a'.repeat(64)}`,
      turnFingerprint: `sha256:${'b'.repeat(64)}`
    },
    turns: [{ role: 'user', content: 'What happens?' }, { role: 'assistant', content: 'The ship tilts.' }]
  }, 'gemma-4-ortenzya', visualPrompt);
  return buildInlineSceneImageRequest(result, { lora: null, aspectRatio: '3:2', megapixels: 0.5 });
}

function node(name, required = {}) {
  return { [name]: { input: { required } } };
}

function info(name) {
  const files = Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles;
  if (name === 'UNETLoader') return node(name, { unet_name: [[files.unet]] });
  if (name === 'CLIPLoader') return node(name, { clip_name: [[files.clip]], type: [['lumina2']] });
  if (name === 'VAELoader') return node(name, { vae_name: [[files.vae]] });
  if (name === 'KSampler') return node(name, { sampler_name: [['res_multistep']], scheduler: [['simple']] });
  if (name === 'EmptySD3LatentImage') return node(name, { width: ['INT', { step: 16 }] });
  if (name === 'LoraLoader') return node(name, { lora_name: [['zimage/kristi6.safetensors']] });
  return node(name);
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

test('loads only metadata-verified Z-Image LoRAs with trigger words', async () => {
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.startsWith('/object_info/')) {
      const name = decodeURIComponent(parsed.pathname.slice('/object_info/'.length));
      return Response.json(info(name));
    }
    assert.equal(parsed.pathname, '/view_metadata/loras');
    return Response.json({ ss_base_model_version: 'zimage', ss_tag_frequency: '{"subject":{"kristibentler":7}}' });
  };
  const capabilities = await loadInlineSceneCapabilities(fetcher, 'http://comfy');
  assert.deepEqual(capabilities.loras, [{ path: 'zimage/kristi6.safetensors', trigger: 'kristibentler' }]);
});

test('queues the scene namespace and verifies exact output PNG dimensions and hash', async () => {
  const capabilities = {
    spec: 'mullet_inline_scene_capabilities_v1',
    template: Z_IMAGE_TURBO_SCENE_TEMPLATE,
    aspectRatios: [],
    megapixels: [],
    loras: []
  };
  const observed = [];
  const bytes = png();
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    observed.push({ path: parsed.pathname, init });
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
  const output = await runComfyInlineScene(fetcher, 'http://comfy', request(), capabilities, 42);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-inline-scene');
  assert.equal(queued.prompt['10'].inputs.filename_prefix, 'mullet/scene');
  assert.equal(output.promptId, promptId);
  assert.match(output.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => validateInlineScenePng(png(800, 600), 864, 576), /dimensions/);
});

test('targets only its queued Comfy job when execution fails', async () => {
  const calls = [];
  const capabilities = {
    spec: 'mullet_inline_scene_capabilities_v1',
    template: Z_IMAGE_TURBO_SCENE_TEMPLATE,
    aspectRatios: [],
    megapixels: [],
    loras: []
  };
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
  await assert.rejects(runComfyInlineScene(fetcher, 'http://comfy', request(), capabilities, 42), /execution failed/);
  assert.ok(calls.includes(`/api/jobs/${promptId}/cancel`));
  assert.ok(!calls.includes('/interrupt'));
});
