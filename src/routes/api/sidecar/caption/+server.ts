import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  SUBJECT_CAPTION_MAX_TOKENS,
  SUBJECT_CAPTION_PROMPT,
  SUBJECT_CAPTION_TIMEOUT_MS,
  createSubjectDescriptor
} from '$lib/subject-continuity';
import { runSidecarVisionCompletion } from '$lib/server/sidecar-model';
import { runtime } from '$lib/server/runtime';

const MAX_PORTRAIT_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

// Captions the generated expression still so its exact visible details can be carried
// into the widescreen scene. Isolated from canonical chat, like every other sidecar.
export const POST: RequestHandler = async ({ request, fetch }) => {
  const form = await request.formData().catch(() => {
    throw error(400, 'subject caption requires multipart form data');
  });
  const image = form.get('image');
  const characterId = String(form.get('characterId') ?? '');
  const displayName = String(form.get('displayName') ?? '');
  const expression = String(form.get('expression') ?? '');
  if (!(image instanceof Blob)) throw error(400, 'subject caption requires one image part');
  if (image.size < 1 || image.size > MAX_PORTRAIT_BYTES) throw error(413, 'subject caption image is too large');

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw error(400, 'subject caption image must be a PNG');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const portraitSha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  let caption: string;
  try {
    caption = await runSidecarVisionCompletion(fetch, {
      baseUrl: runtime.modelBaseUrl,
      model: runtime.modelId,
      systemPrompt: SUBJECT_CAPTION_PROMPT,
      input: '',
      maxTokens: SUBJECT_CAPTION_MAX_TOKENS,
      imageBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
      imageMediaType: 'image/png',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(SUBJECT_CAPTION_TIMEOUT_MS)])
    });
  } catch (cause) {
    console.error('subject caption failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, cause instanceof Error ? cause.message : 'subject caption failed');
  }

  try {
    return json(createSubjectDescriptor(characterId, displayName, portraitSha256, expression, caption));
  } catch (cause) {
    console.error('subject caption unusable', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, cause instanceof Error ? cause.message : 'subject caption was unusable');
  }
};
