import {
  isExpressionLabel,
  isSidecarConversationId,
  type ExpressionLabel,
  type ExpressionSidecarResult
} from './sidecar.ts';

export const PORTRAIT_REQUEST_SPEC = 'mullet_portrait_request_v1' as const;
export const PORTRAIT_TEMPLATE_ID = 'z-image-turbo-v1' as const;
export const PORTRAIT_TIMEOUT_MS = 120_000 as const;

export const PORTRAIT_ASPECT_RATIOS = Object.freeze([
  { id: '2:3', width: 2, height: 3, label: '2:3' },
  { id: '3:4', width: 3, height: 4, label: '3:4' },
  { id: '4:5', width: 4, height: 5, label: '4:5' },
  { id: '9:16', width: 9, height: 16, label: '9:16' }
] as const);

export const PORTRAIT_MEGAPIXELS = Object.freeze([0.5, 0.75, 0.9, 1, 1.5, 2] as const);

export type PortraitAspectRatio = (typeof PORTRAIT_ASPECT_RATIOS)[number]['id'];
export type PortraitMegapixels = (typeof PORTRAIT_MEGAPIXELS)[number];

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
  loraPrefix: 'zimage/',
  multiple: 16,
  outputNode: '10',
  steps: 8,
  cfg: 1,
  sampler: 'res_multistep',
  scheduler: 'simple',
  shift: 3
} as const);

export type PortraitSource = {
  conversationId: string;
  messageCount: number;
  messageIndex: number;
  fingerprint: string;
  expression: ExpressionLabel;
};

export type PortraitRequest = {
  spec: typeof PORTRAIT_REQUEST_SPEC;
  modelTemplate: typeof PORTRAIT_TEMPLATE_ID;
  source: PortraitSource;
  subject: string;
  setting: string;
  attire: string;
  lora: string | null;
  aspectRatio: PortraitAspectRatio;
  megapixels: PortraitMegapixels;
  seed?: number;
};

export type PortraitCapabilities = {
  spec: 'mullet_portrait_capabilities_v1';
  template: typeof Z_IMAGE_TURBO_TEMPLATE;
  aspectRatios: typeof PORTRAIT_ASPECT_RATIOS;
  megapixels: typeof PORTRAIT_MEGAPIXELS;
  loras: string[];
};

const FINGERPRINT_PATTERN = /^\d+:[0-9a-f]{8}$/;
const LORA_PATTERN = /^zimage\/[A-Za-z0-9][A-Za-z0-9._ -]*\.safetensors$/;
const aspectMap = new Map(PORTRAIT_ASPECT_RATIOS.map((ratio) => [ratio.id, ratio]));
const megapixelSet = new Set<number>(PORTRAIT_MEGAPIXELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function buildPortraitRequest(
  expression: ExpressionSidecarResult,
  settings: Omit<PortraitRequest, 'spec' | 'modelTemplate' | 'source'>
): PortraitRequest {
  return normalizePortraitRequest({
    spec: PORTRAIT_REQUEST_SPEC,
    modelTemplate: PORTRAIT_TEMPLATE_ID,
    source: {
      conversationId: expression.source.conversationId,
      messageCount: expression.source.messageCount,
      messageIndex: expression.source.messageIndex,
      fingerprint: expression.source.fingerprint,
      expression: expression.output.expression
    },
    ...settings
  });
}

export function normalizePortraitRequest(value: unknown): PortraitRequest {
  if (!isRecord(value)) throw new Error('portrait request must be an object');
  if (value.spec !== PORTRAIT_REQUEST_SPEC) throw new Error(`portrait spec must be ${PORTRAIT_REQUEST_SPEC}`);
  if (value.modelTemplate !== PORTRAIT_TEMPLATE_ID) throw new Error('unsupported portrait model template');
  if (!isRecord(value.source)) throw new Error('portrait source must be an object');
  if (!isSidecarConversationId(value.source.conversationId)) throw new Error('portrait source conversationId must be a UUID');
  const messageCount = integer(value.source.messageCount, 'portrait source messageCount', 1, 1000);
  const messageIndex = integer(value.source.messageIndex, 'portrait source messageIndex', 0, 999);
  if (messageIndex !== messageCount - 1) throw new Error('portrait source must identify the latest response');
  if (typeof value.source.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.source.fingerprint)) {
    throw new Error('portrait source fingerprint is invalid');
  }
  if (!isExpressionLabel(value.source.expression)) throw new Error('portrait source expression is invalid');
  const aspectRatio = value.aspectRatio;
  if (typeof aspectRatio !== 'string' || !aspectMap.has(aspectRatio as PortraitAspectRatio)) {
    throw new Error('unsupported portrait aspect ratio');
  }
  const megapixels = Number(value.megapixels);
  if (!megapixelSet.has(megapixels)) throw new Error('unsupported portrait megapixel target');
  let lora: string | null = null;
  if (value.lora !== null && value.lora !== undefined && value.lora !== '') {
    if (typeof value.lora !== 'string' || !LORA_PATTERN.test(value.lora)) throw new Error('portrait LoRA is invalid');
    lora = value.lora;
  }
  const seed = value.seed === undefined
    ? undefined
    : integer(value.seed, 'portrait seed', 0, Number.MAX_SAFE_INTEGER);
  return {
    spec: PORTRAIT_REQUEST_SPEC,
    modelTemplate: PORTRAIT_TEMPLATE_ID,
    source: {
      conversationId: value.source.conversationId,
      messageCount,
      messageIndex,
      fingerprint: value.source.fingerprint,
      expression: value.source.expression
    },
    subject: textField(value.subject, 'portrait subject', 1, 500),
    setting: textField(value.setting ?? '', 'portrait setting', 0, 500),
    attire: textField(value.attire ?? '', 'portrait attire', 0, 500),
    lora,
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
    normalized.modelTemplate,
    normalized.subject,
    normalized.setting,
    normalized.attire,
    normalized.lora ?? '',
    normalized.aspectRatio,
    normalized.megapixels,
    normalized.seed ?? 'random'
  ].join('\u001f');
}

export function buildPortraitPrompt(request: PortraitRequest): string {
  const normalized = normalizePortraitRequest(request);
  const clauses = [
    `head-and-chest portrait of ${normalized.subject}`,
    `${normalized.source.expression} facial expression`,
    normalized.attire ? `wearing ${normalized.attire}` : '',
    normalized.setting ? `in ${normalized.setting}` : '',
    Z_IMAGE_TURBO_TEMPLATE.promptGuide
  ];
  return clauses.filter(Boolean).join(', ');
}

export function buildZImageTurboWorkflow(request: PortraitRequest, seed: number): Record<string, unknown> {
  const normalized = normalizePortraitRequest(request);
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

export function normalizePortraitCapabilities(value: unknown): PortraitCapabilities {
  if (!isRecord(value) || value.spec !== 'mullet_portrait_capabilities_v1') throw new Error('invalid portrait capabilities');
  if (!isRecord(value.template) || value.template.id !== PORTRAIT_TEMPLATE_ID) throw new Error('invalid portrait template');
  if (!Array.isArray(value.loras) || value.loras.some((lora) => typeof lora !== 'string' || !LORA_PATTERN.test(lora))) {
    throw new Error('invalid portrait LoRA inventory');
  }
  return {
    spec: 'mullet_portrait_capabilities_v1',
    template: Z_IMAGE_TURBO_TEMPLATE,
    aspectRatios: PORTRAIT_ASPECT_RATIOS,
    megapixels: PORTRAIT_MEGAPIXELS,
    loras: [...new Set(value.loras)].sort()
  };
}
