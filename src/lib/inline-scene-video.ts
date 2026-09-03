import {
  inlineSceneDimensionsForTemplate,
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneAspectRatio,
  type InlineSceneImageRequest
} from './inline-scene.ts';
import { sha256Hex } from './sha256.ts';

export const INLINE_SCENE_VIDEO_REQUEST_SPEC = 'mullet_inline_scene_video_request_v7' as const;
export const INLINE_SCENE_VIDEO_CAPABILITIES_SPEC = 'mullet_inline_scene_video_capabilities_v7' as const;
// The scene is a reference-to-video clip (operator order, 2026-09-02): no scene still.
export const MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID = 'minimax-h3-ref2va-scene-v1' as const;
export const MINIMAX_H3_REFERENCE_SCENE_MODE = 'ref2v' as const;
export const MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES = 9 as const;
export const INLINE_SCENE_VIDEO_TEMPLATE_ID = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID;
export const INLINE_SCENE_VIDEO_MODE = MINIMAX_H3_REFERENCE_SCENE_MODE;
export const INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER = 'mullet/identity/refpack' as const;
export const INLINE_SCENE_VIDEO_FPS = 24 as const;
// See PORTRAIT_VIDEO_TIMEOUT_MS: three times the contended measurement, not fifteen minutes.
export const INLINE_SCENE_VIDEO_TIMEOUT_MS = 300_000 as const;
// MiniMax H3 accepts lengths of 5 + 17k frames only; 73 is the nearest three seconds.
export const MINIMAX_H3_SCENE_FRAMES = 73 as const;
export const INLINE_SCENE_VIDEO_FRAMES = MINIMAX_H3_SCENE_FRAMES;
export const MINIMAX_H3_SCENE_DURATION_SECONDS = 3 as const;
export const INLINE_SCENE_VIDEO_DURATION_SECONDS = MINIMAX_H3_SCENE_DURATION_SECONDS;
export const INLINE_SCENE_VIDEO_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 1152, height: 768 },
  { aspectRatio: '4:3', width: 1024, height: 768 },
  { aspectRatio: '5:4', width: 960, height: 768 },
  { aspectRatio: '16:9', width: 1344, height: 768 }
] as const);

// The scene is the expression portrait's aspect ratio inverted: 576x1024 becomes
// 1024x576. The other ratios hold the same pixel budget, snapped to H3's 32-pixel step.
export const MINIMAX_H3_SCENE_DIMENSIONS = Object.freeze([
  { aspectRatio: '3:2', width: 928, height: 640 },
  { aspectRatio: '4:3', width: 896, height: 672 },
  { aspectRatio: '5:4', width: 864, height: 672 },
  { aspectRatio: '16:9', width: 1024, height: 576 }
] as const);


