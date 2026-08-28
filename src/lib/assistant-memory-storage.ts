import {
  assistantMemoryEmptyFingerprint,
  assistantMemoryStateFingerprint,
  normalizeAssistantMemoryResult,
  type AssistantMemoryResult
} from './assistant-memory.ts';

const DATABASE_NAME = 'mullet-personal-assistant-memory';
const STORE_NAME = 'state';
const ACTIVE_MEMORY_KEY = 'active-memory';
const LOCK_NAME = 'mullet-personal-assistant-memory-state';
export const ASSISTANT_MEMORY_DATABASE_VERSION = 1 as const;
export const STORED_ASSISTANT_MEMORY_SPEC = 'mullet_stored_assistant_memory_v1' as const;

export class AssistantMemoryConflictError extends Error {
  constructor(message = 'Another tab updated assistant memory from the same prior revision.') {
    super(message);
    this.name = 'AssistantMemoryConflictError';
  }
}

type StoredAssistantMemoryEnvelope = {
  spec: typeof STORED_ASSISTANT_MEMORY_SPEC;
  writeId: string;
  epoch: string;
  result: AssistantMemoryResult;
};

export type AssistantMemoryWriteReceipt = {
  writeId: string;
  previousRaw: unknown | null;
};

export type AssistantMemoryExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

export type AssistantMemoryClearOperations = {
  exclusive: AssistantMemoryExclusiveRunner;
  publishEpoch: (epoch: string) => void;
  clear: () => Promise<void>;
};

export type AssistantMemoryCommitOperations = {
  save: (result: AssistantMemoryResult) => Promise<AssistantMemoryWriteReceipt>;
  isCurrent: () => boolean;
  discard: (receipt: AssistantMemoryWriteReceipt) => Promise<void>;
  install: (result: AssistantMemoryResult, receipt: AssistantMemoryWriteReceipt) => void;
  exclusive?: AssistantMemoryExclusiveRunner;
};

export type AssistantMemoryRestoreOperations = {
  load: () => Promise<unknown | null>;
  isCurrent: () => boolean;
  accepts: (result: AssistantMemoryResult) => boolean;
  install: (result: AssistantMemoryResult) => void;
  exclusive?: AssistantMemoryExclusiveRunner;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedStorageId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function assistantMemoryWriteBaseMatches(
  persistedResult: unknown | null,
  candidate: AssistantMemoryResult
): boolean {
  const normalized = normalizeAssistantMemoryResult(candidate);
  if (persistedResult === null) {
    return normalized.parentFingerprint === assistantMemoryEmptyFingerprint(normalized.memoryId);
  }
  try {
    const persisted = normalizeAssistantMemoryResult(persistedResult);
    return persisted.memoryId === normalized.memoryId
      && assistantMemoryStateFingerprint(persisted) === normalized.parentFingerprint;
  } catch {
    return false;
  }
}

export function unwrapStoredAssistantMemory(
  value: unknown,
  expectedEpoch: string
): AssistantMemoryResult | null {
  const normalizedEpoch = boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  if (value === null) return null;
  if (!isRecord(value) || value.spec !== STORED_ASSISTANT_MEMORY_SPEC) return null;
  const writeId = boundedStorageId(value.writeId, 'stored assistant-memory write ID');
  const epoch = boundedStorageId(value.epoch, 'stored assistant-memory epoch');
  if (!writeId || epoch !== normalizedEpoch) return null;
  if (!Object.hasOwn(value, 'result')) throw new Error('stored assistant-memory envelope is invalid');
  return normalizeAssistantMemoryResult(value.result);
}

export async function runStoredAssistantMemoryExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for assistant-memory persistence');
  return lockManager.request(LOCK_NAME, { mode: 'exclusive' }, operation);
}

