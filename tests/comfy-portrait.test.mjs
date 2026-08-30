import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE,
  MAGE_FLOW_EDIT_REFERENCE_TEMPLATE,
  PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
  PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_TEMPLATE_ID,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildPortraitRequest
} from '../src/lib/portrait.ts';
import { loadPortraitCapabilities, runComfyPortrait } from '../src/lib/server/comfy-portrait.ts';

const expression = {
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
};

const ownedPromptId = '77777777-7777-4777-8777-777777777777';

function zImageRequest(overrides = {}) {
  return buildPortraitRequest(expression, {
    subject: 'Jenna Stannis',
    setting: 'the Liberator',
    attire: 'flight clothes',
    lora: null,
    aspectRatio: '9:16',
    megapixels: 0.5,
    ...overrides
  });
}

function nodeInfo(node, input, options) {
  return { [node]: { input: { required: { [input]: [options] } } } };
}

function nodePresent(node) {
  return { [node]: { input: { required: {} } } };
}

function png(width = 576, height = 1024) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpeg(width = 400, height = 600) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

function referenceRequest(modelTemplate, referenceBytes, overrides = {}) {
  return buildPortraitRequest({ ...expression, output: { expression: 'fear' } }, {
    modelTemplate,
    subject: 'Sally Knyvette portraying Jenna Stannis',
    setting: 'the Liberator flight deck',
    attire: 'a burgundy and silver-grey leather tunic',
    lora: null,
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: createHash('sha256').update(referenceBytes).digest('hex'),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    characterId: 'jenna-stannis',
    profileFingerprint: '1234abcd',
    aspectRatio: '9:16',
    megapixels: 0.5,
    ...overrides
  });
}

test('exposes all four image models additively and retains exact missing diagnostics', async () => {
  const objectInfo = async (input) => {
    const node = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1));
    if (node === 'UNETLoader') {
      return Response.json(nodeInfo(node, 'unet_name', [
        Z_IMAGE_TURBO_TEMPLATE.modelFiles.unet,
        QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet,
        FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.modelFiles.unet
      ]));
    }
    if (node === 'CLIPLoader') {
      return Response.json({ CLIPLoader: { input: { required: {
        clip_name: [[
          Z_IMAGE_TURBO_TEMPLATE.modelFiles.clip,
          QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.clip,
          FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.modelFiles.clip,
          MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.clip
        ]],
        type: [['lumina2', 'qwen_image', 'flux2', 'mage']]
      } } } });
    }
    if (node === 'VAELoader') {
      return Response.json(nodeInfo(node, 'vae_name', [
        Z_IMAGE_TURBO_TEMPLATE.modelFiles.vae,
        QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.vae,
        FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.modelFiles.vae,
        MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.vae
      ]));
    }
    if (node === 'LoraLoader') {
      return Response.json(nodeInfo(node, 'lora_name', [
        'flux/other.safetensors',
        'zimage/kristi6.safetensors',
        QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.lora
      ]));
    }
    return Response.json(nodePresent(node));
  };

  const capabilities = await loadPortraitCapabilities(objectInfo, 'http://comfy');
  assert.deepEqual(capabilities.loras, ['zimage/kristi6.safetensors']);
  assert.deepEqual(capabilities.aspectRatios, [{ id: '9:16', width: 9, height: 16, label: '9:16 fixed expression' }]);
  assert.equal(capabilities.megapixels[0], 0.5);
  assert.deepEqual(capabilities.templates.map(({ template }) => template.id), [
    PORTRAIT_TEMPLATE_ID,
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
    PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
  ]);
  assert.equal(capabilities.templates[0].available, true);
  assert.equal(capabilities.templates[1].available, true);
  assert.equal(capabilities.templates[2].available, true);
  assert.equal(capabilities.templates[3].available, false);
  assert.deepEqual(capabilities.templates[3].missing, [
    `model:unet:${MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.unet}`
  ]);
  assert.equal(capabilities.templates[2].template.modelFiles.unet, 'flux-2-klein-9b-kv-int8-convrot.safetensors');
});

