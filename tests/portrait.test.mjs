import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE,
  MAGE_FLOW_EDIT_REFERENCE_TEMPLATE,
  PORTRAIT_CAPABILITIES_SPEC,
  PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
  PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_TEMPLATE_ID,
  PORTRAIT_TEMPLATES,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildFlux2Klein9BReferencePortraitWorkflow,
  buildMageFlowReferencePortraitWorkflow,
  buildPortraitPrompt,
  buildPortraitRequest,
  buildQwenReferencePortraitWorkflow,
  buildZImageTurboWorkflow,
  normalizePortraitCapabilities,
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
    aspectRatio: '9:16',
    megapixels: 0.5,
    ...overrides
  });
}

function referenceRequest(overrides = {}) {
  return buildPortraitRequest(expression, {
    modelTemplate: PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    subject: "Sally Knyvette portraying Jenna Stannis in the 1979 BBC television series Blake's 7",
    setting: 'the Liberator flight deck',
    attire: "Jenna's burgundy and silver-grey leather spaceflight tunic",
    lora: null,
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: 'c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8',
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    characterId: 'jenna-stannis',
    profileFingerprint: '1234abcd',
    promptOverride: exactJennaFearPrompt,
    aspectRatio: '9:16',
    megapixels: 0.5,
    ...overrides
  });
}

test('fixes every expression portrait to exact 9:16 at the 0.5 MP default', () => {
  assert.deepEqual(portraitDimensions('9:16', 0.5), { width: 576, height: 1024, pixels: 589824 });
  const dimensions = portraitDimensions('9:16', 1);
  assert.equal(dimensions.width * 16, dimensions.height * 9);
  assert.equal(dimensions.width % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.equal(dimensions.height % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  assert.throws(() => portraitDimensions('2:3', 0.5), /unsupported portrait aspect ratio/);
});

test('normalizes and retains all four additive model capabilities, including unavailable models', () => {
  const capabilities = normalizePortraitCapabilities({
    spec: PORTRAIT_CAPABILITIES_SPEC,
    templates: PORTRAIT_TEMPLATES.map((template) => ({
      template,
      available: template.id !== PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
      missing: template.id === PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
        ? [`model:unet:${MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.unet}`]
        : []
    })),
    aspectRatios: [{ id: 'forged' }],
    megapixels: [99],
    loras: ['zimage/kristi6.safetensors']
  });

  assert.equal(capabilities.spec, 'mullet_portrait_capabilities_v5');
  assert.deepEqual(capabilities.templates.map(({ template }) => template.id), [
    PORTRAIT_TEMPLATE_ID,
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
    PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
  ]);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_TEMPLATE_ID), true);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID), true);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID), true);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID), false);
  assert.equal(portraitModelTemplateAvailable(null, PORTRAIT_TEMPLATE_ID), false);
  assert.deepEqual(capabilities.aspectRatios, [{ id: '9:16', width: 9, height: 16, label: '9:16 fixed expression' }]);
  assert.equal(capabilities.megapixels[0], 0.5);
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

test('composes the model prompt from subject, expression, attire, setting, and selected-model guide', () => {
  const prompt = buildPortraitPrompt(request());
  assert.equal(prompt, 'head-and-chest portrait of Roj Blake, grief facial expression, wearing a dark leather tunic, in the Liberator flight deck, cinematic realistic fiction still, coherent anatomy, natural skin texture, detailed eyes, controlled depth of field, no text, no watermark');
});

test('compiles the Z-Image graph at the fixed expression frame and inserts only compatible LoRAs', () => {
  const plain = buildZImageTurboWorkflow(request(), 42);
  assert.equal(plain['1'].inputs.unet_name, 'z_image_turbo_int8_convrot.safetensors');
  assert.equal(plain['2'].inputs.clip_name, 'qwen_3_4b.safetensors');
  assert.equal(plain['3'].inputs.vae_name, 'ae.safetensors');
  assert.deepEqual(plain['7'].inputs, { width: 576, height: 1024, batch_size: 1 });
  assert.equal(plain['8'].inputs.steps, 8);
  assert.equal(plain['8'].inputs.cfg, 1);
  assert.equal(plain['8'].inputs.seed, 42);
  assert.equal(plain['11'], undefined);

  const withLora = buildZImageTurboWorkflow(request({ lora: 'zimage/kristi6.safetensors' }), 43);
  assert.equal(withLora['11'].inputs.lora_name, 'zimage/kristi6.safetensors');
  assert.deepEqual(withLora['4'].inputs.clip, ['11', 1]);
  assert.deepEqual(withLora['6'].inputs.model, ['11', 0]);
});

