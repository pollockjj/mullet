import {
  isExpressionLabel,
  isSidecarConversationId,
  type ExpressionLabel,
  type ExpressionSidecarResult
} from './sidecar.ts';

export const PORTRAIT_REQUEST_SPEC = 'mullet_portrait_request_v5' as const;
export const PORTRAIT_CAPABILITIES_SPEC = 'mullet_portrait_capabilities_v5' as const;
export const PORTRAIT_TEMPLATE_ID = 'z-image-turbo-v1' as const;
export const PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID = 'qwen-image-edit-2511-reference-v1' as const;
export const PORTRAIT_REFERENCE_TEMPLATE_ID = PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID;
export const PORTRAIT_TIMEOUT_MS = 120_000 as const;

export const PORTRAIT_ASPECT_RATIOS = Object.freeze([
  { id: '9:16', width: 9, height: 16, label: '9:16 fixed expression' }
] as const);

export const PORTRAIT_MEGAPIXELS = Object.freeze([0.5, 0.75, 0.9, 1, 1.5, 2] as const);

export type PortraitAspectRatio = (typeof PORTRAIT_ASPECT_RATIOS)[number]['id'];
export type PortraitMegapixels = (typeof PORTRAIT_MEGAPIXELS)[number];
export type PortraitReferenceModelTemplate = typeof PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID;
export type PortraitModelTemplate = typeof PORTRAIT_TEMPLATE_ID | PortraitReferenceModelTemplate;

export const Z_IMAGE_TURBO_TEMPLATE = Object.freeze({
  id: PORTRAIT_TEMPLATE_ID,
  label: 'Z-Image Turbo',
  modelFamily: 'z-image',
  promptGuide: 'cinematic realistic fiction still, coherent anatomy, natural skin texture, detailed eyes, controlled depth of field, no text, no watermark',
  modelFiles: {
    unet: 'z_image_turbo_int8_convrot.safetensors',
    clip: 'qwen_3_4b.safetensors',
    vae: 'ae.safetensors'
  },
  requiredNodes: [
    'UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'ConditioningZeroOut',
    'ModelSamplingAuraFlow', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage'
  ],
  loraPrefix: 'zimage/',
  multiple: 16,
  outputNode: '10',
  steps: 8,
  cfg: 1,
  sampler: 'res_multistep',
  scheduler: 'simple',
  shift: 3
} as const);

export const QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE = Object.freeze({
  id: PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  label: 'Qwen Image Edit 2511 · identity reference',
  modelFamily: 'qwen-image-edit-2511',
  promptGuide: 'preserve the supplied canonical identity exactly, photorealistic fiction still, coherent anatomy, natural skin texture, no text, no watermark',
  modelFiles: {
    unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'LoadImage',
    'ImageScale',
    'ModelSamplingAuraFlow',
    'CFGNorm',
    'LoraLoaderModelOnly',
    'TextEncodeQwenImageEditPlus',
    'VAEEncode',
    'KSampler',
    'VAEDecode',
    'SaveImage'
  ],
  multiple: 16,
  outputNode: '14',
  steps: 4,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
  shift: 3.1
} as const);

export const PORTRAIT_TEMPLATES = Object.freeze([
  Z_IMAGE_TURBO_TEMPLATE,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE
] as const);

export type PortraitTemplate = (typeof PORTRAIT_TEMPLATES)[number];

export function isPortraitModelTemplate(value: unknown): value is PortraitModelTemplate {
  return typeof value === 'string' && PORTRAIT_TEMPLATES.some((template) => template.id === value);
}

export function migratePortraitModelTemplateSelection(
  current: unknown,
  previous: unknown
): PortraitModelTemplate | null {
  if (isPortraitModelTemplate(current)) return current;
  if (!isPortraitModelTemplate(previous)) return null;
  return previous;
}

export function isPortraitReferenceTemplateId(value: unknown): value is PortraitReferenceModelTemplate {
  return value === PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID;
}

