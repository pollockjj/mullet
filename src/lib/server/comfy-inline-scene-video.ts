import {
  INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER,
  INLINE_SCENE_VIDEO_TEMPLATES,
  MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES,
  buildInlineSceneVideoWorkflow,
  inlineSceneVideoDimensions,
  inlineSceneVideoOutputNode,
  normalizeInlineSceneVideoRequest,
  type InlineSceneVideoCapabilities,
  type InlineSceneVideoRequest
} from '../inline-scene-video.ts';
import { validateH264VideoOnlyMp4 } from '../mp4.ts';
import { trackPrompt, untrackPrompt } from './inflight.ts';

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

  const unique = (items: readonly string[]): string[] => [...new Set(items)];
  const minimaxCapabilities = INLINE_SCENE_VIDEO_TEMPLATES.map((minimax) => {
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
    const acceleratorLora: string = minimax.modelFiles.turboLora;
    if (acceleratorLora) {
      optionDiagnostic(
        minimaxMissing,
        'LoraLoaderModelOnly',
        'lora_name',
        acceleratorLora,
        `model:lora:${acceleratorLora}`
      );
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
    if (nodeAvailable('MiniMaxH3ReferenceToVideo')) {
      diagnostic(minimaxMissing, 'node-input:MiniMaxH3ReferenceToVideo.ref_images', () => requireExactAutogrowDefinition(
        inputDefinition(info.MiniMaxH3ReferenceToVideo, 'MiniMaxH3ReferenceToVideo', 'optional', 'ref_images'),
        'MiniMaxH3ReferenceToVideo',
        'ref_images',
        'ref_image_',
        MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES
      ));
      optionDiagnostic(minimaxMissing, 'MiniMaxH3ReferenceToVideo', 'ref_image_size', minimax.refImageSize, `ref-image-size:${minimax.refImageSize}`);
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
    templates: minimaxCapabilities,
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    // Duration is per template: the FL2VA loop is three seconds, Ref2VA is five.
    // Report the distinct set so the UI cannot claim a duration nothing offers.
    durations: [...new Set(INLINE_SCENE_VIDEO_TEMPLATES.map(({ durationSeconds }) => durationSeconds))]
      .sort((left, right) => left - right)
  };
}

export class InlineSceneVideoReferenceMissingError extends Error {
  constructor(name: string) {
    super('inline-scene video reference is not prepared on the loop lane: ' + name);
    this.name = 'InlineSceneVideoReferenceMissingError';
  }
}

// Every reference the request names must already sit on the loop lane's input namespace
// (prepared by /api/scene/references). A missing one is a 409 upstream, never a silent
// clip without that person.
export async function assertInlineSceneVideoReferencesPresent(
  fetcher: Fetcher,
  baseUrl: string,
  request: InlineSceneVideoRequest,
  signal?: AbortSignal
): Promise<void> {
  const normalized = normalizeInlineSceneVideoRequest(request);
  for (const reference of normalized.source.references) {
    signal?.throwIfAborted();
    const query = new URLSearchParams({ filename: reference.name, subfolder: INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER, type: 'input' });
    // GET, not HEAD: ComfyUI's /view does not answer HEAD consistently. The body is
    // dropped immediately, so nothing but the status is read.
    const response = await fetcher(endpoint(baseUrl, '/view?' + query), { signal });
    const present = response.ok;
    // The body is read and dropped: only the status matters, but leaving it unread keeps
    // the socket half-consumed.
    await response.arrayBuffer().catch(() => undefined);
    if (!present) throw new InlineSceneVideoReferenceMissingError(reference.name);
  }
}

function promptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !UUID_PATTERN.test(value.prompt_id)) {
    throw new Error('ComfyUI returned an invalid inline-scene video prompt ID');
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
  const filenamePattern = /^scene-motion-ref_\d+_\.mp4$/;
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
  seed: number,
  signal?: AbortSignal
): Promise<ComfyInlineSceneVideo> {
  const workflow = buildInlineSceneVideoWorkflow(request, seed);
  let id = '';
  let completed = false;
  try {
    // The clip is conditioned on the prepared references named in the request; nothing is uploaded here.
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
    trackPrompt(baseUrl, id);
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
    if (contentType !== 'video/mp4') throw new Error('ComfyUI inline-scene video output is not MP4');
    if (
      bytes.byteLength < 12
      || bytes[4] !== 0x66
      || bytes[5] !== 0x74
      || bytes[6] !== 0x79
      || bytes[7] !== 0x70
    ) throw new Error('ComfyUI inline-scene video output has an invalid MP4 signature');
    // Video-only decode: the audio branch is not wired into the graph.
    const durationSeconds = validateH264VideoOnlyMp4(bytes, expected).durationSeconds;
    const audioTracks: ComfyInlineSceneVideo['audioTracks'] = 0;
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
  } finally {
    untrackPrompt(id);
  }
}
