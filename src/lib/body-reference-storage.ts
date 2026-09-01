import type { PortraitReferenceImage } from './portrait.ts';
import type { ScenarioPortraitProfile } from './scenario.ts';

export const BODY_REFERENCE_OVERLAY_SPEC = 'mullet_body_reference_overlay_v1' as const;
export const BODY_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;

export type StoredBodyReferenceOverlay = {
  spec: typeof BODY_REFERENCE_OVERLAY_SPEC;
  profileId: string;
  baseProfileFingerprint: string;
  mergedProfileFingerprint: string;
  referenceImage: PortraitReferenceImage;
  image: Blob;
};

export type BodyReferenceOverlay = StoredBodyReferenceOverlay;

const DATABASE_NAME = 'mullet-body-reference-overlays';
const STORE_NAME = 'references';
const LOCK_NAME = 'mullet-body-reference-overlays';
const PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REFERENCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  if (Object.keys(value).sort().join('\u001f') !== [...expected].sort().join('\u001f')) {
    throw new Error(`${name} has unexpected fields`);
  }
}

function profileId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || !PROFILE_ID_PATTERN.test(value)) {
    throw new Error('body-reference profile ID is invalid');
  }
  return value;
}

function fingerprint(value: unknown, name: string): string {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function safeDimension(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 16 || Number(value) > 8192) {
    throw new Error(`${name} is invalid`);
  }
  return Number(value);
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left;
  let divisor = right;
  while (divisor !== 0) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }
  return dividend;
}

function exactAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
    || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
    || bytes[8] !== 0x00 || bytes[9] !== 0x00 || bytes[10] !== 0x00 || bytes[11] !== 0x0d
    || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) throw new Error('body-reference image has an invalid PNG IHDR');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: safeDimension(view.getUint32(16, false), 'body-reference PNG width'),
    height: safeDimension(view.getUint32(20, false), 'body-reference PNG height')
  };
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bodyReferenceOverlayKey(rawProfileId: string, rawBaseFingerprint: string): string {
  return `${profileId(rawProfileId)}\u001f${fingerprint(rawBaseFingerprint, 'body-reference base profile fingerprint')}`;
}

export function bodyReferenceImageName(
  rawProfileId: string,
  rawBaseFingerprint: string,
  imageSha256: string
): string {
  const id = profileId(rawProfileId);
  const base = fingerprint(rawBaseFingerprint, 'body-reference base profile fingerprint');
  if (!SHA256_PATTERN.test(imageSha256)) throw new Error('body-reference image hash is invalid');
  return `body-${id}-${base}-${imageSha256}.png`;
}

function fnv1a32(value: string): number {
  const bytes = new TextEncoder().encode(value);
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

export function bodyReferenceMergedProfileFingerprint(
  rawProfileId: string,
  rawBaseFingerprint: string,
  referenceImage: PortraitReferenceImage
): string {
  const id = profileId(rawProfileId);
  const base = fingerprint(rawBaseFingerprint, 'body-reference base profile fingerprint');
  const fields = [
    'mullet-body-reference-profile-v1',
    id,
    base,
    referenceImage.name,
    referenceImage.subfolder,
    referenceImage.type,
    referenceImage.sha256,
    String(referenceImage.width),
    String(referenceImage.height),
    referenceImage.aspectRatio
  ];
  let derived = fnv1a32(fields.join('\u001f'));
  if (derived === Number.parseInt(base, 16)) derived = (derived ^ 0xa5a5a5a5) >>> 0;
  return derived.toString(16).padStart(8, '0');
}

function normalizeReferenceImage(
  value: unknown,
  id: string,
  baseProfileFingerprint: string
): PortraitReferenceImage {
  if (!isRecord(value)) throw new Error('body-reference image metadata is invalid');
  exactKeys(
    value,
    ['name', 'subfolder', 'type', 'sha256', 'width', 'height', 'aspectRatio'],
    'body-reference image metadata'
  );
  const width = safeDimension(value.width, 'body-reference width');
  const height = safeDimension(value.height, 'body-reference height');
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error('body-reference image hash is invalid');
  }
  const expectedName = bodyReferenceImageName(id, baseProfileFingerprint, value.sha256);
  if (
    typeof value.name !== 'string'
    || !REFERENCE_NAME_PATTERN.test(value.name)
    || value.name !== expectedName
    || value.subfolder !== 'mullet/identity'
    || value.type !== 'input'
  ) throw new Error('body-reference logical image location is invalid');
  const aspectRatio = exactAspectRatio(width, height);
  if (value.aspectRatio !== aspectRatio) {
    throw new Error(`body-reference aspect ratio must be ${aspectRatio}`);
  }
  return {
    name: expectedName,
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: value.sha256,
    width,
    height,
    aspectRatio
  };
}

