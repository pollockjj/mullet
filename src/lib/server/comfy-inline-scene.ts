import {
  INLINE_SCENE_ASPECT_RATIOS,
  INLINE_SCENE_MEGAPIXELS,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildZImageTurboSceneWorkflow,
  inlineSceneDimensions,
  type InlineSceneCapabilities,
  type InlineSceneImageRequest,
  type InlineSceneLora
} from '../inline-scene.ts';
import { sha256Hex as sha256BytesHex } from './comfy-portrait-video.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ComfyInlineSceneImage = {
  bytes: Uint8Array;
  contentType: 'image/png';
  promptId: string;
  filename: string;
  sha256: string;
};

export class ComfyInlineSceneOutputTooLargeError extends Error {}

const OUTPUT_LIMIT_BYTES = 20 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_NODES = Object.freeze([
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'CLIPTextEncode',
  'ConditioningZeroOut',
  'ModelSamplingAuraFlow',
  'EmptySD3LatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
  'LoraLoader'
]);

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

function loraTrigger(metadata: unknown, path: string): InlineSceneLora | null {
  if (!isRecord(metadata) || metadata.ss_base_model_version !== 'zimage') return null;
  const raw = metadata.ss_tag_frequency;
  let frequency: unknown = raw;
  if (typeof raw === 'string') {
    try {
      frequency = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(frequency)) return null;
  const counts = new Map<string, number>();
  for (const group of Object.values(frequency)) {
    if (!isRecord(group)) continue;
    for (const [tag, count] of Object.entries(group)) {
      if (tag.length > 200 || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + count);
    }
  }
  const trigger = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? '';
  return trigger ? { path, trigger } : null;
}

export async function loadInlineSceneCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<InlineSceneCapabilities> {
  const pairs = await Promise.all(REQUIRED_NODES.map(async (nodeName) => {
    const response = await fetcher(endpoint(baseUrl, `/object_info/${encodeURIComponent(nodeName)}`), { signal });
    const body = await responseJson(response, 'inline-scene capability query');
    return [nodeName, nodeInfo(body, nodeName)] as const;
  }));
  const info = Object.fromEntries(pairs) as Record<string, Record<string, unknown>>;
  requireOption(optionList(info.UNETLoader, 'UNETLoader', 'unet_name'), Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles.unet, 'the Z-Image Turbo model');
  requireOption(optionList(info.CLIPLoader, 'CLIPLoader', 'clip_name'), Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles.clip, 'the Z-Image text encoder');
  requireOption(optionList(info.CLIPLoader, 'CLIPLoader', 'type'), 'lumina2', 'the lumina2 text-encoder mode');
  requireOption(optionList(info.VAELoader, 'VAELoader', 'vae_name'), Z_IMAGE_TURBO_SCENE_TEMPLATE.modelFiles.vae, 'the Z-Image VAE');
  requireOption(optionList(info.KSampler, 'KSampler', 'sampler_name'), Z_IMAGE_TURBO_SCENE_TEMPLATE.sampler, 'the res_multistep sampler');
  requireOption(optionList(info.KSampler, 'KSampler', 'scheduler'), Z_IMAGE_TURBO_SCENE_TEMPLATE.scheduler, 'the simple scheduler');
  const widthInput = requiredInput(info.EmptySD3LatentImage, 'EmptySD3LatentImage', 'width');
  if (!isRecord(widthInput[1]) || widthInput[1].step !== Z_IMAGE_TURBO_SCENE_TEMPLATE.multiple) {
    throw new Error('ComfyUI inline-scene dimension step is incompatible');
  }
  const loraPaths = optionList(info.LoraLoader, 'LoraLoader', 'lora_name')
    .filter((path) => path.startsWith(Z_IMAGE_TURBO_SCENE_TEMPLATE.loraPrefix))
    .sort();
  const loras = (await Promise.all(loraPaths.map(async (path) => {
    const response = await fetcher(endpoint(baseUrl, `/view_metadata/loras?filename=${encodeURIComponent(path)}`), { signal });
    const metadata = await responseJson(response, 'inline-scene LoRA metadata query');
    return loraTrigger(metadata, path);
  }))).filter((lora): lora is InlineSceneLora => Boolean(lora));
  return {
    spec: 'mullet_inline_scene_capabilities_v1',
    template: Z_IMAGE_TURBO_SCENE_TEMPLATE,
    aspectRatios: INLINE_SCENE_ASPECT_RATIOS,
    megapixels: INLINE_SCENE_MEGAPIXELS,
    loras
  };
}

function queuedPromptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !UUID_PATTERN.test(value.prompt_id)) {
    throw new Error('ComfyUI returned no prompt ID');
  }
  if (isRecord(value.node_errors) && Object.keys(value.node_errors).length > 0) {
    throw new Error('ComfyUI rejected the inline-scene graph');
  }
  return value.prompt_id;
}