test('dispatches Z-Image, Qwen, FLUX.2 Klein INT8 ConvRot, and Mage through distinct workflows', async () => {
  const referenceBytes = jpeg();
  const cases = [
    {
      id: PORTRAIT_TEMPLATE_ID,
      request: zImageRequest(),
      outputNode: '10',
      filename: 'portrait_00001_.png',
      inspect: (graph) => {
        assert.equal(graph['1'].inputs.unet_name, Z_IMAGE_TURBO_TEMPLATE.modelFiles.unet);
        assert.deepEqual(graph['7'].inputs, { width: 576, height: 1024, batch_size: 1 });
      }
    },
    {
      id: PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
      request: referenceRequest(PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID, referenceBytes),
      outputNode: '14',
      filename: 'portrait-reference_00001_.png',
      inspect: (graph) => {
        assert.equal(graph['1'].inputs.unet_name, QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
        assert.deepEqual(graph['5'].inputs, {
          image: ['4', 0], upscale_method: 'lanczos', width: 576, height: 1024, crop: 'center'
        });
        assert.deepEqual(graph['9'].inputs.image1, ['5', 0]);
        assert.deepEqual(graph['11'].inputs.pixels, ['5', 0]);
        assert.deepEqual(graph['14'].inputs.images, ['13', 0]);
        assert.equal(graph['15'], undefined);
      }
    },
    {
      id: PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
      request: referenceRequest(PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID, referenceBytes),
      outputNode: '18',
      filename: 'portrait-reference_00001_.png',
      inspect: (graph) => {
        assert.equal(graph['1'].inputs.unet_name, 'flux-2-klein-9b-kv-int8-convrot.safetensors');
        assert.deepEqual(graph['11'].inputs, { width: 576, height: 1024, batch_size: 1 });
      }
    },
    {
      id: PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
      request: referenceRequest(PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID, referenceBytes),
      outputNode: '8',
      filename: 'portrait-reference_00001_.png',
      inspect: (graph) => {
        assert.equal(graph['1'].inputs.unet_name, MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
        assert.equal(graph['5'].inputs.width, 576);
        assert.equal(graph['5'].inputs.height, 1024);
      }
    }
  ];

  for (const candidate of cases) {
    let queued;
    let identityFetches = 0;
    let cancellations = 0;
    const fetcher = async (input, init) => {
      const url = String(input);
      if (url.includes('/view?filename=jenna-stannis-v1.jpg')) {
        identityFetches += 1;
        return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
      }
      if (url.endsWith('/prompt')) {
        queued = JSON.parse(init.body);
        return Response.json({ prompt_id: '22222222-2222-4222-8222-222222222222' });
      }
      if (url.includes('/history/')) return Response.json({
        '22222222-2222-4222-8222-222222222222': {
          status: { completed: true, status_str: 'success' },
          outputs: { [candidate.outputNode]: { images: [{ filename: candidate.filename, subfolder: 'mullet', type: 'output' }] } }
        }
      });
      if (url.includes('/view?')) return new Response(png(), { headers: { 'content-type': 'image/png' } });
      if (url.includes('/api/jobs/')) {
        cancellations += 1;
        return Response.json({ cancelled: true });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await runComfyPortrait(fetcher, 'http://comfy', candidate.request, 19790213);
    assert.equal(queued.client_id, 'mullet-portrait', candidate.id);
    candidate.inspect(queued.prompt);
    assert.equal(identityFetches, candidate.id === PORTRAIT_TEMPLATE_ID ? 0 : 1, candidate.id);
    assert.equal(cancellations, 0, `${candidate.id} must not cancel after validated success`);
    assert.equal(result.filename, candidate.filename, candidate.id);
    assert.deepEqual(result.bytes, png(), candidate.id);
  }
});

test('rejects identity-reference hash and exact geometry mismatches before queue submission', async () => {
  const referenceBytes = jpeg(400, 600);
  let promptCalls = 0;
  const fetcher = async (input) => {
    const url = String(input);
    if (url.includes('/view?filename=jenna-stannis-v1.jpg')) {
      return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.endsWith('/prompt')) {
      promptCalls += 1;
      return Response.json({ prompt_id: '22222222-2222-4222-8222-222222222222' });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const valid = referenceRequest(PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID, referenceBytes);
  const forgedHash = {
    ...valid,
    referenceImage: { ...valid.referenceImage, sha256: '0'.repeat(64) }
  };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', forgedHash, 1), /does not match its profile/);

  const forgedGeometry = {
    ...valid,
    referenceImage: { ...valid.referenceImage, width: 800, height: 1200, aspectRatio: '2:3' }
  };
  await assert.rejects(
    runComfyPortrait(fetcher, 'http://comfy', forgedGeometry, 1),
    /dimensions 400x600 do not match profile dimensions 800x1200/
  );
  assert.equal(promptCalls, 0);
});

test('rejects a Comfy portrait whose PNG IHDR is not the requested fixed 9:16 frame', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: '11111111-1111-4111-8111-111111111111' });
    if (url.includes('/history/')) return Response.json({
      '11111111-1111-4111-8111-111111111111': {
        status: { completed: true, status_str: 'success' },
        outputs: { '10': { images: [{ filename: 'portrait_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (url.includes('/view?')) return new Response(png(576, 960), { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected URL ${url}`);
  };
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17), /dimensions do not match/);
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
  await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17), /unexpected portrait filename/);
});

function successfulHistory(filename = 'portrait_00001_.png') {
  return Response.json({
    [ownedPromptId]: {
      status: { completed: true, status_str: 'success' },
      outputs: { '10': { images: [{ filename, subfolder: 'mullet', type: 'output' }] } }
    }
  });
}

test('cancels exactly its owned incomplete portrait on every history, fetch, and validation failure', async () => {
  const cases = [
    {
      name: 'history HTTP failure',
      history: () => new Response('unavailable', { status: 503 }),
      output: null,
      expected: /history query failed \(503\)/
    },
    {
      name: 'history execution failure',
      history: () => Response.json({
        [ownedPromptId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
      }),
      output: null,
      expected: /portrait execution failed/
    },
    {
      name: 'history output validation failure',
      history: () => successfulHistory('../secret.png'),
      output: null,
      expected: /unexpected portrait filename/
    },
    {
      name: 'output fetch failure',
      history: () => successfulHistory(),
      output: () => new Response('unavailable', { status: 502 }),
      expected: /image fetch failed \(502\)/
    },
    {
      name: 'output media validation failure',
      history: () => successfulHistory(),
      output: () => new Response(png(), { headers: { 'content-type': 'image/jpeg' } }),
      expected: /output is not a PNG/
    },
    {
      name: 'output byte validation failure',
      history: () => successfulHistory(),
      output: () => new Response(new Uint8Array(8), { headers: { 'content-type': 'image/png' } }),
      expected: /output has an invalid size/
    },
    {
      name: 'output dimension validation failure',
      history: () => successfulHistory(),
      output: () => new Response(png(576, 960), { headers: { 'content-type': 'image/png' } }),
      expected: /dimensions do not match/
    }
  ];

  for (const candidate of cases) {
    const calls = [];
    const fetcher = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? 'GET' });
      if (url.pathname === '/prompt') return Response.json({ prompt_id: ownedPromptId });
      if (url.pathname === `/history/${ownedPromptId}`) return candidate.history();
      if (url.pathname === '/view' && candidate.output) return candidate.output();
      if (url.pathname === `/api/jobs/${ownedPromptId}/cancel`) return Response.json({ cancelled: true });
      throw new Error(`unexpected URL ${url}`);
    };

    await assert.rejects(
      runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17),
      candidate.expected,
      candidate.name
    );
    assert.deepEqual(
      calls.filter(({ path }) => path.includes('/cancel')),
      [{ path: `/api/jobs/${ownedPromptId}/cancel`, method: 'POST' }],
      candidate.name
    );
    assert.equal(calls.some(({ path }) => path === '/interrupt'), false, candidate.name);
  }
});

test('uses an independent cancellation signal when the caller aborts or times out after ownership', async () => {
  for (const reason of [
    new DOMException('caller cancelled', 'AbortError'),
    new DOMException('portrait deadline elapsed', 'TimeoutError')
  ]) {
    const controller = new AbortController();
    const cancellations = [];
    const fetcher = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/prompt') return Response.json({ prompt_id: ownedPromptId });
      if (url.pathname === `/history/${ownedPromptId}`) {
        controller.abort(reason);
        return Response.json({});
      }
      if (url.pathname === `/api/jobs/${ownedPromptId}/cancel`) {
        cancellations.push({ method: init?.method, signal: init?.signal });
        return Response.json({ cancelled: true });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    await assert.rejects(
      runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17, controller.signal),
      (cause) => cause === reason
    );
    assert.equal(cancellations.length, 1, reason.name);
    assert.equal(cancellations[0].method, 'POST', reason.name);
    assert.notEqual(cancellations[0].signal, controller.signal, reason.name);
    assert.equal(cancellations[0].signal.aborted, false, reason.name);
  }
});

test('never cancels before Comfy returns a valid owned prompt ID', async () => {
  const queueReplies = [
    () => new Response('unavailable', { status: 503 }),
    () => Response.json({ prompt_id: 'not-an-owned-prompt-id' })
  ];
  for (const queueReply of queueReplies) {
    const cancellations = [];
    const fetcher = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/prompt') return queueReply();
      if (url.pathname.includes('/cancel')) {
        cancellations.push(url.pathname);
        return Response.json({ cancelled: true });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    await assert.rejects(runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17));
    assert.deepEqual(cancellations, []);
  }
});

test('preserves the original portrait failure when targeted cancellation also fails', async () => {
  let cancellations = 0;
  const fetcher = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/prompt') return Response.json({ prompt_id: ownedPromptId });
    if (url.pathname === `/history/${ownedPromptId}`) return Response.json({
      [ownedPromptId]: { status: { completed: true, status_str: 'error' }, outputs: {} }
    });
    if (url.pathname === `/api/jobs/${ownedPromptId}/cancel`) {
      cancellations += 1;
      throw new Error('cancellation transport failed');
    }
    throw new Error(`unexpected URL ${url}`);
  };

  await assert.rejects(
    runComfyPortrait(fetcher, 'http://comfy', zImageRequest(), 17),
    /portrait execution failed/
  );
  assert.equal(cancellations, 1);
});
