import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_VIDEO_TIMEOUT_MS,
  inlineSceneVideoDimensions,
  inlineSceneVideoReferencesSha256,
  inlineSceneVideoSourceRequestSha256,
  inlineSceneVideoTemplateAvailable,
  inlineSceneVideoTemplateCapability,
  normalizeInlineSceneVideoRequest
} from '$lib/inline-scene-video';
import {
  ComfyInlineSceneVideoOutputTooLargeError,
  InlineSceneVideoReferenceMissingError,
  assertInlineSceneVideoReferencesPresent,
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo
} from '$lib/server/comfy-inline-scene-video';
import { runtime } from '$lib/server/runtime';

const REQUEST_LIMIT_BYTES = 200_000;

function configuredVideoComfyBaseUrl(): string {
  if (!runtime.sceneVideoComfyBaseUrl) throw error(503, 'Inline scene motion is not configured.');
  return runtime.sceneVideoComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const baseUrl = configuredVideoComfyBaseUrl();
  try {
    const capabilities = await loadInlineSceneVideoCapabilities(
      fetch,
      baseUrl,
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    );
    return json(capabilities, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('inline-scene video capability query failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene motion generator is unavailable.');
  }
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const baseUrl = configuredVideoComfyBaseUrl();
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw error(400, 'inline-scene video request must be JSON');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_LIMIT_BYTES) {
    // Drain before rejecting: an unread request body leaves the keep-alive socket
    // half-consumed and the client's next request on it is reset. The node adapter's
    // BODY_SIZE_LIMIT bounds what can arrive here.
    await request.text().catch(() => undefined);
    throw error(413, 'inline-scene video request is too large');
  }
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) throw error(400, 'inline-scene video request body is invalid');
  let videoRequest;
  try {
    videoRequest = normalizeInlineSceneVideoRequest(body.request);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene video request');
  }
  const referencesSha256 = inlineSceneVideoReferencesSha256(videoRequest);
  const seed = randomSeed();
  const timeoutSignal = AbortSignal.timeout(INLINE_SCENE_VIDEO_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);
  try {
    const capabilities = await loadInlineSceneVideoCapabilities(fetch, baseUrl, signal);
    if (!inlineSceneVideoTemplateAvailable(capabilities, videoRequest.modelTemplate)) {
      const capability = inlineSceneVideoTemplateCapability(capabilities, videoRequest.modelTemplate);
      const diagnostics = capability?.missing.length ? ` Missing: ${capability.missing.join(', ')}.` : '';
      throw error(503, `The selected inline-scene motion model is unavailable.${diagnostics}`);
    }
    await assertInlineSceneVideoReferencesPresent(fetch, baseUrl, videoRequest, signal);
    const result = await runComfyInlineSceneVideo(fetch, baseUrl, videoRequest, seed, signal);
    const dimensions = inlineSceneVideoDimensions(videoRequest.aspectRatio, videoRequest.modelTemplate);
    // Client-side rejections leave no server trace, so a delivered loop is logged here.
    console.info('inline-scene video delivered', result.promptId, result.filename, result.bytes.byteLength, 'bytes', result.durationSeconds, 's');
    return new Response(result.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        'content-type': result.contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-mullet-prompt-id': result.promptId,
        'x-mullet-seed': String(seed),
        'x-mullet-width': String(dimensions.width),
        'x-mullet-height': String(dimensions.height),
        'x-mullet-frames': String(dimensions.frames),
        'x-mullet-fps': String(dimensions.fps),
        'x-mullet-duration-seconds': String(result.durationSeconds),
        'x-mullet-audio-tracks': String(result.audioTracks),
        'x-mullet-model-template': videoRequest.modelTemplate,
        'x-mullet-video-mode': videoRequest.mode,
        'x-mullet-source-request-sha256': inlineSceneVideoSourceRequestSha256(videoRequest),
        'x-mullet-references-sha256': referencesSha256,
        'x-mullet-video-sha256': result.sha256
      }
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    if (cause instanceof ComfyInlineSceneVideoOutputTooLargeError) throw error(413, cause.message);
    if (cause instanceof InlineSceneVideoReferenceMissingError) throw error(409, cause.message);
    if (timeoutSignal.aborted) throw error(504, 'Inline scene motion timed out.');
    console.error('inline-scene video generation failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene motion generator failed to produce a video.');
  }
};
