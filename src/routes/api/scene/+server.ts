import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_IMAGE_TIMEOUT_MS,
  inlineSceneDimensions,
  inlineSceneModelTemplateAvailable,
  normalizeInlineSceneImageRequest
} from '$lib/inline-scene';
import { ComfyInlineSceneOutputTooLargeError, loadInlineSceneCapabilities, runComfyInlineScene } from '$lib/server/comfy-inline-scene';
import { runtime } from '$lib/server/runtime';

function configuredImageComfyBaseUrl(): string {
  if (!runtime.imageComfyBaseUrl) throw error(503, 'Inline scene generation is not configured.');
  return runtime.imageComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const baseUrl = configuredImageComfyBaseUrl();
  try {
    const capabilities = await loadInlineSceneCapabilities(
      fetch,
      baseUrl,
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    );
    return json(capabilities, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('inline-scene capability query failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene generator is unavailable.');
  }
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const baseUrl = configuredImageComfyBaseUrl();
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let sceneRequest;
  try {
    sceneRequest = normalizeInlineSceneImageRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene image request');
  }
  const seed = sceneRequest.seed ?? randomSeed();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(INLINE_SCENE_IMAGE_TIMEOUT_MS)]);
  try {
    const capabilities = await loadInlineSceneCapabilities(fetch, baseUrl, signal);
    if (!inlineSceneModelTemplateAvailable(capabilities, sceneRequest.modelTemplate)) {
      throw error(400, 'The selected inline-scene model is unavailable.');
    }
    if (sceneRequest.lora && !capabilities.loras.includes(sceneRequest.lora.path)) {
      throw error(400, 'The selected inline-scene LoRA is unavailable.');
    }
    const result = await runComfyInlineScene(fetch, baseUrl, sceneRequest, capabilities, seed, signal);
    const dimensions = inlineSceneDimensions(sceneRequest.aspectRatio, sceneRequest.megapixels);
    return new Response(result.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        'content-type': result.contentType,
        'cache-control': 'no-store',
        'x-mullet-prompt-id': result.promptId,
        'x-mullet-seed': String(seed),
        'x-mullet-width': String(dimensions.width),
        'x-mullet-height': String(dimensions.height),
        'x-mullet-model-template': sceneRequest.modelTemplate,
        'x-mullet-image-sha256': result.sha256
      }
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('inline-scene generation failed', cause instanceof Error ? cause.message : 'unknown failure');
    if (cause instanceof ComfyInlineSceneOutputTooLargeError) throw error(502, cause.message);
    if (signal.aborted && !request.signal.aborted) throw error(504, 'The inline-scene generator timed out.');
    throw error(502, 'The inline-scene generator failed to produce an image.');
  }
};
