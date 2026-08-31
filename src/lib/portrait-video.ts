import {
  PORTRAIT_MEGAPIXELS,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  buildQwenReferenceEditWorkflow,
  isPortraitSource,
  portraitDimensions,
  type PortraitAspectRatio,
  type PortraitSource
} from './portrait.ts';

export const PORTRAIT_VIDEO_REQUEST_SPEC = 'mullet_portrait_video_request_v8' as const;
export const PORTRAIT_VIDEO_CAPABILITIES_SPEC = 'mullet_portrait_video_capabilities_v9' as const;
export const LTX25_PORTRAIT_VIDEO_TEMPLATE_ID = 'ltx-2.5-distilled-portrait-v4' as const;
export const MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID = 'minimax-h3-fl2va-portrait-v1' as const;
export const PORTRAIT_VIDEO_TEMPLATE_ID = LTX25_PORTRAIT_VIDEO_TEMPLATE_ID;
export const PORTRAIT_END_FRAME_TEMPLATE_ID = 'qwen-image-edit-2511-end-frame-v1' as const;
export const PORTRAIT_VIDEO_TIMEOUT_MS = 900_000 as const;
export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;
export const LTX25_PORTRAIT_VIDEO_DURATIONS = Object.freeze([2] as const);
export const MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS = Object.freeze([3, 5] as const);
export const PORTRAIT_VIDEO_DURATIONS = Object.freeze([2, 3, 5] as const);
export const PORTRAIT_VIDEO_FPS = 24 as const;
export const PORTRAIT_VIDEO_FRAMES = 49 as const;
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
export type PortraitVideoModeCapability = PortraitVideoModeDefinition & {
  available: boolean;
  missing: string[];
};
export type PortraitVideoDurationSeconds = (typeof PORTRAIT_VIDEO_DURATIONS)[number];
export type PortraitVideoTemplateId =
  | typeof LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
  | typeof MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID;

export const PORTRAIT_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '9:16', width: 576, height: 1024 }
] as const);

export const LTX25_PORTRAIT_VIDEO_TEMPLATE = Object.freeze({
  id: LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
  label: 'LTX 2.5 Distilled',
  modelFamily: 'ltx-2.5',
  modelFiles: {
    unet: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
    clip: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
    videoVae: 'ltx-2.5-video-vae-bf16.safetensors',
    audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
    latentUpscaler: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'LoadImage',
    'CLIPTextEncode',
    'LTXVPreprocess',
    'LTXVConditioning',
    'EmptyLTXVLatentVideo',
    'LTXVImgToVideoInplace',
    'LTXVAddGuide',
    'LTXVCropGuides',
    'LTXVEmptyLatentAudio',
    'LTXVConcatAVLatent',
    'LTXVSeparateAVLatent',
    'LTXVDualCFGGuider',
    'LTXVLatentUpsampler',
    'LatentUpscaleModelLoader',
    'RandomNoise',
    'KSamplerSelect',
    'ManualSigmas',
    'SamplerCustomAdvanced',
    'VAEDecodeTiled',
    'CreateVideo',
    'SaveVideo'
  ],
  outputNodes: {
    [PORTRAIT_VIDEO_MODE_I2V]: '38',
    [PORTRAIT_VIDEO_MODE_LOOP_FLF]: '38',
    [PORTRAIT_VIDEO_MODE_GENERATED_FLF]: '38'
  },
  durations: LTX25_PORTRAIT_VIDEO_DURATIONS,
  multiple: 64,
  sampler: 'euler_ancestral',
  firstPassSigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0',
  secondPassSigmas: '0.85, 0.7250, 0.4219, 0.0',
  format: 'mp4',
  codec: 'h264',
  bitDepth: 8,
  promptGuide: 'locked head-and-chest portrait, restrained natural motion, identical first/last-frame loop, silent video-only output, no cuts'
} as const);

export const MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE = Object.freeze({
  id: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  label: 'MiniMax H3 FL2VA Turbo',
  modelFamily: 'minimax-h3-fl2va',
  modelFiles: {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
    videoVae: 'minimax_h3_video_vae_fp16.safetensors',
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
    'CreateVideo',
    'SaveVideo',
    'LoraLoaderModelOnly'
  ],
  outputNode: '15',
  durations: MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS,
  multiple: 32,
  shortEdge: 576,
  maxPixels: 576 * 1024,
  sampler: 'res_multistep',
  scheduler: 'simple',
  steps: 4,
  denoise: 1,
  format: 'auto',
  codec: 'auto',
  bitDepth: 8,
  promptGuide: 'locked head-and-chest portrait, restrained natural motion, identical first/last-frame loop, silent video-only output, no cuts'
} as const);

