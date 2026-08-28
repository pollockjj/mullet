import {
  PORTRAIT_MEGAPIXELS,
  isPortraitSource,
  portraitDimensions,
  type PortraitAspectRatio,
  type PortraitSource
} from './portrait.ts';

export const PORTRAIT_VIDEO_REQUEST_SPEC = 'mullet_portrait_video_request_v4' as const;
export const PORTRAIT_VIDEO_CAPABILITIES_SPEC = 'mullet_portrait_video_capabilities_v4' as const;
export const PORTRAIT_VIDEO_TEMPLATE_ID = 'minimax-h3-fl2va-portrait-v1' as const;
export const PORTRAIT_END_FRAME_TEMPLATE_ID = 'mage-flow-edit-turbo-4step-v1' as const;
export const PORTRAIT_VIDEO_TIMEOUT_MS = 900_000 as const;
export const PORTRAIT_VIDEO_DURATION_SECONDS = 3 as const;
export const PORTRAIT_VIDEO_DURATIONS = Object.freeze([3, 5] as const);
export const PORTRAIT_VIDEO_FPS = 24 as const;
export const PORTRAIT_VIDEO_FRAMES = 73 as const;
export const PORTRAIT_VIDEO_MODE_I2V = 'i2v' as const;
export const PORTRAIT_VIDEO_MODE_LOOP_FLF = 'flf2v_loop' as const;
export const PORTRAIT_VIDEO_MODE_GENERATED_FLF = 'flf2v_generated' as const;

export const PORTRAIT_VIDEO_MODES = Object.freeze([
  { id: PORTRAIT_VIDEO_MODE_I2V, label: 'Image to video' },
  { id: PORTRAIT_VIDEO_MODE_LOOP_FLF, label: 'Looping first/last frame' },
  { id: PORTRAIT_VIDEO_MODE_GENERATED_FLF, label: 'Generated second-frame FLF' }
] as const);

export type PortraitVideoMode = (typeof PORTRAIT_VIDEO_MODES)[number]['id'];
export type PortraitVideoModeDefinition = (typeof PORTRAIT_VIDEO_MODES)[number];
export type PortraitVideoDurationSeconds = (typeof PORTRAIT_VIDEO_DURATIONS)[number];

export const PORTRAIT_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '2:3', width: 768, height: 1152 }
] as const);

export const MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE = Object.freeze({
  id: PORTRAIT_VIDEO_TEMPLATE_ID,
  label: 'MiniMax H3 FL2VA Turbo',
  modelFamily: 'minimax-h3-fl2va',
  modelFiles: {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
    videoVae: 'minimax_h3_video_vae_fp16.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
    turboLora: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'LoadImage',
    'MiniMaxH3ImageToVideo',
    'BasicGuider',
    'KSamplerSelect',
    'BasicScheduler',
    'RandomNoise',
    'SamplerCustomAdvanced',
    'VAEDecode',
    'VAEDecodeAudio',
    'CreateVideo',
    'SaveVideo',
    'LoraLoaderModelOnly'
  ],
  outputNode: '15',
  multiple: 32,
  shortEdge: 768,
  maxPixels: 768 * 1344,
  sampler: 'res_multistep',
  scheduler: 'simple',
  steps: 4,
  denoise: 1,
  format: 'auto',
  codec: 'auto',
  bitDepth: 8,
  promptGuide: 'locked head-and-chest portrait, restrained natural motion, identical first/last-frame loop, native quiet ambience, no cuts'
} as const);

export const MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE = Object.freeze({
  id: PORTRAIT_END_FRAME_TEMPLATE_ID,
  label: 'Mage-Flow Edit Turbo',
  modelFamily: 'mage-flow-edit',
  workflowRevision: 'b972309e5337293cc003bb19d19aec4681fff623',
  workflowSha256: '4c011982fda515bf7a3e459785b13277d93d622419de61752072e8717ef5c1f6',
  modelFiles: {
    unet: 'mage_flow_edit_turbo_int8_convrot.safetensors',
    clip: 'qwen3vl_4b_bf16.safetensors',
    vae: 'mage_flow_vae_bf16.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'LoadImage',
    'TextEncodeMageFlowEdit',
    'KSampler',
    'VAEDecode',
    'SaveImage'
  ],
  outputNode: '8',
  steps: 4,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple'
} as const);

