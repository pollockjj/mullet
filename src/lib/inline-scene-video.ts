import {
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneAspectRatio,
  type InlineSceneImageRequest
} from './inline-scene.ts';
import { sha256Hex } from './sha256.ts';

export const INLINE_SCENE_VIDEO_REQUEST_SPEC = 'mullet_inline_scene_video_request_v5' as const;
export const INLINE_SCENE_VIDEO_CAPABILITIES_SPEC = 'mullet_inline_scene_video_capabilities_v4' as const;
export const LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID = 'ltx-2.5-distilled-scene-v2' as const;
export const MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID = 'minimax-h3-fl2va-i2v-turbo-v1' as const;
export const INLINE_SCENE_VIDEO_TEMPLATE_ID = LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID;
export const INLINE_SCENE_VIDEO_TIMEOUT_MS = 900_000 as const;
export const INLINE_SCENE_VIDEO_DURATION_SECONDS = 5 as const;
export const INLINE_SCENE_VIDEO_FPS = 24 as const;
export const LTX25_INLINE_SCENE_VIDEO_FRAMES = 121 as const;
export const MINIMAX_H3_INLINE_SCENE_VIDEO_FRAMES = 124 as const;
export const INLINE_SCENE_VIDEO_FRAMES = LTX25_INLINE_SCENE_VIDEO_FRAMES;
export const LTX25_INLINE_SCENE_VIDEO_MODE = 'flf2v_loop' as const;
export const MINIMAX_H3_INLINE_SCENE_VIDEO_MODE = 'i2v' as const;
export const INLINE_SCENE_VIDEO_MODE = LTX25_INLINE_SCENE_VIDEO_MODE;

export const INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 1152, height: 768 },
  { aspectRatio: '4:3', width: 1024, height: 768 },
  { aspectRatio: '5:4', width: 960, height: 768 },
  { aspectRatio: '16:9', width: 1344, height: 768 }
] as const);

export const LTX25_INLINE_SCENE_VIDEO_TEMPLATE = Object.freeze({
  id: LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID,
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
  outputNode: '36',
  mode: LTX25_INLINE_SCENE_VIDEO_MODE,
  durationSeconds: INLINE_SCENE_VIDEO_DURATION_SECONDS,
  frames: LTX25_INLINE_SCENE_VIDEO_FRAMES,
  multiple: 64,
  sampler: 'euler_ancestral',
  firstPassSigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0',
  secondPassSigmas: '0.85, 0.7250, 0.4219, 0.0',
  format: 'mp4',
  codec: 'h264',
  bitDepth: 8,
  promptGuide: 'one continuous landscape shot, identical first/last-frame loop, restrained natural motion, silent video-only output, no cuts'
} as const);

export const MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE = Object.freeze({
  id: MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
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
  mode: MINIMAX_H3_INLINE_SCENE_VIDEO_MODE,
  durationSeconds: INLINE_SCENE_VIDEO_DURATION_SECONDS,
  frames: MINIMAX_H3_INLINE_SCENE_VIDEO_FRAMES,
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
  promptGuide: 'one continuous shot from the supplied first frame, coherent physical motion, native synchronized stereo ambience, no cuts'
} as const);

export const INLINE_SCENE_VIDEO_TEMPLATES = Object.freeze([
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE
] as const);

export type InlineSceneVideoTemplate = (typeof INLINE_SCENE_VIDEO_TEMPLATES)[number];
export type InlineSceneVideoTemplateId = InlineSceneVideoTemplate['id'];
export type InlineSceneVideoMode = InlineSceneVideoTemplate['mode'];

export type InlineSceneVideoSource = {
  conversationId: string;
  epoch: string;
  sceneRequestKey: string;
  scenePromptId: string;
  sceneSeed: number;
  sceneGeneratedAt: number;
  sceneWidth: number;
  sceneHeight: number;
  sceneImageSha256: string;
  sceneRequest: InlineSceneImageRequest;
};