// Reference-to-video scene clip (operator proposal, 2026-09-02): no scene still. Up to
// nine reference images of the cast condition MiniMaxH3ReferenceToVideo directly, so the
// scene lands animated in one pass (probe on firestorm:8189: three references, 1024x576,
// 73 frames, 4 steps, 61.4 s of ComfyUI). Same sampler chain as the loop.
export const MINIMAX_H3_REFERENCE_SCENE_TEMPLATE = Object.freeze({
  id: MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID,
  label: 'MiniMax H3 Ref2VA Turbo · 3 s scene from cast references (1024x576)',
  modelFamily: 'minimax-h3-ref2va',
  modelFiles: {
    unet: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
    videoVae: 'minimax_h3_video_vae_fp16.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
    turboLora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'
  },
  requiredNodes: [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'LoadImage',
    'MiniMaxH3ReferenceToVideo',
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
  mode: MINIMAX_H3_REFERENCE_SCENE_MODE,
  dimensions: MINIMAX_H3_SCENE_DIMENSIONS,
  durationSeconds: MINIMAX_H3_SCENE_DURATION_SECONDS,
  frames: MINIMAX_H3_SCENE_FRAMES,
  multiple: 32,
  shortEdge: 576,
  maxPixels: 896 * 672,
  sampler: 'euler',
  scheduler: 'simple',
  steps: 4,
  denoise: 1,
  shiftVideo: 6,
  shiftAudio: 3,
  // 'max' feeds the references at their own resolution instead of scaling them down to
  // the clip's pixel area. Measured on the lane 2026-09-03 with an identical seed: 46.2 s
  // either way, because the pack's 832x1024 pictures are already under the 2048 limit, so
  // the identity fidelity is free.
  refImageSize: 'max',
  format: 'auto',
  codec: 'auto',
  promptGuide: 'one continuous close shot of the referenced person in the described place, restrained natural motion, no cuts, no camera moves, no text'
} as const);

export type MiniMaxH3SceneReference = {
  // Subject label used in the prompt binding ("Jan"), and the view the picture shows.
  subject: string;
  view: InlineSceneVideoReferenceView;
  // Uploaded ComfyUI input path (subfolder/name) readable by the loop lane.
  image: string;
};

// The prompt names every picture in connection order, as the ComfyUI MiniMax H3 docs
// require ("<Picture 1>"), and says which subject and view it carries.
export function buildMiniMaxH3ReferenceScenePrompt(
  scenePrompt: string,
  continuity: string,
  references: readonly MiniMaxH3SceneReference[]
): string {
  const bySubject = new Map<string, string[]>();
  references.forEach((reference, index) => {
    const tag = `<Picture ${index + 1}>`;
    const viewLabel = reference.view === 'face' ? 'face'
      : reference.view === 'threequarter' ? 'three-quarter view'
      : reference.view === 'waistup' ? 'clothing from the waist up'
      : 'identity';
    const list = bySubject.get(reference.subject) ?? [];
    list.push(`${tag} ${viewLabel}`);
    bySubject.set(reference.subject, list);
  });
  const subjects = [...bySubject.keys()];
  const bindings = [...bySubject.entries()].map(([subject, pictures]) => `${subject} is the person in ${pictures.join(', ')}`);
  // One-to-one by design (operator order, 2026-09-03): one named person, framed close,
  // alone, and never mid-speech.
  // One-to-one: a request can only carry one subject, and the sentences below read as
  // that person alone. If a set ever arrives with more, the first is the scene's subject.
  const only = subjects[0] ?? '';
  return [
    bindings.length ? `Use the pictures only as the identity of ${only}: ${bindings.join('; ')}.` : '',
    scenePrompt,
    continuity,
    `${only} is the only person in the frame: no other people, no bystanders, no crowd, no silhouettes, and no reflections of anyone else.`,
    `Framing: a close medium shot of ${only} from roughly the waist up, facing the camera and filling most of the frame; the camera stays close and never pulls back to a wide landscape.`,
    'Keep the face unobstructed, sharp, and matching the reference pictures exactly.',
    'Motion is quiet and physical only: no talking, no lip or mouth movement, no speech gestures, and no singing; the mouth stays closed.',
    MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.promptGuide + ', no black frames.'
  ].filter(Boolean).join(' ');
}

export function buildMiniMaxH3ReferenceSceneWorkflow(settings: {
  prompt: string;
  references: readonly MiniMaxH3SceneReference[];
  width: number;
  height: number;
  frames: number;
  fps: number;
  seed: number;
}): Record<string, unknown> {
  const template = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE;
  if (settings.references.length < 1 || settings.references.length > MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES) {
    throw new Error(`reference scene needs between 1 and ${MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES} references`);
  }
  if (!Number.isInteger(settings.width) || !Number.isInteger(settings.height) || settings.width % template.multiple !== 0 || settings.height % template.multiple !== 0) {
    throw new Error(`reference scene dimensions must be multiples of ${template.multiple}`);
  }
  if (!Number.isInteger(settings.frames) || settings.frames < 5 || (settings.frames - 5) % 17 !== 0) {
    throw new Error('reference scene frame count must be 5 + 17k');
  }
  if (!Number.isSafeInteger(settings.seed) || settings.seed < 0) throw new Error('reference scene seed is invalid');
  if (settings.references.some((reference) => !/^mullet\/[A-Za-z0-9_./-]+\.png$/.test(reference.image) || reference.image.includes('..'))) {
    throw new Error('reference scene images must live in the mullet input namespace');
  }
  const graph: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: template.modelFiles.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: template.modelFiles.clip, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: template.modelFiles.audioVae } },
    '7': { class_type: 'BasicGuider', inputs: { model: ['18', 0], conditioning: ['6', 0] } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: template.sampler } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['18', 0], scheduler: template.scheduler, steps: template.steps, denoise: template.denoise } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: settings.seed } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['6', 1] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps: settings.fps } },
    '15': { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: 'mullet/scene-motion-ref', format: template.format, codec: template.codec } },
    '16': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 } },
    '18': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['16', 0], shift_video: template.shiftVideo, shift_audio: template.shiftAudio } }
  };
  const refImages: Record<string, [string, number]> = {};
  settings.references.forEach((reference, index) => {
    const nodeId = String(20 + index);
    graph[nodeId] = { class_type: 'LoadImage', inputs: { image: reference.image } };
    // ComfyUI's autogrow input is submitted nested under the input name; flat keys pass
    // validation and then fail inside execute().
    refImages[`ref_image_${index}`] = [nodeId, 0];
  });
  graph['6'] = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: {
    clip: ['2', 0],
    vae: ['3', 0],
    audio_vae: ['4', 0],
    prompt: settings.prompt,
    width: settings.width,
    height: settings.height,
    length: settings.frames,
    ref_image_size: template.refImageSize,
    ref_images: refImages
  } };
  return graph;
}

