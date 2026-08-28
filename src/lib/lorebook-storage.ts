import type { JsonObject } from './character-card.ts';

export type StoredLorebook = {
  name: string;
  raw: JsonObject;
};

const DATABASE_NAME = 'mullet-lorebooks';
const STORE_NAME = 'state';
const ACTIVE_BOOKS_KEY = 'active-books';

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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredLorebooks(): Promise<StoredLorebook[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_BOOKS_KEY);
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB lorebook read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB lorebook read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredLorebooks(books: StoredLorebook[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(books, ACTIVE_BOOKS_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB lorebook write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB lorebook write aborted'));
    });
  } finally {
    database.close();
  }
}