export function normalizeBodyReferenceOverlay(value: unknown): StoredBodyReferenceOverlay {
  if (!isRecord(value) || value.spec !== BODY_REFERENCE_OVERLAY_SPEC) {
    throw new Error('invalid body-reference overlay');
  }
  exactKeys(
    value,
    ['spec', 'profileId', 'baseProfileFingerprint', 'mergedProfileFingerprint', 'referenceImage', 'image'],
    'body-reference overlay'
  );
  const id = profileId(value.profileId);
  const baseProfileFingerprint = fingerprint(
    value.baseProfileFingerprint,
    'body-reference base profile fingerprint'
  );
  const referenceImage = normalizeReferenceImage(value.referenceImage, id, baseProfileFingerprint);
  const mergedProfileFingerprint = fingerprint(
    value.mergedProfileFingerprint,
    'body-reference merged profile fingerprint'
  );
  const expectedMergedFingerprint = bodyReferenceMergedProfileFingerprint(
    id,
    baseProfileFingerprint,
    referenceImage
  );
  if (mergedProfileFingerprint !== expectedMergedFingerprint || mergedProfileFingerprint === baseProfileFingerprint) {
    throw new Error('body-reference merged profile fingerprint does not match its overlay');
  }
  if (
    !(value.image instanceof Blob)
    || value.image.type !== 'image/png'
    || value.image.size < 24
    || value.image.size > BODY_REFERENCE_MAX_BYTES
  ) throw new Error('body-reference image must be a PNG of at most 20 MiB');
  return {
    spec: BODY_REFERENCE_OVERLAY_SPEC,
    profileId: id,
    baseProfileFingerprint,
    mergedProfileFingerprint,
    referenceImage,
    image: value.image
  };
}

export async function verifyBodyReferenceOverlay(value: unknown): Promise<StoredBodyReferenceOverlay> {
  const overlay = normalizeBodyReferenceOverlay(value);
  const dimensions = pngDimensions(new Uint8Array(await overlay.image.arrayBuffer()));
  if (
    dimensions.width !== overlay.referenceImage.width
    || dimensions.height !== overlay.referenceImage.height
  ) throw new Error('body-reference PNG dimensions do not match its metadata');
  if (await sha256Blob(overlay.image) !== overlay.referenceImage.sha256) {
    throw new Error('body-reference image hash does not match its bytes');
  }
  return overlay;
}

export async function createBodyReferenceOverlay(
  profile: ScenarioPortraitProfile,
  image: Blob
): Promise<BodyReferenceOverlay> {
  if (!isRecord(profile)) throw new Error('body-reference profile is invalid');
  const id = profileId(profile.id);
  const baseProfileFingerprint = fingerprint(
    profile.fingerprint,
    'body-reference base profile fingerprint'
  );
  if (
    !(image instanceof Blob)
    || image.type !== 'image/png'
    || image.size < 24
    || image.size > BODY_REFERENCE_MAX_BYTES
  ) throw new Error('body-reference image must be a PNG of at most 20 MiB');
  const dimensions = pngDimensions(new Uint8Array(await image.arrayBuffer()));
  const imageSha256 = await sha256Blob(image);
  const referenceImage: PortraitReferenceImage = {
    name: bodyReferenceImageName(id, baseProfileFingerprint, imageSha256),
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: imageSha256,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: exactAspectRatio(dimensions.width, dimensions.height)
  };
  return verifyBodyReferenceOverlay({
    spec: BODY_REFERENCE_OVERLAY_SPEC,
    profileId: id,
    baseProfileFingerprint,
    mergedProfileFingerprint: bodyReferenceMergedProfileFingerprint(id, baseProfileFingerprint, referenceImage),
    referenceImage,
    image
  });
}

