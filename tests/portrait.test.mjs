import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_CAPABILITIES_SPEC,
  PORTRAIT_H3_REFERENCE_TEMPLATE_ID,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_TEMPLATE_ID,
  PORTRAIT_TEMPLATES,
  MINIMAX_H3_PORTRAIT_STILL_TEMPLATE,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildMiniMaxH3PortraitStillWorkflow,
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
  portraitH3ReferencePlan,
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

function h3Request(overrides = {}) {
  const qwen = referenceRequest();
  return buildPortraitRequest(expression, {
    modelTemplate: PORTRAIT_H3_REFERENCE_TEMPLATE_ID,
    subject: qwen.subject,
    setting: qwen.setting,
    attire: qwen.attire,
    lora: null,
    referenceImage: qwen.referenceImage,
    bodyReferenceImage: managedBodyReference,
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

test('normalizes the additive Z-Image, Qwen, and H3 model capabilities', () => {
  const capabilities = normalizePortraitCapabilities({
    spec: PORTRAIT_CAPABILITIES_SPEC,
    templates: PORTRAIT_TEMPLATES.map((template) => ({
      template,
      available: template.id !== PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
      missing: template.id === PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
        ? [`model:unet:${QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet}`]
        : []
    })),
    aspectRatios: [{ id: 'forged' }],
    megapixels: [99],
    loras: ['zimage/kristi6.safetensors']
  });

  assert.equal(capabilities.spec, 'mullet_portrait_capabilities_v6');
  assert.deepEqual(capabilities.templates.map(({ template }) => template.id), [
    PORTRAIT_TEMPLATE_ID,
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    PORTRAIT_H3_REFERENCE_TEMPLATE_ID
  ]);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_TEMPLATE_ID), true);
  assert.equal(portraitModelTemplateAvailable(capabilities, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID), false);
  assert.equal(portraitModelTemplateAvailable(capabilities, 'retired-reference-editor-v1'), false);
  assert.equal(portraitModelTemplateAvailable(null, PORTRAIT_TEMPLATE_ID), false);
  assert.deepEqual(capabilities.aspectRatios, [{ id: '9:16', width: 9, height: 16, label: '9:16 fixed expression' }]);
  assert.equal(capabilities.megapixels[0], 0.5);
});

test('migrates only recognized Z-Image, Qwen, and H3 selections and rejects retired editors', () => {
  assert.equal(
    migratePortraitModelTemplateSelection(null, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID),
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
  );
  for (const selection of [
    PORTRAIT_TEMPLATE_ID,
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    PORTRAIT_H3_REFERENCE_TEMPLATE_ID
  ]) {
    assert.equal(migratePortraitModelTemplateSelection(null, selection), selection);
  }
  assert.equal(
    migratePortraitModelTemplateSelection('retired-reference-editor-v1', PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID),
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
  );
  assert.equal(migratePortraitModelTemplateSelection('retired-reference-editor-v1', 'also-retired'), null);
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

test('retains revision-matched Qwen Edit 2511 Lightning as an additive four-step option', () => {
  assert.equal(PORTRAIT_REFERENCE_TEMPLATE_ID, PORTRAIT_H3_REFERENCE_TEMPLATE_ID);
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
  assert.deepEqual(graph, buildQwenReferenceEditWorkflow({
    referencePath: 'mullet/identity/jenna-stannis-v1.jpg',
    prompt: exactJennaFearPrompt,
    width: 576,
    height: 1024,
    seed: 19790213,
    filenamePrefix: 'mullet/portrait-reference'
  }));
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
  assert.equal(graph['6'].inputs.shift, 3.1);
  assert.equal(graph['8'].inputs.lora_name, 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
  assert.equal(graph['8'].inputs.strength_model, 1);
  assert.equal(graph['12'].inputs.seed, 19790213);
  assert.equal(graph['12'].inputs.steps, 4);
  assert.equal(graph['12'].inputs.cfg, 1);
  assert.equal(graph['12'].inputs.sampler_name, 'euler');
  assert.equal(graph['12'].inputs.scheduler, 'simple');
  assert.equal(graph['12'].inputs.denoise, 1);
  assert.deepEqual(graph['14'].inputs.images, ['13', 0]);
  assert.equal(graph['15'], undefined);
  assert.equal(JSON.stringify(graph).includes('"crop":"disabled"'), false);
  assert.throws(() => buildZImageTurboWorkflow(built, 1), /requires the Z-Image template/);
});

test('builds the default native five-frame H3 expression keeper with deterministic references and six prompt sections', () => {
  const built = h3Request();
  assert.deepEqual(
    portraitDimensionsForTemplate(built.modelTemplate, built.aspectRatio, built.megapixels),
    { width: 576, height: 1024, pixels: 589824 }
  );
  assert.deepEqual(
    portraitH3ReferencePlan(built).map(({ picture, kind, sha256 }) => ({ picture, kind, sha256 })),
    [
      { picture: 1, kind: 'canonical_identity', sha256: built.referenceImage.sha256 },
      { picture: 2, kind: 'body_wardrobe', sha256: managedBodySha256 }
    ]
  );
  const prompt = buildPortraitPrompt(built);
  for (const section of [
    'subject_definitions:',
    'summary:',
    'retention_analysis:',
    'detailed_description:',
    'overall_soundscape:',
    'non_diegetic_music:'
  ]) assert.equal(prompt.split(section).length, 2, section);
  assert.match(prompt, /<Picture 1>/);
  assert.match(prompt, /<Picture 2>/);
  assert.match(prompt, /no movement, lip motion, speaking/);

  const graph = buildMiniMaxH3PortraitStillWorkflow(built, 19790213);
  assert.equal(graph['1'].inputs.unet_name, MINIMAX_H3_PORTRAIT_STILL_TEMPLATE.modelFiles.unet);
  assert.equal(graph['2'].inputs.type, 'minimax');
  assert.equal(graph['3'].inputs.vae_name, MINIMAX_H3_PORTRAIT_STILL_TEMPLATE.modelFiles.videoVae);
  assert.equal(graph['4'].inputs.vae_name, MINIMAX_H3_PORTRAIT_STILL_TEMPLATE.modelFiles.audioVae);
  assert.equal(graph['5'].inputs.image, `mullet/identity/${built.referenceImage.name}`);
  assert.equal(graph['6'].inputs.image, `mullet/identity/${managedBodyReference.name}`);
  assert.deepEqual(graph['19'].inputs, { model: ['1', 0], shift_video: 12, shift_audio: 3 });
  assert.equal(graph['20'].inputs.width, 576);
  assert.equal(graph['20'].inputs.height, 1024);
  assert.equal(graph['20'].inputs.length, 5);
  assert.equal(graph['20'].inputs.ref_image_size, 'match');
  assert.deepEqual(graph['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
  assert.deepEqual(graph['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
  assert.equal(graph['22'].inputs.sampler_name, 'res_multistep');
  assert.deepEqual(graph['23'].inputs, { model: ['19', 0], scheduler: 'simple', steps: 20, denoise: 1 });
  assert.deepEqual(graph['25'].inputs.latent_image, ['20', 1]);
  assert.deepEqual(graph['27'].inputs, { image: ['26', 0], batch_index: 0, length: 1 });
  assert.deepEqual(graph['28'].inputs, { images: ['27', 0], filename_prefix: 'mullet/portrait-h3' });
  const classes = Object.values(graph).map(({ class_type }) => class_type);
  assert.equal(classes.includes('LoraLoader'), false);
  assert.equal(classes.includes('VHS_VideoCombine'), false);
  assert.equal(classes.includes('SaveAudio'), false);
});

test('deduplicates an H3 body reference by SHA and rejects non-managed or non-fixed portrait inputs', () => {
  const canonical = referenceRequest().referenceImage;
  const duplicate = {
    ...managedBodyReference,
    name: `body-jenna-stannis-1234abcd-${canonical.sha256}.png`,
    sha256: canonical.sha256
  };
  assert.equal(portraitH3ReferencePlan(h3Request({ bodyReferenceImage: duplicate })).length, 1);
  assert.throws(() => h3Request({ megapixels: 0.75 }), /exact 576x1024/);
  assert.throws(
    () => h3Request({ bodyReferenceImage: { ...managedBodyReference, name: 'body.png' } }),
    /content-addressed managed 576x1024 PNG/
  );
  assert.throws(
    () => referenceRequest({ bodyReferenceImage: managedBodyReference }),
    /only MiniMax H3 expression portraits/
  );
  assert.notEqual(
    portraitRequestKey(h3Request()),
    portraitRequestKey(h3Request({ bodyReferenceImage: null }))
  );
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
