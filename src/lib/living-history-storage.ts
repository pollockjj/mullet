import {
  livingHistoryResultsMatch,
  normalizeLivingHistoryResult,
  type LivingHistoryResult
} from './living-history.ts';

const DATABASE_NAME = 'mullet-living-history';
const STORE_NAME = 'state';
const ACTIVE_HISTORY_KEY = 'active-history';

export type LivingHistoryCommitOperations = {
  save: (result: LivingHistoryResult) => Promise<void>;
  isCurrent: () => boolean;
  discard: (result: LivingHistoryResult) => Promise<void>;
  install: (result: LivingHistoryResult) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredLivingHistory(result: LivingHistoryResult): Promise<void> {
  const normalized = normalizeLivingHistoryResult(result);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(normalized, ACTIVE_HISTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history write aborted'));
    });
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

export async function clearStoredLivingHistoryIfResult(result: LivingHistoryResult): Promise<void> {
  const normalized = normalizeLivingHistoryResult(result);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_HISTORY_KEY);
      request.onsuccess = () => {
        const candidate = request.result;
        if (isRecord(candidate) && livingHistoryResultsMatch(candidate, normalized)) {
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
  await operations.save(normalized);
  if (!operations.isCurrent()) {
    await operations.discard(normalized);
    return false;
  }
  operations.install(normalized);
  return true;
}