export type PortraitVideoSource = {
  conversationId: string;
  portraitRequestKey: string;
  portraitPromptId: string;
  portraitSeed: number;
  portraitGeneratedAt: number;
  portraitWidth: number;
  portraitHeight: number;
  portraitImageSha256: string;
  portraitSource: PortraitSource;
};

export type PortraitVideoRequest = {
  spec: typeof PORTRAIT_VIDEO_REQUEST_SPEC;
  modelTemplate: typeof PORTRAIT_VIDEO_TEMPLATE_ID;
  endFrameModelTemplate: typeof PORTRAIT_END_FRAME_TEMPLATE_ID | null;
  mode: PortraitVideoMode;
  source: PortraitVideoSource;
  aspectRatio: PortraitAspectRatio;
  durationSeconds: PortraitVideoDurationSeconds;
};

export type PortraitVideoCapabilities = {
  spec: typeof PORTRAIT_VIDEO_CAPABILITIES_SPEC;
  template: typeof MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE;
  endFrameTemplate: typeof MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE | null;
  modes: readonly PortraitVideoModeDefinition[];
  aspectRatios: typeof PORTRAIT_VIDEO_DIMENSIONS;
  durations: typeof PORTRAIT_VIDEO_DURATIONS;
};

export type PortraitVideoInputPortrait = {
  conversationId: string;
  requestKey: string;
  source: PortraitSource;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  generatedAt: number;
};

