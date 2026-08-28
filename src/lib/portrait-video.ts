import {
  PORTRAIT_MEGAPIXELS,
  isPortraitSource,
  portraitDimensions,
  type PortraitAspectRatio,
  type PortraitSource
} from './portrait.ts';

export const PORTRAIT_VIDEO_REQUEST_SPEC = 'mullet_portrait_video_request_v3' as const;
export const PORTRAIT_VIDEO_CAPABILITIES_SPEC = 'mullet_portrait_video_capabilities_v3' as const;
export const PORTRAIT_VIDEO_TEMPLATE_ID = 'ltx-2.5-distilled-portrait-v3' as const;
export const PORTRAIT_END_FRAME_TEMPLATE_ID = 'qwen-image-edit-2511-lightning-4step-v1' as const;
export const PORTRAIT_VIDEO_TIMEOUT_MS = 900_000 as const;
export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;
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

export const PORTRAIT_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '2:3', width: 384, height: 576 },
  { aspectRatio: '3:4', width: 384, height: 512 },
  { aspectRatio: '4:5', width: 512, height: 640 },
  { aspectRatio: '9:16', width: 576, height: 1024 }
] as const);

export const LTX25_PORTRAIT_VIDEO_TEMPLATE = Object.freeze({
  id: PORTRAIT_VIDEO_TEMPLATE_ID,
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
    'SaveWEBM'
  ],
  outputNodes: {
    [PORTRAIT_VIDEO_MODE_I2V]: '31',
    [PORTRAIT_VIDEO_MODE_LOOP_FLF]: '35',
    [PORTRAIT_VIDEO_MODE_GENERATED_FLF]: '35'
  },
  multiple: 64,
  sampler: 'euler_ancestral',
  firstPassSigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0',
  secondPassSigmas: '0.85, 0.7250, 0.4219, 0.0',
  codec: 'vp9',
  crf: 32,
  promptGuide: 'locked head-and-chest portrait camera, restrained natural motion, seamless end pose, no cuts'
} as const);

export const QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE = Object.freeze({
  id: PORTRAIT_END_FRAME_TEMPLATE_ID,
  label: 'Qwen Image Edit 2511 Lightning',
  modelFamily: 'qwen-image-edit-2511',
  workflowRevision: 'b972309e5337293cc003bb19d19aec4681fff623',
  workflowSha256: 'ca314101ca20bed846292727aa60c75f42499cdb734f5e8b212dcdddb45a43b7',
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
    'FluxKontextImageScale',
    'ModelSamplingAuraFlow',
    'CFGNorm',
    'LoraLoaderModelOnly',
    'TextEncodeQwenImageEditPlus',
    'VAEEncode',
    'KSampler',
    'VAEDecode',
    'ImageScale',
    'SaveImage'
  ],
  outputNode: '14',
  steps: 4,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
  shift: 3.1
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
  durationSeconds: typeof PORTRAIT_VIDEO_DURATION_SECONDS;
};

