// Reference packs for the MiniMax H3 scene clip. Every cast member contributes either
// three Krea 2 turbo views (face, three-quarter, waist up) rendered with the subject's
// Krea LoRA on the still lane, or, without a Krea LoRA, the identity photo already on the
// still lane. Each reference is uploaded into the loop lane's
// mullet/identity/refpack input namespace so the H3 graph can load it by name. Names are
// keyed on the subject's profile fingerprint, so a pack that is already on the loop lane
// is found by name and never rendered again.
//
// Shared-lane discipline: only the prompt IDs this module submits are ever cancelled,
// and only while they are still unsettled. Nothing queue-wide is touched on either lane.

import { buildKrea2TurboImageWorkflow, isKreaLoraName } from '../portrait.ts';
import { trackPrompt, untrackPrompt } from './inflight.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SceneReferenceView = 'face' | 'threequarter' | 'waistup' | 'identity';

export type SceneReferenceProfile = {
  id: string;
  fingerprint: string;
  displayName: string;
  subject: string;
  seed: number;
  subjectLora: { name: string; trigger: string; sha256: string } | null;
  referenceImage: {
    name: string;
    subfolder: string;
    type: 'input';
    sha256: string;
    width: number;
    height: number;
  };
};

export type SceneReference = {
  profileId: string;
  view: SceneReferenceView;
  sha256: string;
  name: string;
};

export const SCENE_REFERENCE_SUBFOLDER = 'mullet/identity/refpack';

export const SCENE_REFERENCE_VIEWS: readonly {
  view: SceneReferenceView;
  width: number;
  height: number;
  text: string;
}[] = Object.freeze([
  {
    view: 'face',
    width: 832,
    height: 1024,
    text: 'photorealistic neutral close-up portrait, face filling the frame, even soft daylight, '
      + 'direct gaze, closed mouth, plain background'
  },
  {
    view: 'threequarter',
    width: 832,
    height: 1024,
    text: 'photorealistic three-quarter view head-and-shoulders portrait turned slightly to the left, '
      + 'natural light, plain background'
  },
  {
    // Waist up, not full body: a full-figure reference pulls the generated shot back into
    // a distant landscape, which is the opposite of a one-to-one scene.
    view: 'waistup',
    width: 832,
    height: 1024,
    text: 'photorealistic waist-up photo facing the camera, head and torso filling the frame, '
      + 'relaxed contemporary clothing clearly visible, even natural light, plain background'
  }
]);

const SCENE_REFERENCE_CLIENT_ID = 'mullet-scene-reference';
const SCENE_REFERENCE_FILENAME_PREFIX = 'mullet/refpack';
const SAVE_IMAGE_NODE = '10';
const POLL_INTERVAL_MS = 250;
const MAX_PROFILES = 3;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MIN_REFERENCE_BYTES = 33;
// Three casts' worth of prepared views. Only metadata is held: the loop lane's input
// namespace is the durable copy, and a cached entry is re-confirmed there before use.
const MEMORY_CACHE_LIMIT = MAX_PROFILES * SCENE_REFERENCE_VIEWS.length * 3;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Scenario profile fingerprints are 8-hex FNV-1a digests (src/lib/scenario.ts).
const FINGERPRINT_PATTERN = /^[0-9a-f]{8,64}$/;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const REFERENCE_IMAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i;
const REFERENCE_SUBFOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VIEW_NAMES: readonly SceneReferenceView[] = Object.freeze(['face', 'threequarter', 'waistup', 'identity']);

type PreparedReference = { view: SceneReferenceView; sha256: string; bytes: Uint8Array };
type ResolvedReference = { view: SceneReferenceView; sha256: string };
type CachedReference = { sha256: string; byteLength: number };
type OutputImage = { filename: string; subfolder: string; type: 'output' };

const memoryCache = new Map<string, CachedReference>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpoint(baseUrl: string, urlPath: string): string {
  return `${baseUrl.replace(/\/$/, '')}${urlPath}`;
}