export function portraitTemplate(modelTemplate: PortraitModelTemplate): PortraitTemplate {
  const template = PORTRAIT_TEMPLATES.find((candidate) => candidate.id === modelTemplate);
  if (!template) throw new Error('unsupported portrait model template');
  return template;
}

export type PortraitReferenceImage = {
  name: string;
  subfolder: 'mullet/identity';
  type: 'input';
  sha256: string;
  width: number;
  height: number;
  aspectRatio: string;
};

export type PortraitSource = {
  conversationId: string;
  messageCount: number;
  messageIndex: number;
  fingerprint: string;
  expression: ExpressionLabel;
  characterId?: string;
  profileFingerprint?: string;
};

export function isPortraitSource(value: unknown): value is PortraitSource {
  if (!isRecord(value)) return false;
  return isSidecarConversationId(value.conversationId)
    && Number.isSafeInteger(value.messageCount)
    && Number(value.messageCount) >= 1
    && Number(value.messageCount) <= 1000
    && Number.isSafeInteger(value.messageIndex)
    && Number(value.messageIndex) === Number(value.messageCount) - 1
    && typeof value.fingerprint === 'string'
    && FINGERPRINT_PATTERN.test(value.fingerprint)
    && isExpressionLabel(value.expression)
    && ((value.characterId === undefined && value.profileFingerprint === undefined)
      || (typeof value.characterId === 'string'
        && PROFILE_ID_PATTERN.test(value.characterId)
        && typeof value.profileFingerprint === 'string'
        && PROFILE_FINGERPRINT_PATTERN.test(value.profileFingerprint)));
}

export type PortraitRequest = {
  spec: typeof PORTRAIT_REQUEST_SPEC;
  modelTemplate: PortraitModelTemplate;
  source: PortraitSource;
  subject: string;
  setting: string;
  attire: string;
  lora: string | null;
  referenceImage: PortraitReferenceImage | null;
  promptOverride: string | null;
  aspectRatio: PortraitAspectRatio;
  megapixels: PortraitMegapixels;
  seed?: number;
};

export type PortraitCapabilities = {
  spec: typeof PORTRAIT_CAPABILITIES_SPEC;
  templates: PortraitTemplateCapability[];
  aspectRatios: typeof PORTRAIT_ASPECT_RATIOS;
  megapixels: typeof PORTRAIT_MEGAPIXELS;
  loras: string[];
};

export type PortraitTemplateCapability = {
  template: PortraitTemplate;
  available: boolean;
  missing: string[];
};

export function portraitModelTemplateAvailable(
  capabilities: PortraitCapabilities | null,
  modelTemplate: PortraitModelTemplate
): boolean {
  if (!capabilities) return false;
  return capabilities.templates.some((capability) => (
    capability.template.id === modelTemplate && capability.available
  ));
}

export function portraitModelTemplateCapability(
  capabilities: PortraitCapabilities | null,
  modelTemplate: PortraitModelTemplate
): PortraitTemplateCapability | null {
  return capabilities?.templates.find((capability) => capability.template.id === modelTemplate) ?? null;
}

const FINGERPRINT_PATTERN = /^\d+:[0-9a-f]{8}$/;
const PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROFILE_FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/;
const LORA_PATTERN = /^zimage\/[A-Za-z0-9][A-Za-z0-9._ -]*\.safetensors$/;
const REFERENCE_IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REFERENCE_ASPECT_RATIO_PATTERN = /^[1-9]\d{0,3}:[1-9]\d{0,3}$/;
const aspectMap = new Map(PORTRAIT_ASPECT_RATIOS.map((ratio) => [ratio.id, ratio]));
const megapixelSet = new Set<number>(PORTRAIT_MEGAPIXELS);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPortraitLoraName(value: unknown): value is string {
  return typeof value === 'string' && LORA_PATTERN.test(value);
}