export type InlineSceneVideoRequest = {
  spec: typeof INLINE_SCENE_VIDEO_REQUEST_SPEC;
  modelTemplate: InlineSceneVideoTemplateId;
  mode: InlineSceneVideoMode;
  source: InlineSceneVideoSource;
  aspectRatio: InlineSceneAspectRatio;
  durationSeconds: typeof INLINE_SCENE_VIDEO_DURATION_SECONDS;
};

export type InlineSceneVideoTemplateCapability = {
  template: InlineSceneVideoTemplate;
  available: boolean;
  missing: string[];
};

export type InlineSceneVideoCapabilities = {
  spec: typeof INLINE_SCENE_VIDEO_CAPABILITIES_SPEC;
  templates: InlineSceneVideoTemplateCapability[];
  aspectRatios: typeof INLINE_SCENE_VIDEO_DIMENSIONS;
  durations: readonly [typeof INLINE_SCENE_VIDEO_DURATION_SECONDS];
};

export type InlineSceneVideoReconciliationConditions = {
  scenesEnabled: boolean;
  motionEnabled: boolean;
  capabilitiesReady: boolean;
  persistenceReady: boolean;
  persistenceAvailable: boolean;
  restorationPending: boolean;
  streaming: boolean;
  sceneBusy: boolean;
  videoBusy: boolean;
  videoError: boolean;
  requestReady: boolean;
  current: boolean;
};

export type InlineSceneVideoDecodeFailureTransition =
  | { action: 'ignore' }
  | {
      action: 'show-static-fallback';
      error: string;
      attemptKey: string | null;
    };

export type InlineSceneVideoMasterToggleAction = 'abort' | 'restore' | 'none';

export type InlineSceneVideoInputScene = {
  conversationId: string;
  epoch: string;
  requestKey: string;
  request: InlineSceneImageRequest;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  generatedAt: number;
  imageSha256: string;
};

export type InlineSceneVideoInputReference = {
  name: string;
  subfolder: 'mullet/motion-inputs';
  type: 'input';
  imageSha256: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INPUT_IMAGE_PATTERN = /^scene-motion-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
const dimensionMap = new Map(INLINE_SCENE_VIDEO_DIMENSIONS.map((entry) => [entry.aspectRatio, entry]));
const LTX_NEGATIVE_PROMPT = 'oversaturated, overexposed, static frame, blurry details, subtitles, text, watermark, cartoon, painting, gray cast, worst quality, low quality, jpeg artifacts, deformed face, deformed hands, fused fingers, extra limbs, cluttered background, camera cuts, camera shake, black frames, talking, lip movement, speech gestures';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum);
  }
  return Number(value);
}

export function inlineSceneVideoTemplate(
  modelTemplate: InlineSceneVideoTemplateId
): InlineSceneVideoTemplate {
  const template = INLINE_SCENE_VIDEO_TEMPLATES.find(({ id }) => id === modelTemplate);
  if (!template) throw new Error('unsupported inline-scene video model template');
  return template;
}

export function inlineSceneVideoTemplateCapability(
  capabilities: InlineSceneVideoCapabilities | null,
  modelTemplate: InlineSceneVideoTemplateId = INLINE_SCENE_VIDEO_TEMPLATE_ID
): InlineSceneVideoTemplateCapability | null {
  return capabilities?.templates.find(({ template }) => template.id === modelTemplate) ?? null;
}

export function inlineSceneVideoTemplateAvailable(
  capabilities: InlineSceneVideoCapabilities | null,
  modelTemplate: InlineSceneVideoTemplateId = INLINE_SCENE_VIDEO_TEMPLATE_ID
): boolean {
  return inlineSceneVideoTemplateCapability(capabilities, modelTemplate)?.available === true;
}

