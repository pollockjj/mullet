import {
  INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  INLINE_SCENE_VIDEO_TEMPLATES,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_SCENE_LOOP_TEMPLATE,
  buildInlineSceneVideoWorkflow,
  isMiniMaxH3InlineSceneVideoTemplate,
  inlineSceneH3ReferencePlan,
  inlineSceneVideoDimensions,
  inlineSceneVideoOutputNode,
  type InlineSceneVideoCapabilities,
  type InlineSceneVideoInputReference,
  type InlineSceneVideoPriorMasterInput,
  type InlineSceneVideoRequest
} from '../inline-scene-video.ts';
import {
  normalizeInlineSceneContinuityMaster,
  type InlineSceneContinuityMaster
} from '../inline-scene.ts';
import { validateH264AacMp4, validateH264VideoOnlyMp4 } from '../mp4.ts';
import { assertComfyIdentityReference } from './comfy-portrait.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ComfyInlineSceneVideo = {
  bytes: Uint8Array;
  contentType: 'video/mp4';
  promptId: string;
  filename: string;
  sha256: string;
  durationSeconds: number;
  audioTracks: 0 | 1;
};

export class ComfyInlineSceneVideoOutputTooLargeError extends Error {}

const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, '') + path;
}

async function responseJson(response: Response, action: string): Promise<unknown> {
  if (!response.ok) throw new Error('ComfyUI ' + action + ' failed (' + response.status + ')');
  return response.json();
}

function nodeInfo(value: unknown, nodeName: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[nodeName])) throw new Error('ComfyUI is missing ' + nodeName);
  return value[nodeName];
}

function inputDefinition(
  info: Record<string, unknown>,
  nodeName: string,
  section: 'required' | 'optional',
  inputName: string
): unknown[] {
  if (
    !isRecord(info.input)
    || !isRecord(info.input[section])
    || !Array.isArray(info.input[section][inputName])
  ) throw new Error('ComfyUI returned invalid ' + nodeName + '.' + inputName + ' metadata');
  return info.input[section][inputName] as unknown[];
}

function requiredInput(info: Record<string, unknown>, nodeName: string, inputName: string): unknown[] {
  return inputDefinition(info, nodeName, 'required', inputName);
}

function optionList(info: Record<string, unknown>, nodeName: string, inputName: string): string[] {
  const input = requiredInput(info, nodeName, inputName);
  if (Array.isArray(input[0]) && input[0].every((item) => typeof item === 'string')) return input[0] as string[];
  if (
    input[0] === 'COMBO'
    && isRecord(input[1])
    && Array.isArray(input[1].options)
    && input[1].options.every((item) => typeof item === 'string')
  ) return input[1].options as string[];
  throw new Error('ComfyUI returned invalid ' + nodeName + '.' + inputName + ' options');
}

function dynamicOptionKeys(input: unknown[], nodeName: string, inputName: string): string[] {
  if (
    input[0] !== 'COMFY_DYNAMICCOMBO_V3'
    || !isRecord(input[1])
    || !Array.isArray(input[1].options)
    || !input[1].options.every((item) => isRecord(item) && typeof item.key === 'string')
  ) throw new Error('ComfyUI returned invalid ' + nodeName + '.' + inputName + ' dynamic options');
  return input[1].options.map((item) => (item as Record<string, unknown>).key as string);
}

function requireOption(options: readonly string[], expected: string, label: string): void {
  if (!options.includes(expected)) throw new Error('ComfyUI is missing ' + label);
}

function requireExactAutogrowDefinition(
  input: unknown[],
  nodeName: string,
  inputName: string,
  prefix: string,
  maximum: number
): void {
  if (input[0] !== 'COMFY_AUTOGROW_V3' || !isRecord(input[1])) {
    throw new Error('ComfyUI returned invalid ' + nodeName + '.' + inputName + ' autogrow metadata');
  }
  const metadata = input[1];
  const template = metadata.template;
  if (!isRecord(template) || !isRecord(template.input) || !isRecord(template.input.required)) {
    throw new Error('ComfyUI returned invalid ' + nodeName + '.' + inputName + ' autogrow metadata');
  }
  const required = template.input.required;
  if (
    template.prefix !== prefix
    || template.min !== 0
    || template.max !== maximum
    || !Array.isArray(required.ref_image)
    || required.ref_image[0] !== 'IMAGE'
  ) {
    throw new Error('ComfyUI ' + nodeName + '.' + inputName + ' autogrow definition is incompatible');
  }
}