test('Qwen center-crops the canonical 400x600 reference before all conditioning and never stretches decoded output', () => {
  const built = referenceRequest();
  assert.equal(built.modelTemplate, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID);
  assert.equal(built.source.characterId, 'jenna-stannis');
  assert.equal(built.source.profileFingerprint, '1234abcd');
  assert.deepEqual(built.referenceImage, {
    name: 'jenna-stannis-v1.jpg',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: 'c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8',
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  });
  assert.equal(buildPortraitPrompt(built), exactJennaFearPrompt);

  const graph = buildQwenReferencePortraitWorkflow(built, 19790213);
  assert.equal(graph['1'].inputs.unet_name, QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, 'qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(graph['2'].inputs.type, 'qwen_image');
  assert.equal(graph['3'].inputs.vae_name, 'qwen_image_vae.safetensors');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.deepEqual(graph['5'].inputs, {
    image: ['4', 0], upscale_method: 'lanczos', width: 576, height: 1024, crop: 'center'
  });
  assert.deepEqual(graph['9'].inputs.image1, ['5', 0]);
  assert.deepEqual(graph['10'].inputs.image1, ['5', 0]);
  assert.deepEqual(graph['11'].inputs.pixels, ['5', 0]);
  assert.equal(graph['12'].inputs.seed, 19790213);
  assert.equal(graph['12'].inputs.steps, 4);
  assert.deepEqual(graph['14'].inputs.images, ['13', 0]);
  assert.equal(graph['15'], undefined);
  assert.equal(JSON.stringify(graph).includes('"crop":"disabled"'), false);
  assert.throws(() => buildZImageTurboWorkflow(built, 1), /requires the Z-Image template/);
});

test('compiles the FLUX.2 Klein 9B Distilled INT8 ConvRot reference workflow additively', () => {
  const graph = buildFlux2Klein9BReferencePortraitWorkflow(referenceRequest({
    modelTemplate: PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID
  }), 73);
  assert.equal(graph['1'].inputs.unet_name, 'flux-2-klein-9b-kv-int8-convrot.safetensors');
  assert.equal(graph['1'].inputs.unet_name, FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.type, 'flux2');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(graph['9'].class_type, 'ReferenceLatent');
  assert.deepEqual(graph['11'].inputs, { width: 576, height: 1024, batch_size: 1 });
  assert.deepEqual(graph['15'].inputs, { steps: 4, width: 576, height: 1024 });
  assert.equal(graph['18'].inputs.filename_prefix, 'mullet/portrait-reference');
});

test('compiles the restored Mage-Flow Edit reference workflow additively', () => {
  const graph = buildMageFlowReferencePortraitWorkflow(referenceRequest({
    modelTemplate: PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
  }), 91);
  assert.equal(graph['1'].inputs.unet_name, MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.type, 'mage');
  assert.equal(graph['4'].inputs.image, 'mullet/identity/jenna-stannis-v1.jpg');
  assert.equal(graph['5'].class_type, 'TextEncodeMageFlowEdit');
  assert.equal(graph['5'].inputs.width, 576);
  assert.equal(graph['5'].inputs.height, 1024);
  assert.deepEqual(graph['5'].inputs['images.image_1'], ['4', 0]);
  assert.equal(graph['6'].inputs.seed, 91);
  assert.equal(graph['8'].inputs.filename_prefix, 'mullet/portrait-reference');
});

test('rejects arbitrary templates, portrait geometry, malformed reference metadata, LoRAs, and stale sources', () => {
  const built = request();
  assert.throws(() => normalizePortraitRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait model/);
  assert.throws(() => normalizePortraitRequest({ ...built, aspectRatio: '2:3' }), /unsupported portrait aspect ratio/);
  assert.throws(() => normalizePortraitRequest({ ...built, megapixels: 9 }), /unsupported portrait megapixel/);
  assert.throws(() => normalizePortraitRequest({ ...built, lora: '../escape.safetensors' }), /LoRA is invalid/);
  assert.throws(() => normalizePortraitRequest({ ...built, source: { ...built.source, messageIndex: 0 } }), /latest response/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), referenceImage: null }), /requires an identity reference/);
  assert.throws(() => normalizePortraitRequest({
    ...referenceRequest(),
    referenceImage: { ...referenceRequest().referenceImage, width: 360, height: 254, aspectRatio: '2:3' }
  }), /aspect ratio must be 180:127/);
  assert.throws(() => normalizePortraitRequest({
    ...referenceRequest(),
    referenceImage: { ...referenceRequest().referenceImage, width: 400, height: 600, aspectRatio: '9:16' }
  }), /aspect ratio must be 2:3/);
  assert.throws(() => normalizePortraitRequest({ ...referenceRequest(), lora: 'zimage/kristi6.safetensors' }), /does not accept a Z-Image LoRA/);
  assert.throws(() => normalizePortraitRequest({ ...built, promptOverride: 'forged override' }), /requires a profile-bound reference portrait/);
  assert.notEqual(portraitRequestKey(built), portraitRequestKey(request({ attire: 'a Federation uniform' })));
  assert.notEqual(portraitRequestKey(referenceRequest()), portraitRequestKey(referenceRequest({
    referenceImage: { ...referenceRequest().referenceImage, width: 800, height: 1200 }
  })));
});
