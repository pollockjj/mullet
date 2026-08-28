import {
  assistantMemoryEmptyFingerprint,
  assistantMemoryResultMatchesRequest,
  assistantMemoryStateFingerprint,
  buildAssistantMemoryRequestFromTurn,
  normalizeAssistantMemoryResult,
  type AssistantMemoryResult,
  type AssistantMemoryTurn
} from './assistant-memory.ts';
import { normalizeLivingHistorySource, type LivingHistorySource } from './living-history.ts';
import { sha256Hex } from './sha256.ts';

const DATABASE_NAME = 'mullet-personal-assistant-memory';
const STORE_NAME = 'state';
const ACTIVE_MEMORY_KEY = 'active-memory';
const PENDING_MEMORY_KEY = 'pending-turn';
const LOCK_NAME = 'mullet-personal-assistant-memory-state';
const TURN_LOCK_NAME = 'mullet-personal-assistant-turn';
export const ASSISTANT_MEMORY_DATABASE_VERSION = 1 as const;
export const STORED_ASSISTANT_MEMORY_SPEC = 'mullet_stored_assistant_memory_v1' as const;
export const STORED_ASSISTANT_MEMORY_PENDING_SPEC = 'mullet_pending_assistant_memory_turn_v1' as const;

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
  pendingRaw: unknown;
};

export type StoredAssistantMemoryPendingTurn = {
  spec: typeof STORED_ASSISTANT_MEMORY_PENDING_SPEC;
  memoryId: string;
  epoch: string;
  turnKey: string;
  source: LivingHistorySource;
  turns: [AssistantMemoryTurn, AssistantMemoryTurn];
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

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (
    !isRecord(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))
  ) throw new Error(`${name} has an invalid schema`);
  return value;
}

function boundedStorageId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function assistantMemoryTurnKey(memoryId: string, source: LivingHistorySource): string {
  const normalizedSource = normalizeLivingHistorySource(source);
  return `sha256:${sha256Hex(JSON.stringify([memoryId, normalizedSource]))}`;
}

export function normalizeStoredAssistantMemoryPendingTurn(value: unknown): StoredAssistantMemoryPendingTurn {
  const record = exactRecord(
    value,
    ['spec', 'memoryId', 'epoch', 'turnKey', 'source', 'turns'],
    'stored assistant-memory pending turn'
  );
  if (record.spec !== STORED_ASSISTANT_MEMORY_PENDING_SPEC) {
    throw new Error('stored assistant-memory pending turn spec is invalid');
  }
  const epoch = boundedStorageId(record.epoch, 'stored assistant-memory pending epoch');
  const request = buildAssistantMemoryRequestFromTurn(
    String(record.memoryId),
    record.source as LivingHistorySource,
    record.turns as [AssistantMemoryTurn, AssistantMemoryTurn],
    null
  );
  const turnKey = assistantMemoryTurnKey(request.memoryId, request.source);
  if (record.turnKey !== turnKey) throw new Error('stored assistant-memory pending turn key is invalid');
  return {
    spec: STORED_ASSISTANT_MEMORY_PENDING_SPEC,
    memoryId: request.memoryId,
    epoch,
    turnKey,
    source: request.source,
    turns: request.turns
  };
}

export function createStoredAssistantMemoryPendingTurn(
  memoryId: string,
  epoch: string,
  source: LivingHistorySource,
  turns: [AssistantMemoryTurn, AssistantMemoryTurn]
): StoredAssistantMemoryPendingTurn {
  return normalizeStoredAssistantMemoryPendingTurn({
    spec: STORED_ASSISTANT_MEMORY_PENDING_SPEC,
    memoryId,
    epoch,
    turnKey: assistantMemoryTurnKey(memoryId, source),
    source,
    turns
  });
}