export async function sha256InlineSceneVideoBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadInlineSceneVideoCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<InlineSceneVideoCapabilities> {
  const nodeNames = [...new Set(INLINE_SCENE_VIDEO_TEMPLATES.flatMap(({ requiredNodes }) => [...requiredNodes]))];
  const bodies = new Map(await Promise.all(nodeNames.map(async (nodeName): Promise<[string, unknown | null]> => {
    try {
      const response = await fetcher(endpoint(baseUrl, '/object_info/' + encodeURIComponent(nodeName)), { signal });
      if (!response.ok) return [nodeName, null];
      return [nodeName, await response.json()];
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return [nodeName, null];
    }
  })));
  const nodeAvailable = (nodeName: string): boolean => {
    const body = bodies.get(nodeName);
    return isRecord(body) && isRecord(body[nodeName]);
  };
  const info = Object.fromEntries(nodeNames
    .filter(nodeAvailable)
    .map((nodeName) => [nodeName, nodeInfo(bodies.get(nodeName), nodeName)])) as Record<string, Record<string, unknown>>;
  const diagnostic = (missing: string[], label: string, check: () => void): void => {
    try {
      check();
    } catch {
      missing.push(label);
    }
  };
  const optionDiagnostic = (
    missing: string[],
    nodeName: string,
    inputName: string,
    expected: string,
    label: string
  ): void => {
    if (!nodeAvailable(nodeName)) return;
    diagnostic(missing, label, () => requireOption(optionList(info[nodeName], nodeName, inputName), expected, label));
  };
  const uploadDiagnostic = (missing: string[]): void => {
    if (!nodeAvailable('LoadImage')) return;
    diagnostic(missing, 'node-input:LoadImage.image_upload', () => {
      const uploadInput = requiredInput(info.LoadImage, 'LoadImage', 'image');
      if (!isRecord(uploadInput[1]) || uploadInput[1].image_upload !== true) throw new Error('upload unavailable');
    });
  };

  const ltx = LTX25_INLINE_SCENE_VIDEO_TEMPLATE;
  const ltxMissing = ltx.requiredNodes
    .filter((nodeName) => !nodeAvailable(nodeName))
    .map((nodeName) => `node:${nodeName}`);
  optionDiagnostic(ltxMissing, 'UNETLoader', 'unet_name', ltx.modelFiles.unet, `model:unet:${ltx.modelFiles.unet}`);
  optionDiagnostic(ltxMissing, 'CLIPLoader', 'clip_name', ltx.modelFiles.clip, `model:clip:${ltx.modelFiles.clip}`);
  optionDiagnostic(ltxMissing, 'CLIPLoader', 'type', 'ltxv', 'clip-type:ltxv');
  optionDiagnostic(ltxMissing, 'VAELoader', 'vae_name', ltx.modelFiles.videoVae, `model:vae:${ltx.modelFiles.videoVae}`);
  optionDiagnostic(ltxMissing, 'VAELoader', 'vae_name', ltx.modelFiles.audioVae, `model:vae:${ltx.modelFiles.audioVae}`);
  optionDiagnostic(ltxMissing, 'LatentUpscaleModelLoader', 'model_name', ltx.modelFiles.latentUpscaler, `model:latent-upscaler:${ltx.modelFiles.latentUpscaler}`);
  optionDiagnostic(ltxMissing, 'KSamplerSelect', 'sampler_name', ltx.sampler, `sampler:${ltx.sampler}`);
  if (nodeAvailable('SaveVideo')) {
    diagnostic(ltxMissing, `video-format:${ltx.format}`, () => requireOption(
      dynamicOptionKeys(requiredInput(info.SaveVideo, 'SaveVideo', 'format'), 'SaveVideo', 'format'),
      ltx.format,
      `video-format:${ltx.format}`
    ));
    diagnostic(ltxMissing, `video-codec:${ltx.codec}`, () => requireOption(
      dynamicOptionKeys(inputDefinition(info.SaveVideo, 'SaveVideo', 'optional', 'codec'), 'SaveVideo', 'codec'),
      ltx.codec,
      `video-codec:${ltx.codec}`
    ));
  }
  uploadDiagnostic(ltxMissing);

  const unique = (items: readonly string[]): string[] => [...new Set(items)];
  const minimaxCapabilities = [
    MINIMAX_H3_SCENE_LOOP_TEMPLATE,
    MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
    MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE
  ].map((minimax) => {
    const minimaxMissing = minimax.requiredNodes
      .filter((nodeName) => !nodeAvailable(nodeName))
      .map((nodeName) => `node:${nodeName}`);
    optionDiagnostic(minimaxMissing, 'UNETLoader', 'unet_name', minimax.modelFiles.unet, `model:unet:${minimax.modelFiles.unet}`);
    optionDiagnostic(minimaxMissing, 'CLIPLoader', 'clip_name', minimax.modelFiles.clip, `model:clip:${minimax.modelFiles.clip}`);
    optionDiagnostic(minimaxMissing, 'CLIPLoader', 'type', 'minimax', 'clip-type:minimax');
    optionDiagnostic(minimaxMissing, 'VAELoader', 'vae_name', minimax.modelFiles.videoVae, `model:vae:${minimax.modelFiles.videoVae}`);
    optionDiagnostic(minimaxMissing, 'VAELoader', 'vae_name', minimax.modelFiles.audioVae, `model:vae:${minimax.modelFiles.audioVae}`);
    optionDiagnostic(minimaxMissing, 'KSamplerSelect', 'sampler_name', minimax.sampler, `sampler:${minimax.sampler}`);
    optionDiagnostic(minimaxMissing, 'BasicScheduler', 'scheduler', minimax.scheduler, `scheduler:${minimax.scheduler}`);
    const acceleratorLora = 'lora' in minimax.modelFiles
      ? minimax.modelFiles.lora
      : 'turboLora' in minimax.modelFiles
        ? minimax.modelFiles.turboLora
        : null;
    if (acceleratorLora) {
      optionDiagnostic(
        minimaxMissing,
        'LoraLoaderModelOnly',
        'lora_name',
        acceleratorLora,
        `model:lora:${acceleratorLora}`
      );
    }
    // Reference conditioning is Ref2VA-only. The FL2VA scene loop takes the accepted
    // scene still as its first and last frame and has no reference slots to check.
    if ('referenceImageSize' in minimax && 'maxReferenceImages' in minimax) {
      const referenceImageSize = minimax.referenceImageSize;
      const maxReferenceImages = minimax.maxReferenceImages;
      optionDiagnostic(
        minimaxMissing,
        'MiniMaxH3ReferenceToVideo',
        'ref_image_size',
        referenceImageSize,
        `node-option:MiniMaxH3ReferenceToVideo.ref_image_size:${referenceImageSize}`
      );
      if (nodeAvailable('MiniMaxH3ReferenceToVideo')) {
        diagnostic(minimaxMissing, 'node-autogrow:MiniMaxH3ReferenceToVideo.ref_images:ref_image_:IMAGE:max=9', () => requireExactAutogrowDefinition(
          inputDefinition(info.MiniMaxH3ReferenceToVideo, 'MiniMaxH3ReferenceToVideo', 'optional', 'ref_images'),
          'MiniMaxH3ReferenceToVideo',
          'ref_images',
          'ref_image_',
          maxReferenceImages
        ));
      }
    }
    if (nodeAvailable('SaveVideo')) {
      diagnostic(minimaxMissing, `video-format:${minimax.format}`, () => requireOption(
        dynamicOptionKeys(requiredInput(info.SaveVideo, 'SaveVideo', 'format'), 'SaveVideo', 'format'),
        minimax.format,
        `video-format:${minimax.format}`
      ));
      diagnostic(minimaxMissing, `video-codec:${minimax.codec}`, () => requireOption(
        dynamicOptionKeys(inputDefinition(info.SaveVideo, 'SaveVideo', 'optional', 'codec'), 'SaveVideo', 'codec'),
        minimax.codec,
        `video-codec:${minimax.codec}`
      ));
    }
    uploadDiagnostic(minimaxMissing);
    return {
      template: minimax,
      available: minimaxMissing.length === 0,
      missing: unique(minimaxMissing)
    };
  });
  return {
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates: [
      minimaxCapabilities[0],
      {
        template: ltx,
        available: ltxMissing.length === 0,
        missing: unique(ltxMissing)
      },
      ...minimaxCapabilities.slice(1)
    ],
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    // Duration is per template now: the FL2VA loop is three seconds, Ref2VA and LTX are
    // five. Report the distinct set so the UI cannot claim a duration nothing offers.
    durations: [...new Set(INLINE_SCENE_VIDEO_TEMPLATES.map(({ durationSeconds }) => durationSeconds))]
      .sort((left, right) => left - right)
  };
}