export function inlineSceneVideoDimensions(
  aspectRatio: InlineSceneAspectRatio,
  modelTemplate: InlineSceneVideoTemplateId = INLINE_SCENE_VIDEO_TEMPLATE_ID
): { width: number; height: number; frames: number; fps: number } {
  const dimensions = dimensionMap.get(aspectRatio);
  if (!dimensions) throw new Error('unsupported inline-scene video aspect ratio');
  const template = inlineSceneVideoTemplate(modelTemplate);
  return {
    width: dimensions.width,
    height: dimensions.height,
    frames: template.frames,
    fps: INLINE_SCENE_VIDEO_FPS
  };
}

export function buildInlineSceneVideoRequest(
  scene: InlineSceneVideoInputScene,
  modelTemplate: InlineSceneVideoTemplateId = INLINE_SCENE_VIDEO_TEMPLATE_ID
): InlineSceneVideoRequest {
  const template = inlineSceneVideoTemplate(modelTemplate);
  return normalizeInlineSceneVideoRequest({
    spec: INLINE_SCENE_VIDEO_REQUEST_SPEC,
    modelTemplate,
    mode: template.mode,
    source: {
      conversationId: scene.conversationId,
      epoch: scene.epoch,
      sceneRequestKey: scene.requestKey,
      scenePromptId: scene.promptId,
      sceneSeed: scene.seed,
      sceneGeneratedAt: scene.generatedAt,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      sceneImageSha256: scene.imageSha256,
      sceneRequest: scene.request
    },
    aspectRatio: scene.request.aspectRatio,
    durationSeconds: INLINE_SCENE_VIDEO_DURATION_SECONDS
  });
}

export function normalizeInlineSceneVideoRequest(value: unknown): InlineSceneVideoRequest {
  if (!isRecord(value)) throw new Error('inline-scene video request must be an object');
  if (value.spec !== INLINE_SCENE_VIDEO_REQUEST_SPEC) throw new Error('invalid inline-scene video request spec');
  if (typeof value.modelTemplate !== 'string' || !INLINE_SCENE_VIDEO_TEMPLATES.some(({ id }) => id === value.modelTemplate)) {
    throw new Error('unsupported inline-scene video model template');
  }
  const modelTemplate = value.modelTemplate as InlineSceneVideoTemplateId;
  const template = inlineSceneVideoTemplate(modelTemplate);
  if (value.mode !== template.mode) throw new Error('unsupported inline-scene video mode for model template');
  if (!isRecord(value.source)) throw new Error('inline-scene video source is invalid');
  const sceneRequest = normalizeInlineSceneImageRequest(value.source.sceneRequest);
  const sceneRequestKey = inlineSceneImageRequestKey(sceneRequest);
  if (
    value.source.conversationId !== sceneRequest.source.conversationId
    || value.source.sceneRequestKey !== sceneRequestKey
    || typeof value.source.epoch !== 'string'
    || !UUID_PATTERN.test(value.source.epoch)
    || typeof value.source.scenePromptId !== 'string'
    || !UUID_PATTERN.test(value.source.scenePromptId)
    || typeof value.source.sceneImageSha256 !== 'string'
    || !SHA256_PATTERN.test(value.source.sceneImageSha256)
  ) throw new Error('inline-scene video source provenance is invalid');
  const sceneGeneratedAt = integer(value.source.sceneGeneratedAt, 'inline-scene video source timestamp', 1, Number.MAX_SAFE_INTEGER);
  const sceneSeed = integer(value.source.sceneSeed, 'inline-scene video source seed', 0, Number.MAX_SAFE_INTEGER);
  const sceneWidth = integer(value.source.sceneWidth, 'inline-scene video source width', 16, 8192);
  const sceneHeight = integer(value.source.sceneHeight, 'inline-scene video source height', 16, 8192);
  const staticDimensions = inlineSceneDimensions(sceneRequest.aspectRatio, sceneRequest.megapixels);
  if (sceneWidth !== staticDimensions.width || sceneHeight !== staticDimensions.height) {
    throw new Error('inline-scene video source dimensions do not match its static request');
  }
  if (value.aspectRatio !== sceneRequest.aspectRatio || !dimensionMap.has(value.aspectRatio as InlineSceneAspectRatio)) {
    throw new Error('inline-scene video aspect ratio does not match its static source');
  }
  if (value.durationSeconds !== INLINE_SCENE_VIDEO_DURATION_SECONDS) throw new Error('unsupported inline-scene video duration');
  return {
    spec: INLINE_SCENE_VIDEO_REQUEST_SPEC,
    modelTemplate,
    mode: template.mode,
    source: {
      conversationId: sceneRequest.source.conversationId,
      epoch: value.source.epoch,
      sceneRequestKey,
      scenePromptId: value.source.scenePromptId,
      sceneSeed,
      sceneGeneratedAt,
      sceneWidth,
      sceneHeight,
      sceneImageSha256: value.source.sceneImageSha256,
      sceneRequest
    },
    aspectRatio: value.aspectRatio as InlineSceneAspectRatio,
    durationSeconds: INLINE_SCENE_VIDEO_DURATION_SECONDS
  };
}

