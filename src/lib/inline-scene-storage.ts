import {
  inlineSceneImageRequestKey,
  normalizeInlineSceneImageRequest,
  type InlineSceneImageRequest,
  type InlineSceneModelTemplate
} from './inline-scene.ts';
import {
  buildInlineSceneVideoRequest,
  inlineSceneVideoReferencesSha256,
  normalizeInlineSceneVideoReference,
  type InlineSceneVideoReference
} from './inline-scene-video.ts';

// v7: the scene is a description plus the prepared reference set; there is no still.
export const STORED_INLINE_SCENE_SPEC = 'mullet_stored_inline_scene_v7' as const;
export const STORED_INLINE_SCENE_ENVELOPE_SPEC = 'mullet_stored_inline_scene_envelope_v7' as const;

export class StoredInlineSceneIntegrityError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'stored inline-scene integrity verification failed');
    this.name = 'StoredInlineSceneIntegrityError';
  }
}

export type StoredInlineScene = {
  spec: typeof STORED_INLINE_SCENE_SPEC;
  conversationId: string;
  epoch: string;
  requestKey: string;
  request: InlineSceneImageRequest;
  modelTemplate: InlineSceneModelTemplate;
  generatedAt: number;
  references: InlineSceneVideoReference[];
  referencesSha256: string;
};

type StoredInlineSceneEnvelope = {
  spec: typeof STORED_INLINE_SCENE_ENVELOPE_SPEC;
  writeId: string;
  scene: StoredInlineScene;
};

export type InlineSceneWriteReceipt = { writeId: string; previousRaw: unknown | null };
export type InlineSceneExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

export type InlineSceneCommitOperations = {
  save: (scene: StoredInlineScene) => Promise<InlineSceneWriteReceipt>;
  isCurrent: () => boolean;
  rollback: (receipt: InlineSceneWriteReceipt) => Promise<void>;
  install: (scene: StoredInlineScene, receipt: InlineSceneWriteReceipt) => void;
  exclusive: InlineSceneExclusiveRunner;
};

export type InlineSceneRestoreOperations = {
  load: () => Promise<unknown | null>;
  discardInvalid: () => Promise<void>;
  isCurrent: () => boolean;
  accepts: (scene: StoredInlineScene) => boolean;
  install: (scene: StoredInlineScene) => void;
  exclusive: InlineSceneExclusiveRunner;
};