export function assistantMemoryPendingMatchesResult(
  pending: StoredAssistantMemoryPendingTurn,
  persistedResult: AssistantMemoryResult | null,
  candidate: AssistantMemoryResult
): boolean {
  try {
    const normalizedPending = normalizeStoredAssistantMemoryPendingTurn(pending);
    const previous = persistedResult === null ? null : normalizeAssistantMemoryResult(persistedResult);
    const result = normalizeAssistantMemoryResult(candidate);
    if (
      normalizedPending.memoryId !== result.memoryId
      || (previous && previous.memoryId !== result.memoryId)
    ) return false;
    const request = buildAssistantMemoryRequestFromTurn(
      result.memoryId,
      normalizedPending.source,
      normalizedPending.turns,
      previous
    );
    return assistantMemoryResultMatchesRequest(result, request);
  } catch {
    return false;
  }
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
  expectedEpoch: string,
  expectedMemoryId: string
): AssistantMemoryResult | null {
  const normalizedEpoch = boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  const normalizedMemoryId = boundedStorageId(expectedMemoryId, 'assistant-memory ID');
  if (value === null) return null;
  if (!isRecord(value) || value.spec !== STORED_ASSISTANT_MEMORY_SPEC) return null;
  exactRecord(value, ['spec', 'writeId', 'epoch', 'result'], 'stored assistant-memory envelope');
  const writeId = boundedStorageId(value.writeId, 'stored assistant-memory write ID');
  const epoch = boundedStorageId(value.epoch, 'stored assistant-memory epoch');
  if (!writeId || epoch !== normalizedEpoch) return null;
  if (!Object.hasOwn(value, 'result')) throw new Error('stored assistant-memory envelope is invalid');
  const result = normalizeAssistantMemoryResult(value.result);
  return result.memoryId === normalizedMemoryId ? result : null;
}

export function unwrapStoredAssistantMemoryPendingTurn(
  value: unknown,
  expectedEpoch: string,
  expectedMemoryId: string
): StoredAssistantMemoryPendingTurn | null {
  const normalizedEpoch = boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  const normalizedMemoryId = boundedStorageId(expectedMemoryId, 'assistant-memory ID');
  if (value === null || !isRecord(value) || value.spec !== STORED_ASSISTANT_MEMORY_PENDING_SPEC) return null;
  const pending = normalizeStoredAssistantMemoryPendingTurn(value);
  return pending.epoch === normalizedEpoch && pending.memoryId === normalizedMemoryId ? pending : null;
}

export async function runStoredAssistantMemoryExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for assistant-memory persistence');
  return lockManager.request(LOCK_NAME, { mode: 'exclusive' }, operation);
}

export async function runPersonalAssistantTurnExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('browser Web Locks are required for personal-assistant turn serialization');
  return lockManager.request(TURN_LOCK_NAME, { mode: 'exclusive' }, operation);
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

