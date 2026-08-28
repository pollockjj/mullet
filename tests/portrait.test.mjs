import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTRAIT_REQUEST_SPEC,
  PORTRAIT_TEMPLATE_ID,
  Z_IMAGE_TURBO_TEMPLATE,
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
    aspectRatio: '2:3',
    megapixels: 0.9,
    ...overrides
  });
}

test('calculates exact portrait ratios at the model multiple', () => {
  assert.deepEqual(portraitDimensions('2:3', 0.9), { width: 768, height: 1152, pixels: 884736 });
  assert.deepEqual(portraitDimensions('3:4', 1), { width: 864, height: 1152, pixels: 995328 });
  for (const ratio of ['2:3', '3:4', '4:5', '9:16']) {
    const dimensions = portraitDimensions(ratio, 1);
    assert.equal(dimensions.width % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
    assert.equal(dimensions.height % Z_IMAGE_TURBO_TEMPLATE.multiple, 0);
  }
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

test('rejects arbitrary templates, dimensions, LoRA paths, and stale sources', () => {
  const built = request();
  assert.throws(() => normalizePortraitRequest({ ...built, modelTemplate: 'anything' }), /unsupported portrait model/);
  assert.throws(() => normalizePortraitRequest({ ...built, megapixels: 9 }), /unsupported portrait megapixel/);
  assert.throws(() => normalizePortraitRequest({ ...built, lora: '../escape.safetensors' }), /LoRA is invalid/);
  assert.throws(() => normalizePortraitRequest({ ...built, source: { ...built.source, messageIndex: 0 } }), /latest response/);
  assert.notEqual(portraitRequestKey(built), portraitRequestKey(request({ attire: 'a Federation uniform' })));
});