export type PortraitVideoInputReference = {
  name: string;
  subfolder: 'mullet/motion-inputs';
  type: 'input';
  imageSha256: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_IMAGE_PATTERN = /^portrait-motion-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const dimensionMap = new Map(PORTRAIT_VIDEO_DIMENSIONS.map((entry) => [entry.aspectRatio, entry]));
const durationFrameMap = new Map<PortraitVideoDurationSeconds, number>([
  [3, PORTRAIT_VIDEO_FRAMES],
  [5, 124]
]);

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

export function portraitVideoDimensions(
  aspectRatio: PortraitAspectRatio,
  durationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS
): { width: number; height: number; frames: number; fps: number } {
  const dimensions = dimensionMap.get(aspectRatio);
  if (!dimensions) throw new Error('unsupported portrait-video aspect ratio');
  const frames = durationFrameMap.get(durationSeconds);
  if (!frames) throw new Error('unsupported portrait-video duration');
  return {
    width: dimensions.width,
    height: dimensions.height,
    frames,
    fps: PORTRAIT_VIDEO_FPS
  };
}

export function buildPortraitVideoRequest(
  portrait: PortraitVideoInputPortrait,
  aspectRatio: PortraitAspectRatio,
  imageSha256: string,
  mode: PortraitVideoMode = PORTRAIT_VIDEO_MODE_LOOP_FLF,
  durationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS
): PortraitVideoRequest {
  return normalizePortraitVideoRequest({
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    mode,
    source: {
      conversationId: portrait.conversationId,
      portraitRequestKey: portrait.requestKey,
      portraitPromptId: portrait.promptId,
      portraitSeed: portrait.seed,
      portraitGeneratedAt: portrait.generatedAt,
      portraitWidth: portrait.width,
      portraitHeight: portrait.height,
      portraitImageSha256: imageSha256,
      portraitSource: portrait.source
    },
    endFrameModelTemplate: mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF ? PORTRAIT_END_FRAME_TEMPLATE_ID : null,
    aspectRatio,
    durationSeconds
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
    && Number.isSafeInteger(value.portraitSeed)
    && Number(value.portraitSeed) >= 0
    && Number.isSafeInteger(value.portraitGeneratedAt)
    && Number(value.portraitGeneratedAt) >= 1
    && Number.isSafeInteger(value.portraitWidth)
    && Number(value.portraitWidth) >= 16
    && Number(value.portraitWidth) <= 8192
    && Number.isSafeInteger(value.portraitHeight)
    && Number(value.portraitHeight) >= 16
    && Number(value.portraitHeight) <= 8192
    && typeof value.portraitImageSha256 === 'string'
    && SHA256_PATTERN.test(value.portraitImageSha256);
}

export function normalizePortraitVideoRequest(value: unknown): PortraitVideoRequest {
  if (!isRecord(value)) throw new Error('portrait-video request must be an object');
  if (value.spec !== PORTRAIT_VIDEO_REQUEST_SPEC) throw new Error(`portrait-video spec must be ${PORTRAIT_VIDEO_REQUEST_SPEC}`);
  if (value.modelTemplate !== PORTRAIT_VIDEO_TEMPLATE_ID) throw new Error('unsupported portrait-video model template');
  if (!PORTRAIT_VIDEO_MODES.some((entry) => entry.id === value.mode)) throw new Error('unsupported portrait-video mode');
  const expectedEndFrameTemplate = value.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF ? PORTRAIT_END_FRAME_TEMPLATE_ID : null;
  if (value.endFrameModelTemplate !== expectedEndFrameTemplate) throw new Error('portrait-video end-frame template does not match its mode');
  if (!isPortraitVideoSource(value.source)) throw new Error('portrait-video source is invalid');
  const aspectRatio = value.aspectRatio;
  if (typeof aspectRatio !== 'string' || !dimensionMap.has(aspectRatio as PortraitAspectRatio)) {
    throw new Error('unsupported portrait-video aspect ratio');
  }
  const durationSeconds = value.durationSeconds;
  if (typeof durationSeconds !== 'number' || !durationFrameMap.has(durationSeconds as PortraitVideoDurationSeconds)) {
    throw new Error('unsupported portrait-video duration');
  }
  const portraitWidth = integer(value.source.portraitWidth, 'portrait-video source width', 16, 8192);
  const portraitHeight = integer(value.source.portraitHeight, 'portrait-video source height', 16, 8192);
  if (!portraitDimensionsMatch(portraitWidth, portraitHeight, aspectRatio as PortraitAspectRatio)) {
    throw new Error('portrait-video source dimensions do not match the selected portrait aspect ratio');
  }
  return {
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    endFrameModelTemplate: expectedEndFrameTemplate,
    mode: value.mode as PortraitVideoMode,
    source: {
      conversationId: value.source.conversationId,
      portraitRequestKey: value.source.portraitRequestKey,
      portraitPromptId: value.source.portraitPromptId,
      portraitSeed: Number(value.source.portraitSeed),
      portraitGeneratedAt: Number(value.source.portraitGeneratedAt),
      portraitWidth,
      portraitHeight,
      portraitImageSha256: value.source.portraitImageSha256,
      portraitSource: value.source.portraitSource
    },
    aspectRatio: aspectRatio as PortraitAspectRatio,
    durationSeconds: durationSeconds as PortraitVideoDurationSeconds
  };
}

export function portraitVideoRequestKey(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return [
    normalized.source.conversationId,
    normalized.source.portraitRequestKey,
    normalized.source.portraitPromptId,
    normalized.source.portraitSeed,
    normalized.source.portraitGeneratedAt,
    normalized.source.portraitWidth,
    normalized.source.portraitHeight,
    normalized.source.portraitImageSha256,
    normalized.source.portraitSource.messageCount,
    normalized.source.portraitSource.messageIndex,
    normalized.source.portraitSource.fingerprint,
    normalized.source.portraitSource.expression,
    normalized.modelTemplate,
    normalized.endFrameModelTemplate ?? '',
    normalized.mode,
    normalized.aspectRatio,
    normalized.durationSeconds
  ].join('\u001f');
}

export function buildPortraitVideoPrompt(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  const loopInstruction = normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF
    ? 'The identical supplied portrait is the first and final keyframe; motion returns exactly to that final keyframe.'
    : normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF
      ? 'The supplied portraits are the first and final keyframes; move continuously from the first pose to the distinct final pose.'
      : 'Continue natural motion forward from the supplied first frame.';
  return [
    'The camera remains completely locked on the head-and-chest portrait.',
    `The subject breathes naturally, blinks once, and holds a restrained ${normalized.source.portraitSource.expression} expression.`,
    'Hair and clothing move subtly.',
    loopInstruction,
    'No camera movement, no cuts, no speech, no text, no black frames.',
    'Audio: quiet synchronized room tone and subtle clothing or hair movement only; no dialogue, narration, or music.'
  ].join(' ');
}

export function portraitVideoEndFrameSeed(videoSeed: number): number {
  const seed = integer(videoSeed, 'portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  return seed === Number.MAX_SAFE_INTEGER ? 0 : seed + 1;
}

export function buildPortraitEndFramePrompt(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.mode !== PORTRAIT_VIDEO_MODE_GENERATED_FLF) throw new Error('portrait-video mode does not generate an end frame');
  return [
    'Preserve the exact same subject, face, identity, hairstyle, attire, lighting, camera framing, and background.',
    `Show the next instant: the subject turns their head slightly and shifts their gaze to the side with a subtle natural ${normalized.source.portraitSource.expression} expression change.`,
    'Keep the head-and-chest portrait composition and photorealistic cinematic detail.',
    'Do not add or remove objects. No text or watermark.'
  ].join(' ');
}

function validatePortraitVideoInputReference(
  input: PortraitVideoInputReference,
  expectedSha256?: string
): void {
  if (
    input.subfolder !== 'mullet/motion-inputs'
    || input.type !== 'input'
    || !SHA256_PATTERN.test(input.imageSha256)
    || (expectedSha256 !== undefined && input.imageSha256 !== expectedSha256)
    || !INPUT_IMAGE_PATTERN.test(input.name)
  ) throw new Error('portrait-video input reference is invalid');
}

export function buildMageFlowPortraitEndFrameWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.mode !== PORTRAIT_VIDEO_MODE_GENERATED_FLF) throw new Error('portrait-video mode does not generate an end frame');
  validatePortraitVideoInputReference(portraitInput, normalized.source.portraitImageSha256);
  const validatedSeed = integer(seed, 'portrait end-frame seed', 0, Number.MAX_SAFE_INTEGER);
  const template = MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'mage', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.vae } },
    '4': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '5': {
      class_type: 'TextEncodeMageFlowEdit',
      inputs: {
        clip: ['2', 0],
        prompt: buildPortraitEndFramePrompt(normalized),
        negative_prompt: '',
        vae: ['3', 0],
        'images.image_1': ['4', 0],
        width: normalized.source.portraitWidth,
        height: normalized.source.portraitHeight,
        batch_size: 1
      }
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: ['5', 2],
        seed: validatedSeed,
        steps: template.steps,
        cfg: template.cfg,
        sampler_name: template.sampler,
        scheduler: template.scheduler,
        denoise: 1
      }
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'mullet/portrait-generated-end-frame' } }
  };
}

