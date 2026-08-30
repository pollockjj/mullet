import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  PORTRAIT_VIDEO_TIMEOUT_MS,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  normalizePortraitVideoRequest,
  portraitVideoDimensions,
  portraitVideoEndFrameSeed,
  portraitVideoModeCapability,
  portraitVideoModeAvailable
} from '$lib/portrait-video';
import {
  ComfyPortraitVideoOutputTooLargeError,
  loadPortraitVideoCapabilities,
  runComfyPortraitEndFrame,
  runComfyPortraitVideo,
  sha256Hex,
  uploadPortraitVideoInput,
  validatePortraitVideoPng
} from '$lib/server/comfy-portrait-video';
import { runtime } from '$lib/server/runtime';

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function configuredImageComfyBaseUrl(): string {
  if (!runtime.imageComfyBaseUrl) throw error(503, 'Portrait end-frame generation is not configured.');
  return runtime.imageComfyBaseUrl;
}

function configuredVideoComfyBaseUrl(): string {
  if (!runtime.videoComfyBaseUrl) throw error(503, 'Portrait motion is not configured.');
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
  if (typeof requestJson !== 'string' || requestJson.length < 1 || requestJson.length > 50_000) {
    throw error(400, 'portrait-video request JSON is invalid');
  }
  if (!(image instanceof Blob) || image.type !== 'image/png' || image.size < 24) {
    throw error(400, 'portrait-video image must be a PNG');
  }
  if (image.size > INPUT_LIMIT_BYTES) throw error(413, 'portrait-video image exceeds 20 MiB');
  return { requestJson, image };
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const imageBaseUrl = configuredImageComfyBaseUrl();
  const videoBaseUrl = configuredVideoComfyBaseUrl();
  try {
    const capabilities = await loadPortraitVideoCapabilities(
      fetch,
      videoBaseUrl,
      imageBaseUrl,
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    );
    return json(capabilities, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('portrait-video capability query failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The portrait-motion generator is unavailable.');
  }
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const imageBaseUrl = configuredImageComfyBaseUrl();
  const videoBaseUrl = configuredVideoComfyBaseUrl();
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw error(400, 'portrait-video request must be multipart form data');
  }
  const form = await request.formData().catch(() => {
    throw error(400, 'portrait-video multipart body is invalid');
  });
  const parts = exactMultipartParts(form);
  let portraitVideoRequest;
  try {
    portraitVideoRequest = normalizePortraitVideoRequest(JSON.parse(parts.requestJson));
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid portrait-video request');
  }
  const imageBytes = new Uint8Array(await parts.image.arrayBuffer());
  try {
    validatePortraitVideoPng(
      imageBytes,
      portraitVideoRequest.source.portraitWidth,
      portraitVideoRequest.source.portraitHeight
    );
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid portrait-video image');
  }
  const imageSha256 = await sha256Hex(imageBytes);
  if (imageSha256 !== portraitVideoRequest.source.portraitImageSha256) {
    throw error(400, 'portrait-video image hash does not match its source');
  }

  const seed = randomSeed();
  const timeoutSignal = AbortSignal.timeout(PORTRAIT_VIDEO_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);
  try {
    const capabilities = await loadPortraitVideoCapabilities(fetch, videoBaseUrl, imageBaseUrl, signal);
    if (!portraitVideoModeAvailable(
      capabilities,
      portraitVideoRequest.mode,
      portraitVideoRequest.modelTemplate
    )) {
      const mode = portraitVideoModeCapability(
        capabilities,
        portraitVideoRequest.mode,
        portraitVideoRequest.modelTemplate
      );
      const diagnostics = mode?.missing.length ? ` Missing: ${mode.missing.join(', ')}.` : '';
      throw error(503, `The selected portrait-motion mode is unavailable.${diagnostics}`);
    }
    const videoInput = await uploadPortraitVideoInput(fetch, videoBaseUrl, imageBytes, imageSha256, signal);
    let endFrame: Awaited<ReturnType<typeof runComfyPortraitEndFrame>> | null = null;
    let endFrameInput;
    let endFrameSeed: number | null = null;
    if (portraitVideoRequest.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF) {
      endFrameSeed = portraitVideoEndFrameSeed(seed);
      const imageInput = await uploadPortraitVideoInput(fetch, imageBaseUrl, imageBytes, imageSha256, signal);
      endFrame = await runComfyPortraitEndFrame(
        fetch,
        imageBaseUrl,
        portraitVideoRequest,
        imageInput,
        endFrameSeed,
        signal
      );
      if (endFrame.sha256 === imageSha256) throw new Error('Generated portrait end frame did not differ from its source.');
      endFrameInput = await uploadPortraitVideoInput(
        fetch,
        videoBaseUrl,
        endFrame.bytes,
        endFrame.sha256,
        signal
      );
    }
    const result = await runComfyPortraitVideo(
      fetch,
      videoBaseUrl,
      portraitVideoRequest,
      videoInput,
      seed,
      signal,
      endFrameInput
    );
    const dimensions = portraitVideoDimensions(portraitVideoRequest.aspectRatio, portraitVideoRequest.durationSeconds);
    const headers: Record<string, string> = {
      'content-type': result.contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-mullet-prompt-id': result.promptId,
      'x-mullet-seed': String(seed),
      'x-mullet-width': String(dimensions.width),
      'x-mullet-height': String(dimensions.height),
      'x-mullet-frames': String(dimensions.frames),
      'x-mullet-fps': String(dimensions.fps),
      'x-mullet-duration-seconds': String(portraitVideoRequest.durationSeconds),
      'x-mullet-encoded-duration-seconds': String(result.durationSeconds),
      'x-mullet-audio-tracks': String(result.audioTracks),
      'x-mullet-model-template': portraitVideoRequest.modelTemplate,
      'x-mullet-video-mode': portraitVideoRequest.mode,
      'x-mullet-input-sha256': imageSha256,
      'x-mullet-video-sha256': result.sha256
    };
    if (endFrame && endFrameSeed !== null && portraitVideoRequest.endFrameModelTemplate) {
      headers['x-mullet-end-frame-model-template'] = portraitVideoRequest.endFrameModelTemplate;
      headers['x-mullet-end-frame-prompt-id'] = endFrame.promptId;
      headers['x-mullet-end-frame-seed'] = String(endFrameSeed);
      headers['x-mullet-end-frame-width'] = String(portraitVideoRequest.source.portraitWidth);
      headers['x-mullet-end-frame-height'] = String(portraitVideoRequest.source.portraitHeight);
      headers['x-mullet-end-frame-sha256'] = endFrame.sha256;
    }
    return new Response(result.bytes.slice().buffer as ArrayBuffer, {
      headers
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    if (cause instanceof ComfyPortraitVideoOutputTooLargeError) throw error(413, cause.message);
    if (timeoutSignal.aborted) throw error(504, 'Portrait motion timed out.');
    console.error('portrait-video generation failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The portrait-motion generator failed to produce a video.');
  }
};
