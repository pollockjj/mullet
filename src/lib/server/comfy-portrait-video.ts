import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE,
  PORTRAIT_VIDEO_DIMENSIONS,
  PORTRAIT_VIDEO_DURATION_SECONDS,
  buildLtx25PortraitVideoWorkflow,
  type PortraitVideoCapabilities,
  type PortraitVideoInputReference,
  type PortraitVideoRequest
} from '../portrait-video.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ComfyPortraitVideo = {
  bytes: Uint8Array;
  contentType: 'video/webm';
  promptId: string;
  filename: string;
  sha256: string;
};

export class ComfyPortraitVideoOutputTooLargeError extends Error {}

const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function responseJson(response: Response, action: string): Promise<unknown> {
  if (!response.ok) throw new Error(`ComfyUI ${action} failed (${response.status})`);
  return response.json();
}

function nodeInfo(value: unknown, nodeName: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[nodeName])) throw new Error(`ComfyUI is missing ${nodeName}`);
  return value[nodeName];
}

function requiredInput(info: Record<string, unknown>, nodeName: string, inputName: string): unknown[] {
  if (!isRecord(info.input) || !isRecord(info.input.required) || !Array.isArray(info.input.required[inputName])) {
    throw new Error(`ComfyUI returned invalid ${nodeName}.${inputName} metadata`);
  }
  return info.input.required[inputName] as unknown[];
}

function optionList(info: Record<string, unknown>, nodeName: string, inputName: string): string[] {
  const input = requiredInput(info, nodeName, inputName);
  if (Array.isArray(input[0]) && input[0].every((item) => typeof item === 'string')) return input[0] as string[];
  if (input[0] === 'COMBO' && isRecord(input[1]) && Array.isArray(input[1].options) && input[1].options.every((item) => typeof item === 'string')) {
    return input[1].options as string[];
  }
  throw new Error(`ComfyUI returned invalid ${nodeName}.${inputName} options`);
}

function requireOption(options: readonly string[], expected: string, label: string): void {
  if (!options.includes(expected)) throw new Error(`ComfyUI is missing ${label}`);
}

export async function loadPortraitVideoCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<PortraitVideoCapabilities> {
  const pairs = await Promise.all(LTX25_PORTRAIT_VIDEO_TEMPLATE.requiredNodes.map(async (nodeName) => {
    const response = await fetcher(endpoint(baseUrl, `/object_info/${encodeURIComponent(nodeName)}`), { signal });
    const body = await responseJson(response, 'portrait-video capability query');
    return [nodeName, nodeInfo(body, nodeName)] as const;
  }));
  const info = Object.fromEntries(pairs) as Record<string, Record<string, unknown>>;
  requireOption(optionList(info.UNETLoader, 'UNETLoader', 'unet_name'), LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.unet, 'the LTX 2.5 diffusion model');
  requireOption(optionList(info.CLIPLoader, 'CLIPLoader', 'clip_name'), LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.clip, 'the LTX 2.5 text encoder');
  requireOption(optionList(info.CLIPLoader, 'CLIPLoader', 'type'), 'ltxv', 'the ltxv text-encoder mode');
  const vaes = optionList(info.VAELoader, 'VAELoader', 'vae_name');
  requireOption(vaes, LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.videoVae, 'the LTX 2.5 video VAE');
  requireOption(vaes, LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.audioVae, 'the LTX 2.5 audio VAE');
  requireOption(
    optionList(info.LatentUpscaleModelLoader, 'LatentUpscaleModelLoader', 'model_name'),
    LTX25_PORTRAIT_VIDEO_TEMPLATE.modelFiles.latentUpscaler,
    'the LTX 2.5 latent upscaler'
  );
  requireOption(optionList(info.KSamplerSelect, 'KSamplerSelect', 'sampler_name'), LTX25_PORTRAIT_VIDEO_TEMPLATE.sampler, 'the euler_ancestral sampler');
  requireOption(optionList(info.SaveWEBM, 'SaveWEBM', 'codec'), LTX25_PORTRAIT_VIDEO_TEMPLATE.codec, 'the VP9 WebM encoder');
  const uploadInput = requiredInput(info.LoadImage, 'LoadImage', 'image');
  if (!isRecord(uploadInput[1]) || uploadInput[1].image_upload !== true) throw new Error('ComfyUI image upload support is unavailable');
  return {
    spec: 'mullet_portrait_video_capabilities_v1',
    template: LTX25_PORTRAIT_VIDEO_TEMPLATE,
    aspectRatios: PORTRAIT_VIDEO_DIMENSIONS,
    durations: [PORTRAIT_VIDEO_DURATION_SECONDS]
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validatePortraitVideoPng(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): void {
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
  ) throw new Error('portrait-video input has an invalid PNG header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error('portrait-video input dimensions do not match its source');
  }
}

export async function uploadPortraitVideoInput(
  fetcher: Fetcher,
  baseUrl: string,
  bytes: Uint8Array,
  imageSha256: string,
  signal?: AbortSignal
): Promise<PortraitVideoInputReference> {
  if (!SHA256_PATTERN.test(imageSha256)) throw new Error('portrait-video input hash is invalid');
  if (await sha256Hex(bytes) !== imageSha256) throw new Error('portrait-video input hash does not match its bytes');
  const name = `portrait-motion-${globalThis.crypto.randomUUID()}.png`;
  const subfolder = 'mullet/motion-inputs';
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), name);
  form.append('subfolder', subfolder);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetcher(endpoint(baseUrl, '/upload/image'), { method: 'POST', body: form, signal });
  const body = await responseJson(response, 'portrait-video input upload');
  if (!isRecord(body) || body.name !== name || body.subfolder !== subfolder || body.type !== 'input') {
    throw new Error('ComfyUI returned an unexpected portrait-video upload location');
  }
  return { name, subfolder, type: 'input', imageSha256 };
}

function promptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !UUID_PATTERN.test(value.prompt_id)) {
    throw new Error('ComfyUI returned no portrait-video prompt ID');
  }
  if (!isRecord(value.node_errors) || Object.keys(value.node_errors).length !== 0) {
    throw new Error('ComfyUI rejected the portrait-video graph');
  }
  return value.prompt_id;
}

function historyEntry(value: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(value)) throw new Error('ComfyUI returned invalid portrait-video history');
  const entry = value[id];
  if (entry === undefined) return null;
  if (!isRecord(entry)) throw new Error('ComfyUI returned invalid portrait-video prompt history');
  return entry;
}

function historyFailure(entry: Record<string, unknown>): string | null {
  if (!isRecord(entry.status)) return null;
  if (entry.status.status_str === 'error') return 'ComfyUI portrait-video execution failed';
  if (entry.status.completed === true && entry.status.status_str !== 'success') return 'ComfyUI portrait-video execution did not succeed';
  return null;
}

function outputVideo(entry: Record<string, unknown>): { filename: string; subfolder: 'mullet'; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  if (!isRecord(entry.outputs) || Object.keys(entry.outputs).length !== 1 || !isRecord(entry.outputs[LTX25_PORTRAIT_VIDEO_TEMPLATE.outputNode])) {
    throw new Error('ComfyUI portrait-video history omitted the fixed output node');
  }
  const output = entry.outputs[LTX25_PORTRAIT_VIDEO_TEMPLATE.outputNode];
  if (!isRecord(output) || !Array.isArray(output.images) || output.images.length !== 1 || !isRecord(output.images[0])) {
    throw new Error('ComfyUI portrait-video history omitted the video');
  }
  if (!Array.isArray(output.animated) || output.animated.length !== 1 || output.animated[0] !== true) {
    throw new Error('ComfyUI portrait-video history did not mark the output animated');
  }
  const video = output.images[0];
  if (typeof video.filename !== 'string' || !/^portrait-motion_\d+_\.webm$/.test(video.filename)) {
    throw new Error('ComfyUI returned an unexpected portrait-video filename');
  }
  if (video.subfolder !== 'mullet' || video.type !== 'output') throw new Error('ComfyUI returned an unexpected portrait-video location');
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
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'portrait-video history query'), id);
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
    await fetcher(endpoint(baseUrl, `/api/jobs/${encodeURIComponent(id)}/cancel`), {
      method: 'POST',
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    // Best-effort cancellation must not replace the original failure.
  }
}

async function readBoundedVideo(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > OUTPUT_LIMIT_BYTES) {
    throw new ComfyPortraitVideoOutputTooLargeError('ComfyUI portrait-video output exceeds 64 MiB');
  }
  if (!response.body) throw new Error('ComfyUI portrait-video output has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > OUTPUT_LIMIT_BYTES) {
      await reader.cancel();
      throw new ComfyPortraitVideoOutputTooLargeError('ComfyUI portrait-video output exceeds 64 MiB');
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

export async function runComfyPortraitVideo(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitVideoRequest,
  input: PortraitVideoInputReference,
  seed: number,
  signal?: AbortSignal
): Promise<ComfyPortraitVideo> {
  let id = '';
  let completed = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildLtx25PortraitVideoWorkflow(request, input, seed),
        client_id: 'mullet-portrait-video'
      }),
      signal
    });
    id = promptId(await responseJson(queueResponse, 'portrait-video queue submission'));
    const video = await waitForVideo(fetcher, baseUrl, id, signal);
    completed = true;
    const query = new URLSearchParams(video);
    const outputResponse = await fetcher(endpoint(baseUrl, `/view?${query}`), { signal });
    if (!outputResponse.ok) throw new Error(`ComfyUI portrait-video fetch failed (${outputResponse.status})`);
    const contentType = outputResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (contentType !== 'video/webm') throw new Error('ComfyUI portrait-video output is not WebM');
    const bytes = await readBoundedVideo(outputResponse);
    if (bytes.byteLength < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
      throw new Error('ComfyUI portrait-video output has an invalid WebM signature');
    }
    return {
      bytes,
      contentType: 'video/webm',
      promptId: id,
      filename: video.filename,
      sha256: await sha256Hex(bytes)
    };
  } catch (cause) {
    if (id && !completed) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  }
}
