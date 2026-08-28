import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { PORTRAIT_REFERENCE_TEMPLATE_ID, buildPortraitRequest } from '../src/lib/portrait.ts';
import { loadPortraitCapabilities, runComfyPortrait } from '../src/lib/server/comfy-portrait.ts';

const request = buildPortraitRequest({
  spec: 'mullet_sidecar_result_v1',
  kind: 'expression',
  source: {
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    messageCount: 2,
    messageIndex: 1,
    role: 'assistant',
    fingerprint: '4:1234abcd'
  },
  model: 'gemma-4-ortenzya',
  output: { expression: 'joy' }
}, {
  subject: 'Jenna Stannis',
  setting: 'the Liberator',
  attire: 'flight clothes',
  lora: null,
  aspectRatio: '2:3',
  megapixels: 0.9
});

function nodeInfo(node, input, options) {
  return { [node]: { input: { required: { [input]: [options] } } } };
}

function nodePresent(node) {
  return { [node]: { input: { required: {} } } };
}

test('exposes only the compatible model assets and zimage LoRAs', async () => {
  const replies = [
    nodeInfo('UNETLoader', 'unet_name', ['z_image_turbo_int8_convrot.safetensors', 'mage_flow_edit_turbo_int8_convrot.safetensors']),
    { CLIPLoader: { input: { required: {
      clip_name: [['qwen_3_4b.safetensors', 'qwen3vl_4b_bf16.safetensors']],
      type: [['lumina2', 'mage']]
    } } } },
    nodeInfo('VAELoader', 'vae_name', ['ae.safetensors', 'mage_flow_vae_bf16.safetensors']),
    nodeInfo('LoraLoader', 'lora_name', ['flux/other.safetensors', 'zimage/kristi6.safetensors']),
    nodePresent('LoadImage'),
    nodePresent('TextEncodeMageFlowEdit'),
    nodePresent('KSampler'),
    nodePresent('VAEDecode'),
    nodePresent('SaveImage')
  ];
  let index = 0;
  const capabilities = await loadPortraitCapabilities(async () => Response.json(replies[index++]), 'http://comfy');
  assert.deepEqual(capabilities.loras, ['zimage/kristi6.safetensors']);
  assert.deepEqual(capabilities.aspectRatios, [{ id: '2:3', width: 2, height: 3, label: '2:3 fixed portrait' }]);
  assert.equal(capabilities.referenceTemplate.id, PORTRAIT_REFERENCE_TEMPLATE_ID);
});

test('verifies the Jenna reference bytes before queuing the Mage-Flow identity graph', async () => {
  const referenceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const referenceSha256 = createHash('sha256').update(referenceBytes).digest('hex');
  const referenceRequest = buildPortraitRequest({
    spec: 'mullet_sidecar_result_v1',
    kind: 'expression',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      role: 'assistant',
      fingerprint: '4:1234abcd'
    },
    model: 'gemma-4-ortenzya',
    output: { expression: 'fear' }
  }, {
    modelTemplate: PORTRAIT_REFERENCE_TEMPLATE_ID,
    subject: 'Sally Knyvette portraying Jenna Stannis',
    setting: 'the Liberator flight deck',
    attire: 'a burgundy and silver-grey leather tunic',
    lora: null,
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: referenceSha256
    },
    characterId: 'jenna-stannis',
    profileFingerprint: '1234abcd',
    aspectRatio: '2:3',
    megapixels: 0.9
  });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const observed = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    observed.push({ url, init });
    if (url.includes('/view?filename=jenna-stannis-v1.jpg')) {
      return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: '22222222-2222-4222-8222-222222222222' });
    if (url.includes('/history/')) return Response.json({
      '22222222-2222-4222-8222-222222222222': {
        status: { completed: true, status_str: 'success' },
        outputs: { '8': { images: [{ filename: 'portrait-reference_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (url.includes('/view?')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runComfyPortrait(fetcher, 'http://comfy', referenceRequest, 19790213);
  const queued = JSON.parse(observed[1].init.body);
  assert.equal(queued.prompt['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(queued.prompt['5'].class_type, 'TextEncodeMageFlowEdit');
  assert.equal(queued.prompt['5'].inputs.width, 768);
  assert.equal(queued.prompt['5'].inputs.height, 1152);
  assert.equal(queued.prompt['6'].inputs.seed, 19790213);
  assert.equal(result.filename, 'portrait-reference_00001_.png');

  const forged = { ...referenceRequest, referenceImage: { ...referenceRequest.referenceImage, sha256: '0'.repeat(64) } };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', forged, 1), /does not match its profile/);
});

test('queues, polls, and proxies only the fixed portrait output', async () => {
  const observed = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetcher = async (input, init) => {
    const url = String(input);
    observed.push({ url, init });
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: '11111111-1111-4111-8111-111111111111' });
    if (url.includes('/history/')) return Response.json({
      '11111111-1111-4111-8111-111111111111': {
        status: { completed: true, status_str: 'success' },
        outputs: { '10': { images: [{ filename: 'portrait_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (url.includes('/view?')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runComfyPortrait(fetcher, 'http://comfy/', request, 17);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait');
  assert.equal(queued.prompt['8'].inputs.seed, 17);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait_00001_.png&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(result.bytes, png);
});

test('rejects a history result outside the fixed output location', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: '11111111-1111-4111-8111-111111111111' });
    return Response.json({
      '11111111-1111-4111-8111-111111111111': {
        status: { completed: true, status_str: 'success' },
        outputs: { '10': { images: [{ filename: '../secret.png', subfolder: '', type: 'output' }] } }
      }
    });
  };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', request, 17), /unexpected portrait filename/);
});