export const PORTRAIT_VIDEO_TEMPLATES = Object.freeze([
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE
] as const);

export type PortraitVideoTemplate = (typeof PORTRAIT_VIDEO_TEMPLATES)[number];

export const QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE = Object.freeze({
  id: PORTRAIT_END_FRAME_TEMPLATE_ID,
  label: 'Qwen Image Edit 2511 · Lightning 4-step',
  modelFamily: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFamily,
  modelFiles: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles,
  requiredNodes: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.requiredNodes,
  outputNode: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.outputNode,
  steps: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.steps,
  cfg: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.cfg,
  sampler: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.sampler,
  scheduler: QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.scheduler
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
  modelTemplate: PortraitVideoTemplateId;
  endFrameModelTemplate: typeof PORTRAIT_END_FRAME_TEMPLATE_ID | null;
  mode: PortraitVideoMode;
  source: PortraitVideoSource;
  aspectRatio: PortraitAspectRatio;
  durationSeconds: PortraitVideoDurationSeconds;
};

export type PortraitVideoTemplateCapability = {
  template: PortraitVideoTemplate;
  available: boolean;
  missing: string[];
  modes: PortraitVideoModeCapability[];
  durations: readonly PortraitVideoDurationSeconds[];
};

export type PortraitVideoCapabilities = {
  spec: typeof PORTRAIT_VIDEO_CAPABILITIES_SPEC;
  templates: PortraitVideoTemplateCapability[];
  endFrameTemplate: typeof QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE;
  aspectRatios: typeof PORTRAIT_VIDEO_DIMENSIONS;
};

export function portraitVideoTemplate(modelTemplate: PortraitVideoTemplateId): PortraitVideoTemplate {
  const template = PORTRAIT_VIDEO_TEMPLATES.find(({ id }) => id === modelTemplate);
  if (!template) throw new Error('unsupported portrait-video model template');
  return template;
}

export function portraitVideoTemplateCapability(
  capabilities: PortraitVideoCapabilities | null,
  modelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID
): PortraitVideoTemplateCapability | null {
  return capabilities?.templates.find(({ template }) => template.id === modelTemplate) ?? null;
}

export function portraitVideoModeCapability(
  capabilities: PortraitVideoCapabilities | null,
  mode: PortraitVideoMode,
  modelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID
): PortraitVideoModeCapability | null {
  return portraitVideoTemplateCapability(capabilities, modelTemplate)?.modes.find((capability) => capability.id === mode) ?? null;
}

export function portraitVideoModeAvailable(
  capabilities: PortraitVideoCapabilities | null,
  mode: PortraitVideoMode,
  modelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID
): boolean {
  return portraitVideoModeCapability(capabilities, mode, modelTemplate)?.available === true;
}

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
const LTX_NEGATIVE_PROMPT = 'oversaturated, overexposed, static frame, blurry details, subtitles, text, watermark, cartoon, painting, gray cast, worst quality, low quality, jpeg artifacts, deformed face, deformed hands, fused fingers, extra limbs, cluttered background, camera cuts, camera shake, black frames, talking, lip movement, speech gestures';
const dimensionMap = new Map(PORTRAIT_VIDEO_DIMENSIONS.map((entry) => [entry.aspectRatio, entry]));
const durationFrameMap = new Map<PortraitVideoDurationSeconds, number>([
  [2, PORTRAIT_VIDEO_FRAMES],
  [3, 73],
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
  durationSeconds?: PortraitVideoDurationSeconds,
  modelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID
): PortraitVideoRequest {
  const selectedDuration = durationSeconds ?? portraitVideoTemplate(modelTemplate).durations[0];
  return normalizePortraitVideoRequest({
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate,
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
    durationSeconds: selectedDuration
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
  if (typeof value.modelTemplate !== 'string' || !PORTRAIT_VIDEO_TEMPLATES.some(({ id }) => id === value.modelTemplate)) {
    throw new Error('unsupported portrait-video model template');
  }
  const modelTemplate = value.modelTemplate as PortraitVideoTemplateId;
  const template = portraitVideoTemplate(modelTemplate);
  if (!PORTRAIT_VIDEO_MODES.some((entry) => entry.id === value.mode)) throw new Error('unsupported portrait-video mode');
  const expectedEndFrameTemplate = value.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF ? PORTRAIT_END_FRAME_TEMPLATE_ID : null;
  if (value.endFrameModelTemplate !== expectedEndFrameTemplate) throw new Error('portrait-video end-frame template does not match its mode');
  if (!isPortraitVideoSource(value.source)) throw new Error('portrait-video source is invalid');
  const aspectRatio = value.aspectRatio;
  if (typeof aspectRatio !== 'string' || !dimensionMap.has(aspectRatio as PortraitAspectRatio)) {
    throw new Error('unsupported portrait-video aspect ratio');
  }
  const durationSeconds = value.durationSeconds;
  if (
    typeof durationSeconds !== 'number'
    || !durationFrameMap.has(durationSeconds as PortraitVideoDurationSeconds)
    || !(template.durations as readonly number[]).includes(durationSeconds)
  ) {
    throw new Error('unsupported portrait-video duration for model template');
  }
  const portraitWidth = integer(value.source.portraitWidth, 'portrait-video source width', 16, 8192);
  const portraitHeight = integer(value.source.portraitHeight, 'portrait-video source height', 16, 8192);
  if (!portraitDimensionsMatch(portraitWidth, portraitHeight, aspectRatio as PortraitAspectRatio)) {
    throw new Error('portrait-video source dimensions do not match the selected portrait aspect ratio');
  }
  return {
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate,
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
    'Ambient idle expression motion only: no talking, no lip or mouth movement, and no speech gestures.',
    'No camera movement, no cuts, no speech, no text, no black frames.',
    'Silent video only; no dialogue, narration, music, room tone, or sound effects.'
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

export function buildQwenPortraitEndFrameWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.mode !== PORTRAIT_VIDEO_MODE_GENERATED_FLF) throw new Error('portrait-video mode does not generate an end frame');
  validatePortraitVideoInputReference(portraitInput, normalized.source.portraitImageSha256);
  return buildQwenReferenceEditWorkflow({
    referencePath: `${portraitInput.subfolder}/${portraitInput.name}`,
    prompt: buildPortraitEndFramePrompt(normalized),
    width: normalized.source.portraitWidth,
    height: normalized.source.portraitHeight,
    seed,
    filenamePrefix: 'mullet/portrait-generated-end-frame'
  });
}

export function buildLtx25PortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number,
  endFrameInput?: PortraitVideoInputReference
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.modelTemplate !== LTX25_PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('portrait-video request does not select LTX 2.5');
  }
  validatePortraitVideoInputReference(portraitInput, normalized.source.portraitImageSha256);
  const validatedSeed = integer(seed, 'portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = portraitVideoDimensions(normalized.aspectRatio, normalized.durationSeconds);
  if (normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF || normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF) {
    const lastInput = normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF ? endFrameInput : portraitInput;
    if (!lastInput) throw new Error('portrait-video generated end-frame input is required');
    validatePortraitVideoInputReference(lastInput);
    if (normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF && lastInput.imageSha256 === portraitInput.imageSha256) {
      throw new Error('portrait-video generated end frame must differ from its source');
    }
    if (normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF && endFrameInput !== undefined) {
      throw new Error('portrait-video loop mode does not accept a separate end frame');
    }
    return buildLtx25FlfPortraitVideoWorkflow(
      normalized,
      portraitInput,
      lastInput,
      validatedSeed,
      width,
      height,
      frames,
      fps
    );
  }
  if (endFrameInput !== undefined) throw new Error('portrait-video I2V mode does not accept an end frame');
  const template = LTX25_PORTRAIT_VIDEO_TEMPLATE;
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: template.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitVideoPrompt(normalized), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: LTX_NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['11', 0], strength: 0.7, bypass: false } },
    '13': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '14': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['12', 0], audio_latent: ['13', 0] } },
    '15': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '16': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '17': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '18': { class_type: 'ManualSigmas', inputs: { sigmas: template.firstPassSigmas } },
    '19': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['16', 0], guider: ['15', 0], sampler: ['17', 0], sigmas: ['18', 0], latent_image: ['14', 0] } },
    '20': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['19', 0] } },
    '21': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['20', 0], upscale_model: ['7', 0], vae: ['5', 0] } },
    '22': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['21', 0], strength: 1, bypass: false } },
    '23': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['22', 0], audio_latent: ['20', 1] } },
    '24': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '25': { class_type: 'RandomNoise', inputs: { noise_seed: nextPortraitVideoSeed(validatedSeed) } },
    '26': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '27': { class_type: 'ManualSigmas', inputs: { sigmas: template.secondPassSigmas } },
    '28': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['25', 0], guider: ['24', 0], sampler: ['26', 0], sigmas: ['27', 0], latent_image: ['23', 0] } },
    '29': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['28', 0] } },
    '30': { class_type: 'VAEDecodeTiled', inputs: { samples: ['29', 0], vae: ['5', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    '31': {
      class_type: 'CreateVideo',
      inputs: {
        images: ['30', 0],
        fps,
        bit_depth: template.bitDepth
      }
    },
    '38': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['31', 0],
        filename_prefix: 'mullet/portrait-motion',
        format: template.format,
        codec: template.codec
      }
    }
  };
}

