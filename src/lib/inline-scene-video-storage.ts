import {
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  INLINE_SCENE_VIDEO_FPS,
  INLINE_SCENE_VIDEO_FRAMES,
  INLINE_SCENE_VIDEO_MODE,
  INLINE_SCENE_VIDEO_TEMPLATE_ID,
  inlineSceneVideoDimensions,
  inlineSceneVideoRequestKey,
  normalizeInlineSceneVideoRequest,
  type InlineSceneVideoRequest
} from './inline-scene-video.ts';

export const STORED_INLINE_SCENE_VIDEO_SPEC = 'mullet_stored_inline_scene_video_v1' as const;
export const STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC = 'mullet_stored_inline_scene_video_envelope_v1' as const;

export class StoredInlineSceneVideoIntegrityError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'stored inline-scene video integrity verification failed');
    this.name = 'StoredInlineSceneVideoIntegrityError';
  }
}

export type StoredInlineSceneVideo = {
  spec: typeof STORED_INLINE_SCENE_VIDEO_SPEC;
  conversationId: string;
  epoch: string;
  requestKey: string;
  request: InlineSceneVideoRequest;
  modelTemplate: typeof INLINE_SCENE_VIDEO_TEMPLATE_ID;
  mode: typeof INLINE_SCENE_VIDEO_MODE;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  frames: typeof INLINE_SCENE_VIDEO_FRAMES;
  fps: typeof INLINE_SCENE_VIDEO_FPS;
  durationSeconds: typeof INLINE_SCENE_VIDEO_DURATION_SECONDS;
  generatedAt: number;
  inputImageSha256: string;
  videoSha256: string;
  video: Blob;
};

type StoredInlineSceneVideoEnvelope = {
  spec: typeof STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC;
  writeId: string;
  video: StoredInlineSceneVideo;
};

export type InlineSceneVideoWriteReceipt = {
  writeId: string;
  previousRaw: unknown | null;
};

export type InlineSceneVideoExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

export type InlineSceneVideoCommitOperations = {
  save: (video: StoredInlineSceneVideo) => Promise<InlineSceneVideoWriteReceipt>;
  isCurrent: () => boolean;
  rollback: (receipt: InlineSceneVideoWriteReceipt) => Promise<void>;
  install: (video: StoredInlineSceneVideo, receipt: InlineSceneVideoWriteReceipt) => void;
  exclusive: InlineSceneVideoExclusiveRunner;
};

export type InlineSceneVideoRestoreOperations = {
  load: () => Promise<unknown | null>;
  discardInvalid: () => Promise<void>;
  isCurrent: () => boolean;
  accepts: (video: StoredInlineSceneVideo) => boolean;
  install: (video: StoredInlineSceneVideo) => void;
  exclusive: InlineSceneVideoExclusiveRunner;
};

const DATABASE_NAME = 'mullet-inline-scene-videos';
const STORE_NAME = 'state';
const ACTIVE_VIDEO_KEY = 'active-inline-scene-video';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(name + ' is invalid');
  }
  return Number(value);
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(name + ' is invalid');
  return value;
}

export function normalizeStoredInlineSceneVideo(value: unknown): StoredInlineSceneVideo {
  if (!isRecord(value) || value.spec !== STORED_INLINE_SCENE_VIDEO_SPEC) {
    throw new Error('invalid stored inline-scene video');
  }
  const request = normalizeInlineSceneVideoRequest(value.request);
  if (
    value.conversationId !== request.source.conversationId
    || value.epoch !== request.source.epoch
  ) throw new Error('stored inline-scene video source is invalid');
  const requestKey = inlineSceneVideoRequestKey(request);
  if (value.requestKey !== requestKey) throw new Error('stored inline-scene video request key is invalid');
  if (value.modelTemplate !== request.modelTemplate || value.modelTemplate !== INLINE_SCENE_VIDEO_TEMPLATE_ID) {
    throw new Error('stored inline-scene video template is invalid');
  }
  if (value.mode !== request.mode || value.mode !== INLINE_SCENE_VIDEO_MODE) {
    throw new Error('stored inline-scene video mode is invalid');
  }
  if (typeof value.promptId !== 'string' || !UUID_PATTERN.test(value.promptId)) {
    throw new Error('stored inline-scene video prompt ID is invalid');
  }
  const expected = inlineSceneVideoDimensions(request.aspectRatio);
  const width = safeInteger(value.width, 'stored inline-scene video width', 16, 8192);
  const height = safeInteger(value.height, 'stored inline-scene video height', 16, 8192);
  if (width !== expected.width || height !== expected.height) {
    throw new Error('stored inline-scene video dimensions are invalid');
  }
  if (
    value.frames !== INLINE_SCENE_VIDEO_FRAMES
    || value.fps !== INLINE_SCENE_VIDEO_FPS
    || value.durationSeconds !== INLINE_SCENE_VIDEO_DURATION_SECONDS
  ) throw new Error('stored inline-scene video timing is invalid');
  const inputImageSha256 = sha256(value.inputImageSha256, 'stored inline-scene video input hash');
  if (inputImageSha256 !== request.source.sceneImageSha256) {
    throw new Error('stored inline-scene video input hash does not match its request');
  }
  const videoSha256 = sha256(value.videoSha256, 'stored inline-scene video output hash');
  if (
    !(value.video instanceof Blob)
    || value.video.type !== 'video/webm'
    || value.video.size < 4
    || value.video.size > 64 * 1024 * 1024
  ) throw new Error('stored inline-scene video is invalid');
  return {
    spec: STORED_INLINE_SCENE_VIDEO_SPEC,
    conversationId: request.source.conversationId,
    epoch: request.source.epoch,
    requestKey,
    request,
    modelTemplate: INLINE_SCENE_VIDEO_TEMPLATE_ID,
    mode: INLINE_SCENE_VIDEO_MODE,
    promptId: value.promptId,
    seed: safeInteger(value.seed, 'stored inline-scene video seed', 0, Number.MAX_SAFE_INTEGER),
    width,
    height,
    frames: INLINE_SCENE_VIDEO_FRAMES,
    fps: INLINE_SCENE_VIDEO_FPS,
    durationSeconds: INLINE_SCENE_VIDEO_DURATION_SECONDS,
    generatedAt: safeInteger(value.generatedAt, 'stored inline-scene video timestamp', 1, Number.MAX_SAFE_INTEGER),
    inputImageSha256,
    videoSha256,
    video: value.video
  };
}

