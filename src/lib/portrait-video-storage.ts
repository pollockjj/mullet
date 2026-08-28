import {
  PORTRAIT_VIDEO_DURATION_SECONDS,
  PORTRAIT_VIDEO_FPS,
  PORTRAIT_VIDEO_FRAMES,
  PORTRAIT_END_FRAME_TEMPLATE_ID,
  PORTRAIT_VIDEO_MODE_GENERATED_FLF,
  PORTRAIT_VIDEO_TEMPLATE_ID,
  normalizePortraitVideoRequest,
  portraitVideoDimensions,
  portraitVideoEndFrameSeed,
  portraitVideoRequestKey,
  type PortraitVideoMode,
  type PortraitVideoRequest
} from './portrait-video.ts';

export const STORED_PORTRAIT_VIDEO_SPEC = 'mullet_stored_portrait_video_v3' as const;
export const STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC = 'mullet_stored_portrait_video_envelope_v3' as const;

export type PortraitVideoEndFrameProvenance = {
  modelTemplate: typeof PORTRAIT_END_FRAME_TEMPLATE_ID;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  imageSha256: string;
};

export type StoredPortraitVideo = {
  spec: typeof STORED_PORTRAIT_VIDEO_SPEC;
  conversationId: string;
  requestKey: string;
  request: PortraitVideoRequest;
  modelTemplate: typeof PORTRAIT_VIDEO_TEMPLATE_ID;
  mode: PortraitVideoMode;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  frames: typeof PORTRAIT_VIDEO_FRAMES;
  fps: typeof PORTRAIT_VIDEO_FPS;
  durationSeconds: typeof PORTRAIT_VIDEO_DURATION_SECONDS;
  generatedAt: number;
  inputImageSha256: string;
  endFrame: PortraitVideoEndFrameProvenance | null;
  videoSha256: string;
  video: Blob;
};

type StoredPortraitVideoEnvelope = {
  spec: typeof STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC;
  writeId: string;
  video: StoredPortraitVideo;
};

export type PortraitVideoWriteReceipt = {
  writeId: string;
  previousRaw: unknown | null;
};

export type PortraitVideoExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

export type PortraitVideoCommitOperations = {
  save: (video: StoredPortraitVideo) => Promise<PortraitVideoWriteReceipt>;
  isCurrent: () => boolean;
  rollback: (receipt: PortraitVideoWriteReceipt) => Promise<void>;
  install: (video: StoredPortraitVideo, receipt: PortraitVideoWriteReceipt) => void;
  exclusive: PortraitVideoExclusiveRunner;
};

export type PortraitVideoRestoreOperations = {
  load: () => Promise<unknown | null>;
  isCurrent: () => boolean;
  accepts: (video: StoredPortraitVideo) => boolean;
  install: (video: StoredPortraitVideo) => void;
  exclusive: PortraitVideoExclusiveRunner;
};

const DATABASE_NAME = 'mullet-portrait-videos';
const STORE_NAME = 'state';
const ACTIVE_VIDEO_KEY = 'active-portrait-video';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return Number(value);
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function normalizeEndFrame(
  value: unknown,
  request: PortraitVideoRequest,
  inputImageSha256: string,
  videoSeed: number
): PortraitVideoEndFrameProvenance | null {
  if (request.mode !== PORTRAIT_VIDEO_MODE_GENERATED_FLF) {
    if (value !== null) throw new Error('stored portrait-video end frame is invalid for its mode');
    return null;
  }
  if (!isRecord(value) || value.modelTemplate !== PORTRAIT_END_FRAME_TEMPLATE_ID) {
    throw new Error('stored portrait-video end-frame template is invalid');
  }
  if (typeof value.promptId !== 'string' || !UUID_PATTERN.test(value.promptId)) {
    throw new Error('stored portrait-video end-frame prompt ID is invalid');
  }
  const seed = safeInteger(value.seed, 'stored portrait-video end-frame seed', 0, Number.MAX_SAFE_INTEGER);
  if (seed !== portraitVideoEndFrameSeed(videoSeed)) throw new Error('stored portrait-video end-frame seed does not match its video');
  const width = safeInteger(value.width, 'stored portrait-video end-frame width', 16, 8192);
  const height = safeInteger(value.height, 'stored portrait-video end-frame height', 16, 8192);
  if (width !== request.source.portraitWidth || height !== request.source.portraitHeight) {
    throw new Error('stored portrait-video end-frame dimensions are invalid');
  }
  const imageSha256 = sha256(value.imageSha256, 'stored portrait-video end-frame hash');
  if (imageSha256 === inputImageSha256) throw new Error('stored portrait-video end-frame hash matches its source');
  return {
    modelTemplate: PORTRAIT_END_FRAME_TEMPLATE_ID,
    promptId: value.promptId,
    seed,
    width,
    height,
    imageSha256
  };
}