export async function clearAssistantMemoryAtEpoch(
  nextEpoch: string,
  operations: AssistantMemoryClearOperations
): Promise<void> {
  const normalizedEpoch = boundedStorageId(nextEpoch, 'assistant-memory epoch');
  await operations.exclusive(async () => {
    operations.publishEpoch(normalizedEpoch);
    await operations.clear();
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, ASSISTANT_MEMORY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB assistant-memory open failed'));
    request.onblocked = () => reject(new Error('IndexedDB assistant-memory upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredAssistantMemory(expectedEpoch: string): Promise<AssistantMemoryResult | null> {
  boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  const database = await openDatabase();
  let loaded: AssistantMemoryResult | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_MEMORY_KEY);
      request.onsuccess = () => {
        try {
          loaded = unwrapStoredAssistantMemory(request.result ?? null, expectedEpoch);
        } catch (cause) {
          reject(cause);
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB assistant-memory read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory read aborted'));
    });
    return loaded;
  } finally {
    database.close();
  }
}

export async function saveStoredAssistantMemory(
  result: AssistantMemoryResult,
  epoch: string
): Promise<AssistantMemoryWriteReceipt> {
  const normalized = normalizeAssistantMemoryResult(result);
  const normalizedEpoch = boundedStorageId(epoch, 'assistant-memory epoch');
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredAssistantMemoryEnvelope = {
    spec: STORED_ASSISTANT_MEMORY_SPEC,
    writeId,
    epoch: normalizedEpoch,
    result: normalized
  };
  const database = await openDatabase();
  let previousRaw: unknown | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_MEMORY_KEY);
      let failure: unknown = null;
      request.onsuccess = () => {
        try {
          previousRaw = request.result ?? null;
          const unwrapped = unwrapStoredAssistantMemory(previousRaw, normalizedEpoch);
          if (previousRaw !== null && unwrapped === null) {
            throw new AssistantMemoryConflictError('The persisted assistant-memory epoch changed before this update committed.');
          }
          if (!assistantMemoryWriteBaseMatches(unwrapped, normalized)) throw new AssistantMemoryConflictError();
          store.put(envelope, ACTIVE_MEMORY_KEY);
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB assistant-memory previous-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory write failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('IndexedDB assistant-memory write aborted'));
    });
    return { writeId, previousRaw };
  } finally {
    database.close();
  }
}

export async function clearStoredAssistantMemory(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_MEMORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function rollbackStoredAssistantMemoryWrite(receipt: AssistantMemoryWriteReceipt): Promise<void> {
  boundedStorageId(receipt.writeId, 'assistant-memory write ID');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_MEMORY_KEY);
      request.onsuccess = () => {
        const candidate = request.result;
        if (
          isRecord(candidate)
          && candidate.spec === STORED_ASSISTANT_MEMORY_SPEC
          && candidate.writeId === receipt.writeId
        ) {
          if (receipt.previousRaw === null) store.delete(ACTIVE_MEMORY_KEY);
          else store.put(receipt.previousRaw, ACTIVE_MEMORY_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB assistant-memory conditional read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory conditional rollback failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory conditional rollback aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitAssistantMemoryResult(
  result: AssistantMemoryResult,
  operations: AssistantMemoryCommitOperations
): Promise<boolean> {
  const execute = async () => {
    const normalized = normalizeAssistantMemoryResult(result);
    if (!operations.isCurrent()) return false;
    const receipt = await operations.save(normalized);
    if (!operations.isCurrent()) {
      await operations.discard(receipt);
      return false;
    }
    operations.install(normalized, receipt);
    return true;
  };
  return operations.exclusive ? operations.exclusive(execute) : execute();
}

export async function restoreAssistantMemoryResult(
  operations: AssistantMemoryRestoreOperations
): Promise<AssistantMemoryResult | null> {
  const execute = async () => {
    if (!operations.isCurrent()) return null;
    const stored = await operations.load();
    if (!operations.isCurrent() || stored === null) return null;
    const normalized = normalizeAssistantMemoryResult(stored);
    if (!operations.accepts(normalized) || !operations.isCurrent()) return null;
    operations.install(normalized);
    return normalized;
  };
  return operations.exclusive ? operations.exclusive(execute) : execute();
}
