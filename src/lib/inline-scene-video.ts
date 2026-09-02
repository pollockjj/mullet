import {
  inlineSceneDimensionsForTemplate,
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneAspectRatio,
  type InlineSceneContinuityMaster,
  type InlineSceneIdentity,
  type InlineSceneImageRequest
} from './inline-scene.ts';
import { sha256Hex } from './sha256.ts';

export const INLINE_SCENE_VIDEO_REQUEST_SPEC = 'mullet_inline_scene_video_request_v6' as const;
export const INLINE_SCENE_VIDEO_CAPABILITIES_SPEC = 'mullet_inline_scene_video_capabilities_v6' as const;
export const MINIMAX_H3_SCENE_LOOP_TEMPLATE_ID = 'minimax-h3-fl2va-scene-loop-v1' as const;
export const MINIMAX_H3_SCENE_LOOP_MODE = 'flf2v_loop' as const;
export const INLINE_SCENE_VIDEO_TEMPLATE_ID = MINIMAX_H3_SCENE_LOOP_TEMPLATE_ID;
export const INLINE_SCENE_VIDEO_MODE = MINIMAX_H3_SCENE_LOOP_MODE;
export const INLINE_SCENE_VIDEO_FPS = 24 as const;
// See PORTRAIT_VIDEO_TIMEOUT_MS: three times the contended measurement, not fifteen minutes.
export const INLINE_SCENE_VIDEO_TIMEOUT_MS = 300_000 as const;
// MiniMaxH3ImageToVideo accepts lengths of 5 + 17k only; 73 is nearest three seconds.
export const MINIMAX_H3_SCENE_LOOP_FRAMES = 73 as const;
export const INLINE_SCENE_VIDEO_FRAMES = MINIMAX_H3_SCENE_LOOP_FRAMES;
export const MINIMAX_H3_SCENE_LOOP_DURATION_SECONDS = 3 as const;
export const INLINE_SCENE_VIDEO_DURATION_SECONDS = MINIMAX_H3_SCENE_LOOP_DURATION_SECONDS;
export const INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 1152, height: 768 },
  { aspectRatio: '4:3', width: 1024, height: 768 },
  { aspectRatio: '5:4', width: 960, height: 768 },
  { aspectRatio: '16:9', width: 1344, height: 768 }
] as const);

// The scene is the expression portrait's aspect ratio inverted: 576x1024 becomes
// 1024x576. The other ratios hold the same pixel budget, snapped to H3's 32-pixel step.
export const MINIMAX_H3_SCENE_LOOP_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 928, height: 640 },
  { aspectRatio: '4:3', width: 896, height: 672 },
  { aspectRatio: '5:4', width: 864, height: 672 },
  { aspectRatio: '16:9', width: 1024, height: 576 }
] as const);

export const MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 832, height: 544 },
  { aspectRatio: '4:3', width: 736, height: 544 },
  { aspectRatio: '5:4', width: 672, height: 544 },
  { aspectRatio: '16:9', width: 960, height: 544 }
] as const);



// Ref2VA with the four-step distillation LoRA. Self-contained: the unaccelerated
// 20-step base it used to extend has been removed entirely.

