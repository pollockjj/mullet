import {
  PORTRAIT_MEGAPIXELS,
  isPortraitSource,
  portraitDimensions,
  type PortraitAspectRatio,
  type PortraitSource
} from './portrait.ts';

export const PORTRAIT_VIDEO_REQUEST_SPEC = 'mullet_portrait_video_request_v1' as const;
export const PORTRAIT_VIDEO_TEMPLATE_ID = 'wan2.1-i2v-480p-v1' as const;
export const PORTRAIT_VIDEO_TIMEOUT_MS = 900_000 as const;
export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;
export const PORTRAIT_VIDEO_FPS = 16 as const;
export const PORTRAIT_VIDEO_FRAMES = 33 as const;

export const PORTRAIT_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '2:3', width: 480, height: 720 },
  { aspectRatio: '3:4', width: 480, height: 640 },
  { aspectRatio: '4:5', width: 512, height: 640 },
  { aspectRatio: '9:16', width: 432, height: 768 }
] as const);

export const WAN_PORTRAIT_VIDEO_TEMPLATE = Object.freeze({
  id: PORTRAIT_VIDEO_TEMPLATE_ID,
  label: 'Wan 2.1 I2V 480p',
  modelFamily: 'wan2.1-i2v',
  modelFiles: {
    unet: 'wan2.1_i2v_480p_14B_fp16.safetensors',
    clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    clipVision: 'clip_vision_h.safetensors',
    vae: 'wan_2.1_vae.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'CLIPVisionLoader',
    'VAELoader',
    'LoadImageOutput',
    'CLIPVisionEncode',
    'CLIPTextEncode',
    'WanImageToVideo',
    'ModelSamplingSD3',
    'KSampler',
    'VAEDecode',
    'SaveWEBM'
  ],
  outputNode: '13',
  multiple: 16,
  steps: 20,
  cfg: 6,
  sampler: 'uni_pc',
  scheduler: 'simple',
  shift: 8,
  codec: 'vp9',
  crf: 32,
  promptGuide: 'locked head-and-chest portrait camera, restrained natural motion, seamless end pose, no cuts'
} as const);

export type PortraitVideoSource = {
  conversationId: string;
  portraitRequestKey: string;
  portraitPromptId: string;
  portraitGeneratedAt: number;
  portraitWidth: number;
  portraitHeight: number;
  portraitSource: PortraitSource;
};

export type PortraitVideoRequest = {
  spec: typeof PORTRAIT_VIDEO_REQUEST_SPEC;
  modelTemplate: typeof PORTRAIT_VIDEO_TEMPLATE_ID;
  source: PortraitVideoSource;
  aspectRatio: PortraitAspectRatio;
  durationSeconds: typeof PORTRAIT_VIDEO_DURATION_SECONDS;
};

export type PortraitVideoCapabilities = {
  spec: 'mullet_portrait_video_capabilities_v1';
  template: typeof WAN_PORTRAIT_VIDEO_TEMPLATE;
  aspectRatios: typeof PORTRAIT_VIDEO_DIMENSIONS;
  durations: readonly [typeof PORTRAIT_VIDEO_DURATION_SECONDS];
};