export function validateInlineSceneVideoPng(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): void {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) throw new Error('inline-scene video input has an invalid PNG header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16, false) !== expectedWidth || view.getUint32(20, false) !== expectedHeight) {
    throw new Error('inline-scene video input dimensions do not match its static source');
  }
}

export async function uploadInlineSceneVideoInput(
  fetcher: Fetcher,
  baseUrl: string,
  bytes: Uint8Array,
  imageSha256: string,
  signal?: AbortSignal
): Promise<InlineSceneVideoInputReference> {
  if (!SHA256_PATTERN.test(imageSha256)) throw new Error('inline-scene video input hash is invalid');
  if (await sha256InlineSceneVideoBytes(bytes) !== imageSha256) {
    throw new Error('inline-scene video input hash does not match its bytes');
  }
  const name = 'scene-motion-' + globalThis.crypto.randomUUID() + '.png';
  const subfolder = 'mullet/motion-inputs';
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), name);
  form.append('subfolder', subfolder);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetcher(endpoint(baseUrl, '/upload/image'), { method: 'POST', body: form, signal });
  const body = await responseJson(response, 'inline-scene video input upload');
  if (!isRecord(body) || body.name !== name || body.subfolder !== subfolder || body.type !== 'input') {
    throw new Error('ComfyUI returned an unexpected inline-scene video upload location');
  }
  return { name, subfolder, type: 'input', imageSha256 };
}