async function responseJson(response: Response, action: string): Promise<unknown> {
  if (!response.ok) throw new Error(`ComfyUI ${action} failed (${response.status})`);
  return response.json();
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is irrelevant; only the status and headers were consulted.
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= MIN_REFERENCE_BYTES
    && bytes.byteLength <= MAX_REFERENCE_BYTES
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function sceneReferenceName(
  profileId: string,
  view: SceneReferenceView,
  profileFingerprint: string
): string {
  if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error('scene reference profile id is invalid');
  }
  if (!VIEW_NAMES.includes(view)) throw new Error('scene reference view is invalid');
  if (typeof profileFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(profileFingerprint)) {
    throw new Error('scene reference fingerprint is invalid');
  }
  return `${profileId}-${view}-${profileFingerprint.slice(0, 16)}.png`;
}

function sceneReferencePrompt(text: string, trigger: string, subject: string): string {
  return `${text} of ${trigger}, ${subject}. No text, watermark, or extra people.`;
}

function assertProfile(profile: SceneReferenceProfile): void {
  if (!isRecord(profile)) throw new Error('scene reference profile must be an object');
  if (typeof profile.id !== 'string' || !PROFILE_ID_PATTERN.test(profile.id)) {
    throw new Error('scene reference profile id is invalid');
  }
  const label = `scene reference profile ${profile.id}`;
  if (typeof profile.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(profile.fingerprint)) {
    throw new Error(`${label} fingerprint is invalid`);
  }
  if (typeof profile.displayName !== 'string' || profile.displayName.trim().length === 0) {
    throw new Error(`${label} display name is invalid`);
  }
  if (typeof profile.subject !== 'string' || profile.subject.trim().length === 0) {
    throw new Error(`${label} subject is invalid`);
  }
  // The last view index is added to the seed, so keep headroom for every view.
  if (!Number.isSafeInteger(profile.seed) || profile.seed < 0
    || profile.seed > Number.MAX_SAFE_INTEGER - SCENE_REFERENCE_VIEWS.length) {
    throw new Error(`${label} seed is invalid`);
  }
  if (profile.subjectLora !== null) {
    const lora = profile.subjectLora;
    if (!isRecord(lora)
      || typeof lora.name !== 'string' || lora.name.length === 0
      || typeof lora.trigger !== 'string' || lora.trigger.trim().length === 0
      || typeof lora.sha256 !== 'string' || !SHA256_PATTERN.test(lora.sha256)) {
      throw new Error(`${label} subject LoRA is invalid`);
    }
  }
  const reference = profile.referenceImage;
  if (!isRecord(reference)
    || typeof reference.name !== 'string' || !REFERENCE_IMAGE_NAME_PATTERN.test(reference.name)
    || typeof reference.subfolder !== 'string' || !REFERENCE_SUBFOLDER_PATTERN.test(reference.subfolder)
    || reference.type !== 'input'
    || typeof reference.sha256 !== 'string' || !SHA256_PATTERN.test(reference.sha256)
    || !Number.isSafeInteger(reference.width) || reference.width < 1 || reference.width > 8192
    || !Number.isSafeInteger(reference.height) || reference.height < 1 || reference.height > 8192) {
    throw new Error(`${label} identity reference is invalid`);
  }
}

function assertProfiles(profiles: readonly SceneReferenceProfile[]): void {
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('scene references need at least one profile');
  if (profiles.length > MAX_PROFILES) throw new Error(`scene references accept at most ${MAX_PROFILES} profiles`);
  const ids = new Set<string>();
  for (const profile of profiles) {
    assertProfile(profile);
    if (ids.has(profile.id)) throw new Error(`scene reference profile ${profile.id} is listed twice`);
    ids.add(profile.id);
  }
}

function assertBaseUrl(value: string, lane: string): void {
  if (typeof value !== 'string' || !/^https?:\/\/\S+$/.test(value)) throw new Error(`${lane} lane base URL is invalid`);
}

// --- Krea render on the still lane ---------------------------------------------------

function promptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== 'string' || !UUID_PATTERN.test(value.prompt_id)) {
    throw new Error('ComfyUI returned no prompt ID');
  }
  return value.prompt_id;
}

