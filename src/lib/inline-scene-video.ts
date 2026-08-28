import {
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneAspectRatio,
  type InlineSceneImageRequest
} from './inline-scene.ts';
import { LTX25_PORTRAIT_VIDEO_TEMPLATE } from './portrait-video.ts';

export const INLINE_SCENE_VIDEO_REQUEST_SPEC = 'mullet_inline_scene_video_request_v1' as const;
export const INLINE_SCENE_VIDEO_TEMPLATE_ID = 'ltx-2.5-scene-i2v-distilled-v1' as const;
export const INLINE_SCENE_VIDEO_TIMEOUT_MS = 900_000 as const;
export const INLINE_SCENE_VIDEO_DURATION_SECONDS = 2 as const;
export const INLINE_SCENE_VIDEO_FPS = 24 as const;
export const INLINE_SCENE_VIDEO_FRAMES = 49 as const;
export const INLINE_SCENE_VIDEO_MODE = 'i2v' as const;

export const INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 576, height: 384 },
  { aspectRatio: '4:3', width: 512, height: 384 },
  { aspectRatio: '5:4', width: 640, height: 512 },
  { aspectRatio: '16:9', width: 1024, height: 576 }
] as const);

export const LTX25_INLINE_SCENE_VIDEO_TEMPLATE = Object.freeze({
  id: INLINE_SCENE_VIDEO_TEMPLATE_ID,
  label: 'LTX 2.5 Distilled I2V',
  modelFamily: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFamily,
  modelFiles: LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles,
  requiredNodes: LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes,
  outputNode: '31',
  multiple: 64,
  sampler: LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler,
  firstPassSigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.firstPassSigmas,
  secondPassSigmas: LTX25_PORTRAIT_VIDEO_TEMPLATE.secondPassSigmas,
  codec: LTX25_PORTRAIT_VIDEO_TEMPLATE.codec,
  crf: LTX25_PORTRAIT_VIDEO_TEMPLATE.crf,
  promptGuide: 'locked landscape camera, restrained natural motion, preserve every visible subject and object, no cuts'
} as const);

export type InlineSceneVideoSource = {
  conversationId: string;
  epoch: string;
  sceneRequestKey: string;
  scenePromptId: string;
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
  spec: 'mullet_inline_scene_video_capabilities_v1';
  template: typeof LTX25_INLINE_SCENE_VIDEO_TEMPLATE;
  modes: readonly [typeof INLINE_SCENE_VIDEO_MODE];
  aspectRatios: typeof INLINE_SCENE_VIDEO_DIMENSIONS;
  durations: readonly [typeof INLINE_SCENE_VIDEO_DURATION_SECONDS];
};

export type InlineSceneVideoInputScene = {
  conversationId: string;
  epoch: string;
  requestKey: string;
  request: InlineSceneImageRequest;
  promptId: string;
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
const NEGATIVE_PROMPT = 'oversaturated, overexposed, static frame, blurry details, subtitles, text, watermark, cartoon, painting, gray cast, worst quality, low quality, jpeg artifacts, deformed face, deformed hands, fused fingers, extra limbs, new subjects, new objects, camera cuts, camera shake, black frames';

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

export function buildInlineSceneVideoPrompt(request: InlineSceneVideoRequest): string {
  const normalized = normalizeInlineSceneVideoRequest(request);
  return [
    normalized.source.sceneRequest.prompt,
    'Animate only the supplied still while preserving every visible subject, identity, attire, object, and spatial position.',
    'The camera remains locked in the same landscape composition.',
    'Continue restrained natural motion already implied by the still; do not introduce new action.',
    'The final pose returns close to the first pose for replay looping.',
    'No camera movement, no cuts, no speech, no new subjects, no new objects, no text, no black frames.'
  ].join(' ');
}

export function buildLtx25InlineSceneVideoWorkflow(
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
  return {
    '1': { class_type: 'LoadImage', inputs: { image: sceneInput.subfolder + '/' + sceneInput.name } },
    '2': { class_type: 'LTXVPreprocess', inputs: { image: ['1', 0], img_compression: 18 } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet, weight_dtype: 'default' } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.clip, type: 'ltxv', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.videoVae } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.audioVae } },
    '7': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.latentUpscaler } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: buildInlineSceneVideoPrompt(normalized), clip: ['4', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['4', 0] } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: fps } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    '12': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['11', 0], strength: 0.7, bypass: false } },
    '13': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['6', 0] } },
    '14': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['12', 0], audio_latent: ['13', 0] } },
    '15': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '16': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed } },
    '17': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.sampler } },
    '18': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.firstPassSigmas } },
    '19': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['16', 0], guider: ['15', 0], sampler: ['17', 0], sigmas: ['18', 0], latent_image: ['14', 0] } },
    '20': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['19', 0] } },
    '21': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['20', 0], upscale_model: ['7', 0], vae: ['5', 0] } },
    '22': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['5', 0], image: ['2', 0], latent: ['21', 0], strength: 1, bypass: false } },
    '23': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['22', 0], audio_latent: ['20', 1] } },
    '24': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['3', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '25': { class_type: 'RandomNoise', inputs: { noise_seed: validatedSeed + 42 <= Number.MAX_SAFE_INTEGER ? validatedSeed + 42 : validatedSeed - 42 } },
    '26': { class_type: 'KSamplerSelect', inputs: { sampler_name: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.sampler } },
    '27': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.secondPassSigmas } },
    '28': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['25', 0], guider: ['24', 0], sampler: ['26', 0], sigmas: ['27', 0], latent_image: ['23', 0] } },
    '29': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['28', 0] } },
    '30': { class_type: 'VAEDecodeTiled', inputs: { samples: ['29', 0], vae: ['5', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    '31': {
      class_type: 'SaveWEBM',
      inputs: {
        images: ['30', 0],
        filename_prefix: 'mullet/scene-motion',
        codec: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.codec,
        fps,
        crf: LTX25_INLINE_SCENE_VIDEO_TEMPLATE.crf
      }
    }
  };
}

export function normalizeInlineSceneVideoCapabilities(value: unknown): InlineSceneVideoCapabilities {
  if (!isRecord(value) || value.spec !== 'mullet_inline_scene_video_capabilities_v1') {
    throw new Error('invalid inline-scene video capabilities');
  }
  if (!isRecord(value.template) || value.template.id !== INLINE_SCENE_VIDEO_TEMPLATE_ID) {
    throw new Error('invalid inline-scene video template');
  }
  return {
    spec: 'mullet_inline_scene_video_capabilities_v1',
    template: LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
    modes: [INLINE_SCENE_VIDEO_MODE],
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    durations: [INLINE_SCENE_VIDEO_DURATION_SECONDS]
  };
}
