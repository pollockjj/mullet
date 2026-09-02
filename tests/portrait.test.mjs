import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_CAPABILITIES_SPEC,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_TEMPLATE_ID,
  PORTRAIT_TEMPLATES,
  PORTRAIT_KREA_TEMPLATE_ID,
  KREA2_TURBO_TEMPLATE,
  buildKrea2TurboWorkflow,
  isKreaLoraName,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildPortraitPrompt,
  buildPortraitRequest,
  buildQwenReferenceEditWorkflow,
  buildQwenReferencePortraitWorkflow,
  buildZImageTurboWorkflow,
  migratePortraitModelTemplateSelection,
  normalizePortraitCapabilities,
  normalizePortraitRequest,
  portraitDimensions,
  portraitDimensionsForTemplate,
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

const managedBodySha256 = 'b'.repeat(64);
const managedBodyReference = Object.freeze({
  name: `body-jenna-stannis-1234abcd-${managedBodySha256}.png`,
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: managedBodySha256,
  width: 576,
  height: 1024,
  aspectRatio: '9:16'
});


test('fixes every expression portrait to exact 9:16 at the 0.5 MP default', () => {
  assert.deepEqual(portraitDimensions('9:16', 0.5), { width: 576, height: 1024, pixels: 589824 });
  const dimensions = portraitDimensions('9:16', 1);
  assert.equal(dimensions.width * 16, dimensions.height * 9);
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

// Operator order 2026-09-02: Jan and Kristi move to Krea 2 turbo with their Krea LoRAs.
// This pins the graph the operator runs by hand on firestorm:8188 (prompt f8377cfa):
// model-only LoRA, no sampling-shift node, EmptyLatentImage, 8 euler/simple steps, cfg 1.
test('builds the operator\'s Krea 2 turbo graph with a model-only subject LoRA', () => {
  assert.equal(isKreaLoraName('janpollock-krea2-v3-attn.safetensors'), true);
  assert.equal(isKreaLoraName('zimage/jan6.safetensors'), false);
  const graph = buildKrea2TurboWorkflow(request({ modelTemplate: PORTRAIT_KREA_TEMPLATE_ID, lora: 'kristibentler-krea2-v4-attn.safetensors' }), 43);
  assert.equal(graph['1'].inputs.unet_name, 'krea2_turbo_int8_convrot.safetensors');
  assert.deepEqual(graph['2'].inputs, { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' });
  assert.equal(graph['3'].inputs.vae_name, 'qwen_image_vae.safetensors');
  assert.equal(graph['7'].class_type, 'EmptyLatentImage');
  assert.equal(graph['6'], undefined);
  assert.equal(graph['8'].inputs.steps, 8);
  assert.equal(graph['8'].inputs.sampler_name, 'euler');
  assert.deepEqual(graph['8'].inputs.model, ['11', 0]);
  assert.deepEqual(graph['4'].inputs.clip, ['2', 0]);
  assert.equal(graph['11'].class_type, 'LoraLoaderModelOnly');
  assert.equal(graph['11'].inputs.lora_name, 'kristibentler-krea2-v4-attn.safetensors');
  assert.equal(KREA2_TURBO_TEMPLATE.outputNode, '10');
  assert.throws(
    () => buildKrea2TurboWorkflow(request({ modelTemplate: PORTRAIT_KREA_TEMPLATE_ID, lora: 'zimage/kristi6.safetensors' }), 43),
    /does not belong to the selected model family/
  );
  assert.throws(
    () => normalizePortraitRequest(request({ lora: 'kristibentler-krea2-v4-attn.safetensors' })),
    /does not belong to the selected model family/
  );
});