function historyEntry(value: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(value)) throw new Error('ComfyUI returned invalid history');
  const entry = value[id];
  if (entry === undefined) return null;
  if (!isRecord(entry)) throw new Error('ComfyUI returned invalid prompt history');
  return entry;
}

function historySettled(entry: Record<string, unknown>): boolean {
  return isRecord(entry.status) && (entry.status.status_str === 'error' || entry.status.completed === true);
}

function historyFailure(entry: Record<string, unknown>): string | null {
  if (!isRecord(entry.status)) return null;
  if (entry.status.status_str === 'error') return 'ComfyUI scene reference render failed';
  if (entry.status.completed === true && entry.status.status_str !== 'success') {
    return 'ComfyUI scene reference render did not succeed';
  }
  return null;
}

function outputImage(entry: Record<string, unknown>): OutputImage | null {
  if (!isRecord(entry.status) || entry.status.completed !== true || entry.status.status_str !== 'success') return null;
  if (!isRecord(entry.outputs) || !isRecord(entry.outputs[SAVE_IMAGE_NODE])) {
    throw new Error('ComfyUI scene reference history omitted the output node');
  }
  const output = entry.outputs[SAVE_IMAGE_NODE];
  if (!isRecord(output)) throw new Error('ComfyUI scene reference history omitted the output node');
  if (!Array.isArray(output.images) || output.images.length !== 1 || !isRecord(output.images[0])) {
    throw new Error('ComfyUI scene reference history must contain exactly one image');
  }
  const image = output.images[0];
  if (typeof image.filename !== 'string' || !/^refpack[A-Za-z0-9_-]*\.png$/.test(image.filename)) {
    throw new Error('ComfyUI returned an unexpected scene reference filename');
  }
  if (image.subfolder !== 'mullet' || image.type !== 'output') {
    throw new Error('ComfyUI returned an unexpected scene reference location');
  }
  return { filename: image.filename, subfolder: 'mullet', type: 'output' };
}

function pollDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function waitForImage(
  fetcher: Fetcher,
  baseUrl: string,
  id: string,
  onSettled: () => void,
  signal?: AbortSignal
): Promise<OutputImage> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetcher(endpoint(baseUrl, `/history/${encodeURIComponent(id)}`), { signal });
    const entry = historyEntry(await responseJson(response, 'history query'), id);
    if (entry) {
      if (historySettled(entry)) onSettled();
      const failure = historyFailure(entry);
      if (failure) throw new Error(failure);
      const image = outputImage(entry);
      if (image) return image;
    }
    await pollDelay(POLL_INTERVAL_MS, signal);
  }
}

async function cancelComfyJob(fetcher: Fetcher, baseUrl: string, id: string): Promise<void> {
  try {
    await fetcher(endpoint(baseUrl, `/api/jobs/${encodeURIComponent(id)}/cancel`), {
      method: 'POST',
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    // Best-effort targeted cancellation must not replace the original failure.
  }
}

async function renderReferenceView(
  fetcher: Fetcher,
  baseUrl: string,
  profile: SceneReferenceProfile,
  lora: { name: string; trigger: string },
  viewIndex: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const spec = SCENE_REFERENCE_VIEWS[viewIndex];
  const workflow = buildKrea2TurboImageWorkflow({
    prompt: sceneReferencePrompt(spec.text, lora.trigger, profile.subject),
    width: spec.width,
    height: spec.height,
    seed: profile.seed + viewIndex,
    lora: lora.name,
    filenamePrefix: SCENE_REFERENCE_FILENAME_PREFIX
  });
  let id = '';
  let settled = false;
  try {
    const queueResponse = await fetcher(endpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: SCENE_REFERENCE_CLIENT_ID }),
      signal
    });
    id = promptId(await responseJson(queueResponse, 'queue submission'));
    trackPrompt(baseUrl, id);
    const image = await waitForImage(fetcher, baseUrl, id, () => { settled = true; }, signal);
    const imageResponse = await fetcher(endpoint(baseUrl, `/view?${new URLSearchParams(image)}`), { signal });
    if (!imageResponse.ok) throw new Error(`ComfyUI scene reference fetch failed (${imageResponse.status})`);
    const contentType = imageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (contentType !== 'image/png') throw new Error('ComfyUI scene reference output is not a PNG');
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (!isPng(bytes)) throw new Error('ComfyUI scene reference output is not a valid PNG');
    return bytes;
  } catch (cause) {
    // A prompt that already finished (success or error) has nothing left to cancel.
    if (id && !settled) await cancelComfyJob(fetcher, baseUrl, id);
    throw cause;
  } finally {
    untrackPrompt(id);
  }
}

