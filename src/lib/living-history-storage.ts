import {
  LIVING_HISTORY_EMPTY_STATE_FINGERPRINT,
  LIVING_HISTORY_RESULT_SPEC,
  livingHistoryStateFingerprint,
  normalizeLivingHistoryResult,
  type LivingHistoryResult
} from './living-history.ts';

const DATABASE_NAME = 'mullet-living-history';
const STORE_NAME = 'state';
const ACTIVE_HISTORY_KEY = 'active-history';
export const LIVING_HISTORY_DATABASE_VERSION = 2 as const;
export const STORED_LIVING_HISTORY_SPEC = 'mullet_stored_living_history_v1' as const;

export class LivingHistoryConflictError extends Error {
  constructor(message = 'Another tab updated living history from the same prior revision.') {
    super(message);
    this.name = 'LivingHistoryConflictError';
  }
}

type StoredLivingHistoryEnvelope = {
  spec: typeof STORED_LIVING_HISTORY_SPEC;
  writeId: string;
  epoch: string;
  result: LivingHistoryResult;
};

export type LivingHistoryWriteReceipt = {
  writeId: string;
  previousRaw: unknown | null;
};

export type LivingHistoryExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;

export type LivingHistoryClearOperations = {
  exclusive: LivingHistoryExclusiveRunner;
  publishEpoch: (epoch: string) => void;
  clear: () => Promise<void>;
};

export type LivingHistoryCommitOperations = {
  save: (result: LivingHistoryResult) => Promise<LivingHistoryWriteReceipt>;
  isCurrent: () => boolean;
  discard: (receipt: LivingHistoryWriteReceipt) => Promise<void>;
  install: (result: LivingHistoryResult, receipt: LivingHistoryWriteReceipt) => void;
  exclusive?: LivingHistoryExclusiveRunner;
};

export type LivingHistoryRestoreOperations = {
  load: () => Promise<unknown | null>;
  isCurrent: () => boolean;
  accepts: (result: LivingHistoryResult) => boolean;
  install: (result: LivingHistoryResult) => void;
  exclusive?: LivingHistoryExclusiveRunner;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateStoredLivingHistoryResult(value: unknown): LivingHistoryResult {
  if (
    isRecord(value)
    && (value.spec === 'mullet_living_history_result_v1' || value.spec === 'mullet_living_history_result_v2')
    && isRecord(value.output)
  ) {
    return normalizeLivingHistoryResult({
      ...value,
      spec: LIVING_HISTORY_RESULT_SPEC,
      parentFingerprint: LIVING_HISTORY_EMPTY_STATE_FINGERPRINT,
      output: {
        ...value.output,
        quotes: value.spec === 'mullet_living_history_result_v1' ? [] : value.output.quotes,
        characters: []
      }
    });
  }
  return normalizeLivingHistoryResult(value);
}

export function livingHistoryWriteBaseMatches(
  persistedResult: unknown | null,
  candidate: LivingHistoryResult
): boolean {
  const normalized = normalizeLivingHistoryResult(candidate);
  const persistedFingerprint = persistedResult === null
    ? LIVING_HISTORY_EMPTY_STATE_FINGERPRINT
    : livingHistoryStateFingerprint(migrateStoredLivingHistoryResult(persistedResult));
  return persistedFingerprint === normalized.parentFingerprint;
}

function boundedStorageId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function unwrapStoredLivingHistory(
  value: unknown,
  expectedEpoch: string | null = null,
  allowLegacy = true
): unknown | null {
  if (expectedEpoch !== null) boundedStorageId(expectedEpoch, 'living-history epoch');
  if (value === null) return null;
  if (!isRecord(value) || value.spec !== STORED_LIVING_HISTORY_SPEC) {
    return expectedEpoch !== null && !allowLegacy ? null : value;
  }
  if (typeof value.writeId !== 'string' || value.writeId.length < 1 || value.writeId.length > 200 || !('result' in value)) {
    throw new Error('stored living-history envelope is invalid');
  }
  if (value.epoch === undefined) return expectedEpoch !== null && !allowLegacy ? null : value.result;
  const storedEpoch = boundedStorageId(value.epoch, 'stored living-history epoch');
  if (expectedEpoch !== null && storedEpoch !== expectedEpoch) return null;
  return value.result;
}

export async function runStoredLivingHistoryExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for living-history persistence');
  return lockManager.request('mullet-living-history-state', { mode: 'exclusive' }, operation);
}

