import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
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
import {
  loadInlineSceneCapabilities,
  runComfyInlineScene,
  uploadInlineSceneContinuityMasterInput,
  validateInlineScenePng
} from '../src/lib/server/comfy-inline-scene.ts';

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
const callyReferenceBytes = Uint8Array.from([...referenceBytes, 0x01]);
const servalanReferenceBytes = Uint8Array.from([...referenceBytes, 0x02]);
const bodyReferenceBytes = Uint8Array.from([...referenceBytes, 0x03]);
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(referenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const callyReference = Object.freeze({
  name: 'cally-v2.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(callyReferenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const servalanReference = Object.freeze({
  name: 'servalan-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(servalanReferenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const bodyReference = Object.freeze({
  name: 'jenna-stannis-body-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(bodyReferenceBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const candidates = Object.freeze([
  Object.freeze({
    id: 'jenna-stannis', displayName: 'Jenna Stannis', aliases: Object.freeze(['Jenna']), profileFingerprint: 'a'.repeat(8)
  }),
  Object.freeze({
    id: 'cally', displayName: 'Cally', aliases: Object.freeze(['Cally']), profileFingerprint: 'b'.repeat(8)
  }),
  Object.freeze({
    id: 'servalan', displayName: 'Servalan', aliases: Object.freeze(['Servalan']), profileFingerprint: 'c'.repeat(8)
  })
]);
const identities = Object.freeze([
  Object.freeze({
    profileId: 'jenna-stannis',
    profileFingerprint: candidates[0].profileFingerprint,
    displayName: candidates[0].displayName,
    subject: 'Sally Knyvette portraying Jenna Stannis',
    referenceImage: canonicalReference,
    bodyReferenceImage: null
  }),
  Object.freeze({
    profileId: 'cally',
    profileFingerprint: candidates[1].profileFingerprint,
    displayName: candidates[1].displayName,
    subject: 'Jan Chappell portraying Cally',
    referenceImage: callyReference,
    bodyReferenceImage: null
  }),
  Object.freeze({
    profileId: 'servalan',
    profileFingerprint: candidates[2].profileFingerprint,
    displayName: candidates[2].displayName,
    subject: 'Jacqueline Pearce portraying Servalan',
    referenceImage: servalanReference,
    bodyReferenceImage: null
  })
]);
const subjectLora = Object.freeze({
  path: 'zimage/jenna6.safetensors',
  trigger: 'jennastannis',
  modelHash: 'd'.repeat(64)
});

// One-to-one by design (operator order, 2026-09-03): the director picks exactly one of
// the candidates, so every scene request carries a solo cast.
function cast(index = 0) {
  return { kind: 'solo', identities: [identities[index]] };
}

function request() {
  const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
  const turns = [{ role: 'user', content: 'What happens?' }, { role: 'assistant', content: 'The ship tilts.' }];
  const source = inlineSceneSourceForCompletedTurn(transcriptSourceForMessages(conversationId, turns));
  const result = createInlineSceneResult(
    buildInlineSceneRequest(conversationId, turns, source, candidates),
    'gemma-4-ortenzya',
    { prompt: visualPrompt, subjectIds: ['jenna-stannis'] }
  );
  return buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: cast(),
    lora: subjectLora,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
}

// The Qwen path is what a solo subject without a trained LoRA renders on.
function qwenRequest(index = 0) {
  const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
  const turns = [{ role: 'user', content: 'What happens?' }, { role: 'assistant', content: 'The ship tilts.' }];
  const source = inlineSceneSourceForCompletedTurn(transcriptSourceForMessages(conversationId, turns));
  const result = createInlineSceneResult(
    buildInlineSceneRequest(conversationId, turns, source, candidates),
    'gemma-4-ortenzya',
    { prompt: visualPrompt, subjectIds: [candidates[index].id] }
  );
  return buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    cast: cast(index),
    lora: null,
    aspectRatio: '3:2',
    megapixels: 0.5
  });
}


// The player's scene partner changed between turns: the previous Jenna scene is the
// continuity master and Cally is the identity the edit newly introduces.
function continuityRequest() {
  const base = qwenRequest(1);
  return {
    ...base,
    continuityMaster: {
      requestKey: `sha256:${'2'.repeat(64)}`,
      promptId: '44444444-4444-4444-8444-444444444444',
      seed: 42,
      generatedAt: 1_700_000_000_000,
      width: 864,
      height: 576,
      imageSha256: '9'.repeat(64),
      cast: [{
        profileId: 'jenna-stannis',
        profileFingerprint: candidates[0].profileFingerprint
      }]
    }
  };
}

