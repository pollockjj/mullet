import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  PORTRAIT_H3_REFERENCE_TEMPLATE_ID,
  PORTRAIT_H3_TIMEOUT_MS,
  PORTRAIT_TIMEOUT_MS,
  normalizePortraitRequest,
  portraitDimensionsForTemplate,
  portraitH3ReferencePlan,
  portraitModelTemplateAvailable,
  portraitModelTemplateCapability,
  validatePortraitPngDimensions
} from '$lib/portrait';
import { ensureComfyManagedReferences } from '$lib/server/comfy-managed-reference';
import { loadPortraitCapabilities, runComfyPortrait } from '$lib/server/comfy-portrait';
import { runtime } from '$lib/server/runtime';

function configuredImageComfyBaseUrl(): string {
  if (!runtime.imageComfyBaseUrl) throw error(503, 'Portrait generation is not configured.');
  return runtime.imageComfyBaseUrl;
}

function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] % 65_536) * 2 ** 32 + words[1];
}

const INPUT_LIMIT_BYTES = 20 * 1024 * 1024;

function exactMultipartParts(form: FormData): { requestJson: string; references: Blob[] } {
  const keys = [...form.keys()];
  const requests = form.getAll('request');
  const references = form.getAll('reference');
  if (
    requests.length !== 1
    || references.length > 1
    || keys.length !== requests.length + references.length
    || keys.some((key) => key !== 'request' && key !== 'reference')
  ) throw error(400, 'portrait multipart body must contain exactly one request and at most one reference');
  const requestJson = requests[0];
  if (typeof requestJson !== 'string' || requestJson.length < 1 || requestJson.length > 100_000) {
    throw error(400, 'portrait request JSON is invalid');
  }
  if (references.some((reference) => (
    !(reference instanceof Blob)
    || reference.type !== 'image/png'
    || reference.size < 33
    || reference.size > INPUT_LIMIT_BYTES
  ))) throw error(400, 'portrait managed reference must be one PNG no larger than 20 MiB');
  return { requestJson, references: references as Blob[] };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function validateManagedBodyAttachment(
  attachments: readonly Blob[],
  bodyReference: ReturnType<typeof portraitH3ReferencePlan>[number]['referenceImage'] | null
): Promise<void> {
  if (attachments.length === 0) return;
  if (!bodyReference) throw error(400, 'portrait managed reference was not selected by the H3 reference plan');
  const bytes = new Uint8Array(await attachments[0].arrayBuffer());
  if (await sha256Bytes(bytes) !== bodyReference.sha256) {
    throw error(400, 'portrait managed reference hash does not match the selected body reference');
  }
  try {
    validatePortraitPngDimensions(bytes, bodyReference.width, bodyReference.height);
  } catch {
    throw error(400, 'portrait managed reference does not match its declared PNG');
  }
}

export const GET: RequestHandler = async ({ fetch, request }) => {
  const baseUrl = configuredImageComfyBaseUrl();
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
  const baseUrl = configuredImageComfyBaseUrl();
  const multipart = request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data') ?? false;
  let body: unknown;
  let referenceAttachments: Blob[] = [];
  if (multipart) {
    const form = await request.formData().catch(() => {
      throw error(400, 'portrait multipart body is invalid');
    });
    const parts = exactMultipartParts(form);
    referenceAttachments = parts.references;
    try {
      body = JSON.parse(parts.requestJson);
    } catch {
      throw error(400, 'portrait request JSON is invalid');
    }
  } else {
    body = await request.json().catch(() => {
      throw error(400, 'portrait request body must be JSON or multipart form data');
    });
  }
  let portraitRequest;
  try {
    portraitRequest = normalizePortraitRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid portrait request');
  }
  if (portraitRequest.modelTemplate === PORTRAIT_H3_REFERENCE_TEMPLATE_ID && !multipart) {
    throw error(400, 'MiniMax H3 portrait requests must be multipart form data');
  }
  if (portraitRequest.modelTemplate !== PORTRAIT_H3_REFERENCE_TEMPLATE_ID && multipart) {
    throw error(400, 'only MiniMax H3 portrait requests use multipart form data');
  }
  const managedBodyReference = portraitRequest.modelTemplate === PORTRAIT_H3_REFERENCE_TEMPLATE_ID
    ? portraitH3ReferencePlan(portraitRequest)
        .find(({ kind }) => kind === 'body_wardrobe')?.referenceImage ?? null
    : null;
  await validateManagedBodyAttachment(referenceAttachments, managedBodyReference);

  const seed = portraitRequest.seed ?? randomSeed();
  const timeout = portraitRequest.modelTemplate === PORTRAIT_H3_REFERENCE_TEMPLATE_ID
    ? PORTRAIT_H3_TIMEOUT_MS
    : PORTRAIT_TIMEOUT_MS;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
  try {
    const capabilities = await loadPortraitCapabilities(fetch, baseUrl, signal);
    if (portraitRequest.lora && !capabilities.loras.includes(portraitRequest.lora)) {
      throw error(400, 'The selected portrait LoRA is unavailable for this model.');
    }
    if (!portraitModelTemplateAvailable(capabilities, portraitRequest.modelTemplate)) {
      const template = portraitModelTemplateCapability(capabilities, portraitRequest.modelTemplate);
      const diagnostics = template?.missing.length ? ` Missing: ${template.missing.join(', ')}.` : '';
      throw error(400, `The selected portrait image model is unavailable.${diagnostics}`);
    }
    if (managedBodyReference) {
      await ensureComfyManagedReferences(
        fetch,
        baseUrl,
        [managedBodyReference],
        referenceAttachments,
        signal
      );
    }
    const result = await runComfyPortrait(fetch, baseUrl, portraitRequest, seed, signal);
    const dimensions = portraitDimensionsForTemplate(
      portraitRequest.modelTemplate,
      portraitRequest.aspectRatio,
      portraitRequest.megapixels
    );
    const imageBody = result.bytes.slice().buffer as ArrayBuffer;
    return new Response(imageBody, {
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
