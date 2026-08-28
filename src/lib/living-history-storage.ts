import {
  normalizeLivingHistoryResult,
  type LivingHistoryResult
} from './living-history.ts';

const DATABASE_NAME = 'mullet-living-history';
const STORE_NAME = 'state';
const ACTIVE_HISTORY_KEY = 'active-history';
export const STORED_LIVING_HISTORY_SPEC = 'mullet_stored_living_history_v1' as const;

type StoredLivingHistoryEnvelope = {
  spec: typeof STORED_LIVING_HISTORY_SPEC;
  writeId: string;
  result: LivingHistoryResult;
};

export type LivingHistoryCommitOperations = {
  save: (result: LivingHistoryResult) => Promise<string>;
  isCurrent: () => boolean;
  discard: (writeId: string) => Promise<void>;
  install: (result: LivingHistoryResult) => void;
};

export type LivingHistoryRestoreOperations = {
  load: () => Promise<unknown | null>;
  isCurrent: () => boolean;
  accepts: (result: LivingHistoryResult) => boolean;
  discard: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapStoredLivingHistory(value: unknown): unknown | null {
  if (value === null || !isRecord(value) || value.spec !== STORED_LIVING_HISTORY_SPEC) return value;
  if (typeof value.writeId !== 'string' || value.writeId.length < 1 || value.writeId.length > 200 || !('result' in value)) {
    throw new Error('stored living-history envelope is invalid');
  }
  return value.result;
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history open failed'));
    request.onblocked = () => reject(new Error('IndexedDB living-history upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredLivingHistory(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_HISTORY_KEY);
      request.onsuccess = () => {
        try {
          resolve(unwrapStoredLivingHistory(request.result ?? null));
        } catch (cause) {
          reject(cause);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredLivingHistory(result: LivingHistoryResult): Promise<string> {
  const normalized = normalizeLivingHistoryResult(result);
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredLivingHistoryEnvelope = {
    spec: STORED_LIVING_HISTORY_SPEC,
    writeId,
    result: normalized
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(envelope, ACTIVE_HISTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history write aborted'));
    });
    return writeId;
  } finally {
    database.close();
  }
}

export async function clearStoredLivingHistory(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_HISTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredLivingHistoryIfWriteId(writeId: string): Promise<void> {
  if (!writeId || writeId.length > 200) throw new Error('living-history write ID is invalid');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_HISTORY_KEY);
      request.onsuccess = () => {
        const candidate = request.result;
        if (
          isRecord(candidate)
          && candidate.spec === STORED_LIVING_HISTORY_SPEC
          && candidate.writeId === writeId
        ) {
          store.delete(ACTIVE_HISTORY_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history conditional read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history conditional delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history conditional delete aborted'));
    });
  } finally {
    database.close();
  }
}

export async function commitLivingHistoryResult(
  result: LivingHistoryResult,
  operations: LivingHistoryCommitOperations
): Promise<boolean> {
  const normalized = normalizeLivingHistoryResult(result);
  if (!operations.isCurrent()) return false;
  const writeId = await operations.save(normalized);
  if (!operations.isCurrent()) {
    await operations.discard(writeId);
    return false;
  }
  operations.install(normalized);
  return true;
}

export async function restoreLivingHistoryResult(
  operations: LivingHistoryRestoreOperations
): Promise<LivingHistoryResult | null> {
  const stored = await operations.load();
  if (!operations.isCurrent() || stored === null) return null;
  const normalized = normalizeLivingHistoryResult(stored);
  if (!operations.accepts(normalized)) {
    await operations.discard();
    return null;
  }
  if (!operations.isCurrent()) return null;
  return normalized;
}