export function buildMiniMaxH3PortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number,
  endFrameInput?: PortraitVideoInputReference
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  validatePortraitVideoInputReference(portraitInput, normalized.source.portraitImageSha256);
  const validatedSeed = integer(seed, 'portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = portraitVideoDimensions(normalized.aspectRatio, normalized.durationSeconds);
  let lastFrame: [string, number] | null = null;
  if (normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF) {
    if (endFrameInput !== undefined) throw new Error('portrait-video loop mode does not accept a separate end frame');
    lastFrame = ['5', 0];
  } else if (normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF) {
    if (!endFrameInput) throw new Error('portrait-video generated end-frame input is required');
    validatePortraitVideoInputReference(endFrameInput);
    if (endFrameInput.imageSha256 === portraitInput.imageSha256) {
      throw new Error('portrait-video generated end frame must differ from its source');
    }
    lastFrame = ['17', 0];
  } else if (endFrameInput !== undefined) {
    throw new Error('portrait-video I2V mode does not accept an end frame');
  }
  const template = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE;
  const filenamePrefix = normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF
    ? 'mullet/portrait-motion-generated-flf'
    : normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF
      ? 'mullet/portrait-motion-loop-flf'
      : 'mullet/portrait-motion';
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '5': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '6': { class_type: 'MiniMaxH3ImageToVideo', inputs: {
      clip: ['2', 0],
      vae: ['3', 0],
      prompt: buildPortraitVideoPrompt(normalized),
      width,
      height,
      length: frames,
      first_frame: ['5', 0],
      ...(lastFrame ? { last_frame: lastFrame } : {})
    } },
    '7': { class_type: 'BasicGuider', inputs: { model: ['16', 0], conditioning: ['6', 0] } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['16', 0], scheduler: template.scheduler, steps: template.steps, denoise: template.denoise } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['6', 1] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'VAEDecodeAudio', inputs: { samples: ['11', 0], vae: ['4', 0] } },
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps, audio: ['13', 0], bit_depth: template.bitDepth } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: filenamePrefix, format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } },
    ...(normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF && endFrameInput
      ? { '17': { class_type: 'LoadImage', inputs: { image: `${endFrameInput.subfolder}/${endFrameInput.name}` } } }
      : {})
  };
}