// --- In-process cache ----------------------------------------------------------------

function remember(key: string, value: CachedReference): void {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

async function renderedReferences(
  fetcher: Fetcher,
  stillLaneBaseUrl: string,
  profile: SceneReferenceProfile,
  lora: { name: string; trigger: string },
  views: readonly SceneReferenceView[],
  signal?: AbortSignal
): Promise<PreparedReference[]> {
  const prepared: PreparedReference[] = [];
  for (const [viewIndex, spec] of SCENE_REFERENCE_VIEWS.entries()) {
    if (!views.includes(spec.view)) continue;
    signal?.throwIfAborted();
    const bytes = await renderReferenceView(fetcher, stillLaneBaseUrl, profile, lora, viewIndex, signal);
    prepared.push({ view: spec.view, sha256: await sha256Hex(bytes), bytes });
  }
  return prepared;
}

// --- Identity photo from the still lane ---------------------------------------------

async function identityReference(
  fetcher: Fetcher,
  stillLaneBaseUrl: string,
  profile: SceneReferenceProfile,
  signal?: AbortSignal
): Promise<PreparedReference> {
  const reference = profile.referenceImage;
  const query = new URLSearchParams({ filename: reference.name, subfolder: reference.subfolder, type: reference.type });
  const response = await fetcher(endpoint(stillLaneBaseUrl, `/view?${query}`), { signal });
  if (response.status !== 200) {
    await discardBody(response);
    throw new Error(
      `identity reference is unavailable on the still lane: ${reference.subfolder}/${reference.name} (${response.status})`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < MIN_REFERENCE_BYTES || bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error(`identity reference has an invalid size: ${reference.name}`);
  }
  if (await sha256Hex(bytes) !== reference.sha256) {
    throw new Error(`identity reference does not match its profile hash: ${reference.name}`);
  }
  // The refpack entry is named .png, so the bytes must be a PNG.
  if (!isPng(bytes)) throw new Error(`identity reference is not a PNG: ${reference.name}`);
  return { view: 'identity', sha256: reference.sha256, bytes };
}

// --- Loop lane upload ---------------------------------------------------------------

// Reads a prepared reference back from the loop lane. The name carries the subject's
// fingerprint, so a hit means this exact view of this exact profile is already there.
async function loopLaneReference(
  fetcher: Fetcher,
  loopLaneBaseUrl: string,
  name: string,
  signal?: AbortSignal
): Promise<CachedReference | null> {
  const query = new URLSearchParams({ filename: name, subfolder: SCENE_REFERENCE_SUBFOLDER, type: 'input' });
  const response = await fetcher(endpoint(loopLaneBaseUrl, `/view?${query}`), { signal });
  if (response.status !== 200) {
    await discardBody(response);
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isPng(bytes)) return null;
  return { sha256: await sha256Hex(bytes), byteLength: bytes.byteLength };
}

async function loopLaneHasReference(
  fetcher: Fetcher,
  loopLaneBaseUrl: string,
  name: string,
  byteLength: number,
  signal?: AbortSignal
): Promise<boolean> {
  const query = new URLSearchParams({ filename: name, subfolder: SCENE_REFERENCE_SUBFOLDER, type: 'input' });
  const response = await fetcher(endpoint(loopLaneBaseUrl, `/view?${query}`), { signal });
  if (response.status !== 200) {
    await discardBody(response);
    return false;
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    await discardBody(response);
    return /^\d+$/.test(contentLength.trim()) && Number(contentLength.trim()) === byteLength;
  }
  const body = await response.arrayBuffer();
  return body.byteLength === byteLength;
}

async function uploadReference(
  fetcher: Fetcher,
  loopLaneBaseUrl: string,
  name: string,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), name);
  form.append('subfolder', SCENE_REFERENCE_SUBFOLDER);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const response = await fetcher(endpoint(loopLaneBaseUrl, '/upload/image'), { method: 'POST', body: form, signal });
  const body = await responseJson(response, 'scene reference upload');
  if (!isRecord(body) || body.name !== name || body.subfolder !== SCENE_REFERENCE_SUBFOLDER || body.type !== 'input') {
    throw new Error(`ComfyUI returned an unexpected scene reference upload location for ${name}`);
  }
  if (!(await loopLaneHasReference(fetcher, loopLaneBaseUrl, name, bytes.byteLength, signal))) {
    throw new Error(`scene reference upload could not be verified on the loop lane: ${name}`);
  }
}