export async function clearLivingHistoryAtEpoch(
  nextEpoch: string,
  operations: LivingHistoryClearOperations
): Promise<void> {
  const normalizedEpoch = boundedStorageId(nextEpoch, 'living-history epoch');
  await operations.exclusive(async () => {
    operations.publishEpoch(normalizedEpoch);
    await operations.clear();
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, LIVING_HISTORY_DATABASE_VERSION);
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

export async function loadStoredLivingHistory(expectedEpoch: string, allowLegacy = false): Promise<unknown | null> {
  boundedStorageId(expectedEpoch, 'living-history epoch');
  const database = await openDatabase();
  let loaded: LivingHistoryResult | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_HISTORY_KEY);
      request.onsuccess = () => {
        try {
          const raw = request.result ?? null;
          const unwrapped = unwrapStoredLivingHistory(raw, expectedEpoch, allowLegacy);
          if (unwrapped !== null) {
            loaded = migrateStoredLivingHistoryResult(unwrapped);
            const epochBound = isRecord(raw)
              && raw.spec === STORED_LIVING_HISTORY_SPEC
              && typeof raw.epoch === 'string';
            const currentPayload = isRecord(unwrapped)
              && unwrapped.spec === LIVING_HISTORY_RESULT_SPEC
              && typeof unwrapped.parentFingerprint === 'string'
              && isRecord(unwrapped.output)
              && Array.isArray(unwrapped.output.characters);
            if (!epochBound || !currentPayload) {
              store.put({
                spec: STORED_LIVING_HISTORY_SPEC,
                writeId: globalThis.crypto.randomUUID(),
                epoch: expectedEpoch,
                result: loaded
              } satisfies StoredLivingHistoryEnvelope, ACTIVE_HISTORY_KEY);
            }
          }
        } catch (cause) {
          reject(cause);
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB living-history read aborted'));
    });
    return loaded;
  } finally {
    database.close();
  }
}

export async function saveStoredLivingHistory(
  result: LivingHistoryResult,
  epoch: string
): Promise<LivingHistoryWriteReceipt> {
  const normalized = normalizeLivingHistoryResult(result);
  const normalizedEpoch = boundedStorageId(epoch, 'living-history epoch');
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredLivingHistoryEnvelope = {
    spec: STORED_LIVING_HISTORY_SPEC,
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
      const request = store.get(ACTIVE_HISTORY_KEY);
      let failure: unknown = null;
      request.onsuccess = () => {
        try {
          previousRaw = request.result ?? null;
          const unwrapped = unwrapStoredLivingHistory(previousRaw, normalizedEpoch, true);
          if (previousRaw !== null && unwrapped === null) {
            throw new LivingHistoryConflictError('The persisted living-history epoch changed before this update committed.');
          }
          if (!livingHistoryWriteBaseMatches(unwrapped, normalized)) throw new LivingHistoryConflictError();
          store.put(envelope, ACTIVE_HISTORY_KEY);
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB living-history previous-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB living-history write failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('IndexedDB living-history write aborted'));
    });
    return { writeId, previousRaw };
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

export async function rollbackStoredLivingHistoryWrite(receipt: LivingHistoryWriteReceipt): Promise<void> {
  if (!receipt.writeId || receipt.writeId.length > 200) throw new Error('living-history write ID is invalid');
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
          && candidate.writeId === receipt.writeId
        ) {
          if (receipt.previousRaw === null) store.delete(ACTIVE_HISTORY_KEY);
          else store.put(receipt.previousRaw, ACTIVE_HISTORY_KEY);
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
  const execute = async () => {
    const normalized = normalizeLivingHistoryResult(result);
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

export async function restoreLivingHistoryResult(
  operations: LivingHistoryRestoreOperations
): Promise<LivingHistoryResult | null> {
  const execute = async () => {
    if (!operations.isCurrent()) return null;
    const stored = await operations.load();
    if (!operations.isCurrent() || stored === null) return null;
    const normalized = normalizeLivingHistoryResult(stored);
    if (!operations.accepts(normalized) || !operations.isCurrent()) return null;
    operations.install(normalized);
    return normalized;
  };
  return operations.exclusive ? operations.exclusive(execute) : execute();
}