// Only distillation-accelerated paths survive. Anything that needed 20 unaccelerated
// steps is removed, not hidden behind a selector.
// One scene-motion path. No selection.
export const INLINE_SCENE_VIDEO_TEMPLATES = Object.freeze([
  MINIMAX_H3_REFERENCE_SCENE_TEMPLATE
] as const);

export type InlineSceneVideoTemplate = (typeof INLINE_SCENE_VIDEO_TEMPLATES)[number];
export type InlineSceneVideoTemplateId = InlineSceneVideoTemplate['id'];
export type InlineSceneVideoMode = InlineSceneVideoTemplate['mode'];

export type InlineSceneVideoReferenceView = 'face' | 'threequarter' | 'waistup' | 'identity';

// One prepared reference picture on the loop lane (input `mullet/identity/refpack/<name>`).
export type InlineSceneVideoReference = {
  profileId: string;
  view: InlineSceneVideoReferenceView;
  sha256: string;
  name: string;
};

export type InlineSceneVideoSource = {
  conversationId: string;
  epoch: string;
  sceneRequestKey: string;
  sceneRequest: InlineSceneImageRequest;
  references: InlineSceneVideoReference[];
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REFERENCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}-(face|threequarter|waistup|identity)-[0-9a-f]{1,16}\.png$/;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  return inlineSceneVideoTemplate(modelTemplate).modelFamily === 'minimax-h3-ref2va';
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
  scene: {
    conversationId: string;
    epoch: string;
    request: InlineSceneImageRequest;
    references: readonly InlineSceneVideoReference[];
  },
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
      sceneRequestKey: inlineSceneImageRequestKey(scene.request),
      sceneRequest: scene.request,
      references: Array.isArray(scene.references) ? scene.references.map((reference) => ({ ...reference })) : scene.references
    },
    aspectRatio: scene.request.aspectRatio,
    durationSeconds: template.durationSeconds
  });
}

// A reference's file name is keyed on the subject's profile fingerprint (so the loop lane
// can be checked for it before anything is rendered); its sha256 is the picture's hash.
export function inlineSceneVideoReferenceName(profileId: string, view: InlineSceneVideoReferenceView, profileFingerprint: string): string {
  return `${profileId}-${view}-${profileFingerprint.slice(0, 16)}.png`;
}

