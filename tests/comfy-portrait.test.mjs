import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  buildPortraitRequest
} from '../src/lib/portrait.ts';
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
  aspectRatio: '1:1',
  megapixels: 0.5
});

function nodeInfo(node, input, options) {
  return { [node]: { input: { required: { [input]: [options] } } } };
}

function nodePresent(node) {
  return { [node]: { input: { required: {} } } };
}

function png(width = 704, height = 704) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

test('exposes only the compatible model assets and zimage LoRAs', async () => {
  const replies = [
    nodeInfo('UNETLoader', 'unet_name', ['z_image_turbo_int8_convrot.safetensors', 'flux-2-klein-9b-fp8.safetensors']),
    { CLIPLoader: { input: { required: {
      clip_name: [['qwen_3_4b.safetensors', 'qwen_3_8b_fp8mixed.safetensors']],
      type: [['lumina2', 'flux2']]
    } } } },
    nodeInfo('VAELoader', 'vae_name', ['ae.safetensors', 'full_encoder_small_decoder.safetensors']),
    nodeInfo('LoraLoader', 'lora_name', ['flux/other.safetensors', 'zimage/kristi6.safetensors']),
    ...FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.requiredNodes.map(nodePresent)
  ];
  let index = 0;
  const capabilities = await loadPortraitCapabilities(async () => Response.json(replies[index++]), 'http://comfy');
  assert.deepEqual(capabilities.loras, ['zimage/kristi6.safetensors']);
  assert.deepEqual(capabilities.aspectRatios, [{ id: '1:1', width: 1, height: 1, label: '1:1 fixed expression' }]);
  assert.equal(capabilities.megapixels[0], 0.5);
  assert.equal(capabilities.referenceTemplate.id, PORTRAIT_REFERENCE_TEMPLATE_ID);
});

test('verifies the Jenna reference bytes before queuing the FLUX.2 Klein 9B identity graph', async () => {
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
    aspectRatio: '1:1',
    megapixels: 0.5
  });
  const outputPng = png();
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
        outputs: { '18': { images: [{ filename: 'portrait-reference_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (url.includes('/view?')) return new Response(outputPng, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runComfyPortrait(fetcher, 'http://comfy', referenceRequest, 19790213);
  const queued = JSON.parse(observed[1].init.body);
  assert.equal(queued.prompt['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(queued.prompt['5'].class_type, 'ImageScaleToTotalPixels');
  assert.equal(queued.prompt['7'].class_type, 'CLIPTextEncode');
  assert.deepEqual(queued.prompt['9'].inputs, { conditioning: ['7', 0], latent: ['6', 0] });
  assert.deepEqual(queued.prompt['10'].inputs, { conditioning: ['8', 0], latent: ['6', 0] });
  assert.deepEqual(queued.prompt['11'].inputs, { width: 704, height: 704, batch_size: 1 });
  assert.equal(queued.prompt['12'].inputs.noise_seed, 19790213);
  assert.equal(result.filename, 'portrait-reference_00001_.png');

  const forged = { ...referenceRequest, referenceImage: { ...referenceRequest.referenceImage, sha256: '0'.repeat(64) } };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', forged, 1), /does not match its profile/);
});

test('queues, polls, and proxies only the fixed portrait output', async () => {
  const observed = [];
  const outputPng = png();
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
    if (url.includes('/view?')) return new Response(outputPng, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runComfyPortrait(fetcher, 'http://comfy/', request, 17);
  const queued = JSON.parse(observed[0].init.body);
  assert.equal(queued.client_id, 'mullet-portrait');
  assert.deepEqual(queued.prompt['7'].inputs, { width: 704, height: 704, batch_size: 1 });
  assert.equal(queued.prompt['8'].inputs.seed, 17);
  assert.equal(observed[2].url, 'http://comfy/view?filename=portrait_00001_.png&subfolder=mullet&type=output');
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(result.bytes, outputPng);
});

test('rejects a Comfy portrait whose PNG IHDR is not the requested fixed square', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: '11111111-1111-4111-8111-111111111111' });
    if (url.includes('/history/')) return Response.json({
      '11111111-1111-4111-8111-111111111111': {
        status: { completed: true, status_str: 'success' },
        outputs: { '10': { images: [{ filename: 'portrait_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (url.includes('/view?')) return new Response(png(704, 1056), { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', request, 17), /dimensions do not match/);
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