export function applyBodyReferenceOverlay(
  profile: ScenarioPortraitProfile,
  value: StoredBodyReferenceOverlay
): ScenarioPortraitProfile {
  if (!isRecord(profile)) throw new Error('body-reference profile is invalid');
  // Creation and every persistence read verify the PNG bytes before producing this type.
  // Re-normalize the immutable metadata here so a reactive projection stays synchronous.
  const overlay = normalizeBodyReferenceOverlay(value);
  if (profile.id !== overlay.profileId || profile.fingerprint !== overlay.baseProfileFingerprint) {
    throw new Error('body-reference overlay does not match its base profile');
  }
  return {
    ...profile,
    bodyReferenceImage: overlay.referenceImage,
    fingerprint: overlay.mergedProfileFingerprint
  };
}

export async function runBodyReferenceOverlayExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for body-reference persistence');
  return lockManager.request(LOCK_NAME, { mode: 'exclusive' }, operation);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB body-reference open failed'));
    request.onblocked = () => reject(new Error('IndexedDB body-reference upgrade is blocked by another MULLET tab'));
  });
}

async function loadRawBodyReferenceOverlay(key: string): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB body-reference read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB body-reference read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function loadBodyReferenceOverlay(
  rawProfileId: string,
  rawBaseFingerprint: string
): Promise<BodyReferenceOverlay | null> {
  const key = bodyReferenceOverlayKey(rawProfileId, rawBaseFingerprint);
  const raw = await loadRawBodyReferenceOverlay(key);
  if (raw === null) return null;
  const overlay = await verifyBodyReferenceOverlay(raw);
  if (bodyReferenceOverlayKey(overlay.profileId, overlay.baseProfileFingerprint) !== key) {
    throw new Error('stored body-reference key does not match its overlay');
  }
  return overlay;
}

export async function loadBodyReferenceOverlays(): Promise<StoredBodyReferenceOverlay[]> {
  const database = await openDatabase();
  let raw: unknown[];
  let rawKeys: IDBValidKey[];
  try {
    [raw, rawKeys] = await new Promise<[unknown[], IDBValidKey[]]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const valuesRequest = store.getAll();
      const keysRequest = store.getAllKeys();
      transaction.oncomplete = () => resolve([valuesRequest.result, keysRequest.result]);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB body-reference list failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB body-reference list aborted'));
    });
  } finally {
    database.close();
  }
  if (raw.length !== rawKeys.length) throw new Error('stored body-reference key/value count does not match');
  const overlays = await Promise.all(raw.map(verifyBodyReferenceOverlay));
  overlays.forEach((overlay, index) => {
    const key = rawKeys[index];
    if (
      typeof key !== 'string'
      || bodyReferenceOverlayKey(overlay.profileId, overlay.baseProfileFingerprint) !== key
    ) throw new Error('stored body-reference key does not match its overlay');
  });
  return overlays.sort((left, right) => (
    bodyReferenceOverlayKey(left.profileId, left.baseProfileFingerprint)
      .localeCompare(bodyReferenceOverlayKey(right.profileId, right.baseProfileFingerprint))
  ));
}

export async function saveBodyReferenceOverlay(value: unknown): Promise<StoredBodyReferenceOverlay> {
  const overlay = await verifyBodyReferenceOverlay(value);
  return runBodyReferenceOverlayExclusive(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(
          overlay,
          bodyReferenceOverlayKey(overlay.profileId, overlay.baseProfileFingerprint)
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB body-reference write failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB body-reference write aborted'));
      });
      return overlay;
    } finally {
      database.close();
    }
  });
}

export async function removeBodyReferenceOverlay(
  rawProfileId: string,
  rawBaseFingerprint: string
): Promise<void> {
  const key = bodyReferenceOverlayKey(rawProfileId, rawBaseFingerprint);
  await runBodyReferenceOverlayExclusive(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB body-reference delete failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB body-reference delete aborted'));
      });
    } finally {
      database.close();
    }
  });
}
