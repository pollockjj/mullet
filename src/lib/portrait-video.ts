import {
  PORTRAIT_MEGAPIXELS,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  buildQwenReferenceEditWorkflow,
  isPortraitSource,
  portraitDimensions,
  type PortraitAspectRatio,
  type PortraitSource
} from './portrait.ts';

export const PORTRAIT_VIDEO_REQUEST_SPEC = 'mullet_portrait_video_request_v9' as const;
export const PORTRAIT_VIDEO_CAPABILITIES_SPEC = 'mullet_portrait_video_capabilities_v10' as const;
export const MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID = 'minimax-h3-fl2va-portrait-v2' as const;
export const PORTRAIT_VIDEO_TEMPLATE_ID = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID;
export const PORTRAIT_END_FRAME_TEMPLATE_ID = 'qwen-image-edit-2511-end-frame-v1' as const;
export const PORTRAIT_VIDEO_TIMEOUT_MS = 900_000 as const;
export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;
export const MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS = Object.freeze([2, 3, 5] as const);
export const PORTRAIT_VIDEO_DURATIONS = Object.freeze([2, 3, 5] as const);
export const PORTRAIT_VIDEO_FPS = 28 as const;
export const PORTRAIT_VIDEO_FRAMES = 56 as const;
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
export type PortraitVideoTemplateId = typeof MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID;

export const PORTRAIT_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '9:16', width: 576, height: 1024 }
] as const);


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
    'LoraLoaderModelOnly',
    'MiniMaxH3SigmaShift'
  ],
  outputNode: '15',
  durations: MINIMAX_H3_PORTRAIT_VIDEO_DURATIONS,
  multiple: 32,
  shortEdge: 576,
  maxPixels: 576 * 1024,
  sampler: 'euler',
  scheduler: 'simple',
  steps: 4,
  denoise: 1,
  shiftVideo: 6,
  shiftAudio: 3,
  format: 'auto',
  codec: 'auto',
  promptGuide: 'locked head-and-chest portrait, restrained natural motion, identical first/last-frame loop, silent video-only output, no cuts'
} as const);

export const PORTRAIT_VIDEO_TEMPLATES = Object.freeze([
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
const dimensionMap = new Map(PORTRAIT_VIDEO_DIMENSIONS.map((entry) => [entry.aspectRatio, entry]));
const timingMap = new Map<PortraitVideoTemplateId, Map<PortraitVideoDurationSeconds, { frames: number; fps: number }>>([
  [MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID, new Map([
    [2, { frames: PORTRAIT_VIDEO_FRAMES, fps: PORTRAIT_VIDEO_FPS }],
    [3, { frames: 73, fps: 24 }],
    [5, { frames: 124, fps: 24 }]
  ])]
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
  durationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS,
  modelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID
): { width: number; height: number; frames: number; fps: number } {
  const dimensions = dimensionMap.get(aspectRatio);
  if (!dimensions) throw new Error('unsupported portrait-video aspect ratio');
  const timing = timingMap.get(modelTemplate)?.get(durationSeconds);
  if (!timing) throw new Error('unsupported portrait-video duration for model template');
  return {
    width: dimensions.width,
    height: dimensions.height,
    frames: timing.frames,
    fps: timing.fps
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

// The loop depends only on the exact still it animates and the loop parameters. The
// still's prompt ID, seed, timestamp and transcript position stay in the request as
// provenance, but keying on them meant a byte-identical still (the seed is fixed per
// character, so the same expression reproduces the same bytes) cost a fresh 45-90 s loop
// on every turn and on every reload instead of reusing the stored one.
export function portraitVideoRequestKey(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return [
    normalized.source.conversationId,
    normalized.source.portraitWidth,
    normalized.source.portraitHeight,
    normalized.source.portraitImageSha256,
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

export function buildMiniMaxH3PortraitVideoPrompt(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  if (normalized.modelTemplate !== MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('portrait-video request does not select MiniMax H3');
  }
  const { frames, fps } = portraitVideoDimensions(
    normalized.aspectRatio,
    normalized.durationSeconds,
    normalized.modelTemplate
  );
  const effectiveDuration = (frames / fps).toFixed(2);
  const alignment = normalized.mode === PORTRAIT_VIDEO_MODE_I2V
    ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    : `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${effectiveDuration}-second mark of the target video.`;
  const firstPicture = normalized.mode === PORTRAIT_VIDEO_MODE_I2V ? '<Picture 1>' : 'Picture 1';
  const endpointPath = normalized.mode === PORTRAIT_VIDEO_MODE_LOOP_FLF
    ? `The supplied endpoint images are identical; after the minimal idle motion, the subject progressively returns and settles into the exact identity, face, expression, pose, closed-mouth position, lighting, background, and composition established by Picture 2 at ${effectiveDuration} seconds.`
    : normalized.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF
      ? `The subject moves continuously from Picture 1 and progressively settles into the exact identity, face, expression, pose, closed-mouth position, lighting, background, and composition established by Picture 2 at ${effectiveDuration} seconds.`
      : 'Continue forward from <Picture 1> with only the restrained idle motion described here.';
  return [
    alignment,
    '',
    `integrated_multimodal_description: [Shot 1] Live-action, cinematic, the camera holds a Static Shot on the head-and-chest portrait. At 0.00 seconds, preserve the exact identity, face, expression, hairstyle, attire, lighting, background, framing, and pose established by ${firstPicture}.`,
    `The subject holds a restrained ${normalized.source.portraitSource.expression} expression while breathing visually with almost imperceptible chest movement, blinking once, and allowing only subtle hair and fabric motion. ${endpointPath}`,
    'Nobody speaks, vocalizes, or mouths words; the mouth remains closed and still, with no lip movement or speech gestures. Use one continuous shot with no cuts, camera movement, new subjects, new objects, text, subtitles, captions, or black frames.',
    '',
    'overall_soundscape: N/A. Complete silence; no dialogue, voices, narration, singing, breathing sounds, room tone, ambience, Foley, sound effects, or other audio.',
    '',
    'non_diegetic_music: N/A. No music or audience-only score.'
  ].join('\n');
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


function nextPortraitVideoSeed(seed: number): number {
  return seed + 42 <= Number.MAX_SAFE_INTEGER ? seed + 42 : seed - 42;
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
  const { width, height, frames, fps } = portraitVideoDimensions(
    normalized.aspectRatio,
    normalized.durationSeconds,
    normalized.modelTemplate
  );
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
      prompt: buildMiniMaxH3PortraitVideoPrompt(normalized),
      width,
      height,
      length: frames,
      first_frame: ['5', 0],
      ...(lastFrame ? { last_frame: lastFrame } : {})
    } },
    '7': { class_type: 'BasicGuider', inputs: { model: ['18', 0], conditioning: ['6', 0] } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['18', 0], scheduler: template.scheduler, steps: template.steps, denoise: template.denoise } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['6', 1] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: filenamePrefix, format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } },
    '18': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['16', 0], shift_video: template.shiftVideo, shift_audio: template.shiftAudio } },
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
  return buildMiniMaxH3PortraitVideoWorkflow(normalized, portraitInput, seed, endFrameInput);
}

export function portraitVideoOutputNode(request: PortraitVideoRequest): string {
  const normalized = normalizePortraitVideoRequest(request);
  return MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE.outputNode;
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
