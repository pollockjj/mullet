import {
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  buildLtx25InlineSceneVideoWorkflow,
  type InlineSceneVideoCapabilities,
  type InlineSceneVideoInputReference,
  type InlineSceneVideoRequest
} from '../inline-scene-video.ts';
import { loadPortraitVideoCapabilities } from './comfy-portrait-video.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ComfyInlineSceneVideo = {
  bytes: Uint8Array;
  contentType: 'video/webm';
  promptId: string;
  filename: string;
  sha256: string;
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

export async function sha256InlineSceneVideoBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadInlineSceneVideoCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<InlineSceneVideoCapabilities> {
  await loadPortraitVideoCapabilities(fetcher, baseUrl, signal);
  return {
    spec: 'mullet_inline_scene_video_capabilities_v1',
    template: LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
    modes: ['i2v'],
    aspectRatios: INLINE_SCENE_VIDEO_DIMENSIONS,
    durations: [INLINE_SCENE_VIDEO_DURATION_SECONDS]
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

function outputVideo(entry: Record<string, unknown>): { filename: string; subfolder: 'mullet'; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  if (
    !isRecord(entry.outputs)
    || Object.keys(entry.outputs).length !== 1
    || !isRecord(entry.outputs[LTX25_INLINE_SCENE_VIDEO_TEMPLATE.outputNode])
  ) throw new Error('ComfyUI inline-scene video history omitted the fixed output node');
  const output = entry.outputs[LTX25_INLINE_SCENE_VIDEO_TEMPLATE.outputNode];
  if (!isRecord(output) || !Array.isArray(output.images) || output.images.length !== 1 || !isRecord(output.images[0])) {
    throw new Error('ComfyUI inline-scene video history omitted the video');
  }
  if (!Array.isArray(output.animated) || output.animated.length !== 1 || output.animated[0] !== true) {
    throw new Error('ComfyUI inline-scene video history did not mark the output animated');
  }
  const video = output.images[0];
  if (typeof video.filename !== 'string' || !/^scene-motion_\d+_\.webm$/.test(video.filename)) {
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
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: 'mullet'; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, '/history/' + encodeURIComponent(id)), { signal });
    const entry = historyEntry(await responseJson(response, 'inline-scene video history query'), id);
    if (entry) {
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const video = outputVideo(entry);
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
  signal?: AbortSignal
): Promise<ComfyInlineSceneVideo> {
  let id = '';
  let completed = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildLtx25InlineSceneVideoWorkflow(request, input, seed),
        client_id: 'mullet-inline-scene-video'
      }),
      signal
    });
    id = promptId(await responseJson(queueResponse, 'inline-scene video queue submission'));
    const video = await waitForVideo(fetcher, baseUrl, id, signal);
    completed = true;
    const query = new URLSearchParams(video);
    const outputResponse = await fetcher(endpoint(baseUrl, '/view?' + query), { signal });
    if (!outputResponse.ok) throw new Error('ComfyUI inline-scene video fetch failed (' + outputResponse.status + ')');
    const contentType = outputResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (contentType !== 'video/webm') throw new Error('ComfyUI inline-scene video output is not WebM');
    const bytes = await readBoundedVideo(outputResponse);
    if (bytes.byteLength < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
      throw new Error('ComfyUI inline-scene video output has an invalid WebM signature');
    }
    return {
      bytes,
      contentType: 'video/webm',
      promptId: id,
      filename: video.filename,
      sha256: await sha256InlineSceneVideoBytes(bytes)
    };
  } catch (cause) {
    if (id && !completed) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  }
}