export function normalizeStoredPortraitVideo(value: unknown): StoredPortraitVideo {
  if (!isRecord(value) || value.spec !== STORED_PORTRAIT_VIDEO_SPEC) throw new Error('invalid stored portrait video');
  const request = normalizePortraitVideoRequest(value.request);
  if (value.conversationId !== request.source.conversationId) throw new Error('stored portrait-video source is invalid');
  const requestKey = portraitVideoRequestKey(request);
  if (value.requestKey !== requestKey) throw new Error('stored portrait-video request key is invalid');
  if (value.modelTemplate !== request.modelTemplate || value.modelTemplate !== PORTRAIT_VIDEO_TEMPLATE_ID) {
    throw new Error('stored portrait-video template is invalid');
  }
  if (value.mode !== request.mode) throw new Error('stored portrait-video mode is invalid');
  if (typeof value.promptId !== 'string' || !UUID_PATTERN.test(value.promptId)) {
    throw new Error('stored portrait-video prompt ID is invalid');
  }
  const seed = safeInteger(value.seed, 'stored portrait-video seed', 0, Number.MAX_SAFE_INTEGER);
  const expected = portraitVideoDimensions(request.aspectRatio);
  const width = safeInteger(value.width, 'stored portrait-video width', 16, 8192);
  const height = safeInteger(value.height, 'stored portrait-video height', 16, 8192);
  if (width !== expected.width || height !== expected.height) throw new Error('stored portrait-video dimensions are invalid');
  if (value.frames !== PORTRAIT_VIDEO_FRAMES || value.fps !== PORTRAIT_VIDEO_FPS || value.durationSeconds !== PORTRAIT_VIDEO_DURATION_SECONDS) {
    throw new Error('stored portrait-video timing is invalid');
  }
  const inputImageSha256 = sha256(value.inputImageSha256, 'stored portrait-video input hash');
  if (inputImageSha256 !== request.source.portraitImageSha256) throw new Error('stored portrait-video input hash does not match its request');
  const endFrame = normalizeEndFrame(value.endFrame, request, inputImageSha256, seed);
  const videoSha256 = sha256(value.videoSha256, 'stored portrait-video output hash');
  if (!(value.video instanceof Blob) || value.video.type !== 'video/webm' || value.video.size < 4 || value.video.size > 64 * 1024 * 1024) {
    throw new Error('stored portrait video is invalid');
  }
  return {
    spec: STORED_PORTRAIT_VIDEO_SPEC,
    conversationId: value.conversationId,
    requestKey,
    request,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    mode: request.mode,
    promptId: value.promptId,
    seed,
    width,
    height,
    frames: PORTRAIT_VIDEO_FRAMES,
    fps: PORTRAIT_VIDEO_FPS,
    durationSeconds: PORTRAIT_VIDEO_DURATION_SECONDS,
    generatedAt: safeInteger(value.generatedAt, 'stored portrait-video timestamp', 1, Number.MAX_SAFE_INTEGER),
    inputImageSha256,
    endFrame,
    videoSha256,
    video: value.video
  };
}

export function unwrapStoredPortraitVideo(value: unknown): unknown | null {
  if (value === null) return null;
  if (isRecord(value) && (
    value.spec === 'mullet_stored_portrait_video_v1'
    || value.spec === 'mullet_stored_portrait_video_v2'
    || value.spec === 'mullet_stored_portrait_video_envelope_v1'
    || value.spec === 'mullet_stored_portrait_video_envelope_v2'
  )) return null;
  if (!isRecord(value) || value.spec !== STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC) return value;
  if (typeof value.writeId !== 'string' || value.writeId.length < 1 || value.writeId.length > 200 || !('video' in value)) {
    throw new Error('stored portrait-video envelope is invalid');
  }
  return value.video;
}

export async function runStoredPortraitVideoExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for portrait-video persistence');
  return lockManager.request('mullet-portrait-video-state', { mode: 'exclusive' }, operation);
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video open failed'));
    request.onblocked = () => reject(new Error('IndexedDB portrait-video upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredPortraitVideo(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_VIDEO_KEY);
      request.onsuccess = () => resolve(unwrapStoredPortraitVideo(request.result ?? null));
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredPortraitVideo(video: StoredPortraitVideo): Promise<PortraitVideoWriteReceipt> {
  const normalized = normalizeStoredPortraitVideo(video);
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredPortraitVideoEnvelope = {
    spec: STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC,
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
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video previous-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait-video write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video write aborted'));
    });
    return { writeId, previousRaw };
  } finally {
    database.close();
  }
}

export async function rollbackStoredPortraitVideoWrite(receipt: PortraitVideoWriteReceipt): Promise<void> {
  if (!receipt.writeId || receipt.writeId.length > 200) throw new Error('portrait-video write ID is invalid');
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
          && candidate.spec === STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC
          && candidate.writeId === receipt.writeId
        ) {
          if (receipt.previousRaw === null) store.delete(ACTIVE_VIDEO_KEY);
          else store.put(receipt.previousRaw, ACTIVE_VIDEO_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video rollback read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait-video rollback failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video rollback aborted'));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredPortraitVideo(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_VIDEO_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait-video delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitStoredPortraitVideo(
  video: StoredPortraitVideo,
  operations: PortraitVideoCommitOperations
): Promise<boolean> {
  return operations.exclusive(async () => {
    const normalized = normalizeStoredPortraitVideo(video);
    if (!operations.isCurrent()) return false;
    const receipt = await operations.save(normalized);
    if (!operations.isCurrent()) {
      await operations.rollback(receipt);
      return false;
    }
    operations.install(normalized, receipt);
    return true;
  });
}

export async function restoreStoredPortraitVideo(
  operations: PortraitVideoRestoreOperations
): Promise<StoredPortraitVideo | null> {
  return operations.exclusive(async () => {
    if (!operations.isCurrent()) return null;
    const stored = await operations.load();
    if (!operations.isCurrent() || stored === null) return null;
    const normalized = normalizeStoredPortraitVideo(stored);
    if (!operations.accepts(normalized) || !operations.isCurrent()) return null;
    operations.install(normalized);
    return normalized;
  });
}