export type PortraitVideoCapabilities = {
  spec: typeof PORTRAIT_VIDEO_CAPABILITIES_SPEC;
  template: typeof LTX25_PORTRAIT_VIDEO_TEMPLATE;
  endFrameTemplate: typeof QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE | null;
  modes: readonly PortraitVideoModeDefinition[];
  aspectRatios: typeof PORTRAIT_VIDEO_DIMENSIONS;
  durations: readonly [typeof PORTRAIT_VIDEO_DURATION_SECONDS];
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
  aspectRatio: PortraitAspectRatio,
  imageSha256: string,
  mode: PortraitVideoMode = PORTRAIT_VIDEO_MODE_I2V
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
  if (value.durationSeconds !== PORTRAIT_VIDEO_DURATION_SECONDS) throw new Error('unsupported portrait-video duration');
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
    durationSeconds: PORTRAIT_VIDEO_DURATION_SECONDS
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
      : 'The final pose matches the first pose for a seamless loop.';
  return [
    'The camera remains completely locked on the head-and-chest portrait.',
    `The subject breathes naturally, blinks once, and holds a restrained ${normalized.source.portraitSource.expression} expression.`,
    'Hair and clothing move subtly.',
    loopInstruction,
    'No camera movement, no cuts, no speech, no text, no black frames.'
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
  const validatedSeed = integer(seed, 'portrait end-frame seed', 0, Number.MAX_SAFE_INTEGER);
  const template = QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.vae } },
    '4': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '5': { class_type: 'FluxKontextImageScale', inputs: { image: ['4', 0] } },
    '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: template.shift } },
    '7': { class_type: 'CFGNorm', inputs: { model: ['6', 0], strength: 1, pre_cfg: false } },
    '8': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['7', 0], lora_name: template.modelFiles.lora, strength_model: 1 } },
    '9': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['5', 0], prompt: buildPortraitEndFramePrompt(normalized) } },
    '10': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['5', 0], prompt: '' } },
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    '12': {
      class_type: 'KSampler',
      inputs: {
        model: ['8', 0],
        positive: ['9', 0],
        negative: ['10', 0],
        latent_image: ['11', 0],
        seed: validatedSeed,
        steps: template.steps,
        cfg: template.cfg,
        sampler_name: template.sampler,
        scheduler: template.scheduler,
        denoise: 1
      }
    },
    '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['3', 0] } },
    '14': { class_type: 'SaveImage', inputs: { images: ['15', 0], filename_prefix: 'mullet/portrait-generated-end-frame' } },
    '15': {
      class_type: 'ImageScale',
      inputs: {
        image: ['13', 0],
        upscale_method: 'lanczos',
        width: normalized.source.portraitWidth,
        height: normalized.source.portraitHeight,
        crop: 'disabled'
      }
    }
  };
}

