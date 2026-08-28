import {
  PORTRAIT_ASPECT_RATIOS,
  PORTRAIT_MEGAPIXELS,
  Z_IMAGE_TURBO_TEMPLATE,
  buildZImageTurboWorkflow,
  type PortraitCapabilities,
  type PortraitRequest
} from '$lib/portrait';

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

export async function loadPortraitCapabilities(
  fetcher: Fetcher,
  baseUrl: string,
  signal?: AbortSignal
): Promise<PortraitCapabilities> {
  const paths = [
    '/object_info/UNETLoader',
    '/object_info/CLIPLoader',
    '/object_info/VAELoader',
    '/object_info/LoraLoader'
  ];
  const [unetInfo, clipInfo, vaeInfo, loraInfo] = await Promise.all(paths.map(async (path) => {
    const response = await fetcher(endpoint(baseUrl, path), { signal });
    return responseJson(response, 'capability query');
  }));
  const unets = optionList(unetInfo, 'UNETLoader', 'unet_name');
  const clips = optionList(clipInfo, 'CLIPLoader', 'clip_name');
  const vaes = optionList(vaeInfo, 'VAELoader', 'vae_name');
  const loras = optionList(loraInfo, 'LoraLoader', 'lora_name');
  if (!unets.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.unet)) throw new Error('ComfyUI is missing the Z-Image Turbo model');
  if (!clips.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.clip)) throw new Error('ComfyUI is missing the Z-Image text encoder');
  if (!vaes.includes(Z_IMAGE_TURBO_TEMPLATE.modelFiles.vae)) throw new Error('ComfyUI is missing the Z-Image VAE');
  return {
    spec: 'mullet_portrait_capabilities_v1',
    template: Z_IMAGE_TURBO_TEMPLATE,
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

function outputImage(entry: Record<string, unknown>): { filename: string; subfolder: string; type: 'output' } | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  if (!isRecord(entry.outputs) || !isRecord(entry.outputs[Z_IMAGE_TURBO_TEMPLATE.outputNode])) {
    throw new Error('ComfyUI portrait history omitted the output node');
  }
  const output = entry.outputs[Z_IMAGE_TURBO_TEMPLATE.outputNode];
  if (!Array.isArray(output.images) || !isRecord(output.images[0])) throw new Error('ComfyUI portrait history omitted the image');
  const image = output.images[0];
  if (typeof image.filename !== 'string' || !/^portrait_\d+_\.png$/.test(image.filename)) {
    throw new Error('ComfyUI returned an unexpected portrait filename');
  }
  if (image.subfolder !== 'mullet' || image.type !== 'output') throw new Error('ComfyUI returned an unexpected portrait location');
  return { filename: image.filename, subfolder: 'mullet', type: 'output' };
}

async function waitForImage(
  fetcher: Fetcher,
  baseUrl: string,
  id: string,
  signal?: AbortSignal
): Promise<{ filename: string; subfolder: string; type: 'output' }> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'history query'), id);
    if (entry) {
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const image = outputImage(entry);
      if (image) return image;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 250);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(signal.reason);
      }, { once: true });
    });
  }
}

export async function runComfyPortrait(
  fetcher: Fetcher,
  baseUrl: string,
  request: PortraitRequest,
  seed: number,
  signal?: AbortSignal
): Promise<ComfyPortraitImage> {
  const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: buildZImageTurboWorkflow(request, seed), client_id: 'mullet-portrait' }),
    signal
  });
  const id = promptId(await responseJson(queueResponse, 'queue submission'));
  const image = await waitForImage(fetcher, baseUrl, id, signal);
  const query = new URLSearchParams(image);
  const imageResponse = await fetcher(endpoint(baseUrl, `/view?${query}`), { signal });
  if (!imageResponse.ok) throw new Error(`ComfyUI image fetch failed (${imageResponse.status})`);
  const contentType = imageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (contentType !== 'image/png') throw new Error('ComfyUI portrait output is not a PNG');
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (bytes.byteLength < 8 || bytes.byteLength > 20 * 1024 * 1024) throw new Error('ComfyUI portrait output has an invalid size');
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('ComfyUI portrait output has an invalid PNG signature');
  }
  return { bytes, contentType, promptId: id, filename: image.filename };
}