export function inlineSceneVideoRequestKey(request: InlineSceneVideoRequest): string {
  const normalized = normalizeInlineSceneVideoRequest(request);
  return [
    normalized.source.conversationId,
    normalized.source.epoch,
    normalized.source.sceneRequestKey,
    normalized.source.scenePromptId,
    normalized.source.sceneSeed,
    normalized.source.sceneGeneratedAt,
    normalized.source.sceneWidth,
    normalized.source.sceneHeight,
    normalized.source.sceneImageSha256,
    normalized.modelTemplate,
    normalized.mode,
    normalized.aspectRatio,
    normalized.durationSeconds
  ].join('\u001f');
}

export function inlineSceneVideoSourceRequestSha256(request: InlineSceneVideoRequest): string {
  return sha256Hex(normalizeInlineSceneVideoRequest(request).source.sceneRequestKey);
}

export function inlineSceneVideoReconciliationAllowed(
  conditions: InlineSceneVideoReconciliationConditions
): boolean {
  return conditions.scenesEnabled
    && conditions.motionEnabled
    && conditions.capabilitiesReady
    && conditions.persistenceReady
    && conditions.persistenceAvailable
    && !conditions.restorationPending
    && !conditions.streaming
    && !conditions.sceneBusy
    && !conditions.videoBusy
    && !conditions.videoError
    && conditions.requestReady
    && !conditions.current;
}

export function inlineSceneVideoDecodeFailureTransition(
  componentDestroying: boolean,
  request: InlineSceneVideoRequest | null
): InlineSceneVideoDecodeFailureTransition {
  if (componentDestroying) return { action: 'ignore' };
  return {
    action: 'show-static-fallback',
    error: 'The generated scene motion could not be decoded; showing the static scene.',
    attemptKey: request ? inlineSceneVideoRequestKey(request) : null
  };
}

export function inlineSceneVideoMasterToggleAction(
  scenesEnabled: boolean,
  motionEnabled: boolean,
  persistenceAvailable: boolean
): InlineSceneVideoMasterToggleAction {
  if (!scenesEnabled) return 'abort';
  if (motionEnabled && persistenceAvailable) return 'restore';
  return 'none';
}

export function inlineSceneMasterToggleEnabled(
  scenePersistenceReady: boolean,
  scenePersistenceAvailable: boolean,
  videoPersistenceReady: boolean
): boolean {
  return scenePersistenceReady && scenePersistenceAvailable && videoPersistenceReady;
}

export function parseInlineSceneVideoIntegerHeader(
  value: string | null,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Inline-scene motion response omitted ' + name + '.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('Inline-scene motion response omitted ' + name + '.');
  }
  return parsed;
}

export function parseInlineSceneVideoNumberHeader(
  value: string | null,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (value === null || !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error('Inline-scene motion response omitted ' + name + '.');
  }
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed)
    || parsed < minimum
    || parsed > maximum
    || String(parsed) !== value
  ) throw new Error('Inline-scene motion response omitted ' + name + '.');
  return parsed;
}