export function normalizeInlineSceneVideoReference(value: unknown, profileFingerprint?: string): InlineSceneVideoReference {
  if (!isRecord(value)) throw new Error('inline-scene video reference is invalid');
  const { profileId, view, sha256, name } = value;
  if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) throw new Error('inline-scene video reference profile is invalid');
  if (view !== 'face' && view !== 'threequarter' && view !== 'waistup' && view !== 'identity') {
    throw new Error('inline-scene video reference view is invalid');
  }
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) throw new Error('inline-scene video reference hash is invalid');
  if (typeof name !== 'string' || !REFERENCE_NAME_PATTERN.test(name) || !name.startsWith(`${profileId}-${view}-`)) {
    throw new Error('inline-scene video reference name does not match its profile and view');
  }
  if (profileFingerprint !== undefined && name !== inlineSceneVideoReferenceName(profileId, view, profileFingerprint)) {
    throw new Error('inline-scene video reference name does not match its subject fingerprint');
  }
  return { profileId, view, sha256, name };
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
  ) throw new Error('inline-scene video source provenance is invalid');
  if (!Array.isArray(value.source.references) || value.source.references.length < 1 || value.source.references.length > MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES) {
    throw new Error(`inline-scene video needs between 1 and ${MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES} references`);
  }
  // Every reference must belong to a cast member of the scene (its name is bound to that
  // member's fingerprint), and every cast member must have at least one reference, or the
  // clip cannot bind identities.
  const fingerprints = new Map(sceneRequest.cast.identities.map(({ profileId, profileFingerprint }) => [profileId, profileFingerprint]));
  const references = value.source.references.map((reference: unknown) => {
    const profileId = isRecord(reference) && typeof reference.profileId === 'string' ? reference.profileId : '';
    const fingerprint = fingerprints.get(profileId);
    if (fingerprint === undefined) throw new Error('inline-scene video reference does not belong to the scene cast');
    return normalizeInlineSceneVideoReference(reference, fingerprint);
  });
  if (new Set(references.map(({ name }) => name)).size !== references.length) {
    throw new Error('inline-scene video references are duplicated');
  }
  const castIds = new Set(fingerprints.keys());
  for (const profileId of castIds) {
    if (!references.some((reference) => reference.profileId === profileId)) {
      throw new Error(`inline-scene video is missing references for ${profileId}`);
    }
  }
  if (
    value.aspectRatio !== sceneRequest.aspectRatio
    || !template.dimensions.some(({ aspectRatio }) => aspectRatio === value.aspectRatio)
  ) {
    throw new Error('inline-scene video aspect ratio does not match its scene');
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
      sceneRequest,
      references
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
    ...normalized.source.references.map(({ name }) => name),
    normalized.modelTemplate,
    normalized.mode,
    normalized.aspectRatio,
    normalized.durationSeconds
  ].join('\u001f');
}

// One hash over the ordered reference set: the clip's input provenance, carried in the
// response headers and the stored record where the still's hash used to be.
export function inlineSceneVideoReferencesSha256(request: InlineSceneVideoRequest): string {
  return sha256Hex(normalizeInlineSceneVideoRequest(request).source.references.map(({ sha256 }) => sha256).join('\n'));
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





export function inlineSceneVideoSceneReferences(request: InlineSceneVideoRequest): MiniMaxH3SceneReference[] {
  const normalized = normalizeInlineSceneVideoRequest(request);
  const names = new Map(normalized.source.sceneRequest.cast.identities.map(({ profileId, displayName }) => [profileId, displayName]));
  return normalized.source.references.map((reference) => ({
    subject: names.get(reference.profileId) ?? reference.profileId,
    view: reference.view,
    image: `${INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER}/${reference.name}`
  }));
}

export function buildInlineSceneVideoPrompt(request: InlineSceneVideoRequest): string {
  const normalized = normalizeInlineSceneVideoRequest(request);
  return buildMiniMaxH3ReferenceScenePrompt(
    normalized.source.sceneRequest.prompt,
    normalized.source.sceneRequest.continuity,
    inlineSceneVideoSceneReferences(normalized)
  );
}

export function buildInlineSceneVideoWorkflow(
  request: InlineSceneVideoRequest,
  seed: number
): Record<string, unknown> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  const { width, height, frames, fps } = inlineSceneVideoDimensions(normalized.aspectRatio, normalized.modelTemplate);
  return buildMiniMaxH3ReferenceSceneWorkflow({
    prompt: buildInlineSceneVideoPrompt(normalized),
    references: inlineSceneVideoSceneReferences(normalized),
    width,
    height,
    frames,
    fps,
    seed
  });
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
