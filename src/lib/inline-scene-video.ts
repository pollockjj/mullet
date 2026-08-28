import {
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneAspectRatio,
  type InlineSceneImageRequest
} from './inline-scene.ts';
import { sha256Hex } from './sha256.ts';

export const INLINE_SCENE_VIDEO_REQUEST_SPEC = 'mullet_inline_scene_video_request_v2' as const;
export const INLINE_SCENE_VIDEO_TEMPLATE_ID = 'minimax-h3-fl2va-i2v-turbo-v1' as const;
export const INLINE_SCENE_VIDEO_TIMEOUT_MS = 900_000 as const;
export const INLINE_SCENE_VIDEO_DURATION_SECONDS = 5 as const;
export const INLINE_SCENE_VIDEO_FPS = 24 as const;
export const INLINE_SCENE_VIDEO_FRAMES = 124 as const;
export const INLINE_SCENE_VIDEO_MODE = 'i2v' as const;

export const INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 1152, height: 768 },
  { aspectRatio: '4:3', width: 1024, height: 768 },
  { aspectRatio: '5:4', width: 960, height: 768 },
  { aspectRatio: '16:9', width: 1344, height: 768 }
] as const);

export const MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE = Object.freeze({
  id: INLINE_SCENE_VIDEO_TEMPLATE_ID,
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
  promptGuide: 'one continuous shot from the supplied first frame, coherent physical motion, native synchronized stereo ambience, no cuts'
} as const);

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
  modelTemplate: typeof INLINE_SCENE_VIDEO_TEMPLATE_ID;
  mode: typeof INLINE_SCENE_VIDEO_MODE;
  source: InlineSceneVideoSource;
  aspectRatio: InlineSceneAspectRatio;
  durationSeconds: typeof INLINE_SCENE_VIDEO_DURATION_SECONDS;
};

export type InlineSceneVideoCapabilities = {
  spec: 'mullet_inline_scene_video_capabilities_v2';
  template: typeof MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE;
  modes: readonly [typeof INLINE_SCENE_VIDEO_MODE];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum);
  }
  return Number(value);
}

export function inlineSceneVideoDimensions(
  aspectRatio: InlineSceneAspectRatio
): { width: number; height: number; frames: number; fps: number } {
  const dimensions = dimensionMap.get(aspectRatio);
  if (!dimensions) throw new Error('unsupported inline-scene video aspect ratio');
  return {
    width: dimensions.width,
    height: dimensions.height,
    frames: INLINE_SCENE_VIDEO_FRAMES,
    fps: INLINE_SCENE_VIDEO_FPS
  };
}

export function buildInlineSceneVideoRequest(scene: InlineSceneVideoInputScene): InlineSceneVideoRequest {
  return normalizeInlineSceneVideoRequest({
    spec: INLINE_SCENE_VIDEO_REQUEST_SPEC,
    modelTemplate: INLINE_SCENE_VIDEO_TEMPLATE_ID,
    mode: INLINE_SCENE_VIDEO_MODE,
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
  if (value.modelTemplate !== INLINE_SCENE_VIDEO_TEMPLATE_ID) throw new Error('unsupported inline-scene video model template');
  if (value.mode !== INLINE_SCENE_VIDEO_MODE) throw new Error('unsupported inline-scene video mode');
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
    modelTemplate: INLINE_SCENE_VIDEO_TEMPLATE_ID,
    mode: INLINE_SCENE_VIDEO_MODE,
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
  return [
    normalized.source.sceneRequest.prompt,
    'The video opens exactly on the supplied first frame.',
    'Preserve every visible subject, identity, attire, object, and spatial relationship while continuing only restrained physical motion implied by the scene.',
    'Use one continuous landscape shot with no cuts, no new subjects, no new objects, no text, and no black frames.',
    'End in a composition close to the opening frame for clean replay.',
    'Audio: generate synchronized diegetic room tone, environmental ambience, and quiet physical sounds implied by visible movement; no dialogue, narration, or music.'
  ].join(' ');
}

export function buildMiniMaxH3InlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  if (
    sceneInput.subfolder !== 'mullet/motion-inputs'
    || sceneInput.type !== 'input'
    || sceneInput.imageSha256 !== normalized.source.sceneImageSha256
    || !INPUT_IMAGE_PATTERN.test(sceneInput.name)
  ) throw new Error('inline-scene video input reference is invalid');
  const validatedSeed = integer(seed, 'inline-scene video seed', 0, Number.MAX_SAFE_INTEGER);
  const { width, height, frames, fps } = inlineSceneVideoDimensions(normalized.aspectRatio);
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

export function normalizeInlineSceneVideoCapabilities(value: unknown): InlineSceneVideoCapabilities {
  if (!isRecord(value) || value.spec !== 'mullet_inline_scene_video_capabilities_v2') {
    throw new Error('invalid inline-scene video capabilities');
  }
  if (!isRecord(value.template) || value.template.id !== INLINE_SCENE_VIDEO_TEMPLATE_ID) {
    throw new Error('invalid inline-scene video template');
  }
  return {
    spec: 'mullet_inline_scene_video_capabilities_v2',
    template: MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
    modes: [INLINE_SCENE_VIDEO_MODE],
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    durations: [INLINE_SCENE_VIDEO_DURATION_SECONDS]
  };
}