function historyEntry(value: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(value)) throw new Error('ComfyUI returned invalid inline-scene history');
  const entry = value[id];
  if (entry === undefined) return null;
  if (!isRecord(entry)) throw new Error('ComfyUI returned invalid inline-scene prompt history');
  return entry;
}

function historyFailure(entry: Record<string, unknown>): string | null {
  if (!isRecord(entry.status)) return null;
  if (entry.status.status_str === 'error') return 'ComfyUI inline-scene execution failed';
  if (entry.status.completed === true && entry.status.status_str !== 'success') return 'ComfyUI inline-scene execution did not succeed';
  return null;
}

function outputImage(entry: Record<string, unknown>): { filename: string; subfolder: 'mullet'; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  if (!isRecord(entry.outputs) || !isRecord(entry.outputs[Z_IMAGE_TURBO_SCENE_TEMPLATE.outputNode])) {
    throw new Error('ComfyUI inline-scene history omitted the output node');
  }
  const output = entry.outputs[Z_IMAGE_TURBO_SCENE_TEMPLATE.outputNode];
  if (!isRecord(output) || !Array.isArray(output.images) || output.images.length !== 1 || !isRecord(output.images[0])) {
    throw new Error('ComfyUI inline-scene history must contain exactly one image');
  }
  const image = output.images[0];
  if (typeof image.filename !== 'string' || !/^scene_\d+_\.png$/.test(image.filename)) {
    throw new Error('ComfyUI returned an unexpected inline-scene filename');
  }
  if (image.subfolder !== 'mullet' || image.type !== 'output') throw new Error('ComfyUI returned an unexpected inline-scene location');
  return { filename: image.filename, subfolder: 'mullet', type: 'output' };
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

async function waitForImage(
  fetcher: Fetcher,
  baseUrl: string,
  id: string,
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: 'mullet'; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'inline-scene history query'), id);
    if (entry) {
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const image = outputImage(entry);
      if (image) return image;
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
    // Best-effort targeted cancellation must not replace the original failure.
  }
}

async function readBoundedPng(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > OUTPUT_LIMIT_BYTES) {
    throw new ComfyInlineSceneOutputTooLargeError('ComfyUI inline-scene output exceeds 20 MiB');
  }
  if (!response.body) throw new Error('ComfyUI inline-scene output has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > OUTPUT_LIMIT_BYTES) {
      await reader.cancel();
      throw new ComfyInlineSceneOutputTooLargeError('ComfyUI inline-scene output exceeds 20 MiB');
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

export function validateInlineScenePng(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): void {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
    || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
    || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) throw new Error('ComfyUI inline-scene output has an invalid PNG header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16, false) !== expectedWidth || view.getUint32(20, false) !== expectedHeight) {
    throw new Error('ComfyUI inline-scene output dimensions do not match the request');
  }
}

export async function runComfyInlineScene(
  fetcher: Fetcher,
  baseUrl: string,
  request: InlineSceneImageRequest,
  capabilities: InlineSceneCapabilities,
  seed: number,
  signal?: AbortSignal
): Promise<ComfyInlineSceneImage> {
  let id = '';
  let completed = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildZImageTurboSceneWorkflow(request, seed, capabilities),
        client_id: 'mullet-inline-scene'
      }),
      signal
    });
    id = queuedPromptId(await responseJson(queueResponse, 'inline-scene queue submission'));
    const image = await waitForImage(fetcher, baseUrl, id, signal);
    completed = true;
    const query = new URLSearchParams(image);
    const outputResponse = await fetcher(endpoint(baseUrl, `/view?${query}`), { signal });
    if (!outputResponse.ok) throw new Error(`ComfyUI inline-scene fetch failed (${outputResponse.status})`);
    const contentType = outputResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (contentType !== 'image/png') throw new Error('ComfyUI inline-scene output is not a PNG');
    const bytes = await readBoundedPng(outputResponse);
    const dimensions = inlineSceneDimensions(request.aspectRatio, request.megapixels);
    validateInlineScenePng(bytes, dimensions.width, dimensions.height);
    return {
      bytes,
      contentType: 'image/png',
      promptId: id,
      filename: image.filename,
      sha256: await sha256BytesHex(bytes)
    };
  } catch (cause) {
    if (id && !completed) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  }
}
