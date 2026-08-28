import type { SidecarState } from './sidecar.ts';

const DATABASE_NAME = 'mullet-sidecars';
const STORE_NAME = 'state';
const ACTIVE_CONVERSATION_KEY = 'active-conversation';

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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB sidecar open failed'));
    request.onblocked = () => reject(new Error('IndexedDB sidecar upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredSidecarState(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_CONVERSATION_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB sidecar read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB sidecar read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredSidecarState(state: SidecarState): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(state, ACTIVE_CONVERSATION_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB sidecar write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB sidecar write aborted'));
    });
  } finally {
    database.close();
  }
}
