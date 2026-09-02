import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_IMAGE_TIMEOUT_MS,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  inlineSceneDimensionsForTemplate,
  inlineSceneModelTemplateAvailable,
  inlineSceneQwenReferencePlan,
  normalizeInlineSceneImageRequest
} from '$lib/inline-scene';
import type { PortraitReferenceImage } from '$lib/portrait';
import {
  ComfyInlineSceneOutputTooLargeError,
  loadInlineSceneCapabilities,
  runComfyInlineScene,
  uploadInlineSceneContinuityMasterInput,
  validateInlineScenePng
} from '$lib/server/comfy-inline-scene';
import { ensureComfyManagedReferences } from '$lib/server/comfy-managed-reference';
import { runtime } from '$lib/server/runtime';

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function configuredImageComfyBaseUrl(): string {
  if (!runtime.sceneStillComfyBaseUrl) throw error(503, 'Inline scene generation is not configured.');
  return runtime.sceneStillComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

function exactMultipartParts(form: FormData): {
  requestJson: string;
  master: Blob | null;
  references: Blob[];
} {
  const keys = [...form.keys()];
  const requests = form.getAll('request');
  const masters = form.getAll('master');
  const references = form.getAll('reference');
  if (
    requests.length !== 1
    || masters.length > 1
    || references.length > 3
    || keys.length !== requests.length + masters.length + references.length
    || keys.some((key) => key !== 'request' && key !== 'master' && key !== 'reference')
  ) throw error(400, 'multipart body must contain exactly one request, at most one master, and at most three references');
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
  if (references.some((reference) => (
    !(reference instanceof Blob) || reference.type !== 'image/png' || reference.size < 33
  ))) throw error(400, 'inline-scene managed references must be PNG files');
  if (references.reduce((total, reference) => total + (reference instanceof Blob ? reference.size : 0), 0) > INPUT_LIMIT_BYTES) {
    throw error(413, 'inline-scene managed references exceed 20 MiB in aggregate');
  }
  return {
    requestJson,
    master: master instanceof Blob ? master : null,
    references: references as Blob[]
  };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function validateManagedReferenceAttachments(
  attachments: readonly Blob[],
  requested: readonly PortraitReferenceImage[]
): Promise<void> {
  const requestedByHash = new Map(requested.map((reference) => [reference.sha256, reference]));
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const bytes = new Uint8Array(await attachment.arrayBuffer());
    const digest = await sha256Bytes(bytes);
    const reference = requestedByHash.get(digest);
    if (!reference) throw error(400, 'inline-scene managed reference was not selected by the active reference plan');
    if (seen.has(digest)) throw error(400, 'inline-scene managed reference is duplicated');
    try {
      validateInlineScenePng(bytes, reference.width, reference.height);
    } catch {
      throw error(400, 'inline-scene managed reference does not match its declared PNG');
    }
    seen.add(digest);
  }
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
  const bodyReferences = sceneRequest.modelTemplate === INLINE_SCENE_QWEN_TEMPLATE_ID
    ? inlineSceneQwenReferencePlan(sceneRequest)
        .filter((slot) => slot.kind === 'body_wardrobe')
        .map((slot) => slot.referenceImage)
    : [];
  await validateManagedReferenceAttachments(parts.references, bodyReferences);
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
  const timeout = INLINE_SCENE_IMAGE_TIMEOUT_MS;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
  try {
    const capabilities = await loadInlineSceneCapabilities(
      fetch,
      baseUrl,
      signal
    );
    if (!inlineSceneModelTemplateAvailable(capabilities, sceneRequest.modelTemplate)) {
      throw error(400, 'The selected inline-scene model is unavailable.');
    }
    if (sceneRequest.lora && !capabilities.loras.includes(sceneRequest.lora.path)) {
      throw error(400, 'The selected inline-scene LoRA is unavailable.');
    }
    if (bodyReferences.length > 0) {
      await ensureComfyManagedReferences(fetch, baseUrl, bodyReferences, parts.references, signal);
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