function nextPortraitVideoSeed(seed: number): number {
  return seed + 42 <= Number.MAX_SAFE_INTEGER ? seed + 42 : seed - 42;
}

function buildLtx25FlfPortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  endFrameInput: PortraitVideoInputReference,
  seed: number,
  width: number,
  height: number,
  frames: number,
  fps: number
): Record<string, unknown> {
  const template = LTX25_PORTRAIT_VIDEO_TEMPLATE;
  const generatedEndFrame = request.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF;
  const endFrameImage: [string, number] = generatedEndFrame ? ['37', 0] : ['2', 0];
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: template.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitVideoPrompt(request), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: LTX_NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['11', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '13': { class_type: 'LTXVAddGuide', inputs: { positive: ['12', 0], negative: ['12', 1], vae: ['5', 0], latent: ['12', 2], image: endFrameImage, frame_idx: -1, strength: 0.7 } },
    '14': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '15': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['13', 2], audio_latent: ['14', 0] } },
    '16': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['13', 0], negative: ['13', 1], video_cfg: 1, audio_cfg: 1 } },
    '17': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '18': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '19': { class_type: 'ManualSigmas', inputs: { sigmas: template.firstPassSigmas } },
    '20': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['17', 0], guider: ['16', 0], sampler: ['18', 0], sigmas: ['19', 0], latent_image: ['15', 0] } },
    '21': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['20', 0] } },
    '22': { class_type: 'LTXVCropGuides', inputs: { positive: ['13', 0], negative: ['13', 1], latent: ['21', 0] } },
    '23': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['22', 2], upscale_model: ['7', 0], vae: ['5', 0] } },
    '24': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['23', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '25': { class_type: 'LTXVAddGuide', inputs: { positive: ['24', 0], negative: ['24', 1], vae: ['5', 0], latent: ['24', 2], image: endFrameImage, frame_idx: -1, strength: 0.7 } },
    '26': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['25', 2], audio_latent: ['21', 1] } },
    '27': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['25', 0], negative: ['25', 1], video_cfg: 1, audio_cfg: 1 } },
    '28': { class_type: 'RandomNoise', inputs: { noise_seed: nextPortraitVideoSeed(seed) } },
    '29': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '30': { class_type: 'ManualSigmas', inputs: { sigmas: template.secondPassSigmas } },
    '31': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['28', 0], guider: ['27', 0], sampler: ['29', 0], sigmas: ['30', 0], latent_image: ['26', 0] } },
    '32': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['31', 0] } },
    '33': { class_type: 'LTXVCropGuides', inputs: { positive: ['25', 0], negative: ['25', 1], latent: ['32', 0] } },
    '34': { class_type: 'VAEDecodeTiled', inputs: { samples: ['33', 2], vae: ['5', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    '35': {
      class_type: 'CreateVideo',
      inputs: {
        images: ['34', 0],
        fps,
        bit_depth: template.bitDepth
      }
    },
    ...(generatedEndFrame ? {
      '36': { class_type: 'LoadImage', inputs: { image: `${endFrameInput.subfolder}/${endFrameInput.name}` } },
      '37': { class_type: 'LTXVPreprocess', inputs: { image: ['36', 0], img_compression: 18 } }
    } : {}),
    '38': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['35', 0],
        filename_prefix: generatedEndFrame ? 'mullet/portrait-motion-generated-flf' : 'mullet/portrait-motion-loop-flf',
        format: template.format,
        codec: template.codec
      }
    }
  };
}

