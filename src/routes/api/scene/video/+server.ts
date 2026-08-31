import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_VIDEO_TIMEOUT_MS,
  inlineSceneVideoDimensions,
  inlineSceneVideoSourceRequestSha256,
  inlineSceneVideoTemplateAvailable,
  inlineSceneVideoTemplateCapability,
  normalizeInlineSceneVideoRequest
} from '$lib/inline-scene-video';
import {
  ComfyInlineSceneVideoOutputTooLargeError,
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes,
  uploadInlineSceneVideoInput,
  validateInlineSceneVideoPng
} from '$lib/server/comfy-inline-scene-video';
import { runtime } from '$lib/server/runtime';

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function configuredVideoComfyBaseUrl(): string {
  if (!runtime.videoComfyBaseUrl) throw error(503, 'Inline scene motion is not configured.');
  return runtime.videoComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

function exactMultipartParts(form: FormData): { requestJson: string; image: Blob } {
  const keys = [...form.keys()];
  if (
    keys.length !== 2
    || form.getAll('request').length !== 1
    || form.getAll('image').length !== 1
    || keys.some((key) => key !== 'request' && key !== 'image')
  ) throw error(400, 'multipart body must contain exactly one request and one image');
  const requestJson = form.get('request');
  const image = form.get('image');
  if (typeof requestJson !== 'string' || requestJson.length < 1 || requestJson.length > 100_000) {
    throw error(400, 'inline-scene video request JSON is invalid');
  }
  if (!(image instanceof Blob) || image.type !== 'image/png' || image.size < 24) {
    throw error(400, 'inline-scene video image must be a PNG');
  }
  if (image.size > INPUT_LIMIT_BYTES) throw error(413, 'inline-scene video image exceeds 20 MiB');
  return { requestJson, image };
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
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw error(400, 'inline-scene video request must be multipart form data');
  }
  const form = await request.formData().catch(() => {
    throw error(400, 'inline-scene video multipart body is invalid');
  });
  const parts = exactMultipartParts(form);
  let videoRequest;
  try {
    videoRequest = normalizeInlineSceneVideoRequest(JSON.parse(parts.requestJson));
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene video request');
  }
  const imageBytes = new Uint8Array(await parts.image.arrayBuffer());
  try {
    validateInlineSceneVideoPng(
      imageBytes,
      videoRequest.source.sceneWidth,
      videoRequest.source.sceneHeight
    );
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene video image');
  }
  const imageSha256 = await sha256InlineSceneVideoBytes(imageBytes);
  if (imageSha256 !== videoRequest.source.sceneImageSha256) {
    throw error(400, 'inline-scene video image hash does not match its static source');
  }
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
    const input = await uploadInlineSceneVideoInput(fetch, baseUrl, imageBytes, imageSha256, signal);
    const result = await runComfyInlineSceneVideo(fetch, baseUrl, videoRequest, input, seed, signal);
    const dimensions = inlineSceneVideoDimensions(videoRequest.aspectRatio, videoRequest.modelTemplate);
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
        'x-mullet-source-prompt-id': videoRequest.source.scenePromptId,
        'x-mullet-source-seed': String(videoRequest.source.sceneSeed),
        'x-mullet-source-request-sha256': inlineSceneVideoSourceRequestSha256(videoRequest),
        'x-mullet-input-sha256': imageSha256,
        'x-mullet-video-sha256': result.sha256
      }
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    if (cause instanceof ComfyInlineSceneVideoOutputTooLargeError) throw error(413, cause.message);
    if (timeoutSignal.aborted) throw error(504, 'Inline scene motion timed out.');
    console.error('inline-scene video generation failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene motion generator failed to produce a video.');
  }
};