export type PortraitVideoInputPortrait = {
  conversationId: string;
  requestKey: string;
  source: PortraitSource;
  promptId: string;
  width: number;
  height: number;
  generatedAt: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_IMAGE_PATTERN = /^mullet\/portrait_\d+_\.png$/;
const dimensionMap = new Map(PORTRAIT_VIDEO_DIMENSIONS.map((entry) => [entry.aspectRatio, entry]));

const NEGATIVE_PROMPT = 'oversaturated, overexposed, static frame, blurry details, subtitles, text, watermark, cartoon, painting, gray cast, worst quality, low quality, jpeg artifacts, deformed face, deformed hands, fused fingers, extra limbs, cluttered background, camera cuts, camera shake, black frames';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function portraitDimensionsMatch(width: number, height: number, aspectRatio: PortraitAspectRatio): boolean {
  return PORTRAIT_MEGAPIXELS.some((megapixels) => {
    const dimensions = portraitDimensions(aspectRatio, megapixels);
    return dimensions.width === width && dimensions.height === height;
  });
}

export function portraitVideoDimensions(aspectRatio: PortraitAspectRatio): { width: number; height: number; frames: number; fps: number } {
  const dimensions = dimensionMap.get(aspectRatio);
  if (!dimensions) throw new Error('unsupported portrait-video aspect ratio');
  return {
    width: dimensions.width,
    height: dimensions.height,
    frames: PORTRAIT_VIDEO_FRAMES,
    fps: PORTRAIT_VIDEO_FPS
  };
}

export function buildPortraitVideoRequest(
  portrait: PortraitVideoInputPortrait,
  aspectRatio: PortraitAspectRatio
): PortraitVideoRequest {
  return normalizePortraitVideoRequest({
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    source: {
      conversationId: portrait.conversationId,
      portraitRequestKey: portrait.requestKey,
      portraitPromptId: portrait.promptId,
      portraitGeneratedAt: portrait.generatedAt,
      portraitWidth: portrait.width,
      portraitHeight: portrait.height,
      portraitSource: portrait.source
    },
    aspectRatio,
    durationSeconds: PORTRAIT_VIDEO_DURATION_SECONDS
  });
}

export function isPortraitVideoSource(value: unknown): value is PortraitVideoSource {
  if (!isRecord(value) || !isPortraitSource(value.portraitSource)) return false;
  return value.conversationId === value.portraitSource.conversationId
    && typeof value.portraitRequestKey === 'string'
    && value.portraitRequestKey.length >= 1
    && value.portraitRequestKey.length <= 5000
    && typeof value.portraitPromptId === 'string'
    && UUID_PATTERN.test(value.portraitPromptId)
    && Number.isSafeInteger(value.portraitGeneratedAt)
    && Number(value.portraitGeneratedAt) >= 1
    && Number.isSafeInteger(value.portraitWidth)
    && Number(value.portraitWidth) >= 16
    && Number(value.portraitWidth) <= 8192
    && Number.isSafeInteger(value.portraitHeight)
    && Number(value.portraitHeight) >= 16
    && Number(value.portraitHeight) <= 8192;
}

export function normalizePortraitVideoRequest(value: unknown): PortraitVideoRequest {
  if (!isRecord(value)) throw new Error('portrait-video request must be an object');
  if (value.spec !== PORTRAIT_VIDEO_REQUEST_SPEC) throw new Error(`portrait-video spec must be ${PORTRAIT_VIDEO_REQUEST_SPEC}`);
  if (value.modelTemplate !== PORTRAIT_VIDEO_TEMPLATE_ID) throw new Error('unsupported portrait-video model template');
  if (!isPortraitVideoSource(value.source)) throw new Error('portrait-video source is invalid');
  const aspectRatio = value.aspectRatio;
  if (typeof aspectRatio !== 'string' || !dimensionMap.has(aspectRatio as PortraitAspectRatio)) {
    throw new Error('unsupported portrait-video aspect ratio');
  }
  if (value.durationSeconds !== PORTRAIT_VIDEO_DURATION_SECONDS) throw new Error('unsupported portrait-video duration');
  const portraitWidth = integer(value.source.portraitWidth, 'portrait-video source width', 16, 8192);
  const portraitHeight = integer(value.source.portraitHeight, 'portrait-video source height', 16, 8192);
  if (!portraitDimensionsMatch(portraitWidth, portraitHeight, aspectRatio as PortraitAspectRatio)) {
    throw new Error('portrait-video source dimensions do not match the selected portrait aspect ratio');
  }
  return {
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    source: {
      conversationId: value.source.conversationId,
      portraitRequestKey: value.source.portraitRequestKey,
      portraitPromptId: value.source.portraitPromptId,
      portraitGeneratedAt: Number(value.source.portraitGeneratedAt),
      portraitWidth,
      portraitHeight,
      portraitSource: value.source.portraitSource
    },
    aspectRatio: aspectRatio as PortraitAspectRatio,
    durationSeconds: PORTRAIT_VIDEO_DURATION_SECONDS
  };
}

export function portraitVideoRequestKey(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return [
    normalized.source.conversationId,
    normalized.source.portraitRequestKey,
    normalized.source.portraitPromptId,
    normalized.source.portraitGeneratedAt,
    normalized.modelTemplate,
    normalized.aspectRatio,
    normalized.durationSeconds
  ].join('\u001f');
}

export function buildPortraitVideoPrompt(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return [
    'The camera remains completely locked on the head-and-chest portrait.',
    `The subject breathes naturally, blinks once, and holds a restrained ${normalized.source.portraitSource.expression} expression.`,
    'Hair and clothing move subtly.',
    'The final pose matches the first pose for a seamless loop.',
    'No camera movement, no cuts, no speech, no text, no black frames.'
  ].join(' ');
}

export function buildWanPortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitOutputPath: string,
  seed: number
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  if (!OUTPUT_IMAGE_PATTERN.test(portraitOutputPath)) throw new Error('portrait-video input path is invalid');
  const validatedSeed = integer(seed, 'portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = portraitVideoDimensions(normalized.aspectRatio);
  return {
    '1': { class_type: 'LoadImageOutput', inputs: { image: portraitOutputPath } },
    '2': { class_type: 'UNETLoader', inputs: { unet_name: WAN_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet, weight_dtype: 'default' } },
    '3': { class_type: 'CLIPLoader', inputs: { clip_name: WAN_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip, type: 'wan', device: 'default' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: WAN_PORTRAIT_VIDEO_TEMPLATE.modelFiles.vae } },
    '5': { class_type: 'CLIPVisionLoader', inputs: { clip_name: WAN_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clipVision } },
    '6': { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['5', 0], image: ['1', 0], crop: 'none' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitVideoPrompt(normalized), clip: ['3', 0] } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['3', 0] } },
    '9': { class_type: 'ModelSamplingSD3', inputs: { model: ['2', 0], shift: WAN_PORTRAIT_VIDEO_TEMPLATE.shift } },
    '10': {
      class_type: 'WanImageToVideo',
      inputs: {
        positive: ['7', 0],
        negative: ['8', 0],
        vae: ['4', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        clip_vision_output: ['6', 0],
        start_image: ['1', 0]
      }
    },
    '11': {
      class_type: 'KSampler',
      inputs: {
        model: ['9', 0],
        seed: validatedSeed,
        steps: WAN_PORTRAIT_VIDEO_TEMPLATE.steps,
        cfg: WAN_PORTRAIT_VIDEO_TEMPLATE.cfg,
        sampler_name: WAN_PORTRAIT_VIDEO_TEMPLATE.sampler,
        scheduler: WAN_PORTRAIT_VIDEO_TEMPLATE.scheduler,
        positive: ['10', 0],
        negative: ['10', 1],
        latent_image: ['10', 2],
        denoise: 1
      }
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['4', 0] } },
    '13': {
      class_type: 'SaveWEBM',
      inputs: {
        images: ['12', 0],
        filename_prefix: 'mullet/portrait-motion',
        codec: WAN_PORTRAIT_VIDEO_TEMPLATE.codec,
        fps,
        crf: WAN_PORTRAIT_VIDEO_TEMPLATE.crf
      }
    }
  };
}

export function normalizePortraitVideoCapabilities(value: unknown): PortraitVideoCapabilities {
  if (!isRecord(value) || value.spec !== 'mullet_portrait_video_capabilities_v1') {
    throw new Error('invalid portrait-video capabilities');
  }
  if (!isRecord(value.template) || value.template.id !== PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('invalid portrait-video template');
  }
  return {
    spec: 'mullet_portrait_video_capabilities_v1',
    template: WAN_PORTRAIT_VIDEO_TEMPLATE,
    aspectRatios: PORTRAIT_VIDEO_DIMENSIONS,
    durations: [PORTRAIT_VIDEO_DURATION_SECONDS]
  };
}