export function buildMiniMaxH3PortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number,
  endFrameInput?: PortraitVideoInputReference
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.modelTemplate !== MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('portrait-video request does not select MiniMax H3');
  }
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
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps, bit_depth: template.bitDepth } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: filenamePrefix, format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } },
    ...(normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF && endFrameInput
      ? { '17': { class_type: 'LoadImage', inputs: { image: `${endFrameInput.subfolder}/${endFrameInput.name}` } } }
      : {})
  };
}

export function buildPortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number,
  endFrameInput?: PortraitVideoInputReference
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  return normalized.modelTemplate === LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
    ? buildLtx25PortraitVideoWorkflow(normalized, portraitInput, seed, endFrameInput)
    : buildMiniMaxH3PortraitVideoWorkflow(normalized, portraitInput, seed, endFrameInput);
}

export function portraitVideoOutputNode(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return normalized.modelTemplate === LTX25_PORTRAIT_VIDEO_TEMPLATE_ID
    ? LTX25_PORTRAIT_VIDEO_TEMPLATE.outputNodes[normalized.mode]
    : MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.outputNode;
}

function normalizedMissing(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 500)
    || new Set(value).size !== value.length
  ) throw new Error(`invalid portrait-video ${label}`);
  return [...value] as string[];
}

function normalizedModes(value: unknown): PortraitVideoModeCapability[] {
  if (!Array.isArray(value) || value.length !== PORTRAIT_VIDEO_MODES.length) {
    throw new Error('invalid portrait-video modes');
  }
  const rawModeById = new Map(value.map((mode) => [isRecord(mode) ? mode.id : null, mode]));
  const modes = PORTRAIT_VIDEO_MODES.map((definition): PortraitVideoModeCapability => {
    const raw = rawModeById.get(definition.id);
    if (!isRecord(raw) || raw.label !== definition.label || typeof raw.available !== 'boolean') {
      throw new Error('invalid portrait-video modes');
    }
    const missing = normalizedMissing(raw.missing, 'modes');
    if (raw.available !== (missing.length === 0)) throw new Error('invalid portrait-video modes');
    return { ...definition, available: raw.available, missing };
  });
  if (rawModeById.size !== PORTRAIT_VIDEO_MODES.length) throw new Error('invalid portrait-video modes');
  return modes;
}

