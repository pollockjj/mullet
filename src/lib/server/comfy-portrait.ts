import {
  FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE,
  MAGE_FLOW_EDIT_REFERENCE_TEMPLATE,
  PORTRAIT_ASPECT_RATIOS,
  PORTRAIT_CAPABILITIES_SPEC,
  PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
  PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
  PORTRAIT_MEGAPIXELS,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_TEMPLATE_ID,
  PORTRAIT_TEMPLATES,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildFlux2Klein9BReferencePortraitWorkflow,
  buildMageFlowReferencePortraitWorkflow,
  buildQwenReferencePortraitWorkflow,
  buildZImageTurboWorkflow,
  isPortraitReferenceTemplateId,
  portraitDimensions,
  portraitTemplate,
  validatePortraitPngDimensions,
  type PortraitCapabilities,
  type PortraitRequest,
  type PortraitTemplate
} from '../portrait.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ComfyPortraitImage = {
  bytes: Uint8Array;
  contentType: string;
  promptId: string;
  filename: string;
};

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
  const node = value[nodeName];
  if (!isRecord(node.input) || !isRecord(node.input.required)) return [];
  const input = node.input.required[inputName];
  if (!Array.isArray(input) || !Array.isArray(input[0]) || input[0].some((item) => typeof item !== 'string')) {
    return [];
  }
  return input[0] as string[];
}

function nodeAvailable(value: unknown, nodeName: string): boolean {
  return isRecord(value) && isRecord(value[nodeName]);
}

export async function loadPortraitCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<PortraitCapabilities> {
  const nodeNames = [...new Set([
    'LoraLoader',
    ...PORTRAIT_TEMPLATES.flatMap((template) => [...template.requiredNodes])
  ])];
  const infoEntries = await Promise.all(nodeNames.map(async (nodeName): Promise<[string, unknown | null]> => {
    const response = await fetcher(endpoint(baseUrl, `/object_info/${encodeURIComponent(nodeName)}`), { signal });
    if (!response.ok) return [nodeName, null];
    return [nodeName, await response.json()];
  }));
  const info = new Map(infoEntries);
  const unetInfo = info.get('UNETLoader');
  const clipInfo = info.get('CLIPLoader');
  const vaeInfo = info.get('VAELoader');
  const loraInfo = info.get('LoraLoader');
  const unets = optionList(unetInfo, 'UNETLoader', 'unet_name');
  const clips = optionList(clipInfo, 'CLIPLoader', 'clip_name');
  const clipTypes = optionList(clipInfo, 'CLIPLoader', 'type');
  const vaes = optionList(vaeInfo, 'VAELoader', 'vae_name');
  const loras = optionList(loraInfo, 'LoraLoader', 'lora_name');
  const clipType = new Map<PortraitTemplate['id'], string>([
    [Z_IMAGE_TURBO_TEMPLATE.id, 'lumina2'],
    [QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.id, 'qwen_image'],
    [FLUX2_KLEIN_9B_EDIT_REFERENCE_TEMPLATE.id, 'flux2'],
    [MAGE_FLOW_EDIT_REFERENCE_TEMPLATE.id, 'mage']
  ]);
  const templates = PORTRAIT_TEMPLATES.map((template) => {
    const missing: string[] = [];
    if (!unets.includes(template.modelFiles.unet)) missing.push(`model:unet:${template.modelFiles.unet}`);
    if (!clips.includes(template.modelFiles.clip)) missing.push(`model:clip:${template.modelFiles.clip}`);
    if (!vaes.includes(template.modelFiles.vae)) missing.push(`model:vae:${template.modelFiles.vae}`);
    const requiredClipType = clipType.get(template.id);
    if (requiredClipType && !clipTypes.includes(requiredClipType)) missing.push(`clip-type:${requiredClipType}`);
    if ('lora' in template.modelFiles && !loras.includes(template.modelFiles.lora)) {
      missing.push(`model:lora:${template.modelFiles.lora}`);
    }
    for (const nodeName of template.requiredNodes) {
      if (!nodeAvailable(info.get(nodeName), nodeName)) missing.push(`node:${nodeName}`);
    }
    return { template, available: missing.length === 0, missing: [...new Set(missing)] };
  });
  return {
    spec: PORTRAIT_CAPABILITIES_SPEC,
    templates,
    aspectRatios: PORTRAIT_ASPECT_RATIOS,
    megapixels: PORTRAIT_MEGAPIXELS,
    loras: loras.filter((lora) => lora.startsWith(Z_IMAGE_TURBO_TEMPLATE.loraPrefix)).sort()
  };
}

function promptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.prompt_id)) {
    throw new Error('ComfyUI returned no prompt ID');
  }
  return value.prompt_id;
}

function historyEntry(value: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(value)) throw new Error('ComfyUI returned invalid history');
  const entry = value[id];
  if (entry === undefined) return null;
  if (!isRecord(entry)) throw new Error('ComfyUI returned invalid prompt history');
  return entry;
}

function historyFailure(entry: Record<string, unknown>): string | null {
  if (!isRecord(entry.status)) return null;
  if (entry.status.status_str === 'error') return 'ComfyUI portrait execution failed';
  if (entry.status.completed === true && entry.status.status_str !== 'success') return 'ComfyUI portrait execution did not succeed';
  return null;
}

function outputImage(entry: Record<string, unknown>, request: PortraitRequest): { filename: string; subfolder: string; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  const referenceConditioned = isPortraitReferenceTemplateId(request.modelTemplate);
  const outputNode = portraitTemplate(request.modelTemplate).outputNode;
  if (!isRecord(entry.outputs) || !isRecord(entry.outputs[outputNode])) {
    throw new Error('ComfyUI portrait history omitted the output node');
  }
  const output = entry.outputs[outputNode];
  if (!isRecord(output)) throw new Error('ComfyUI portrait history omitted the output node');
  if (!Array.isArray(output.images) || !isRecord(output.images[0])) throw new Error('ComfyUI portrait history omitted the image');
  const image = output.images[0];
  const filenamePattern = referenceConditioned
    ? /^portrait-reference_\d+_\.png$/
    : /^portrait_\d+_\.png$/;
  if (typeof image.filename !== 'string' || !filenamePattern.test(image.filename)) {
    throw new Error('ComfyUI returned an unexpected portrait filename');
  }
  if (image.subfolder !== 'mullet' || image.type !== 'output') throw new Error('ComfyUI returned an unexpected portrait location');
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
  request: PortraitRequest,
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: string; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'history query'), id);
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

type ReferenceImageInfo = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number };

function validImageDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 8192;
}

function assertValidReferenceDimensions(width: number, height: number): { width: number; height: number } {
  if (!validImageDimension(width) || !validImageDimension(height)) {
    throw new Error('ComfyUI identity reference has invalid dimensions');
  }
  return { width, height };
}

function pngReferenceInfo(bytes: Uint8Array): ReferenceImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new Error('ComfyUI identity reference has an invalid PNG header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dimensions = assertValidReferenceDimensions(view.getUint32(16, false), view.getUint32(20, false));
  return { mediaType: 'image/png', ...dimensions };
}

function jpegReferenceInfo(bytes: Uint8Array): ReferenceImageInfo | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.byteLength) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) break;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return { mediaType: 'image/jpeg', ...assertValidReferenceDimensions(width, height) };
    }
    offset += segmentLength;
  }
  throw new Error('ComfyUI identity reference has an invalid JPEG header');
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpReferenceInfo(bytes: Uint8Array): ReferenceImageInfo | null {
  if (bytes.byteLength < 20
    || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkLength = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkLength > bytes.byteLength) break;
    if (chunkType === 'VP8X' && chunkLength >= 10) {
      const width = uint24LittleEndian(bytes, dataOffset + 4) + 1;
      const height = uint24LittleEndian(bytes, dataOffset + 7) + 1;
      return { mediaType: 'image/webp', ...assertValidReferenceDimensions(width, height) };
    }
    if (chunkType === 'VP8L' && chunkLength >= 5 && bytes[dataOffset] === 0x2f) {
      const width = 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8);
      const height = 1
        + (bytes[dataOffset + 2] >> 6)
        + (bytes[dataOffset + 3] << 2)
        + ((bytes[dataOffset + 4] & 0x0f) << 10);
      return { mediaType: 'image/webp', ...assertValidReferenceDimensions(width, height) };
    }
    if (chunkType === 'VP8 ' && chunkLength >= 10
      && bytes[dataOffset + 3] === 0x9d
      && bytes[dataOffset + 4] === 0x01
      && bytes[dataOffset + 5] === 0x2a) {
      const width = view.getUint16(dataOffset + 6, true) & 0x3fff;
      const height = view.getUint16(dataOffset + 8, true) & 0x3fff;
      return { mediaType: 'image/webp', ...assertValidReferenceDimensions(width, height) };
    }
    offset = dataOffset + chunkLength + (chunkLength % 2);
  }
  throw new Error('ComfyUI identity reference has an invalid WebP header');
}

