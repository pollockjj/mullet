import { randomInt } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PORTRAIT_TIMEOUT_MS, normalizePortraitRequest, portraitDimensions } from '$lib/portrait';
import { loadPortraitCapabilities, runComfyPortrait } from '$lib/server/comfy-portrait';
import { runtime } from '$lib/server/runtime';

function configuredComfyBaseUrl(): string {
  if (!runtime.comfyBaseUrl) throw error(503, 'Portrait generation is not configured.');
  return runtime.comfyBaseUrl;
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const baseUrl = configuredComfyBaseUrl();
  try {
    const capabilities = await loadPortraitCapabilities(
      fetch,
      baseUrl,
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    );
    return json(capabilities, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('portrait capability query failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The portrait generator is unavailable.');
  }
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const baseUrl = configuredComfyBaseUrl();
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let portraitRequest;
  try {
    portraitRequest = normalizePortraitRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid portrait request');
  }

  const seed = portraitRequest.seed ?? randomInt(0, 2 ** 48);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(PORTRAIT_TIMEOUT_MS)]);
  try {
    const capabilities = await loadPortraitCapabilities(fetch, baseUrl, signal);
    if (portraitRequest.lora && !capabilities.loras.includes(portraitRequest.lora)) {
      throw error(400, 'The selected portrait LoRA is unavailable for this model.');
    }
    const result = await runComfyPortrait(fetch, baseUrl, portraitRequest, seed, signal);
    const dimensions = portraitDimensions(portraitRequest.aspectRatio, portraitRequest.megapixels);
    return new Response(result.bytes, {
      headers: {
        'content-type': result.contentType,
        'cache-control': 'no-store',
        'x-mullet-prompt-id': result.promptId,
        'x-mullet-seed': String(seed),
        'x-mullet-width': String(dimensions.width),
        'x-mullet-height': String(dimensions.height),
        'x-mullet-model-template': portraitRequest.modelTemplate
      }
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('portrait generation failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The portrait generator failed to produce an image.');
  }
};