export function normalizePortraitVideoCapabilities(value: unknown): PortraitVideoCapabilities {
  if (!isRecord(value) || value.spec !== PORTRAIT_VIDEO_CAPABILITIES_SPEC) {
    throw new Error('invalid portrait-video capabilities');
  }
  if (!Array.isArray(value.templates) || value.templates.length !== PORTRAIT_VIDEO_TEMPLATES.length) {
    throw new Error('invalid portrait-video templates');
  }
  const rawTemplateById = new Map(value.templates.map((capability) => [
    isRecord(capability) && isRecord(capability.template) ? capability.template.id : null,
    capability
  ]));
  const templates = PORTRAIT_VIDEO_TEMPLATES.map((template): PortraitVideoTemplateCapability => {
    const raw = rawTemplateById.get(template.id);
    if (!isRecord(raw) || !isRecord(raw.template) || raw.template.id !== template.id || typeof raw.available !== 'boolean') {
      throw new Error('invalid portrait-video templates');
    }
    const missing = normalizedMissing(raw.missing, 'templates');
    if (raw.available !== (missing.length === 0)) throw new Error('invalid portrait-video templates');
    const modes = normalizedModes(raw.modes);
    const rawDurations = raw.durations;
    if (
      !Array.isArray(rawDurations)
      || rawDurations.length !== template.durations.length
      || !template.durations.every((duration, index) => rawDurations[index] === duration)
    ) throw new Error('invalid portrait-video durations');
    return { template, available: raw.available, missing, modes, durations: template.durations };
  });
  if (rawTemplateById.size !== PORTRAIT_VIDEO_TEMPLATES.length) throw new Error('invalid portrait-video templates');
  if (!isRecord(value.endFrameTemplate) || value.endFrameTemplate.id !== PORTRAIT_END_FRAME_TEMPLATE_ID) {
    throw new Error('invalid portrait-video end-frame template');
  }
  return {
    spec: PORTRAIT_VIDEO_CAPABILITIES_SPEC,
    templates,
    endFrameTemplate: QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE,
    aspectRatios: PORTRAIT_VIDEO_DIMENSIONS
  };
}
