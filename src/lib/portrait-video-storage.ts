import {
  PORTRAIT_VIDEO_DURATION_SECONDS,
  PORTRAIT_VIDEO_FPS,
  PORTRAIT_VIDEO_FRAMES,
  PORTRAIT_VIDEO_TEMPLATE_ID,
  isPortraitVideoSource,
  portraitVideoDimensions,
  type PortraitVideoSource
} from './portrait-video.ts';
import type { PortraitAspectRatio } from './portrait.ts';

export const STORED_PORTRAIT_VIDEO_SPEC = 'mullet_stored_portrait_video_v1' as const;

export type StoredPortraitVideo = {
  spec: typeof STORED_PORTRAIT_VIDEO_SPEC;
  conversationId: string;
  requestKey: string;
  source: PortraitVideoSource;
  modelTemplate: typeof PORTRAIT_VIDEO_TEMPLATE_ID;
  aspectRatio: PortraitAspectRatio;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  frames: typeof PORTRAIT_VIDEO_FRAMES;
  fps: typeof PORTRAIT_VIDEO_FPS;
  durationSeconds: typeof PORTRAIT_VIDEO_DURATION_SECONDS;
  generatedAt: number;
  video: Blob;
};

export type PortraitVideoCommitOperations = {
  save: (video: StoredPortraitVideo) => Promise<void>;
  isCurrent: () => boolean;
  discard: (video: StoredPortraitVideo) => Promise<void>;
  install: (video: StoredPortraitVideo) => void;
};

const DATABASE_NAME = 'mullet-portrait-videos';
const STORE_NAME = 'state';
const ACTIVE_VIDEO_KEY = 'active-portrait-video';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return Number(value);
}

export function normalizeStoredPortraitVideo(value: unknown): StoredPortraitVideo {
  if (!isRecord(value) || value.spec !== STORED_PORTRAIT_VIDEO_SPEC) throw new Error('invalid stored portrait video');
  if (!isPortraitVideoSource(value.source) || value.conversationId !== value.source.conversationId) {
    throw new Error('stored portrait-video source is invalid');
  }
  if (typeof value.requestKey !== 'string' || value.requestKey.length < 1 || value.requestKey.length > 5000) {
    throw new Error('stored portrait-video request key is invalid');
  }
  if (value.modelTemplate !== PORTRAIT_VIDEO_TEMPLATE_ID) throw new Error('stored portrait-video template is invalid');
  if (typeof value.promptId !== 'string' || !UUID_PATTERN.test(value.promptId)) {
    throw new Error('stored portrait-video prompt ID is invalid');
  }
  if (value.aspectRatio !== '2:3' && value.aspectRatio !== '3:4' && value.aspectRatio !== '4:5' && value.aspectRatio !== '9:16') {
    throw new Error('stored portrait-video aspect ratio is invalid');
  }
  const expected = portraitVideoDimensions(value.aspectRatio);
  const width = safeInteger(value.width, 'stored portrait-video width', 16, 8192);
  const height = safeInteger(value.height, 'stored portrait-video height', 16, 8192);
  if (width !== expected.width || height !== expected.height) throw new Error('stored portrait-video dimensions are invalid');
  if (value.frames !== PORTRAIT_VIDEO_FRAMES || value.fps !== PORTRAIT_VIDEO_FPS || value.durationSeconds !== PORTRAIT_VIDEO_DURATION_SECONDS) {
    throw new Error('stored portrait-video timing is invalid');
  }
  if (!(value.video instanceof Blob) || value.video.type !== 'video/webm' || value.video.size < 4 || value.video.size > 250 * 1024 * 1024) {
    throw new Error('stored portrait video is invalid');
  }
  return {
    spec: STORED_PORTRAIT_VIDEO_SPEC,
    conversationId: value.conversationId,
    requestKey: value.requestKey,
    source: value.source,
    modelTemplate: PORTRAIT_VIDEO_TEMPLATE_ID,
    aspectRatio: value.aspectRatio,
    promptId: value.promptId,
    seed: safeInteger(value.seed, 'stored portrait-video seed', 0, Number.MAX_SAFE_INTEGER),
    width,
    height,
    frames: PORTRAIT_VIDEO_FRAMES,
    fps: PORTRAIT_VIDEO_FPS,
    durationSeconds: PORTRAIT_VIDEO_DURATION_SECONDS,
    generatedAt: safeInteger(value.generatedAt, 'stored portrait-video timestamp', 1, Number.MAX_SAFE_INTEGER),
    video: value.video
  };
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
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredPortraitVideo(video: StoredPortraitVideo): Promise<void> {
  const normalized = normalizeStoredPortraitVideo(video);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(normalized, ACTIVE_VIDEO_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait-video write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video write aborted'));
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

export async function clearStoredPortraitVideoIfPromptId(promptId: string): Promise<void> {
  if (!UUID_PATTERN.test(promptId)) throw new Error('portrait-video prompt ID is invalid');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_VIDEO_KEY);
      request.onsuccess = () => {
        if (isRecord(request.result) && request.result.promptId === promptId) store.delete(ACTIVE_VIDEO_KEY);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait-video conditional read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait-video conditional delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait-video conditional delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitStoredPortraitVideo(
  video: StoredPortraitVideo,
  operations: PortraitVideoCommitOperations
): Promise<boolean> {
  const normalized = normalizeStoredPortraitVideo(video);
  if (!operations.isCurrent()) return false;
  await operations.save(normalized);
  if (!operations.isCurrent()) {
    await operations.discard(normalized);
    return false;
  }
  operations.install(normalized);
  return true;
}