function textField(value: unknown, name: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${name} must contain between ${minimum} and ${maximum} characters`);
  }
  return normalized;
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function referenceAspectRatio(width: number, height: number): string {
  const validatedWidth = integer(width, 'portrait identity reference width', 1, 8192);
  const validatedHeight = integer(height, 'portrait identity reference height', 1, 8192);
  const divisor = greatestCommonDivisor(validatedWidth, validatedHeight);
  return `${validatedWidth / divisor}:${validatedHeight / divisor}`;
}

export function portraitDimensions(
  aspectRatio: PortraitAspectRatio,
  megapixels: PortraitMegapixels,
  multiple = Z_IMAGE_TURBO_TEMPLATE.multiple
): { width: number; height: number; pixels: number } {
  const ratio = aspectMap.get(aspectRatio);
  if (!ratio) throw new Error('unsupported portrait aspect ratio');
  if (!megapixelSet.has(megapixels)) throw new Error('unsupported portrait megapixel target');
  if (!Number.isSafeInteger(multiple) || multiple < 1 || multiple > 256) throw new Error('invalid model dimension multiple');
  const rawScale = Math.sqrt((megapixels * 1_000_000) / (ratio.width * ratio.height));
  const scale = Math.max(multiple, Math.round(rawScale / multiple) * multiple);
  const width = ratio.width * scale;
  const height = ratio.height * scale;
  return { width, height, pixels: width * height };
}

export function validatePortraitPngDimensions(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): void {
  if (!Number.isSafeInteger(expectedWidth) || expectedWidth < 1 || expectedWidth > 8192
    || !Number.isSafeInteger(expectedHeight) || expectedHeight < 1 || expectedHeight > 8192) {
    throw new Error('portrait PNG expected dimensions are invalid');
  }
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 33
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
    || bytes[8] !== 0
    || bytes[9] !== 0
    || bytes[10] !== 0
    || bytes[11] !== 13
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) throw new Error('portrait output has an invalid PNG signature or IHDR');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16, false) !== expectedWidth || view.getUint32(20, false) !== expectedHeight) {
    throw new Error('portrait output dimensions do not match its request');
  }
}

export function buildPortraitRequest(
  expression: ExpressionSidecarResult,
  settings: Omit<PortraitRequest, 'spec' | 'modelTemplate' | 'source' | 'referenceImage' | 'promptOverride'> & {
    modelTemplate?: PortraitModelTemplate;
    referenceImage?: PortraitReferenceImage | null;
    promptOverride?: string | null;
    characterId?: string;
    profileFingerprint?: string;
  }
): PortraitRequest {
  return normalizePortraitRequest({
    spec: PORTRAIT_REQUEST_SPEC,
    modelTemplate: settings.modelTemplate ?? PORTRAIT_TEMPLATE_ID,
    source: {
      conversationId: expression.source.conversationId,
      messageCount: expression.source.messageCount,
      messageIndex: expression.source.messageIndex,
      fingerprint: expression.source.fingerprint,
      expression: expression.output.expression,
      ...(settings.characterId === undefined ? {} : { characterId: settings.characterId }),
      ...(settings.profileFingerprint === undefined ? {} : { profileFingerprint: settings.profileFingerprint })
    },
    subject: settings.subject,
    setting: settings.setting,
    attire: settings.attire,
    lora: settings.lora,
    referenceImage: settings.referenceImage ?? null,
    promptOverride: settings.promptOverride ?? null,
    aspectRatio: settings.aspectRatio,
    megapixels: settings.megapixels,
    ...(settings.seed === undefined ? {} : { seed: settings.seed })
  });
}

export function normalizePortraitRequest(value: unknown): PortraitRequest {
  if (!isRecord(value)) throw new Error('portrait request must be an object');
  if (value.spec !== PORTRAIT_REQUEST_SPEC) throw new Error(`portrait spec must be ${PORTRAIT_REQUEST_SPEC}`);
  if (!isPortraitModelTemplate(value.modelTemplate)) throw new Error('unsupported portrait model template');
  const modelTemplate = value.modelTemplate;
  if (!isRecord(value.source)) throw new Error('portrait source must be an object');
  if (!isSidecarConversationId(value.source.conversationId)) throw new Error('portrait source conversationId must be a UUID');
  const messageCount = integer(value.source.messageCount, 'portrait source messageCount', 1, 1000);
  const messageIndex = integer(value.source.messageIndex, 'portrait source messageIndex', 0, 999);
  if (messageIndex !== messageCount - 1) throw new Error('portrait source must identify the latest response');
  if (typeof value.source.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.source.fingerprint)) {
    throw new Error('portrait source fingerprint is invalid');
  }
  if (!isExpressionLabel(value.source.expression)) throw new Error('portrait source expression is invalid');
  const hasCharacterId = value.source.characterId !== undefined;
  const hasProfileFingerprint = value.source.profileFingerprint !== undefined;
  if (hasCharacterId !== hasProfileFingerprint) throw new Error('portrait source profile binding is incomplete');
  let profileBinding: { characterId: string; profileFingerprint: string } | null = null;
  if (hasCharacterId) {
    if (typeof value.source.characterId !== 'string' || !PROFILE_ID_PATTERN.test(value.source.characterId)) {
      throw new Error('portrait source characterId is invalid');
    }
    if (typeof value.source.profileFingerprint !== 'string' || !PROFILE_FINGERPRINT_PATTERN.test(value.source.profileFingerprint)) {
      throw new Error('portrait source profile fingerprint is invalid');
    }
    profileBinding = {
      characterId: value.source.characterId,
      profileFingerprint: value.source.profileFingerprint
    };
  }
  const aspectRatio = value.aspectRatio;
  if (typeof aspectRatio !== 'string' || !aspectMap.has(aspectRatio as PortraitAspectRatio)) {
    throw new Error('unsupported portrait aspect ratio');
  }
  const megapixels = Number(value.megapixels);
  if (!megapixelSet.has(megapixels)) throw new Error('unsupported portrait megapixel target');
  let lora: string | null = null;
  if (value.lora !== null && value.lora !== undefined && value.lora !== '') {
    if (!isPortraitLoraName(value.lora)) throw new Error('portrait LoRA is invalid');
    lora = value.lora;
  }
  let referenceImage: PortraitReferenceImage | null = null;
  if (value.referenceImage !== null && value.referenceImage !== undefined) {
    if (!isRecord(value.referenceImage)
      || typeof value.referenceImage.name !== 'string'
      || !REFERENCE_IMAGE_PATTERN.test(value.referenceImage.name)
      || value.referenceImage.subfolder !== 'mullet/identity'
      || value.referenceImage.type !== 'input'
      || typeof value.referenceImage.sha256 !== 'string'
      || !SHA256_PATTERN.test(value.referenceImage.sha256)
      || typeof value.referenceImage.aspectRatio !== 'string'
      || !REFERENCE_ASPECT_RATIO_PATTERN.test(value.referenceImage.aspectRatio)) {
      throw new Error('portrait identity reference is invalid');
    }
    const width = integer(value.referenceImage.width, 'portrait identity reference width', 1, 8192);
    const height = integer(value.referenceImage.height, 'portrait identity reference height', 1, 8192);
    const aspectRatio = referenceAspectRatio(width, height);
    if (value.referenceImage.aspectRatio !== aspectRatio) {
      throw new Error(`portrait identity reference aspect ratio must be ${aspectRatio}`);
    }
    referenceImage = {
      name: value.referenceImage.name,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: value.referenceImage.sha256,
      width,
      height,
      aspectRatio
    };
  }
  if (isPortraitReferenceTemplateId(modelTemplate) && referenceImage === null) {
    throw new Error('reference-conditioned portrait requires an identity reference');
  }
  if (isPortraitReferenceTemplateId(modelTemplate) && lora !== null) {
    throw new Error('reference-conditioned portrait does not accept a Z-Image LoRA');
  }
  if (modelTemplate === PORTRAIT_TEMPLATE_ID && referenceImage !== null) {
    throw new Error('Z-Image portrait does not accept an identity reference');
  }
  const promptOverride = value.promptOverride === null || value.promptOverride === undefined
    ? null
    : textField(value.promptOverride, 'portrait prompt override', 1, 2000);
  if (promptOverride !== null && (!isPortraitReferenceTemplateId(modelTemplate) || profileBinding === null)) {
    throw new Error('portrait prompt override requires a profile-bound reference portrait');
  }
  const seed = value.seed === undefined
    ? undefined
    : integer(value.seed, 'portrait seed', 0, Number.MAX_SAFE_INTEGER);
  return {
    spec: PORTRAIT_REQUEST_SPEC,
    modelTemplate,
    source: {
      conversationId: value.source.conversationId,
      messageCount,
      messageIndex,
      fingerprint: value.source.fingerprint,
      expression: value.source.expression,
      ...(profileBinding ?? {})
    },
    subject: textField(value.subject, 'portrait subject', 1, 500),
    setting: textField(value.setting ?? '', 'portrait setting', 0, 500),
    attire: textField(value.attire ?? '', 'portrait attire', 0, 500),
    lora,
    referenceImage,
    promptOverride,
    aspectRatio: aspectRatio as PortraitAspectRatio,
    megapixels: megapixels as PortraitMegapixels,
    ...(seed === undefined ? {} : { seed })
  };
}

export function portraitRequestKey(request: PortraitRequest): string {
  const normalized = normalizePortraitRequest(request);
  return [
    normalized.source.conversationId,
    normalized.source.messageCount,
    normalized.source.messageIndex,
    normalized.source.fingerprint,
    normalized.source.expression,
    normalized.source.characterId ?? '',
    normalized.source.profileFingerprint ?? '',
    normalized.modelTemplate,
    normalized.subject,
    normalized.setting,
    normalized.attire,
    normalized.lora ?? '',
    normalized.referenceImage?.name ?? '',
    normalized.referenceImage?.sha256 ?? '',
    normalized.referenceImage?.width ?? '',
    normalized.referenceImage?.height ?? '',
    normalized.referenceImage?.aspectRatio ?? '',
    normalized.promptOverride ?? '',
    normalized.aspectRatio,
    normalized.megapixels,
    normalized.seed ?? 'random'
  ].join('\u001f');
}

export function buildPortraitPrompt(request: PortraitRequest): string {
  const normalized = normalizePortraitRequest(request);
  if (normalized.promptOverride) return normalized.promptOverride;
  const referenceConditioned = isPortraitReferenceTemplateId(normalized.modelTemplate);
  const clauses = [
    `head-and-chest portrait of ${normalized.subject}`,
    `${normalized.source.expression} facial expression`,
    normalized.attire ? `wearing ${normalized.attire}` : '',
    normalized.setting ? `in ${normalized.setting}` : '',
    portraitTemplate(normalized.modelTemplate).promptGuide
  ];
  const description = clauses.filter(Boolean).join(', ');
  return referenceConditioned
    ? normalized.modelTemplate === PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
      ? `Use the supplied canonical reference as the identity source. Preserve the exact same person, facial structure, eyes, nose, mouth, age, and hairstyle. Create a ${description}. Preserve identity; do not substitute another person. Do not add modern clothing details.`
      : `Keep the exact same person, facial structure, eyes, nose, mouth, age, and hairstyle from the supplied canonical reference. Reframe as a ${description}. Change only the expression, attire, and setting requested. Preserve identity; do not substitute another person or add modern clothing details.`
    : description;
}

export function buildZImageTurboWorkflow(request: PortraitRequest, seed: number): Record<string, unknown> {
  const normalized = normalizePortraitRequest(request);
  if (normalized.modelTemplate !== PORTRAIT_TEMPLATE_ID) throw new Error('Z-Image workflow requires the Z-Image template');
  const validatedSeed = integer(seed, 'portrait seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height } = portraitDimensions(normalized.aspectRatio, normalized.megapixels);
  const modelSource: [string, number] = normalized.lora ? ['11', 0] : ['1', 0];
  const clipSource: [string, number] = normalized.lora ? ['11', 1] : ['2', 0];
  const graph: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: Z_IMAGE_TURBO_TEMPLATE.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: Z_IMAGE_TURBO_TEMPLATE.modelFiles.clip, type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: Z_IMAGE_TURBO_TEMPLATE.modelFiles.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitPrompt(normalized), clip: clipSource } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: modelSource, shift: Z_IMAGE_TURBO_TEMPLATE.shift } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed: validatedSeed,
        steps: Z_IMAGE_TURBO_TEMPLATE.steps,
        cfg: Z_IMAGE_TURBO_TEMPLATE.cfg,
        sampler_name: Z_IMAGE_TURBO_TEMPLATE.sampler,
        scheduler: Z_IMAGE_TURBO_TEMPLATE.scheduler,
        denoise: 1,
        model: ['6', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['7', 0]
      }
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'mullet/portrait' } }
  };
  if (normalized.lora) {
    graph['11'] = {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['2', 0],
        lora_name: normalized.lora,
        strength_model: 1,
        strength_clip: 1
      }
    };
  }
  return graph;
}

export type QwenReferenceEditSettings = {
  referencePath: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix: 'mullet/portrait-reference' | 'mullet/portrait-generated-end-frame' | 'mullet/scene';
  referenceWidth?: number;
  referenceHeight?: number;
  containReference?: boolean;
};

export function buildQwenReferenceEditWorkflow(settings: QwenReferenceEditSettings): Record<string, unknown> {
  const template = QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE;
  const validatedSeed = integer(settings.seed, 'Qwen edit seed', 0, Number.MAX_SAFE_INTEGER);
  const width = integer(settings.width, 'Qwen edit width', 16, 8192);
  const height = integer(settings.height, 'Qwen edit height', 16, 8192);
  if (width % template.multiple !== 0 || height % template.multiple !== 0) {
    throw new Error(`Qwen edit dimensions must be divisible by ${template.multiple}`);
  }
  if (!/^mullet\/(?:identity|motion-inputs)\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(settings.referencePath)) {
    throw new Error('Qwen edit reference path is invalid');
  }
  const prompt = textField(settings.prompt, 'Qwen edit prompt', 1, 2000);
  let referenceSource: [string, number] = ['5', 0];
  const graph: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.vae } },
    '4': { class_type: 'LoadImage', inputs: { image: settings.referencePath } },
    '5': {
      class_type: 'ImageScale',
      inputs: { image: ['4', 0], upscale_method: 'lanczos', width, height, crop: 'center' }
    },
    '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: template.shift } },
    '7': { class_type: 'CFGNorm', inputs: { model: ['6', 0], strength: 1, pre_cfg: false } },
    '8': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['7', 0], lora_name: template.modelFiles.lora, strength_model: 1 } },
    '9': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: referenceSource, prompt } },
    '10': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: referenceSource, prompt: '' } },
    '11': { class_type: 'VAEEncode', inputs: { pixels: referenceSource, vae: ['3', 0] } },
    '12': {
      class_type: 'KSampler',
      inputs: {
        model: ['8', 0], positive: ['9', 0], negative: ['10', 0], latent_image: ['11', 0],
        seed: validatedSeed, steps: template.steps, cfg: template.cfg,
        sampler_name: template.sampler, scheduler: template.scheduler, denoise: 1
      }
    },
    '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['3', 0] } },
    '14': { class_type: 'SaveImage', inputs: { images: ['13', 0], filename_prefix: settings.filenamePrefix } }
  };
  if (settings.containReference) {
    const referenceWidth = integer(settings.referenceWidth, 'Qwen edit reference width', 16, 8192);
    const referenceHeight = integer(settings.referenceHeight, 'Qwen edit reference height', 16, 8192);
    const scale = Math.min(width / referenceWidth, height / referenceHeight);
    const scaledWidth = Math.max(8, Math.floor((referenceWidth * scale) / 8) * 8);
    const scaledHeight = Math.max(8, Math.floor((referenceHeight * scale) / 8) * 8);
    const remainingWidth = width - scaledWidth;
    const remainingHeight = height - scaledHeight;
    const left = Math.floor(remainingWidth / 16) * 8;
    const top = Math.floor(remainingHeight / 16) * 8;
    graph['5'] = {
      class_type: 'ImageScale',
      inputs: { image: ['4', 0], upscale_method: 'lanczos', width: scaledWidth, height: scaledHeight, crop: 'disabled' }
    };
    graph['15'] = {
      class_type: 'ImagePadForOutpaint',
      inputs: {
        image: ['5', 0],
        left,
        top,
        right: remainingWidth - left,
        bottom: remainingHeight - top,
        feathering: 40
      }
    };
    referenceSource = ['15', 0];
    (graph['9'] as { inputs: Record<string, unknown> }).inputs.image1 = referenceSource;
    (graph['10'] as { inputs: Record<string, unknown> }).inputs.image1 = referenceSource;
    (graph['11'] as { inputs: Record<string, unknown> }).inputs.pixels = referenceSource;
  }
  return graph;
}

export function buildQwenReferencePortraitWorkflow(request: PortraitRequest, seed: number): Record<string, unknown> {
  const normalized = normalizePortraitRequest(request);
  if (normalized.modelTemplate !== PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID || !normalized.referenceImage) {
    throw new Error('Qwen reference workflow requires a reference-conditioned portrait');
  }
  const { width, height } = portraitDimensions(normalized.aspectRatio, normalized.megapixels);
  return buildQwenReferenceEditWorkflow({
    referencePath: `${normalized.referenceImage.subfolder}/${normalized.referenceImage.name}`,
    prompt: buildPortraitPrompt(normalized),
    width,
    height,
    seed,
    filenamePrefix: 'mullet/portrait-reference'
  });
}

export function normalizePortraitCapabilities(value: unknown): PortraitCapabilities {
  if (!isRecord(value) || value.spec !== PORTRAIT_CAPABILITIES_SPEC) throw new Error('invalid portrait capabilities');
  if (!Array.isArray(value.templates) || value.templates.length !== PORTRAIT_TEMPLATES.length) {
    throw new Error('invalid portrait template capabilities');
  }
  const suppliedTemplates = value.templates;
  const templates = PORTRAIT_TEMPLATES.map((template): PortraitTemplateCapability => {
    const matching = suppliedTemplates.filter((candidate: unknown) => (
      isRecord(candidate) && isRecord(candidate.template) && candidate.template.id === template.id
    ));
    if (matching.length !== 1) throw new Error(`invalid portrait template capability for ${template.id}`);
    const capability = matching[0];
    if (!isRecord(capability)
      || typeof capability.available !== 'boolean'
      || !Array.isArray(capability.missing)
      || capability.missing.some((diagnostic) => (
        typeof diagnostic !== 'string' || diagnostic.length < 1 || diagnostic.length > 500
      ))) {
      throw new Error(`invalid portrait template diagnostics for ${template.id}`);
    }
    const missing = [...new Set(capability.missing as string[])];
    if (capability.available !== (missing.length === 0)) {
      throw new Error(`portrait template availability contradicts diagnostics for ${template.id}`);
    }
    return { template, available: capability.available, missing };
  });
  if (!Array.isArray(value.loras) || value.loras.some((lora) => !isPortraitLoraName(lora))) {
    throw new Error('invalid portrait LoRA inventory');
  }
  return {
    spec: PORTRAIT_CAPABILITIES_SPEC,
    templates,
    aspectRatios: PORTRAIT_ASPECT_RATIOS,
    megapixels: PORTRAIT_MEGAPIXELS,
    loras: [...new Set(value.loras)].sort()
  };
}