const DATABASE_NAME = 'mullet-inline-scenes';
const STORE_NAME = 'state';
const ACTIVE_SCENE_KEY = 'active-inline-scene';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OBSOLETE_INLINE_SCENE_SPECS = new Set([
  'mullet_stored_inline_scene_v6',
  'mullet_stored_inline_scene_envelope_v6',
  'mullet_stored_inline_scene_v1',
  'mullet_stored_inline_scene_envelope_v1',
  'mullet_stored_inline_scene_v2',
  'mullet_stored_inline_scene_envelope_v2',
  'mullet_stored_inline_scene_v3',
  'mullet_stored_inline_scene_envelope_v3',
  'mullet_stored_inline_scene_v4',
  'mullet_stored_inline_scene_envelope_v4',
  'mullet_stored_inline_scene_v5',
  'mullet_stored_inline_scene_envelope_v5'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObsoleteStoredInlineScene(value: unknown): boolean {
  return isRecord(value)
    && typeof value.spec === 'string'
    && OBSOLETE_INLINE_SCENE_SPECS.has(value.spec);
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${name} is invalid`);
  return Number(value);
}

export function normalizeStoredInlineScene(value: unknown): StoredInlineScene {
  if (!isRecord(value) || value.spec !== STORED_INLINE_SCENE_SPEC) throw new Error('invalid stored inline scene');
  const request = normalizeInlineSceneImageRequest(value.request);
  if (value.conversationId !== request.source.conversationId) throw new Error('stored inline-scene source is invalid');
  if (typeof value.epoch !== 'string' || !UUID_PATTERN.test(value.epoch)) throw new Error('stored inline-scene epoch is invalid');
  const requestKey = inlineSceneImageRequestKey(request);
  if (value.requestKey !== requestKey) throw new Error('stored inline-scene request key is invalid');
  if (value.modelTemplate !== request.modelTemplate) {
    throw new Error('stored inline-scene template is invalid');
  }
  if (!Array.isArray(value.references) || value.references.length < 1) throw new Error('stored inline-scene references are invalid');
  const references = value.references.map((reference: unknown) => normalizeInlineSceneVideoReference(reference));
  if (typeof value.referencesSha256 !== 'string' || !SHA256_PATTERN.test(value.referencesSha256)) {
    throw new Error('stored inline-scene reference hash is invalid');
  }
  // The video request normalizer enforces that the references cover exactly the cast.
  const videoRequest = buildInlineSceneVideoRequest({
    conversationId: request.source.conversationId,
    epoch: value.epoch,
    request,
    references
  });
  if (inlineSceneVideoReferencesSha256(videoRequest) !== value.referencesSha256) {
    throw new Error('stored inline-scene reference hash does not match its references');
  }
  return {
    spec: STORED_INLINE_SCENE_SPEC,
    conversationId: value.conversationId,
    epoch: value.epoch,
    requestKey,
    request,
    modelTemplate: request.modelTemplate,
    generatedAt: safeInteger(value.generatedAt, 'stored inline-scene timestamp', 1, Number.MAX_SAFE_INTEGER),
    references,
    referencesSha256: value.referencesSha256
  };
}

export function unwrapStoredInlineScene(value: unknown): unknown | null {
  if (value === null) return null;
  if (isObsoleteStoredInlineScene(value)) return null;
  if (!isRecord(value) || value.spec !== STORED_INLINE_SCENE_ENVELOPE_SPEC) return value;
  if (typeof value.writeId !== 'string' || !value.writeId || value.writeId.length > 200 || !('scene' in value)) {
    throw new Error('stored inline-scene envelope is invalid');
  }
  return value.scene;
}

export async function verifyStoredInlineScene(value: unknown): Promise<StoredInlineScene> {
  // No bytes are stored with the scene any more; normalization is the whole verification.
  return normalizeStoredInlineScene(value);
}

export async function runStoredInlineSceneExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for inline-scene persistence');
  return lockManager.request('mullet-inline-scene-state', { mode: 'exclusive' }, operation);
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene open failed'));
    request.onblocked = () => reject(new Error('IndexedDB inline-scene upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredInlineScene(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_SCENE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredInlineScene(scene: StoredInlineScene): Promise<InlineSceneWriteReceipt> {
  const normalized = normalizeStoredInlineScene(scene);
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredInlineSceneEnvelope = { spec: STORED_INLINE_SCENE_ENVELOPE_SPEC, writeId, scene: normalized };
  const database = await openDatabase();
  let previousRaw: unknown | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_SCENE_KEY);
      request.onsuccess = () => {
        previousRaw = request.result ?? null;
        store.put(envelope, ACTIVE_SCENE_KEY);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene previous-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene write aborted'));
    });
    return { writeId, previousRaw };
  } finally {
    database.close();
  }
}

export async function rollbackStoredInlineSceneWrite(receipt: InlineSceneWriteReceipt): Promise<void> {
  if (!receipt.writeId || receipt.writeId.length > 200) throw new Error('inline-scene write ID is invalid');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_SCENE_KEY);
      request.onsuccess = () => {
        const candidate = request.result;
        if (isRecord(candidate) && candidate.spec === STORED_INLINE_SCENE_ENVELOPE_SPEC && candidate.writeId === receipt.writeId) {
          if (receipt.previousRaw === null) store.delete(ACTIVE_SCENE_KEY);
          else store.put(receipt.previousRaw, ACTIVE_SCENE_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB inline-scene rollback read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene rollback failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene rollback aborted'));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredInlineScene(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_SCENE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB inline-scene delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB inline-scene delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitStoredInlineScene(scene: StoredInlineScene, operations: InlineSceneCommitOperations): Promise<boolean> {
  return operations.exclusive(async () => {
    const verified = await verifyStoredInlineScene(scene);
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

export async function restoreStoredInlineScene(operations: InlineSceneRestoreOperations): Promise<StoredInlineScene | null> {
  return operations.exclusive(async () => {
    if (!operations.isCurrent()) return null;
    const stored = await operations.load();
    if (!operations.isCurrent() || stored === null) return null;
    if (isObsoleteStoredInlineScene(stored)) {
      await operations.discardInvalid();
      return null;
    }
    let verified: StoredInlineScene;
    try {
      verified = await verifyStoredInlineScene(unwrapStoredInlineScene(stored));
    } catch (cause) {
      await operations.discardInvalid();
      throw new StoredInlineSceneIntegrityError(cause);
    }
    if (!operations.accepts(verified) || !operations.isCurrent()) return null;
    operations.install(verified);
    return verified;
  });
}