export function unwrapStoredInlineSceneVideo(value: unknown): unknown | null {
  if (value === null) return null;
  if (!isRecord(value) || value.spec !== STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC) return value;
  if (
    typeof value.writeId !== 'string'
    || value.writeId.length < 1
    || value.writeId.length > 200
    || !('video' in value)
  ) throw new Error('stored inline-scene video envelope is invalid');
  return value.video;
}

async function blobSha256(blob: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyStoredInlineSceneVideo(value: unknown): Promise<StoredInlineSceneVideo> {
  const video = normalizeStoredInlineSceneVideo(value);
  const signature = new Uint8Array(await video.video.slice(0, 4).arrayBuffer());
  if (
    signature[0] !== 0x1a
    || signature[1] !== 0x45
    || signature[2] !== 0xdf
    || signature[3] !== 0xa3
  ) throw new Error('stored inline-scene video has an invalid WebM signature');
  if (await blobSha256(video.video) !== video.videoSha256) {
    throw new Error('stored inline-scene video hash does not match its bytes');
  }
  return video;
}

export async function runStoredInlineSceneVideoExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for inline-scene video persistence');
  return lockManager.request('mullet-inline-scene-video-state', { mode: 'exclusive' }, operation);
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene video open failed'));
    request.onblocked = () => reject(new Error('IndexedDB inline-scene video upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredInlineSceneVideo(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_VIDEO_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene video read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredInlineSceneVideo(
  video: StoredInlineSceneVideo
): Promise<InlineSceneVideoWriteReceipt> {
  const normalized = normalizeStoredInlineSceneVideo(video);
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredInlineSceneVideoEnvelope = {
    spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC,
    writeId,
    video: normalized
  };
  const database = await openDatabase();
  let previousRaw: unknown | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_VIDEO_KEY);
      request.onsuccess = () => {
        previousRaw = request.result ?? null;
        store.put(envelope, ACTIVE_VIDEO_KEY);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene video previous-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video write aborted'));
    });
    return { writeId, previousRaw };
  } finally {
    database.close();
  }
}

export async function rollbackStoredInlineSceneVideoWrite(receipt: InlineSceneVideoWriteReceipt): Promise<void> {
  if (!receipt.writeId || receipt.writeId.length > 200) throw new Error('inline-scene video write ID is invalid');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_VIDEO_KEY);
      request.onsuccess = () => {
        const candidate = request.result;
        if (
          isRecord(candidate)
          && candidate.spec === STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC
          && candidate.writeId === receipt.writeId
        ) {
          if (receipt.previousRaw === null) store.delete(ACTIVE_VIDEO_KEY);
          else store.put(receipt.previousRaw, ACTIVE_VIDEO_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene video rollback read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video rollback failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video rollback aborted'));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredInlineSceneVideo(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_VIDEO_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene video delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitStoredInlineSceneVideo(
  video: StoredInlineSceneVideo,
  operations: InlineSceneVideoCommitOperations
): Promise<boolean> {
  return operations.exclusive(async () => {
    const verified = await verifyStoredInlineSceneVideo(video);
    if (!operations.isCurrent()) return false;
    const receipt = await operations.save(verified);
    if (!operations.isCurrent()) {
      await operations.rollback(receipt);
      return false;
    }
    operations.install(verified, receipt);
    return true;
  });
}

export async function restoreStoredInlineSceneVideo(
  operations: InlineSceneVideoRestoreOperations
): Promise<StoredInlineSceneVideo | null> {
  return operations.exclusive(async () => {
    if (!operations.isCurrent()) return null;
    const stored = await operations.load();
    if (!operations.isCurrent() || stored === null) return null;
    let verified: StoredInlineSceneVideo;
    try {
      verified = await verifyStoredInlineSceneVideo(unwrapStoredInlineSceneVideo(stored));
    } catch (cause) {
      await operations.discardInvalid();
      throw new StoredInlineSceneVideoIntegrityError(cause);
    }
    if (!operations.accepts(verified) || !operations.isCurrent()) return null;
    operations.install(verified);
    return verified;
  });
}