export function buildInlineSceneVideoPrompt(request: InlineSceneVideoRequest): string {
  const normalized = normalizeInlineSceneVideoRequest(request);
  const common = [
    normalized.source.sceneRequest.prompt,
    'The video opens exactly on the supplied first frame.',
    'Preserve every visible subject, identity, attire, object, and spatial relationship while continuing only restrained physical motion implied by the scene.',
    'Use one continuous landscape shot with no cuts, no new subjects, no new objects, no text, and no black frames.'
  ];
  return normalized.modelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID
    ? [
        ...common,
        'The identical supplied scene is the first and final keyframe; all restrained motion returns exactly to that final keyframe.',
        'Ambient physical motion only: no talking, no lip or mouth movement, and no speech gestures.',
        'Silent video only; no dialogue, narration, music, room tone, ambience, or sound effects.'
      ].join(' ')
    : [
        ...common,
        'End in a composition close to the opening frame for clean replay.',
        'Audio: generate synchronized diegetic room tone, environmental ambience, and quiet physical sounds implied by visible movement; no dialogue, narration, or music.'
      ].join(' ');
}

function validateInlineSceneVideoInputReference(
  sceneInput: InlineSceneVideoInputReference,
  expectedImageSha256: string
): void {
  if (
    sceneInput.subfolder !== 'mullet/motion-inputs'
    || sceneInput.type !== 'input'
    || sceneInput.imageSha256 !== expectedImageSha256
    || !INPUT_IMAGE_PATTERN.test(sceneInput.name)
  ) throw new Error('inline-scene video input reference is invalid');
}

function nextInlineSceneVideoSeed(seed: number): number {
  return seed + 42 <= Number.MAX_SAFE_INTEGER ? seed + 42 : seed - 42;
}

export function buildLtx25InlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  if (normalized.modelTemplate !== LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID) {
    throw new Error('inline-scene video request does not select LTX 2.5');
  }
  validateInlineSceneVideoInputReference(sceneInput, normalized.source.sceneImageSha256);
  const validatedSeed = integer(seed, 'inline-scene video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = inlineSceneVideoDimensions(normalized.aspectRatio, normalized.modelTemplate);
  const template = LTX25_INLINE_SCENE_VIDEO_TEMPLATE;
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `${sceneInput.subfolder}/${sceneInput.name}` } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: template.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildInlineSceneVideoPrompt(normalized), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: LTX_NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['11', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '13': { class_type: 'LTXVAddGuide', inputs: { positive: ['12', 0], negative: ['12', 1], vae: ['5', 0], latent: ['12', 2], image: ['2', 0], frame_idx: -1, strength: 0.7 } },
    '14': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '15': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['13', 2], audio_latent: ['14', 0] } },
    '16': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['13', 0], negative: ['13', 1], video_cfg: 1, audio_cfg: 1 } },
    '17': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '18': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '19': { class_type: 'ManualSigmas', inputs: { sigmas: template.firstPassSigmas } },
    '20': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['17', 0], guider: ['16', 0], sampler: ['18', 0], sigmas: ['19', 0], latent_image: ['15', 0] } },
    '21': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['20', 0] } },
    '22': { class_type: 'LTXVCropGuides', inputs: { positive: ['13', 0], negative: ['13', 1], latent: ['21', 0] } },
    '23': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['22', 2], upscale_model: ['7', 0], vae: ['5', 0] } },
    '24': { class_type: 'LTXVAddGuide', inputs: { positive: ['10', 0], negative: ['10', 1], vae: ['5', 0], latent: ['23', 0], image: ['2', 0], frame_idx: 0, strength: 0.7 } },
    '25': { class_type: 'LTXVAddGuide', inputs: { positive: ['24', 0], negative: ['24', 1], vae: ['5', 0], latent: ['24', 2], image: ['2', 0], frame_idx: -1, strength: 0.7 } },
    '26': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['25', 2], audio_latent: ['21', 1] } },
    '27': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['25', 0], negative: ['25', 1], video_cfg: 1, audio_cfg: 1 } },
    '28': { class_type: 'RandomNoise', inputs: { noise_seed: nextInlineSceneVideoSeed(validatedSeed) } },
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
    '36': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['35', 0],
        filename_prefix: 'mullet/scene-motion-loop-flf',
        format: template.format,
        codec: template.codec
      }
    }
  };
}