export function buildLtx25PortraitVideoWorkflow(
  request: PortraitVideoRequest,
  portraitInput: PortraitVideoInputReference,
  seed: number,
  endFrameInput?: PortraitVideoInputReference
): Record<string, unknown> {
  const normalized = normalizePortraitVideoRequest(request);
  validatePortraitVideoInputReference(portraitInput, normalized.source.portraitImageSha256);
  const validatedSeed = integer(seed, 'portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = portraitVideoDimensions(normalized.aspectRatio);
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
    return buildLtx25FlfPortraitVideoWorkflow(normalized, portraitInput, lastInput, validatedSeed, width, height, frames, fps);
  }
  if (endFrameInput !== undefined) throw new Error('portrait-video I2V mode does not accept an end frame');
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitVideoPrompt(normalized), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['11', 0], strength: 0.7, bypass: false } },
    '13': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '14': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['12', 0], audio_latent: ['13', 0] } },
    '15': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '16': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '17': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler } },
    '18': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.firstPassSigmas } },
    '19': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['16', 0], guider: ['15', 0], sampler: ['17', 0], sigmas: ['18', 0], latent_image: ['14', 0] } },
    '20': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['19', 0] } },
    '21': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['20', 0], upscale_model: ['7', 0], vae: ['5', 0] } },
    '22': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['21', 0], strength: 1, bypass: false } },
    '23': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['22', 0], audio_latent: ['20', 1] } },
    '24': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '25': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed + 42 <= Number.MAX_SAFE_INTEGER ? validatedSeed + 42 : validatedSeed - 42 } },
    '26': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler } },
    '27': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.secondPassSigmas } },
    '28': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['25', 0], guider: ['24', 0], sampler: ['26', 0], sigmas: ['27', 0], latent_image: ['23', 0] } },
    '29': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['28', 0] } },
    '30': { class_type: 'VAEDecodeTiled', inputs: { samples: ['29', 0], vae: ['5', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    '31': {
      class_type: 'SaveWEBM',
      inputs: {
        images: ['30', 0],
        filename_prefix: 'mullet/portrait-motion',
        codec: LTX25_PORTRAIT_VIDEO_TEMPLATE.codec,
        fps,
        crf: LTX25_PORTRAIT_VIDEO_TEMPLATE.crf
      }
    }
  };
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
  const nextSeed = seed + 42 <= Number.MAX_SAFE_INTEGER ? seed + 42 : seed - 42;
  const generatedEndFrame = request.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF;
  const endFrameImage = generatedEndFrame ? ['37', 0] : ['2', 0];
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `${portraitInput.subfolder}/${portraitInput.name}` } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildPortraitVideoPrompt(request), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['11', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '13': { class_type: 'LTXVAddGuide', inputs: { positive: ['12', 0], negative: ['12', 1], vae: ['5', 0], latent: ['12', 2], image: endFrameImage, frame_idx: -1, strength: 0.7 } },
    '14': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '15': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['13', 2], audio_latent: ['14', 0] } },
    '16': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['13', 0], negative: ['13', 1], video_cfg: 1, audio_cfg: 1 } },
    '17': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '18': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler } },
    '19': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.firstPassSigmas } },
    '20': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['17', 0], guider: ['16', 0], sampler: ['18', 0], sigmas: ['19', 0], latent_image: ['15', 0] } },
    '21': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['20', 0] } },
    '22': { class_type: 'LTXVCropGuides', inputs: { positive: ['13', 0], negative: ['13', 1], latent: ['21', 0] } },
    '23': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['22', 2], upscale_model: ['7', 0], vae: ['5', 0] } },
    '24': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['23', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '25': { class_type: 'LTXVAddGuide', inputs: { positive: ['24', 0], negative: ['24', 1], vae: ['5', 0], latent: ['24', 2], image: endFrameImage, frame_idx: -1, strength: 0.7 } },
    '26': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['25', 2], audio_latent: ['21', 1] } },
    '27': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['25', 0], negative: ['25', 1], video_cfg: 1, audio_cfg: 1 } },
    '28': { class_type: 'RandomNoise', inputs: { noise_seed: nextSeed } },
    '29': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler } },
    '30': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.secondPassSigmas } },
    '31': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['28', 0], guider: ['27', 0], sampler: ['29', 0], sigmas: ['30', 0], latent_image: ['26', 0] } },
    '32': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['31', 0] } },
    '33': { class_type: 'LTXVCropGuides', inputs: { positive: ['25', 0], negative: ['25', 1], latent: ['32', 0] } },
    '34': { class_type: 'VAEDecodeTiled', inputs: { samples: ['33', 2], vae: ['5', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    '35': {
      class_type: 'SaveWEBM',
      inputs: {
        images: ['34', 0],
        filename_prefix: generatedEndFrame ? 'mullet/portrait-motion-generated-flf' : 'mullet/portrait-motion-loop-flf',
        codec: LTX25_PORTRAIT_VIDEO_TEMPLATE.codec,
        fps,
        crf: LTX25_PORTRAIT_VIDEO_TEMPLATE.crf
      }
    },
    ...(generatedEndFrame ? {
      '36': { class_type: 'LoadImage', inputs: { image: `${endFrameInput.subfolder}/${endFrameInput.name}` } },
      '37': { class_type: 'LTXVPreprocess', inputs: { image: ['36', 0], img_compression: 18 } }
    } : {})
  };
}

export function portraitVideoOutputNode(request: PortraitVideoRequest): string {
  return LTX25_PORTRAIT_VIDEO_TEMPLATE.outputNodes[normalizePortraitVideoRequest(request).mode];
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
  return {
    spec: PORTRAIT_VIDEO_CAPABILITIES_SPEC,
    template: LTX25_PORTRAIT_VIDEO_TEMPLATE,
    endFrameTemplate: hasGeneratedEndFrame ? QWEN_IMAGE_EDIT_PORTRAIT_END_FRAME_TEMPLATE : null,
    modes,
    aspectRatios: PORTRAIT_VIDEO_DIMENSIONS,
    durations: [PORTRAIT_VIDEO_DURATION_SECONDS]
  };
}
