import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  PORTRAIT_TEMPLATE_ID,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildQwenReferencePortraitWorkflow,
  buildPortraitPrompt,
  buildPortraitRequest,
  buildZImageTurboWorkflow,
  normalizePortraitRequest,
  portraitDimensions,
  portraitModelTemplateAvailable,
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

const exactJennaFearPrompt = "Use the supplied canonical Jenna Stannis reference as the identity source. Preserve the exact same woman, facial structure, eyes, nose, mouth, age, voluminous feathered blonde hairstyle, and burgundy-and-silver leather costume. Create a photorealistic head-and-chest portrait of Sally Knyvette portraying Jenna Stannis in the 1979 BBC television series Blake's 7. She has a fearful, alert facial expression. Place her on the Liberator flight deck with cream geometric walls and restrained 1970s BBC retrofuturist controls. Preserve her identity; do not substitute another woman. No text, watermark, modern zipper, or contemporary clothing.";

function request(overrides = {}) {
  return buildPortraitRequest(expression, {
    subject: 'Roj Blake',
    setting: 'the Liberator flight deck',
    attire: 'a dark leather tunic',
    lora: null,
    aspectRatio: '2:3',
    megapixels: 0.9,
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
    promptOverride: exactJennaFearPrompt,
    aspectRatio: '2:3',
    megapixels: 0.9,
    ...overrides
  });
}

test('fixes every expression portrait to exact 2:3 at the proven 0.9 MP default', () => {
  assert.deepEqual(portraitDimensions('2:3', 0.9), { width: 768, height: 1152, pixels: 884736 });
  const dimensions = portraitDimensions('2:3', 1);
  assert.equal(dimensions.width * 3, dimensions.height * 2);
  assert.equal(dimensions.width % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.equal(dimensions.height % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.throws(() => portraitDimensions('1:1', 0.5), /unsupported portrait aspect ratio/);
});

test('requires the advertised Qwen reference capability for reference-conditioned portraits', () => {
  const capabilities = {
    spec: 'mullet_portrait_capabilities_v4',
    template: Z_IMAGE_TURBO_TEMPLATE,
    referenceTemplate: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
    aspectRatios: [{ id: '2:3', width: 2, height: 3, label: '2:3 fixed expression' }],
    megapixels: [0.5, 0.75, 0.9, 1, 1.5, 2],
    loras: []
  };
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_REFERENCE_TEMPLATE_ID), true);
  assert.equal(portraitModelTemplateAvailable({ ...capabilities, referenceTemplate: null }, PORTRAIT_REFERENCE_TEMPLATE_ID), false);
  assert.equal(portraitModelTemplateAvailable(null, PORTRAIT_REFERENCE_TEMPLATE_ID), false);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_TEMPLATE_ID), true);
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
  assert.deepEqual(plain['7'].inputs, { width: 768, height: 1152, batch_size: 1 });
  assert.equal(plain['8'].inputs.steps, 8);
  assert.equal(plain['8'].inputs.cfg, 1);
  assert.equal(plain['8'].inputs.seed, 42);
  assert.equal(plain['11'], undefined);

  const withLora = buildZImageTurboWorkflow(request({ lora: 'zimage/kristi6.safetensors' }), 43);
  assert.equal(withLora['11'].inputs.lora_name, 'zimage/kristi6.safetensors');
  assert.deepEqual(withLora['4'].inputs.clip, ['11', 1]);
  assert.deepEqual(withLora['6'].inputs.model, ['11', 0]);
});

test('binds Jenna identity provenance and compiles the proven Qwen Image Edit reference graph', () => {
  const built = referenceRequest();
  assert.equal(built.modelTemplate, PORTRAIT_REFERENCE_TEMPLATE_ID);
  assert.equal(built.source.characterId, 'jenna-stannis');
  assert.equal(built.source.profileFingerprint, '1234abcd');
  assert.equal(built.referenceImage.name, 'jenna-stannis-v1.jpg');
  const prompt = buildPortraitPrompt(built);
  assert.equal(prompt, exactJennaFearPrompt);

  const graph = buildQwenReferencePortraitWorkflow(built, 19790213);
  assert.equal(graph['1'].inputs.unet_name, QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, 'qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(graph['2'].inputs.type, 'qwen_image');
  assert.equal(graph['3'].inputs.vae_name, 'qwen_image_vae.safetensors');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(graph['5'].class_type, 'FluxKontextImageScale');
  assert.equal(graph['6'].inputs.shift, 3.1);
  assert.equal(graph['7'].class_type, 'CFGNorm');
  assert.equal(graph['8'].inputs.lora_name, 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
  assert.equal(graph['9'].class_type, 'TextEncodeQwenImageEditPlus');
  assert.equal(graph['9'].inputs.prompt, exactJennaFearPrompt);
  assert.equal(graph['12'].inputs.seed, 19790213);
  assert.equal(graph['12'].inputs.steps, 4);
  assert.equal(graph['12'].inputs.cfg, 1);
  assert.deepEqual(graph['15'].inputs, {
    image: ['13', 0], upscale_method: 'lanczos', width: 768, height: 1152, crop: 'disabled'
  });
  assert.deepEqual(graph['14'].inputs.images, ['15', 0]);
  assert.throws(() => buildZImageTurboWorkflow(built, 1), /requires the Z-Image template/);
});

test('rejects arbitrary templates, dimensions, LoRA paths, and stale sources', () => {
  const built = request();
  assert.throws(() => normalizePortraitRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait model/);
  assert.throws(() => normalizePortraitRequest({ ...built, aspectRatio: '1:1' }), /unsupported portrait aspect ratio/);
  assert.throws(() => normalizePortraitRequest({ ...built, megapixels: 9 }), /unsupported portrait megapixel/);
  assert.throws(() => normalizePortraitRequest({ ...built, lora: '../escape.safetensors' }), /LoRA is invalid/);
  assert.throws(() => normalizePortraitRequest({ ...built, source: { ...built.source, messageIndex: 0 } }), /latest response/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), referenceImage: null }), /requires an identity reference/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), lora: 'zimage/kristi6.safetensors' }), /does not accept a Z-Image LoRA/);
  assert.throws(() => normalizePortraitRequest({ ...built, promptOverride: 'forged override' }), /requires a profile-bound reference portrait/);
  assert.notEqual(portraitRequestKey(built), portraitRequestKey(request({ attire: 'a Federation uniform' })));
  assert.notEqual(portraitRequestKey(referenceRequest()), portraitRequestKey(referenceRequest({ profileFingerprint: '5678abcd' })));
});