function referenceImageInfo(bytes: Uint8Array): ReferenceImageInfo {
  const info = pngReferenceInfo(bytes) ?? jpegReferenceInfo(bytes) ?? webpReferenceInfo(bytes);
  if (!info) throw new Error('ComfyUI identity reference is not a JPEG, PNG, or WebP image');
  return info;
}

async function assertIdentityReference(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitRequest,
  signal?: AbortSignal
): Promise<void> {
  if (!isPortraitReferenceTemplateId(request.modelTemplate) || !request.referenceImage) return;
  const query = new URLSearchParams({
    filename: request.referenceImage.name,
    subfolder: request.referenceImage.subfolder,
    type: request.referenceImage.type
  });
  const response = await fetcher(endpoint(baseUrl, `/view?${query}`), { signal });
  if (!response.ok) throw new Error('ComfyUI identity reference is unavailable');
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('ComfyUI identity reference has an invalid media type');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 8 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error('ComfyUI identity reference has an invalid size');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== request.referenceImage.sha256) throw new Error('ComfyUI identity reference does not match its profile');
  const imageInfo = referenceImageInfo(bytes);
  if (imageInfo.mediaType !== contentType) throw new Error('ComfyUI identity reference media type does not match its bytes');
  if (imageInfo.width !== request.referenceImage.width || imageInfo.height !== request.referenceImage.height) {
    throw new Error(
      `ComfyUI identity reference dimensions ${imageInfo.width}x${imageInfo.height} do not match profile dimensions `
      + `${request.referenceImage.width}x${request.referenceImage.height}`
    );
  }
}

export async function runComfyPortrait(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitRequest,
  seed: number,
  signal?: AbortSignal
): Promise<ComfyPortraitImage> {
  await assertIdentityReference(fetcher, baseUrl, request, signal);
  const workflow = request.modelTemplate === PORTRAIT_TEMPLATE_ID
    ? buildZImageTurboWorkflow(request, seed)
    : request.modelTemplate === PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
      ? buildQwenReferencePortraitWorkflow(request, seed)
      : request.modelTemplate === PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID
        ? buildFlux2Klein9BReferencePortraitWorkflow(request, seed)
        : request.modelTemplate === PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
          ? buildMageFlowReferencePortraitWorkflow(request, seed)
          : (() => { throw new Error('unsupported portrait model template'); })();
  let id = '';
  let validated = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'mullet-portrait' }),
      signal
    });
    id = promptId(await responseJson(queueResponse, 'queue submission'));
    const image = await waitForImage(fetcher, baseUrl, id, request, signal);
    const query = new URLSearchParams(image);
    const imageResponse = await fetcher(endpoint(baseUrl, `/view?${query}`), { signal });
    if (!imageResponse.ok) throw new Error(`ComfyUI image fetch failed (${imageResponse.status})`);
    const contentType = imageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (contentType !== 'image/png') throw new Error('ComfyUI portrait output is not a PNG');
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (bytes.byteLength < 33 || bytes.byteLength > 20 * 1024 * 1024) throw new Error('ComfyUI portrait output has an invalid size');
    const dimensions = portraitDimensions(request.aspectRatio, request.megapixels);
    validatePortraitPngDimensions(bytes, dimensions.width, dimensions.height);
    validated = true;
    return { bytes, contentType, promptId: id, filename: image.filename };
  } catch (cause) {
    if (id && !validated) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  }
}