export async function loadStoredAssistantMemory(
  expectedEpoch: string,
  expectedMemoryId: string
): Promise<AssistantMemoryResult | null> {
  boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  boundedStorageId(expectedMemoryId, 'assistant-memory ID');
  const database = await openDatabase();
  let loaded: AssistantMemoryResult | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_MEMORY_KEY);
      request.onsuccess = () => {
        try {
          loaded = unwrapStoredAssistantMemory(request.result ?? null, expectedEpoch, expectedMemoryId);
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

export async function loadStoredAssistantMemoryPendingTurn(
  expectedEpoch: string,
  expectedMemoryId: string
): Promise<StoredAssistantMemoryPendingTurn | null> {
  boundedStorageId(expectedEpoch, 'assistant-memory epoch');
  boundedStorageId(expectedMemoryId, 'assistant-memory ID');
  const database = await openDatabase();
  let loaded: StoredAssistantMemoryPendingTurn | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(PENDING_MEMORY_KEY);
      request.onsuccess = () => {
        try {
          loaded = unwrapStoredAssistantMemoryPendingTurn(request.result ?? null, expectedEpoch, expectedMemoryId);
        } catch (cause) {
          reject(cause);
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB assistant-memory pending read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory pending read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory pending read aborted'));
    });
    return loaded;
  } finally {
    database.close();
  }
}

export async function saveStoredAssistantMemoryPendingTurn(
  pending: StoredAssistantMemoryPendingTurn
): Promise<boolean> {
  const normalized = normalizeStoredAssistantMemoryPendingTurn(pending);
  const database = await openDatabase();
  let inserted = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const activeRequest = store.get(ACTIVE_MEMORY_KEY);
      const pendingRequest = store.get(PENDING_MEMORY_KEY);
      let activeRaw: unknown | null = null;
      let pendingRaw: unknown | null = null;
      let completedReads = 0;
      let failure: unknown = null;
      const finish = () => {
        completedReads += 1;
        if (completedReads !== 2) return;
        try {
          const active = unwrapStoredAssistantMemory(activeRaw, normalized.epoch, normalized.memoryId);
          if (activeRaw !== null && active === null) {
            throw new AssistantMemoryConflictError('The persisted assistant-memory generation does not match this pending turn.');
          }
          const currentPending = unwrapStoredAssistantMemoryPendingTurn(
            pendingRaw,
            normalized.epoch,
            normalized.memoryId
          );
          if (pendingRaw !== null && currentPending === null) {
            throw new AssistantMemoryConflictError('The persisted assistant-memory pending generation changed.');
          }
          if (currentPending) {
            if (currentPending.turnKey !== normalized.turnKey) {
              throw new AssistantMemoryConflictError('A different assistant-memory turn is already pending.');
            }
            return;
          }
          store.put(normalized, PENDING_MEMORY_KEY);
          inserted = true;
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
      activeRequest.onsuccess = () => { activeRaw = activeRequest.result ?? null; finish(); };
      pendingRequest.onsuccess = () => { pendingRaw = pendingRequest.result ?? null; finish(); };
      activeRequest.onerror = () => reject(activeRequest.error ?? new Error('IndexedDB assistant-memory state read failed'));
      pendingRequest.onerror = () => reject(pendingRequest.error ?? new Error('IndexedDB assistant-memory pending read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory pending write failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('IndexedDB assistant-memory pending write aborted'));
    });
    return inserted;
  } finally {
    database.close();
  }
}

export async function saveStoredAssistantMemory(
  result: AssistantMemoryResult,
  epoch: string,
  pending: StoredAssistantMemoryPendingTurn
): Promise<AssistantMemoryWriteReceipt> {
  const normalized = normalizeAssistantMemoryResult(result);
  const normalizedEpoch = boundedStorageId(epoch, 'assistant-memory epoch');
  const normalizedPending = normalizeStoredAssistantMemoryPendingTurn(pending);
  if (normalizedPending.epoch !== normalizedEpoch || normalizedPending.memoryId !== normalized.memoryId) {
    throw new AssistantMemoryConflictError('The pending turn belongs to another assistant-memory generation.');
  }
  const writeId = globalThis.crypto.randomUUID();
  const envelope: StoredAssistantMemoryEnvelope = {
    spec: STORED_ASSISTANT_MEMORY_SPEC,
    writeId,
    epoch: normalizedEpoch,
    result: normalized
  };
  const database = await openDatabase();
  let previousRaw: unknown | null = null;
  let pendingRaw: unknown = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const activeRequest = store.get(ACTIVE_MEMORY_KEY);
      const pendingRequest = store.get(PENDING_MEMORY_KEY);
      let completedReads = 0;
      let failure: unknown = null;
      const finish = () => {
        completedReads += 1;
        if (completedReads !== 2) return;
        try {
          const unwrapped = unwrapStoredAssistantMemory(previousRaw, normalizedEpoch, normalized.memoryId);
          if (previousRaw !== null && unwrapped === null) {
            throw new AssistantMemoryConflictError('The persisted assistant-memory epoch changed before this update committed.');
          }
          if (!assistantMemoryWriteBaseMatches(unwrapped, normalized)) throw new AssistantMemoryConflictError();
          const currentPending = unwrapStoredAssistantMemoryPendingTurn(
            pendingRaw,
            normalizedEpoch,
            normalized.memoryId
          );
          if (!currentPending || currentPending.turnKey !== normalizedPending.turnKey) {
            throw new AssistantMemoryConflictError('The assistant-memory pending turn changed before this update committed.');
          }
          if (!assistantMemoryPendingMatchesResult(currentPending, unwrapped, normalized)) {
            throw new AssistantMemoryConflictError('The assistant-memory result does not match its persisted pending turn.');
          }
          store.put(envelope, ACTIVE_MEMORY_KEY);
          store.delete(PENDING_MEMORY_KEY);
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
      activeRequest.onsuccess = () => { previousRaw = activeRequest.result ?? null; finish(); };
      pendingRequest.onsuccess = () => { pendingRaw = pendingRequest.result ?? null; finish(); };
      activeRequest.onerror = () => reject(activeRequest.error ?? new Error('IndexedDB assistant-memory previous-state read failed'));
      pendingRequest.onerror = () => reject(pendingRequest.error ?? new Error('IndexedDB assistant-memory pending-state read failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB assistant-memory write failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('IndexedDB assistant-memory write aborted'));
    });
    return { writeId, previousRaw, pendingRaw };
  } finally {
    database.close();
  }
}

export async function clearStoredAssistantMemory(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(ACTIVE_MEMORY_KEY);
      store.delete(PENDING_MEMORY_KEY);
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
          store.put(receipt.pendingRaw, PENDING_MEMORY_KEY);
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
