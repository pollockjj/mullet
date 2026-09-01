import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_VIDEO_TIMEOUT_MS,
  isMiniMaxH3InlineSceneVideoTemplate,
  inlineSceneH3ReferencePlan,
  inlineSceneVideoDimensions,
  inlineSceneVideoSourceRequestSha256,
  inlineSceneVideoTemplateAvailable,
  inlineSceneVideoTemplateCapability,
  normalizeInlineSceneVideoRequest
} from '$lib/inline-scene-video';
import type { PortraitReferenceImage } from '$lib/portrait';
import {
  ComfyInlineSceneVideoOutputTooLargeError,
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes,
  uploadInlineSceneVideoInput,
  uploadInlineSceneVideoPriorMasterInput,
  validateInlineSceneVideoPriorMasterBytes,
  validateInlineSceneVideoPng
} from '$lib/server/comfy-inline-scene-video';
import { ensureComfyManagedReferences } from '$lib/server/comfy-managed-reference';
import { runtime } from '$lib/server/runtime';

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function configuredVideoComfyBaseUrl(): string {
  if (!runtime.sceneComfyBaseUrl) throw error(503, 'Inline scene motion is not configured.');
  return runtime.sceneComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

function exactMultipartParts(form: FormData): {
  requestJson: string;
  image: Blob;
  master: Blob | null;
  references: Blob[];
} {
  const keys = [...form.keys()];
  const requests = form.getAll('request');
  const images = form.getAll('image');
  const masters = form.getAll('master');
  const references = form.getAll('reference');
  if (
    requests.length !== 1
    || images.length !== 1
    || masters.length > 1
    || references.length > 3
    || keys.length !== requests.length + images.length + masters.length + references.length
    || keys.some((key) => key !== 'request' && key !== 'image' && key !== 'master' && key !== 'reference')
  ) throw error(400, 'multipart body must contain one request, one image, at most one master, and at most three references');
  const requestJson = requests[0];
  const image = images[0];
  const master = masters[0] ?? null;
  if (typeof requestJson !== 'string' || requestJson.length < 1 || requestJson.length > 100_000) {
    throw error(400, 'inline-scene video request JSON is invalid');
  }
  if (!(image instanceof Blob) || image.type !== 'image/png' || image.size < 24) {
    throw error(400, 'inline-scene video image must be a PNG');
  }
  if (image.size > INPUT_LIMIT_BYTES) throw error(413, 'inline-scene video image exceeds 20 MiB');
  if (master !== null && (!(master instanceof Blob) || master.type !== 'image/png' || master.size < 24)) {
    throw error(400, 'inline-scene video master must be a PNG');
  }
  if (master instanceof Blob && master.size > INPUT_LIMIT_BYTES) {
    throw error(413, 'inline-scene video master exceeds 20 MiB');
  }
  if (references.some((reference) => (
    !(reference instanceof Blob) || reference.type !== 'image/png' || reference.size < 33
  ))) throw error(400, 'inline-scene video managed references must be PNG files');
  if (references.reduce((total, reference) => total + (reference instanceof Blob ? reference.size : 0), 0) > INPUT_LIMIT_BYTES) {
    throw error(413, 'inline-scene video managed references exceed 20 MiB in aggregate');
  }
  return {
    requestJson,
    image,
    master: master instanceof Blob ? master : null,
    references: references as Blob[]
  };
}

async function validateManagedReferenceAttachments(
  attachments: readonly Blob[],
  requested: readonly PortraitReferenceImage[]
): Promise<void> {
  const requestedByHash = new Map(requested.map((reference) => [reference.sha256, reference]));
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const bytes = new Uint8Array(await attachment.arrayBuffer());
    const digest = await sha256InlineSceneVideoBytes(bytes);
    const reference = requestedByHash.get(digest);
    if (!reference) throw error(400, 'inline-scene video managed reference was not selected by the active reference plan');
    if (seen.has(digest)) throw error(400, 'inline-scene video managed reference is duplicated');
    try {
      validateInlineSceneVideoPng(bytes, reference.width, reference.height);
    } catch {
      throw error(400, 'inline-scene video managed reference does not match its declared PNG');
    }
    seen.add(digest);
  }
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
  const isH3 = isMiniMaxH3InlineSceneVideoTemplate(videoRequest.modelTemplate);
  const h3ReferencePlan = isH3 ? inlineSceneH3ReferencePlan(videoRequest) : [];
  const bodyReferences = h3ReferencePlan
    .flatMap((entry) => entry.kind === 'body_identity' ? [entry.referenceImage] : []);
  await validateManagedReferenceAttachments(parts.references, bodyReferences);
  const priorMaster = h3ReferencePlan.find((entry) => entry.kind === 'prior_master');
  if (parts.master && !priorMaster) {
    throw error(400, 'inline-scene video master is not expected for this request');
  }
  if (priorMaster && !parts.master) {
    throw error(400, 'inline-scene video request is missing its prior master');
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
  const masterBytes = parts.master ? new Uint8Array(await parts.master.arrayBuffer()) : null;
  if (masterBytes && priorMaster) {
    try {
      await validateInlineSceneVideoPriorMasterBytes(masterBytes, priorMaster.master);
    } catch (cause) {
      throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene video prior master');
    }
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
    if (bodyReferences.length > 0) {
      await ensureComfyManagedReferences(fetch, baseUrl, bodyReferences, parts.references, signal);
    }
    const input = await uploadInlineSceneVideoInput(fetch, baseUrl, imageBytes, imageSha256, signal);
    const priorMasterInput = masterBytes && priorMaster
      ? await uploadInlineSceneVideoPriorMasterInput(fetch, baseUrl, masterBytes, priorMaster.master, signal)
      : undefined;
    const result = await runComfyInlineSceneVideo(
      fetch,
      baseUrl,
      videoRequest,
      input,
      seed,
      signal,
      priorMasterInput
    );
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