// The scene loop. Identity comes from the accepted scene still itself, which was
// generated with the cast references, so FL2VA needs no reference conditioning of its
// own and can use identical first and last frames to produce a genuine seamless loop -
// the same mechanism the working portrait loop uses.
export const MINIMAX_H3_SCENE_LOOP_TEMPLATE = Object.freeze({
  id: MINIMAX_H3_SCENE_LOOP_TEMPLATE_ID,
  label: 'MiniMax H3 FL2VA Turbo · 3 s loop (1024x576)',
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
    'CreateVideo',
    'SaveVideo',
    'LoraLoaderModelOnly',
    'MiniMaxH3SigmaShift'
  ],
  outputNode: '15',
  mode: MINIMAX_H3_SCENE_LOOP_MODE,
  dimensions: MINIMAX_H3_SCENE_LOOP_DIMENSIONS,
  durationSeconds: MINIMAX_H3_SCENE_LOOP_DURATION_SECONDS,
  frames: MINIMAX_H3_SCENE_LOOP_FRAMES,
  multiple: 32,
  shortEdge: 576,
  maxPixels: 1024 * 576,
  sampler: 'euler',
  scheduler: 'simple',
  steps: 4,
  denoise: 1,
  shiftVideo: 6,
  shiftAudio: 3,
  format: 'auto',
  codec: 'auto',
  promptGuide: 'one continuous landscape shot, identical first and last frame so the clip loops seamlessly, restrained natural motion, no cuts, no camera moves'
} as const);

// Only distillation-accelerated paths survive. Anything that needed 20 unaccelerated
// steps is removed, not hidden behind a selector.
// One scene-motion path. No selection.
export const INLINE_SCENE_VIDEO_TEMPLATES = Object.freeze([
  MINIMAX_H3_SCENE_LOOP_TEMPLATE
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
  durationSeconds: number;
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
  durations: readonly number[];
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

export type InlineSceneVideoPriorMasterInput = {
  name: string;
  subfolder: 'mullet/motion-inputs';
  type: 'input';
  imageSha256: string;
  width: number;
  height: number;
};

export type InlineSceneH3ReferencePlanEntry =
  | {
      picture: number;
      kind: 'current_scene';
      sha256: string;
    }
  | {
      picture: number;
      kind: 'prior_master';
      sha256: string;
      master: InlineSceneContinuityMaster;
    }
  | {
      picture: number;
      kind: 'canonical_identity' | 'body_identity';
      sha256: string;
      identityIndex: number;
      identity: InlineSceneIdentity;
      referenceImage: InlineSceneIdentity['referenceImage'];
    };

type InlineSceneH3ReferencePlanCandidate =
  | Omit<Extract<InlineSceneH3ReferencePlanEntry, { kind: 'current_scene' }>, 'picture'>
  | Omit<Extract<InlineSceneH3ReferencePlanEntry, { kind: 'prior_master' }>, 'picture'>
  | Omit<Extract<InlineSceneH3ReferencePlanEntry, { kind: 'canonical_identity' | 'body_identity' }>, 'picture'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INPUT_IMAGE_PATTERN = /^scene-motion-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
const PRIOR_MASTER_IMAGE_PATTERN = /^scene-motion-prior-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;

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

export function isMiniMaxH3InlineSceneVideoTemplate(
  modelTemplate: InlineSceneVideoTemplateId
): boolean {
  return inlineSceneVideoTemplate(modelTemplate).modelFamily === 'minimax-h3-fl2va';
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
  const template = inlineSceneVideoTemplate(modelTemplate);
  const dimensions = template.dimensions.find((entry) => entry.aspectRatio === aspectRatio);
  if (!dimensions) throw new Error('unsupported inline-scene video aspect ratio');
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
    durationSeconds: template.durationSeconds
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
  const staticDimensions = inlineSceneDimensionsForTemplate(
    sceneRequest.modelTemplate,
    sceneRequest.aspectRatio,
    sceneRequest.megapixels
  );
  if (sceneWidth !== staticDimensions.width || sceneHeight !== staticDimensions.height) {
    throw new Error('inline-scene video source dimensions do not match its static request');
  }
  if (
    value.aspectRatio !== sceneRequest.aspectRatio
    || !template.dimensions.some(({ aspectRatio }) => aspectRatio === value.aspectRatio)
  ) {
    throw new Error('inline-scene video aspect ratio does not match its static source');
  }
  if (value.durationSeconds !== template.durationSeconds) throw new Error('unsupported inline-scene video duration');
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
    durationSeconds: template.durationSeconds
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

function validateInlineSceneVideoPriorMasterInput(
  input: InlineSceneVideoPriorMasterInput,
  master: InlineSceneContinuityMaster
): void {
  if (
    input.subfolder !== 'mullet/motion-inputs'
    || input.type !== 'input'
    || input.imageSha256 !== master.imageSha256
    || input.width !== master.width
    || input.height !== master.height
    || !PRIOR_MASTER_IMAGE_PATTERN.test(input.name)
  ) throw new Error('inline-scene video prior master input does not match its request');
}

function nextInlineSceneVideoSeed(seed: number): number {
  return seed + 42 <= Number.MAX_SAFE_INTEGER ? seed + 42 : seed - 42;
}



// Scene loop: MiniMaxH3ImageToVideo with the accepted scene still wired to BOTH
// first_frame and last_frame, which is what makes the clip loop. Mirrors the portrait
// loop graph that already runs reliably at four steps.
function buildMiniMaxH3SceneLoopWorkflow(
  normalized: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number
): Record<string, unknown> {
  const template = MINIMAX_H3_SCENE_LOOP_TEMPLATE;
  const { width, height, frames, fps } = inlineSceneVideoDimensions(
    normalized.aspectRatio,
    normalized.modelTemplate
  );
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '5': { class_type: 'LoadImage', inputs: { image: `${sceneInput.subfolder}/${sceneInput.name}` } },
    '6': { class_type: 'MiniMaxH3ImageToVideo', inputs: {
      clip: ['2', 0],
      vae: ['3', 0],
      prompt: buildInlineSceneVideoPrompt(normalized),
      width,
      height,
      length: frames,
      first_frame: ['5', 0],
      last_frame: ['5', 0]
    } },
    '7': { class_type: 'BasicGuider', inputs: { model: ['18', 0], conditioning: ['6', 0] } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['18', 0], scheduler: template.scheduler, steps: template.steps, denoise: template.denoise } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['6', 1] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    // The scene loop is silent by necessity, not by choice: MiniMaxH3ImageToVideo (the
    // FL2VA node that provides first/last-frame looping) rejects audio_vae in this build,
    // so no audio branch exists on this path. Ref2VA keeps native audio but cannot loop.
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: 'mullet/scene-motion-loop', format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } },
    '18': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['16', 0], shift_video: template.shiftVideo, shift_audio: template.shiftAudio } }
  };
}