export async function validateInlineSceneVideoPriorMasterBytes(
  bytes: Uint8Array,
  master: InlineSceneContinuityMaster
): Promise<void> {
  const normalized = normalizeInlineSceneContinuityMaster(master);
  if (await sha256InlineSceneVideoBytes(bytes) !== normalized.imageSha256) {
    throw new Error('inline-scene video prior master hash does not match its bytes');
  }
  try {
    validateInlineSceneVideoPng(bytes, normalized.width, normalized.height);
  } catch {
    throw new Error('inline-scene video prior master dimensions do not match its bytes');
  }
}

export async function uploadInlineSceneVideoPriorMasterInput(
  fetcher: Fetcher,
  baseUrl: string,
  bytes: Uint8Array,
  master: InlineSceneContinuityMaster,
  signal?: AbortSignal
): Promise<InlineSceneVideoPriorMasterInput> {
  const normalized = normalizeInlineSceneContinuityMaster(master);
  await validateInlineSceneVideoPriorMasterBytes(bytes, normalized);
  const name = 'scene-motion-prior-' + globalThis.crypto.randomUUID() + '.png';
  const subfolder = 'mullet/motion-inputs';
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), name);
  form.append('subfolder', subfolder);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetcher(endpoint(baseUrl, '/upload/image'), { method: 'POST', body: form, signal });
  const body = await responseJson(response, 'inline-scene video prior master upload');
  if (!isRecord(body) || body.name !== name || body.subfolder !== subfolder || body.type !== 'input') {
    throw new Error('ComfyUI returned an unexpected inline-scene video prior master upload location');
  }
  return {
    name,
    subfolder,
    type: 'input',
    imageSha256: normalized.imageSha256,
    width: normalized.width,
    height: normalized.height
  };
}

function promptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !UUID_PATTERN.test(value.prompt_id)) {
    throw new Error('ComfyUI returned no inline-scene video prompt ID');
  }
  if (!isRecord(value.node_errors) || Object.keys(value.node_errors).length !== 0) {
    throw new Error('ComfyUI rejected the inline-scene video graph');
  }
  return value.prompt_id;
}

function historyEntry(value: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(value)) throw new Error('ComfyUI returned invalid inline-scene video history');
  const entry = value[id];
  if (entry === undefined) return null;
  if (!isRecord(entry)) throw new Error('ComfyUI returned invalid inline-scene video prompt history');
  return entry;
}

function historyFailure(entry: Record<string, unknown>): string | null {
  if (!isRecord(entry.status)) return null;
  if (entry.status.status_str === 'error') return 'ComfyUI inline-scene video execution failed';
  if (entry.status.completed === true && entry.status.status_str !== 'success') {
    return 'ComfyUI inline-scene video execution did not succeed';
  }
  return null;
}

function outputVideo(
  entry: Record<string, unknown>,
  request: InlineSceneVideoRequest
): { filename: string; subfolder: 'mullet'; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  const outputNode = inlineSceneVideoOutputNode(request);
  if (
    !isRecord(entry.outputs)
    || Object.keys(entry.outputs).length !== 1
    || !isRecord(entry.outputs[outputNode])
  ) throw new Error('ComfyUI inline-scene video history omitted the fixed output node');
  const output = entry.outputs[outputNode];
  const references = isRecord(output) && Array.isArray(output.videos) ? output.videos : isRecord(output) ? output.images : null;
  if (!Array.isArray(references) || references.length !== 1 || !isRecord(references[0])) {
    throw new Error('ComfyUI inline-scene video history omitted the video');
  }
  if (!Array.isArray(output.animated) || output.animated.length !== 1 || output.animated[0] !== true) {
    throw new Error('ComfyUI inline-scene video history did not mark the output animated');
  }
  const video = references[0];
  const filenamePattern = request.modelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID
    ? /^scene-motion-loop-flf_\d+_\.mp4$/
    : /^scene-motion_\d+_\.mp4$/;
  if (typeof video.filename !== 'string' || !filenamePattern.test(video.filename)) {
    throw new Error('ComfyUI returned an unexpected inline-scene video filename');
  }
  if (video.subfolder !== 'mullet' || video.type !== 'output') {
    throw new Error('ComfyUI returned an unexpected inline-scene video location');
  }
  return { filename: video.filename, subfolder: 'mullet', type: 'output' };
}

function pollDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function waitForVideo(
  fetcher: Fetcher,
  baseUrl: string,
  id: string,
  request: InlineSceneVideoRequest,
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: 'mullet'; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, '/history/' + encodeURIComponent(id)), { signal });
    const entry = historyEntry(await responseJson(response, 'inline-scene video history query'), id);
    if (entry) {
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const video = outputVideo(entry, request);
      if (video) return video;
    }
    await pollDelay(250, signal);
  }
}

async function cancelComfyJob(fetcher: Fetcher, baseUrl: string, id: string): Promise<void> {
  try {
    await fetcher(endpoint(baseUrl, '/api/jobs/' + encodeURIComponent(id) + '/cancel'), {
      method: 'POST',
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    // Best-effort targeted cancellation must not replace the original failure.
  }
}

async function readBoundedVideo(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > OUTPUT_LIMIT_BYTES) {
    throw new ComfyInlineSceneVideoOutputTooLargeError('ComfyUI inline-scene video output exceeds 64 MiB');
  }
  if (!response.body) throw new Error('ComfyUI inline-scene video output has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > OUTPUT_LIMIT_BYTES) {
      await reader.cancel();
      throw new ComfyInlineSceneVideoOutputTooLargeError('ComfyUI inline-scene video output exceeds 64 MiB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function runComfyInlineSceneVideo(
  fetcher: Fetcher,
  baseUrl: string,
  request: InlineSceneVideoRequest,
  input: InlineSceneVideoInputReference,
  seed: number,
  signal?: AbortSignal,
  priorMasterInput?: InlineSceneVideoPriorMasterInput
): Promise<ComfyInlineSceneVideo> {
  const workflow = buildInlineSceneVideoWorkflow(request, input, seed, priorMasterInput);
  let id = '';
  let completed = false;
  try {
    if (isMiniMaxH3InlineSceneVideoTemplate(request.modelTemplate)) {
      for (const entry of inlineSceneH3ReferencePlan(request)) {
        if (entry.kind === 'canonical_identity' || entry.kind === 'body_identity') {
          await assertComfyIdentityReference(fetcher, baseUrl, entry.referenceImage, signal);
        }
      }
    }
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: 'mullet-inline-scene-video'
      }),
      signal
    });
    id = promptId(await responseJson(queueResponse, 'inline-scene video queue submission'));
    const video = await waitForVideo(fetcher, baseUrl, id, request, signal);
    const query = new URLSearchParams(video);
    const outputResponse = await fetcher(endpoint(baseUrl, '/view?' + query), { signal });
    if (!outputResponse.ok) throw new Error('ComfyUI inline-scene video fetch failed (' + outputResponse.status + ')');
    const contentType = outputResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const bytes = await readBoundedVideo(outputResponse);
    const dimensions = inlineSceneVideoDimensions(request.aspectRatio, request.modelTemplate);
    const expected = {
      width: dimensions.width,
      height: dimensions.height,
      frames: dimensions.frames,
      fps: dimensions.fps
    };
    let durationSeconds: number;
    let audioTracks: ComfyInlineSceneVideo['audioTracks'];
    if (contentType !== 'video/mp4') throw new Error('ComfyUI inline-scene video output is not MP4');
    if (
      bytes.byteLength < 12
      || bytes[4] !== 0x66
      || bytes[5] !== 0x74
      || bytes[6] !== 0x79
      || bytes[7] !== 0x70
    ) throw new Error('ComfyUI inline-scene video output has an invalid MP4 signature');
    if (request.modelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID) {
      durationSeconds = validateH264VideoOnlyMp4(bytes, expected).durationSeconds;
      audioTracks = 0;
    } else {
      durationSeconds = validateH264AacMp4(bytes, expected).durationSeconds;
      audioTracks = 1;
    }
    completed = true;
    return {
      bytes,
      contentType: 'video/mp4',
      promptId: id,
      filename: video.filename,
      sha256: await sha256InlineSceneVideoBytes(bytes),
      durationSeconds,
      audioTracks
    };
  } catch (cause) {
    if (id && !completed) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  }
}