export function portraitVideoOutputNode(request: PortraitVideoRequest): string {
  normalizePortraitVideoRequest(request);
  return MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.outputNode;
}

export function normalizePortraitVideoCapabilities(value: unknown): PortraitVideoCapabilities {
  if (!isRecord(value) || value.spec !== PORTRAIT_VIDEO_CAPABILITIES_SPEC) {
    throw new Error('invalid portrait-video capabilities');
  }
  if (!isRecord(value.template) || value.template.id !== PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('invalid portrait-video template');
  }
  if (!Array.isArray(value.modes) || value.modes.length < 1) throw new Error('invalid portrait-video modes');
  const modeIds = value.modes.map((mode) => isRecord(mode) ? mode.id : null);
  if (modeIds.some((id) => !PORTRAIT_VIDEO_MODES.some((mode) => mode.id === id)) || new Set(modeIds).size !== modeIds.length) {
    throw new Error('invalid portrait-video modes');
  }
  const modes = PORTRAIT_VIDEO_MODES.filter((mode) => modeIds.includes(mode.id));
  const hasGeneratedEndFrame = modes.some((mode) => mode.id === PORTRAIT_VIDEO_MODE_GENERATED_FLF);
  if (hasGeneratedEndFrame !== (isRecord(value.endFrameTemplate) && value.endFrameTemplate.id === PORTRAIT_END_FRAME_TEMPLATE_ID)) {
    throw new Error('invalid portrait-video end-frame template');
  }
  const durations = value.durations;
  if (
    !Array.isArray(durations)
    || durations.length !== PORTRAIT_VIDEO_DURATIONS.length
    || !PORTRAIT_VIDEO_DURATIONS.every((duration, index) => durations[index] === duration)
  ) throw new Error('invalid portrait-video durations');
  return {
    spec: PORTRAIT_VIDEO_CAPABILITIES_SPEC,
    template: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE,
    endFrameTemplate: hasGeneratedEndFrame ? MAGE_FLOW_EDIT_PORTRAIT_END_FRAME_TEMPLATE : null,
    modes,
    aspectRatios: PORTRAIT_VIDEO_DIMENSIONS,
    durations: PORTRAIT_VIDEO_DURATIONS
  };
}
