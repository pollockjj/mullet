import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_IMAGE_TIMEOUT_MS,
  MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_STILL_TIMEOUT_MS,
  inlineSceneDimensionsForTemplate,
  inlineSceneModelTemplateAvailable,
  normalizeInlineSceneImageRequest
} from '$lib/inline-scene';
import {
  ComfyInlineSceneOutputTooLargeError,
  loadInlineSceneCapabilities,
  runComfyInlineScene,
  uploadInlineSceneContinuityMasterInput,
  validateInlineScenePng
} from '$lib/server/comfy-inline-scene';
import { runtime } from '$lib/server/runtime';

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function configuredImageComfyBaseUrl(): string {
  if (!runtime.imageComfyBaseUrl) throw error(503, 'Inline scene generation is not configured.');
  return runtime.imageComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

function exactMultipartParts(form: FormData): { requestJson: string; master: Blob | null } {
  const keys = [...form.keys()];
  const requests = form.getAll('request');
  const masters = form.getAll('master');
  if (
    requests.length !== 1
    || masters.length > 1
    || keys.length !== requests.length + masters.length
    || keys.some((key) => key !== 'request' && key !== 'master')
  ) throw error(400, 'multipart body must contain exactly one request and at most one master');
  const requestJson = requests[0];
  const master = masters[0] ?? null;
  if (typeof requestJson !== 'string' || requestJson.length < 1 || requestJson.length > 100_000) {
    throw error(400, 'inline-scene request JSON is invalid');
  }
  if (master !== null && (!(master instanceof Blob) || master.type !== 'image/png' || master.size < 24)) {
    throw error(400, 'inline-scene continuity master must be a PNG');
  }
  if (master instanceof Blob && master.size > INPUT_LIMIT_BYTES) {
    throw error(413, 'inline-scene continuity master exceeds 20 MiB');
  }
  return { requestJson, master: master instanceof Blob ? master : null };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const baseUrl = configuredImageComfyBaseUrl();
  try {
    const capabilities = await loadInlineSceneCapabilities(
      fetch,
      baseUrl,
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      { minimaxH3T1StillValidated: runtime.minimaxH3T1StillValidated }
    );
    return json(capabilities, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('inline-scene capability query failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene generator is unavailable.');
  }
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const baseUrl = configuredImageComfyBaseUrl();
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw error(400, 'inline-scene request must be multipart form data');
  }
  const form = await request.formData().catch(() => {
    throw error(400, 'inline-scene multipart body is invalid');
  });
  const parts = exactMultipartParts(form);
  let sceneRequest;
  try {
    sceneRequest = normalizeInlineSceneImageRequest(JSON.parse(parts.requestJson));
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene image request');
  }
  if (sceneRequest.continuityMaster && !parts.master) {
    throw error(400, 'inline-scene continuity metadata requires exactly one master PNG');
  }
  if (!sceneRequest.continuityMaster && parts.master) {
    throw error(400, 'inline-scene request has an unexpected continuity master PNG');
  }
  let continuityMasterBytes: Uint8Array | null = null;
  if (sceneRequest.continuityMaster && parts.master) {
    continuityMasterBytes = new Uint8Array(await parts.master.arrayBuffer());
    try {
      validateInlineScenePng(
        continuityMasterBytes,
        sceneRequest.continuityMaster.width,
        sceneRequest.continuityMaster.height
      );
    } catch {
      throw error(400, 'inline-scene continuity master dimensions do not match its bytes');
    }
    if (await sha256Bytes(continuityMasterBytes) !== sceneRequest.continuityMaster.imageSha256) {
      throw error(400, 'inline-scene continuity master hash does not match its bytes');
    }
  }
  const seed = sceneRequest.seed ?? randomSeed();
  const timeout = sceneRequest.modelTemplate === MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID
    ? MINIMAX_H3_INLINE_SCENE_STILL_TIMEOUT_MS
    : INLINE_SCENE_IMAGE_TIMEOUT_MS;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
  try {
    const capabilities = await loadInlineSceneCapabilities(
      fetch,
      baseUrl,
      signal,
      { minimaxH3T1StillValidated: runtime.minimaxH3T1StillValidated }
    );
    if (!inlineSceneModelTemplateAvailable(capabilities, sceneRequest.modelTemplate)) {
      throw error(400, 'The selected inline-scene model is unavailable.');
    }
    if (sceneRequest.lora && !capabilities.loras.includes(sceneRequest.lora.path)) {
      throw error(400, 'The selected inline-scene LoRA is unavailable.');
    }
    const uploadedMaster = sceneRequest.continuityMaster && continuityMasterBytes
      ? await uploadInlineSceneContinuityMasterInput(
          fetch,
          baseUrl,
          continuityMasterBytes,
          sceneRequest.continuityMaster,
          signal
        )
      : undefined;
    const result = await runComfyInlineScene(
      fetch,
      baseUrl,
      sceneRequest,
      capabilities,
      seed,
      signal,
      uploadedMaster
    );
    const dimensions = inlineSceneDimensionsForTemplate(
      sceneRequest.modelTemplate,
      sceneRequest.aspectRatio,
      sceneRequest.megapixels
    );
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