// The loop animates an already-correct scene still, so the prompt only has to keep it
// still-faithful and make the motion return to the starting frame.
export function buildInlineSceneVideoPrompt(request: InlineSceneVideoRequest): string {
  const normalized = normalizeInlineSceneVideoRequest(request);
  return [
    normalized.source.sceneRequest.prompt,
    // The same verbatim appearance facts the scene still was given, so the clip cannot
    // drift away from the frame it is animating.
    normalized.source.sceneRequest.continuity,
    'Preserve every visible subject, identity, attire, object, and spatial relationship while continuing only restrained physical motion implied by the scene.',
    'The identical supplied scene is both the first and the final keyframe; all motion returns exactly to that keyframe so the clip loops seamlessly.',
    'Ambient physical motion only: no talking, no lip or mouth movement, and no speech gestures.',
    'One continuous landscape shot: no camera movement, no cuts, no new subjects, no new objects, no text, and no black frames.'
  ].filter(Boolean).join(' ');
}

export function buildInlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  sceneInput: InlineSceneVideoInputReference,
  seed: number,
  priorMasterInput?: InlineSceneVideoPriorMasterInput
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  if (priorMasterInput) throw new Error('the scene loop does not accept a prior master input');
  return buildMiniMaxH3SceneLoopWorkflow(normalized, sceneInput, seed);
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
    durations: [...new Set(INLINE_SCENE_VIDEO_TEMPLATES.map(({ durationSeconds }) => durationSeconds))]
      .sort((left, right) => left - right)
  };
}