function uploadedMaster(requestValue = continuityRequest()) {
  return {
    name: 'scene-continuity-55555555-5555-4555-8555-555555555555.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: requestValue.continuityMaster.imageSha256,
    width: requestValue.continuityMaster.width,
    height: requestValue.continuityMaster.height
  };
}

function node(name, required = {}, optional = {}) {
  return { [name]: { input: { required, optional } } };
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
  if (name === 'TextEncodeQwenImageEditPlus') return node(name, {}, {
    image1: ['IMAGE'],
    image2: ['IMAGE'],
    image3: ['IMAGE']
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





test('requires all three optional IMAGE inputs before advertising Qwen scene support', async () => {
  for (const missingInput of ['image1', 'image2', 'image3']) {
    const capabilities = await loadInlineSceneCapabilities(async (url) => {
      const parsed = new URL(String(url));
      const name = decodeURIComponent(parsed.pathname.slice('/object_info/'.length));
      if (name !== 'TextEncodeQwenImageEditPlus') return Response.json(info(name));
      return Response.json(node(name, {}, Object.fromEntries(
        ['image1', 'image2', 'image3']
          .filter((inputName) => inputName !== missingInput)
          .map((inputName) => [inputName, ['IMAGE']])
      )));
    }, 'http://comfy');
    const zImage = capabilities.templates.find(({ template }) => template.id === INLINE_SCENE_TEMPLATE_ID);
    const qwen = capabilities.templates.find(({ template }) => template.id === INLINE_SCENE_QWEN_TEMPLATE_ID);
    assert.equal(zImage.available, true);
    assert.equal(qwen.available, false);
    assert.deepEqual(qwen.missing, [
      `node-input:TextEncodeQwenImageEditPlus:optional:${missingInput}:IMAGE`
    ]);
  }
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
  assert.match(queued.prompt['4'].inputs.text, /jennastannis represents Sally Knyvette portraying Jenna Stannis/);
  assert.equal(queued.prompt['8'].inputs.steps, Z_IMAGE_TURBO_SCENE_TEMPLATE.steps);
  assert.equal(queued.prompt['10'].inputs.filename_prefix, 'mullet/scene');
  assert.equal(observed.some(({ path, filename }) => path === '/view' && filename === 'scene_00001_.png'), true);
  assert.equal(observed.some(({ path, filename }) => path === '/view' && filename === canonicalReference.name), false);
  assert.equal(output.promptId, promptId);
  assert.match(output.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => validateInlineScenePng(png(800, 600), 864, 576), /dimensions/);
});

test('fetches and verifies the solo Qwen reference before queueing its exact image slot', async () => {
  const available = capabilities();
  const bytes = png();
  const referencePayloads = new Map([[canonicalReference.name, referenceBytes]]);
  const observed = [];
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const filename = parsed.searchParams.get('filename');
    observed.push({ pathname: parsed.pathname, filename, init });
    if (parsed.pathname === '/view' && referencePayloads.has(filename)) {
      return new Response(referencePayloads.get(filename), { headers: { 'content-type': 'image/jpeg' } });
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
  assert.deepEqual(
    observed
      .filter(({ pathname, filename }) => pathname === '/view' && referencePayloads.has(filename))
      .map(({ filename }) => filename),
    [canonicalReference.name]
  );
  assert.equal(queued.prompt['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(queued.prompt['8'].inputs.lora_name, QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora);
  assert.equal(queued.prompt['12'].inputs.steps, 4);
  assert.equal(queued.prompt['14'].inputs.filename_prefix, 'mullet/scene');
  // One subject means one occupied picture slot; nothing else is bound.
  assert.equal(Object.hasOwn(queued.prompt['9'].inputs, 'image2'), false);
  assert.equal(Object.hasOwn(queued.prompt['9'].inputs, 'image3'), false);
  assert.equal(observed.some(({ filename }) => filename === callyReference.name), false);
});


test('fetches and verifies a selected body and wardrobe reference before queueing it in a free Qwen slot', async () => {
  const available = capabilities();
  const base = qwenRequest();
  const requestValue = {
    ...base,
    cast: {
      kind: 'solo',
      identities: [{ ...base.cast.identities[0], bodyReferenceImage: bodyReference }]
    }
  };
  const outputBytes = png();
  const referencePayloads = new Map([
    [canonicalReference.name, referenceBytes],
    [bodyReference.name, bodyReferenceBytes]
  ]);
  const observed = [];
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const filename = parsed.searchParams.get('filename');
    observed.push({ pathname: parsed.pathname, filename, init });
    if (parsed.pathname === '/view' && referencePayloads.has(filename)) {
      return new Response(referencePayloads.get(filename), { headers: { 'content-type': 'image/jpeg' } });
    }
    if (parsed.pathname === '/prompt') return Response.json({ prompt_id: promptId, node_errors: {} });
    if (parsed.pathname === `/history/${promptId}`) return Response.json({
      [promptId]: {
        status: { completed: true, status_str: 'success' },
        outputs: { '14': { images: [{ filename: 'scene_00001_.png', subfolder: 'mullet', type: 'output' }] } }
      }
    });
    if (parsed.pathname === '/view') return new Response(outputBytes, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected ${parsed.pathname}`);
  };

  await runComfyInlineScene(fetcher, 'http://comfy', requestValue, available, 42);
  const promptIndex = observed.findIndex(({ pathname }) => pathname === '/prompt');
  assert.ok(promptIndex > 0);
  assert.deepEqual(
    observed.slice(0, promptIndex).map(({ filename }) => filename),
    [canonicalReference.name, bodyReference.name]
  );
  const queued = JSON.parse(observed[promptIndex].init.body);
  assert.equal(queued.prompt['4'].inputs.image, `mullet/identity/${canonicalReference.name}`);
  assert.equal(queued.prompt['16'].inputs.image, `mullet/identity/${bodyReference.name}`);
  assert.deepEqual(queued.prompt['9'].inputs.image2, ['16', 0]);
  assert.match(queued.prompt['9'].inputs.prompt, /Picture 2 is the body and wardrobe reference for Jenna Stannis/);

  const tamperedCalls = [];
  await assert.rejects(
    runComfyInlineScene(async (url) => {
      const parsed = new URL(String(url));
      tamperedCalls.push({ pathname: parsed.pathname, filename: parsed.searchParams.get('filename') });
      if (parsed.pathname === '/view') {
        return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
      }
      if (parsed.pathname === '/prompt') throw new Error('tampered body reference must not queue');
      throw new Error(`unexpected ${parsed.pathname}`);
    }, 'http://comfy', requestValue, available, 42),
    /does not match its profile/
  );
  assert.equal(tamperedCalls.some(({ pathname }) => pathname === '/prompt'), false);
  assert.deepEqual(
    tamperedCalls.map(({ filename }) => filename),
    [canonicalReference.name, bodyReference.name]
  );
});

test('validates continuity master bytes before a unique non-overwriting Comfy upload', async () => {
  const bytes = png();
  const requestValue = continuityRequest();
  const master = {
    ...requestValue.continuityMaster,
    imageSha256: createHash('sha256').update(bytes).digest('hex')
  };
  const observed = [];
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    observed.push({ parsed, init });
    assert.equal(parsed.pathname, '/upload/image');
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);
    const image = init.body.get('image');
    assert.ok(image instanceof Blob);
    assert.match(image.name, /^scene-continuity-[0-9a-f-]{36}\.png$/);
    assert.equal(image.type, 'image/png');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
    assert.equal(init.body.get('subfolder'), 'mullet/motion-inputs');
    assert.equal(init.body.get('type'), 'input');
    assert.equal(init.body.get('overwrite'), 'false');
    return Response.json({
      name: image.name,
      subfolder: 'mullet/motion-inputs',
      type: 'input'
    });
  };
  const uploaded = await uploadInlineSceneContinuityMasterInput(fetcher, 'http://comfy', bytes, master);
  const uploadedAgain = await uploadInlineSceneContinuityMasterInput(fetcher, 'http://comfy', bytes, master);
  assert.equal(observed.length, 2);
  assert.notEqual(uploadedAgain.name, uploaded.name);
  assert.equal(uploaded.imageSha256, master.imageSha256);
  assert.equal(uploaded.width, master.width);
  assert.equal(uploaded.height, master.height);
  assert.match(uploaded.name, /^scene-continuity-[0-9a-f-]{36}\.png$/);

  let rejectedCalls = 0;
  const rejectingFetcher = async () => {
    rejectedCalls += 1;
    throw new Error('upload must not be attempted');
  };
  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(rejectingFetcher, 'http://comfy', bytes, {
      ...master,
      imageSha256: '0'.repeat(64)
    }),
    /hash does not match/
  );
  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(rejectingFetcher, 'http://comfy', bytes, {
      ...master,
      width: master.width + 16
    }),
    /dimensions do not match/
  );
  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(
      rejectingFetcher,
      'http://comfy',
      new Uint8Array((20 * 1024 * 1024) + 1),
      master
    ),
    /exceeds 20 MiB/
  );
  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(
      rejectingFetcher,
      'http://comfy',
      new ArrayBuffer(bytes.byteLength),
      master
    ),
    /bytes are invalid/
  );
  const invalidPng = bytes.slice();
  invalidPng[0] = 0;
  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(rejectingFetcher, 'http://comfy', invalidPng, {
      ...master,
      imageSha256: createHash('sha256').update(invalidPng).digest('hex')
    }),
    /dimensions do not match its bytes/
  );
  assert.equal(rejectedCalls, 0);

  await assert.rejects(
    uploadInlineSceneContinuityMasterInput(async (_url, init) => Response.json({
      name: init.body.get('image').name,
      subfolder: 'mullet/wrong',
      type: 'input'
    }), 'http://comfy', bytes, master),
    /unexpected inline-scene continuity upload location/
  );
});

test('queues continuity with the uploaded master and only the newly introduced identity reference', async () => {
  const available = capabilities();
  const requestValue = continuityRequest();
  const input = uploadedMaster(requestValue);
  const bytes = png();
  const observed = [];
  const referencePayloads = new Map([[callyReference.name, callyReferenceBytes]]);
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const filename = parsed.searchParams.get('filename');
    observed.push({ pathname: parsed.pathname, filename, init });
    if (parsed.pathname === '/view' && referencePayloads.has(filename)) {
      return new Response(referencePayloads.get(filename), { headers: { 'content-type': 'image/jpeg' } });
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
  await runComfyInlineScene(fetcher, 'http://comfy', requestValue, available, 42, undefined, input);
  const promptIndex = observed.findIndex(({ pathname }) => pathname === '/prompt');
  assert.ok(promptIndex > 0);
  assert.deepEqual(
    observed.slice(0, promptIndex).map(({ filename }) => filename),
    [callyReference.name]
  );
  // The master already carries Jenna, so her identity photo is never re-fetched.
  assert.equal(observed.some(({ filename }) => filename === canonicalReference.name), false);
  const queued = JSON.parse(observed[promptIndex].init.body);
  assert.equal(queued.prompt['4'].inputs.image, `mullet/motion-inputs/${input.name}`);
  assert.equal(queued.prompt['16'].inputs.image, 'mullet/identity/cally-v2.jpg');
  assert.equal(Object.hasOwn(queued.prompt, '17'), false);

  const noQueueCalls = [];
  await assert.rejects(
    runComfyInlineScene(
      async (url) => {
        noQueueCalls.push(new URL(String(url)).pathname);
        throw new Error('must not fetch or queue');
      },
      'http://comfy',
      requestValue,
      available,
      42,
      undefined,
      { ...input, imageSha256: '8'.repeat(64) }
    ),
    /does not match continuity provenance/
  );
  assert.deepEqual(noQueueCalls, []);
});

test('does not queue a continuity edit when a newly introduced identity reference is tampered', async () => {
  const calls = [];
  const requestValue = continuityRequest();
  await assert.rejects(
    runComfyInlineScene(async (url) => {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname);
      if (parsed.pathname === '/view') {
        return new Response(referenceBytes, { headers: { 'content-type': 'image/jpeg' } });
      }
      if (parsed.pathname === '/prompt') throw new Error('tampered reference must not queue');
      throw new Error(`unexpected ${parsed.pathname}`);
    }, 'http://comfy', requestValue, capabilities(), 42, undefined, uploadedMaster(requestValue)),
    /does not match its profile/
  );
  assert.equal(calls.includes('/prompt'), false);
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
