import {
  PORTRAIT_ASPECT_RATIOS,
  PORTRAIT_MEGAPIXELS,
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  PORTRAIT_CAPABILITIES_SPEC,
  QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE,
  Z_IMAGE_TURBO_TEMPLATE,
  buildQwenReferencePortraitWorkflow,
  buildZImageTurboWorkflow,
  portraitDimensions,
  validatePortraitPngDimensions,
  type PortraitCapabilities,
  type PortraitRequest
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
  if (!isRecord(value) || !isRecord(value[nodeName])) throw new Error(`ComfyUI omitted ${nodeName}`);
  const node = value[nodeName];
  if (!isRecord(node.input) || !isRecord(node.input.required)) throw new Error(`ComfyUI returned invalid ${nodeName} metadata`);
  const input = node.input.required[inputName];
  if (!Array.isArray(input) || !Array.isArray(input[0]) || input[0].some((item) => typeof item !== 'string')) {
    throw new Error(`ComfyUI returned invalid ${nodeName}.${inputName} options`);
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
  const referenceNodes = QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.requiredNodes;
  const paths = [
    '/object_info/UNETLoader',
    '/object_info/CLIPLoader',
    '/object_info/VAELoader',
    '/object_info/LoraLoader',
    ...referenceNodes.map((nodeName) => `/object_info/${nodeName}`)
  ];
  const [unetInfo, clipInfo, vaeInfo, loraInfo, ...referenceNodeInfo] = await Promise.all(paths.map(async (path) => {
    const response = await fetcher(endpoint(baseUrl, path), { signal });
    return responseJson(response, 'capability query');
  }));
  const unets = optionList(unetInfo, 'UNETLoader', 'unet_name');
  const clips = optionList(clipInfo, 'CLIPLoader', 'clip_name');
  const clipTypes = optionList(clipInfo, 'CLIPLoader', 'type');
  const vaes = optionList(vaeInfo, 'VAELoader', 'vae_name');
  const loras = optionList(loraInfo, 'LoraLoader', 'lora_name');
  if (!unets.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.unet)) throw new Error('ComfyUI is missing the Z-Image Turbo model');
  if (!clips.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.clip)) throw new Error('ComfyUI is missing the Z-Image text encoder');
  if (!vaes.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.vae)) throw new Error('ComfyUI is missing the Z-Image VAE');
  const referenceReady = unets.includes(QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.unet)
    && clips.includes(QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.clip)
    && clipTypes.includes('qwen_image')
    && vaes.includes(QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.vae)
    && loras.includes(QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.modelFiles.lora)
    && referenceNodeInfo.every((info, index) => nodeAvailable(info, referenceNodes[index]));
  return {
    spec: PORTRAIT_CAPABILITIES_SPEC,
    template: Z_IMAGE_TURBO_TEMPLATE,
    referenceTemplate: referenceReady ? QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE : null,
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
  const referenceConditioned = request.modelTemplate === PORTRAIT_REFERENCE_TEMPLATE_ID;
  const outputNode = referenceConditioned
    ? QWEN_IMAGE_EDIT_REFERENCE_TEMPLATE.outputNode
    : Z_IMAGE_TURBO_TEMPLATE.outputNode;
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

async function assertIdentityReference(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitRequest,
  signal?: AbortSignal
): Promise<void> {
  if (request.modelTemplate !== PORTRAIT_REFERENCE_TEMPLATE_ID || !request.referenceImage) return;
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
}

export async function runComfyPortrait(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitRequest,
  seed: number,
  signal?: AbortSignal
): Promise<ComfyPortraitImage> {
  await assertIdentityReference(fetcher, baseUrl, request, signal);
  const workflow = request.modelTemplate === PORTRAIT_REFERENCE_TEMPLATE_ID
    ? buildQwenReferencePortraitWorkflow(request, seed)
    : buildZImageTurboWorkflow(request, seed);
  const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'mullet-portrait' }),
    signal
  });
  const id = promptId(await responseJson(queueResponse, 'queue submission'));
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
  return { bytes, contentType, promptId: id, filename: image.filename };
}
