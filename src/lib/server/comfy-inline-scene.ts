import {
  INLINE_SCENE_ASPECT_RATIOS,
  INLINE_SCENE_CAPABILITIES_SPEC,
  INLINE_SCENE_MEGAPIXELS,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATES,
  QWEN_IMAGE_EDIT_SCENE_TEMPLATE,
  Z_IMAGE_TURBO_SCENE_TEMPLATE,
  buildQwenImageEditSceneWorkflow,
  buildZImageTurboSceneWorkflow,
  inlineSceneQwenReferencePlan,
  inlineSceneDimensions,
  inlineSceneTemplate,
  normalizeInlineSceneContinuityMaster,
  type InlineSceneCapabilities,
  type InlineSceneContinuityMaster,
  type InlineSceneImageRequest,
  type InlineSceneUploadedMasterInput
} from '../inline-scene.ts';
import { sha256Hex as sha256BytesHex } from './comfy-portrait-video.ts';
import { assertComfyIdentityReference } from './comfy-portrait.ts';

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
const REQUIRED_NODES = [...new Set([
  ...INLINE_SCENE_TEMPLATES.flatMap((template) => [...template.requiredNodes]),
  'LoraLoader'
])];

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

function optionList(value: unknown, nodeName: string, inputName: string): string[] {
  if (!isRecord(value) || !isRecord(value[nodeName])) return [];
  const info = value[nodeName];
  if (!isRecord(info.input) || !isRecord(info.input.required) || !Array.isArray(info.input.required[inputName])) return [];
  const input = info.input.required[inputName] as unknown[];
  if (Array.isArray(input[0]) && input[0].every((item) => typeof item === 'string')) return input[0] as string[];
  if (input[0] === 'COMBO' && isRecord(input[1]) && Array.isArray(input[1].options) && input[1].options.every((item) => typeof item === 'string')) {
    return input[1].options as string[];
  }
  return [];
}

function nodeAvailable(value: unknown, nodeName: string): boolean {
  return isRecord(value) && isRecord(value[nodeName]);
}

function optionalInputHasType(
  value: unknown,
  nodeName: string,
  inputName: string,
  inputType: string
): boolean {
  if (!isRecord(value) || !isRecord(value[nodeName])) return false;
  const info = value[nodeName];
  if (!isRecord(info.input) || !isRecord(info.input.optional)) return false;
  const input = info.input.optional[inputName];
  return Array.isArray(input) && input[0] === inputType;
}