export function buildMiniMaxH3InlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  if (normalized.modelTemplate !== MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID) {
    throw new Error('inline-scene video request does not select MiniMax H3');
  }
  validateInlineSceneVideoInputReference(sceneInput, normalized.source.sceneImageSha256);
  const validatedSeed = integer(seed, 'inline-scene video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = inlineSceneVideoDimensions(normalized.aspectRatio, normalized.modelTemplate);
  const template = MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '5': { class_type: 'LoadImage', inputs: { image: sceneInput.subfolder + '/' + sceneInput.name } },
    '6': { class_type: 'MiniMaxH3ImageToVideo', inputs: {
      clip: ['2', 0],
      vae: ['3', 0],
      prompt: buildInlineSceneVideoPrompt(normalized),
      width,
      height,
      length: frames,
      first_frame: ['5', 0]
    } },
    '7': { class_type: 'BasicGuider', inputs: { model: ['16', 0], conditioning: ['6', 0] } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['16', 0], scheduler: template.scheduler, steps: template.steps, denoise: template.denoise } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['6', 1] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'VAEDecodeAudio', inputs: { samples: ['11', 0], vae: ['4', 0] } },
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps, audio: ['13', 0], bit_depth: template.bitDepth } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: 'mullet/scene-motion', format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } }
  };
}

export function buildInlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  return normalized.modelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID
    ? buildLtx25InlineSceneVideoWorkflow(normalized, sceneInput, seed)
    : buildMiniMaxH3InlineSceneVideoWorkflow(normalized, sceneInput, seed);
}

export function inlineSceneVideoOutputNode(request: InlineSceneVideoRequest): string {
  return inlineSceneVideoTemplate(normalizeInlineSceneVideoRequest(request).modelTemplate).outputNode;
}

export function normalizeInlineSceneVideoCapabilities(value: unknown): InlineSceneVideoCapabilities {
  if (!isRecord(value) || value.spec !== INLINE_SCENE_VIDEO_CAPABILITIES_SPEC) {
    throw new Error('invalid inline-scene video capabilities');
  }
  if (!Array.isArray(value.templates) || value.templates.length !== INLINE_SCENE_VIDEO_TEMPLATES.length) {
    throw new Error('invalid inline-scene video templates');
  }
  const rawById = new Map(value.templates.map((capability) => [
    isRecord(capability) && isRecord(capability.template) ? capability.template.id : null,
    capability
  ]));
  const templates = INLINE_SCENE_VIDEO_TEMPLATES.map((template): InlineSceneVideoTemplateCapability => {
    const raw = rawById.get(template.id);
    if (!isRecord(raw) || !isRecord(raw.template) || raw.template.id !== template.id || typeof raw.available !== 'boolean') {
      throw new Error('invalid inline-scene video template capability');
    }
    if (
      !Array.isArray(raw.missing)
      || raw.missing.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 500)
    ) throw new Error('invalid inline-scene video template diagnostics');
    const missing = [...new Set(raw.missing)] as string[];
    if (raw.available !== (missing.length === 0)) {
      throw new Error('inline-scene video template availability contradicts diagnostics');
    }
    return { template, available: raw.available, missing };
  });
  if (rawById.size !== INLINE_SCENE_VIDEO_TEMPLATES.length) throw new Error('invalid inline-scene video templates');
  return {
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates,
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    durations: [INLINE_SCENE_VIDEO_DURATION_SECONDS]
  };
}
