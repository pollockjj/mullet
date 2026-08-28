import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  PORTRAIT_TEMPLATE_ID,
  FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildFlux2Klein9BReferencePortraitWorkflow,
  buildPortraitPrompt,
  buildPortraitRequest,
  buildZImageTurboWorkflow,
  normalizePortraitRequest,
  portraitDimensions,
  portraitRequestKey
} from '../src/lib/portrait.ts';

const expression = {
  spec: 'mullet_sidecar_result_v1',
  kind: 'expression',
  source: {
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    messageCount: 4,
    messageIndex: 3,
    role: 'assistant',
    fingerprint: '12:1234abcd'
  },
  model: 'gemma-4-ortenzya',
  output: { expression: 'grief' }
};

function request(overrides = {}) {
  return buildPortraitRequest(expression, {
    subject: 'Roj Blake',
    setting: 'the Liberator flight deck',
    attire: 'a dark leather tunic',
    lora: null,
    aspectRatio: '1:1',
    megapixels: 0.5,
    ...overrides
  });
}

function referenceRequest(overrides = {}) {
  return buildPortraitRequest(expression, {
    modelTemplate: PORTRAIT_REFERENCE_TEMPLATE_ID,
    subject: "Sally Knyvette portraying Jenna Stannis in the 1979 BBC television series Blake's 7",
    setting: 'the Liberator flight deck',
    attire: "Jenna's burgundy and silver-grey leather spaceflight tunic",
    lora: null,
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: 'c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8'
    },
    characterId: 'jenna-stannis',
    profileFingerprint: '1234abcd',
    aspectRatio: '1:1',
    megapixels: 0.5,
    ...overrides
  });
}

test('fixes every expression portrait to 1:1 at the native 0.5 MP default', () => {
  assert.deepEqual(portraitDimensions('1:1', 0.5), { width: 704, height: 704, pixels: 495616 });
  const dimensions = portraitDimensions('1:1', 1);
  assert.equal(dimensions.width, dimensions.height);
  assert.equal(dimensions.width % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.equal(dimensions.height % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.throws(() => portraitDimensions('2:3', 0.5), /unsupported portrait aspect ratio/);
});

test('binds a portrait request only to an expression result fingerprint', () => {
  const built = request();
  assert.equal(built.spec, PORTRAIT_REQUEST_SPEC);
  assert.equal(built.modelTemplate, PORTRAIT_TEMPLATE_ID);
  assert.deepEqual(built.source, {
    conversationId: expression.source.conversationId,
    messageCount: 4,
    messageIndex: 3,
    fingerprint: expression.source.fingerprint,
    expression: 'grief'
  });
  assert.equal(JSON.stringify(built).includes('assistant'), false);
  assert.equal(JSON.stringify(built).includes('transcript'), false);
});

test('composes the model prompt from subject, expression, attire, setting, and fixed guide', () => {
  const prompt = buildPortraitPrompt(request());
  assert.equal(prompt, 'head-and-chest portrait of Roj Blake, grief facial expression, wearing a dark leather tunic, in the Liberator flight deck, cinematic realistic fiction still, coherent anatomy, natural skin texture, detailed eyes, controlled depth of field, no text, no watermark');
});

test('compiles the proven Z-Image graph and inserts only compatible LoRAs', () => {
  const plain = buildZImageTurboWorkflow(request(), 42);
  assert.equal(plain['1'].inputs.unet_name, 'z_image_turbo_int8_convrot.safetensors');
  assert.equal(plain['2'].inputs.clip_name, 'qwen_3_4b.safetensors');
  assert.equal(plain['3'].inputs.vae_name, 'ae.safetensors');
  assert.deepEqual(plain['7'].inputs, { width: 704, height: 704, batch_size: 1 });
  assert.equal(plain['8'].inputs.steps, 8);
  assert.equal(plain['8'].inputs.cfg, 1);
  assert.equal(plain['8'].inputs.seed, 42);
  assert.equal(plain['11'], undefined);

  const withLora = buildZImageTurboWorkflow(request({ lora: 'zimage/kristi6.safetensors' }), 43);
  assert.equal(withLora['11'].inputs.lora_name, 'zimage/kristi6.safetensors');
  assert.deepEqual(withLora['4'].inputs.clip, ['11', 1]);
  assert.deepEqual(withLora['6'].inputs.model, ['11', 0]);
});

test('binds Jenna identity provenance and compiles the official FLUX.2 Klein 9B reference graph', () => {
  const built = referenceRequest();
  assert.equal(built.modelTemplate, PORTRAIT_REFERENCE_TEMPLATE_ID);
  assert.equal(built.source.characterId, 'jenna-stannis');
  assert.equal(built.source.profileFingerprint, '1234abcd');
  assert.equal(built.referenceImage.name, 'jenna-stannis-v1.jpg');
  const prompt = buildPortraitPrompt(built);
  assert.match(prompt, /supplied canonical reference/);
  assert.match(prompt, /Preserve identity; do not substitute another person/);

  const graph = buildFlux2Klein9BReferencePortraitWorkflow(built, 19790213);
  assert.equal(graph['1'].inputs.unet_name, FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, 'qwen_3_8b_fp8mixed.safetensors');
  assert.equal(graph['2'].inputs.type, 'flux2');
  assert.equal(graph['3'].inputs.vae_name, 'full_encoder_small_decoder.safetensors');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(graph['5'].class_type, 'ImageScaleToTotalPixels');
  assert.equal(graph['5'].inputs.megapixels, 0.5);
  assert.equal(graph['6'].class_type, 'VAEEncode');
  assert.equal(graph['7'].class_type, 'CLIPTextEncode');
  assert.equal(graph['8'].class_type, 'ConditioningZeroOut');
  assert.deepEqual(graph['9'].inputs, { conditioning: ['7', 0], latent: ['6', 0] });
  assert.deepEqual(graph['10'].inputs, { conditioning: ['8', 0], latent: ['6', 0] });
  assert.deepEqual(graph['11'].inputs, { width: 704, height: 704, batch_size: 1 });
  assert.equal(graph['12'].inputs.noise_seed, 19790213);
  assert.deepEqual(graph['15'].inputs, { steps: 4, width: 704, height: 704 });
  assert.deepEqual(graph['18'].inputs.images, ['17', 0]);
  assert.throws(() => buildZImageTurboWorkflow(built, 1), /requires the Z-Image template/);
});

test('rejects arbitrary templates, dimensions, LoRA paths, and stale sources', () => {
  const built = request();
  assert.throws(() => normalizePortraitRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait model/);
  assert.throws(() => normalizePortraitRequest({ ...built, aspectRatio: '2:3' }), /unsupported portrait aspect ratio/);
  assert.throws(() => normalizePortraitRequest({ ...built, megapixels: 9 }), /unsupported portrait megapixel/);
  assert.throws(() => normalizePortraitRequest({ ...built, lora: '../escape.safetensors' }), /LoRA is invalid/);
  assert.throws(() => normalizePortraitRequest({ ...built, source: { ...built.source, messageIndex: 0 } }), /latest response/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), referenceImage: null }), /requires an identity reference/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), lora: 'zimage/kristi6.safetensors' }), /does not accept a Z-Image LoRA/);
  assert.notEqual(portraitRequestKey(built), portraitRequestKey(request({ attire: 'a Federation uniform' })));
  assert.notEqual(portraitRequestKey(referenceRequest()), portraitRequestKey(referenceRequest({ profileFingerprint: '5678abcd' })));
});