export async function loadInlineSceneCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<InlineSceneCapabilities> {
  const pairs = await Promise.all(REQUIRED_NODES.map(async (nodeName): Promise<[string, unknown | null]> => {
    const response = await fetcher(endpoint(baseUrl, `/object_info/${encodeURIComponent(nodeName)}`), { signal });
    if (!response.ok) return [nodeName, null];
    return [nodeName, await response.json()];
  }));
  const info = new Map(pairs);
  const unets = optionList(info.get('UNETLoader'), 'UNETLoader', 'unet_name');
  const clips = optionList(info.get('CLIPLoader'), 'CLIPLoader', 'clip_name');
  const clipTypes = optionList(info.get('CLIPLoader'), 'CLIPLoader', 'type');
  const vaes = optionList(info.get('VAELoader'), 'VAELoader', 'vae_name');
  const loras = optionList(info.get('LoraLoader'), 'LoraLoader', 'lora_name');
  const modelOnlyLoras = optionList(info.get('LoraLoaderModelOnly'), 'LoraLoaderModelOnly', 'lora_name');
  const samplers = optionList(info.get('KSampler'), 'KSampler', 'sampler_name');
  const schedulers = optionList(info.get('KSampler'), 'KSampler', 'scheduler');
  const templates = INLINE_SCENE_TEMPLATES.map((template) => {
    const missing: string[] = [];
    if (!unets.includes(template.modelFiles.unet)) missing.push(`model:unet:${template.modelFiles.unet}`);
    if (!clips.includes(template.modelFiles.clip)) missing.push(`model:clip:${template.modelFiles.clip}`);
    if (!vaes.includes(template.modelFiles.vae)) missing.push(`model:vae:${template.modelFiles.vae}`);
    const clipType = template.id === INLINE_SCENE_TEMPLATE_ID ? 'lumina2' : 'qwen_image';
    if (!clipTypes.includes(clipType)) missing.push(`clip-type:${clipType}`);
    if (!samplers.includes(template.sampler)) missing.push(`sampler:${template.sampler}`);
    if (!schedulers.includes(template.scheduler)) missing.push(`scheduler:${template.scheduler}`);
    if (template.id === INLINE_SCENE_QWEN_TEMPLATE_ID && !modelOnlyLoras.includes(QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora)) {
      missing.push(`model:lora:${QWEN_IMAGE_EDIT_SCENE_TEMPLATE.modelFiles.lora}`);
    }
    if (template.id === INLINE_SCENE_QWEN_TEMPLATE_ID) {
      for (const inputName of ['image1', 'image2', 'image3']) {
        if (!optionalInputHasType(
          info.get('TextEncodeQwenImageEditPlus'),
          'TextEncodeQwenImageEditPlus',
          inputName,
          'IMAGE'
        )) missing.push(`node-input:TextEncodeQwenImageEditPlus:optional:${inputName}:IMAGE`);
      }
    }
    for (const nodeName of template.requiredNodes) {
      if (!nodeAvailable(info.get(nodeName), nodeName)) missing.push(`node:${nodeName}`);
    }
    return { template, available: missing.length === 0, missing: [...new Set(missing)] };
  });
  return {
    spec: INLINE_SCENE_CAPABILITIES_SPEC,
    templates,
    aspectRatios: INLINE_SCENE_ASPECT_RATIOS,
    megapixels: INLINE_SCENE_MEGAPIXELS,
    loras: loras.filter((lora) => lora.startsWith(Z_IMAGE_TURBO_SCENE_TEMPLATE.loraPrefix)).sort()
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

function outputImage(
  entry: Record<string, unknown>,
  request: InlineSceneImageRequest
): { filename: string; subfolder: 'mullet'; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  const outputNode = inlineSceneTemplate(request.modelTemplate).outputNode;
  if (!isRecord(entry.outputs) || !isRecord(entry.outputs[outputNode])) {
    throw new Error('ComfyUI inline-scene history omitted the output node');
  }
  const output = entry.outputs[outputNode];
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
  request: InlineSceneImageRequest,
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: 'mullet'; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'inline-scene history query'), id);
    if (entry) {
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const image = outputImage(entry, request);
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

export async function uploadInlineSceneContinuityMasterInput(
  fetcher: Fetcher,
  baseUrl: string,
  bytes: Uint8Array,
  master: InlineSceneContinuityMaster,
  signal?: AbortSignal
): Promise<InlineSceneUploadedMasterInput> {
  const normalized = normalizeInlineSceneContinuityMaster(master);
  if (!(bytes instanceof Uint8Array)) throw new Error('inline-scene continuity master bytes are invalid');
  if (bytes.byteLength > OUTPUT_LIMIT_BYTES) {
    throw new Error('inline-scene continuity master exceeds 20 MiB');
  }
  if (await sha256BytesHex(bytes) !== normalized.imageSha256) {
    throw new Error('inline-scene continuity master hash does not match its bytes');
  }
  try {
    validateInlineScenePng(bytes, normalized.width, normalized.height);
  } catch {
    throw new Error('inline-scene continuity master dimensions do not match its bytes');
  }
  const name = `scene-continuity-${globalThis.crypto.randomUUID()}.png`;
  const subfolder = 'mullet/motion-inputs';
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), name);
  form.append('subfolder', subfolder);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetcher(endpoint(baseUrl, '/upload/image'), { method: 'POST', body: form, signal });
  const body = await responseJson(response, 'inline-scene continuity master upload');
  if (!isRecord(body) || body.name !== name || body.subfolder !== subfolder || body.type !== 'input') {
    throw new Error('ComfyUI returned an unexpected inline-scene continuity upload location');
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

export async function runComfyInlineScene(
  fetcher: Fetcher,
  baseUrl: string,
  request: InlineSceneImageRequest,
  capabilities: InlineSceneCapabilities,
  seed: number,
  signal?: AbortSignal,
  continuityMasterInput?: InlineSceneUploadedMasterInput
): Promise<ComfyInlineSceneImage> {
  if (request.modelTemplate !== INLINE_SCENE_QWEN_TEMPLATE_ID && continuityMasterInput) {
    throw new Error('only Qwen inline scenes can use an uploaded continuity master');
  }
  const workflow = request.modelTemplate === INLINE_SCENE_TEMPLATE_ID
    ? buildZImageTurboSceneWorkflow(request, seed, capabilities)
    : request.modelTemplate === INLINE_SCENE_QWEN_TEMPLATE_ID
      ? buildQwenImageEditSceneWorkflow(request, seed, capabilities, continuityMasterInput)
      : (() => { throw new Error('unsupported inline-scene model template'); })();
  if (request.modelTemplate === INLINE_SCENE_QWEN_TEMPLATE_ID) {
    for (const slot of inlineSceneQwenReferencePlan(request)) {
      if (slot.kind === 'continuity_master') continue;
      const referenceImage = slot.kind === 'identity'
        ? slot.identity.referenceImage
        : slot.referenceImage;
      await assertComfyIdentityReference(fetcher, baseUrl, referenceImage, signal);
    }
  }
  let id = '';
  let completed = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: 'mullet-inline-scene'
      }),
      signal
    });
    id = queuedPromptId(await responseJson(queueResponse, 'inline-scene queue submission'));
    const image = await waitForImage(fetcher, baseUrl, id, request, signal);
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