// --- Entry point --------------------------------------------------------------------

export async function ensureSceneReferences(
  fetcher: Fetcher,
  stillLaneBaseUrl: string,
  loopLaneBaseUrl: string,
  profiles: readonly SceneReferenceProfile[],
  signal?: AbortSignal
): Promise<SceneReference[]> {
  assertBaseUrl(stillLaneBaseUrl, 'still');
  assertBaseUrl(loopLaneBaseUrl, 'loop');
  assertProfiles(profiles);
  const references: SceneReference[] = [];
  for (const profile of profiles) {
    signal?.throwIfAborted();
    const lora = profile.subjectLora !== null && isKreaLoraName(profile.subjectLora.name) ? profile.subjectLora : null;
    const views: readonly SceneReferenceView[] = lora
      ? SCENE_REFERENCE_VIEWS.map(({ view }) => view)
      : ['identity'];
    // Names are deterministic, so the loop lane is asked first: a pack prepared in an
    // earlier session or turn costs one GET per view and no rendering at all.
    const prepared: ResolvedReference[] = [];
    const missing: SceneReferenceView[] = [];
    for (const view of views) {
      signal?.throwIfAborted();
      const name = sceneReferenceName(profile.id, view, profile.fingerprint);
      // The name is the cache key: it already carries the profile, the view, and the
      // subject's fingerprint, so two profiles can never share an entry.
      const known = memoryCache.get(name);
      // A cached entry is still confirmed on the lane, which MULLET does not own: its
      // input namespace can be cleaned or the service restarted between turns.
      const cached = known && await loopLaneHasReference(fetcher, loopLaneBaseUrl, name, known.byteLength, signal)
        ? known
        : await loopLaneReference(fetcher, loopLaneBaseUrl, name, signal);
      if (!cached) {
        memoryCache.delete(name);
        missing.push(view);
        continue;
      }
      remember(name, cached);
      prepared.push({ view, sha256: cached.sha256 });
    }
    if (missing.length > 0) {
      const rendered = lora
        ? await renderedReferences(fetcher, stillLaneBaseUrl, profile, lora, missing, signal)
        : [await identityReference(fetcher, stillLaneBaseUrl, profile, signal)];
      for (const item of rendered) {
        signal?.throwIfAborted();
        await uploadReference(
          fetcher,
          loopLaneBaseUrl,
          sceneReferenceName(profile.id, item.view, profile.fingerprint),
          item.bytes,
          signal
        );
        remember(
          sceneReferenceName(profile.id, item.view, profile.fingerprint),
          { sha256: item.sha256, byteLength: item.bytes.byteLength }
        );
        prepared.push({ view: item.view, sha256: item.sha256 });
      }
    }
    // Emit in view order so the prompt tags read face, three-quarter, full body per subject.
    for (const view of views) {
      const item = prepared.find((candidate) => candidate.view === view);
      if (!item) throw new Error(`scene reference ${view} for ${profile.id} could not be prepared`);
      references.push({
        profileId: profile.id,
        view: item.view,
        sha256: item.sha256,
        name: sceneReferenceName(profile.id, item.view, profile.fingerprint)
      });
    }
  }
  return references;
}
