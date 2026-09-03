import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureSceneReferences, type SceneReferenceProfile } from '$lib/server/comfy-scene-references';
import { runtime } from '$lib/server/runtime';

// Prepares the reference pack for a scene cast: three Krea views per LoRA subject rendered
// on the still lane, or the identity photo for a reference-driven subject, uploaded to the
// loop lane's `mullet/identity/refpack/` namespace. Idempotent; the client caches the
// result per profile fingerprint.
const PROFILE_LIMIT = 3;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > maximum) throw error(400, `${name} is invalid`);
  return value;
}

function profileFromBody(value: unknown): SceneReferenceProfile {
  if (!isRecord(value)) throw error(400, 'scene reference profile is invalid');
  const id = text(value.id, 'profile id', 64);
  if (!PROFILE_ID_PATTERN.test(id)) throw error(400, 'profile id is invalid');
  const fingerprint = text(value.fingerprint, 'profile fingerprint', 64);
  // Scenario fingerprints are 8-hex FNV-1a digests, not sha256 (src/lib/scenario.ts).
  if (!/^[0-9a-f]{8,64}$/.test(fingerprint)) throw error(400, 'profile fingerprint is invalid');
  if (!Number.isSafeInteger(value.seed) || Number(value.seed) < 0) throw error(400, 'profile seed is invalid');
  let subjectLora: SceneReferenceProfile['subjectLora'] = null;
  if (value.subjectLora !== null && value.subjectLora !== undefined) {
    if (!isRecord(value.subjectLora)) throw error(400, 'profile LoRA is invalid');
    const sha256 = text(value.subjectLora.sha256, 'profile LoRA hash', 64);
    if (!SHA256_PATTERN.test(sha256)) throw error(400, 'profile LoRA hash is invalid');
    subjectLora = {
      name: text(value.subjectLora.name, 'profile LoRA name', 200),
      trigger: text(value.subjectLora.trigger, 'profile LoRA trigger', 100),
      sha256
    };
  }
  if (!isRecord(value.referenceImage)) throw error(400, 'profile reference image is invalid');
  const reference = value.referenceImage;
  const referenceSha = text(reference.sha256, 'profile reference hash', 64);
  if (!SHA256_PATTERN.test(referenceSha)) throw error(400, 'profile reference hash is invalid');
  const name = text(reference.name, 'profile reference name', 128);
  const subfolder = text(reference.subfolder, 'profile reference subfolder', 128);
  if (!NAME_PATTERN.test(name) || !/^mullet(\/[A-Za-z0-9._-]+)*$/.test(subfolder)) throw error(400, 'profile reference location is invalid');
  if (reference.type !== 'input') throw error(400, 'profile reference type is invalid');
  const width = Number(reference.width);
  const height = Number(reference.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192) {
    throw error(400, 'profile reference dimensions are invalid');
  }
  return {
    id,
    fingerprint,
    displayName: text(value.displayName, 'profile display name', 200),
    subject: text(value.subject, 'profile subject', 2000),
    seed: Number(value.seed),
    subjectLora,
    referenceImage: { name, subfolder, type: 'input', sha256: referenceSha, width, height }
  };
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const stillLane = runtime.sceneStillComfyBaseUrl;
  const loopLane = runtime.sceneVideoComfyBaseUrl;
  if (!stillLane || !loopLane) throw error(503, 'Scene references are not configured.');
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.profiles) || body.profiles.length < 1 || body.profiles.length > PROFILE_LIMIT) {
    throw error(400, `scene reference request must name between 1 and ${PROFILE_LIMIT} profiles`);
  }
  const profiles = body.profiles.map(profileFromBody);
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) throw error(400, 'scene reference profiles are duplicated');
  const timeoutSignal = AbortSignal.timeout(240_000);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);
  try {
    const references = await ensureSceneReferences(fetch, stillLane, loopLane, profiles, signal);
    return json({ references }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    if (timeoutSignal.aborted) throw error(504, 'Scene reference preparation timed out.');
    const message = cause instanceof Error ? cause.message : 'unknown failure';
    console.error('scene reference preparation failed', message);
    if (message.startsWith('identity reference is unavailable')) throw error(409, message);
    throw error(502, 'The scene reference preparation failed.');
  }
};
