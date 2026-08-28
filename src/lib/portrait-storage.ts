import { PORTRAIT_TEMPLATE_ID, isPortraitSource, type PortraitSource } from './portrait.ts';

export const STORED_PORTRAIT_SPEC = 'mullet_stored_portrait_v1' as const;

export type StoredPortrait = {
  spec: typeof STORED_PORTRAIT_SPEC;
  conversationId: string;
  requestKey: string;
  source: PortraitSource;
  modelTemplate: typeof PORTRAIT_TEMPLATE_ID;
  promptId: string;
  seed: number;
  width: number;
  height: number;
  generatedAt: number;
  image: Blob;
};

const DATABASE_NAME = 'mullet-portraits';
const STORE_NAME = 'state';
const ACTIVE_PORTRAIT_KEY = 'active-portrait';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return Number(value);
}

export function normalizeStoredPortrait(value: unknown): StoredPortrait {
  if (!isRecord(value) || value.spec !== STORED_PORTRAIT_SPEC) throw new Error('invalid stored portrait');
  if (typeof value.conversationId !== 'string' || !isPortraitSource(value.source) || value.source.conversationId !== value.conversationId) {
    throw new Error('stored portrait source is invalid');
  }
  if (typeof value.requestKey !== 'string' || value.requestKey.length < 1 || value.requestKey.length > 5000) {
    throw new Error('stored portrait request key is invalid');
  }
  if (value.modelTemplate !== PORTRAIT_TEMPLATE_ID) throw new Error('stored portrait template is invalid');
  if (typeof value.promptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.promptId)) throw new Error('stored portrait prompt ID is invalid');
  if (!(value.image instanceof Blob) || value.image.type !== 'image/png' || value.image.size < 8 || value.image.size > 20 * 1024 * 1024) {
    throw new Error('stored portrait image is invalid');
  }
  return {
    spec: STORED_PORTRAIT_SPEC,
    conversationId: value.conversationId,
    requestKey: value.requestKey,
    source: value.source,
    modelTemplate: PORTRAIT_TEMPLATE_ID,
    promptId: value.promptId,
    seed: safeInteger(value.seed, 'stored portrait seed', 0, Number.MAX_SAFE_INTEGER),
    width: safeInteger(value.width, 'stored portrait width', 16, 8192),
    height: safeInteger(value.height, 'stored portrait height', 16, 8192),
    generatedAt: safeInteger(value.generatedAt, 'stored portrait timestamp', 1, Number.MAX_SAFE_INTEGER),
    image: value.image
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait open failed'));
    request.onblocked = () => reject(new Error('IndexedDB portrait upgrade is blocked by another MULLET tab'));
  });
}

export async function loadStoredPortrait(): Promise<unknown | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_PORTRAIT_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB portrait read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait read aborted'));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredPortrait(portrait: StoredPortrait): Promise<void> {
  const normalized = normalizeStoredPortrait(portrait);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(normalized, ACTIVE_PORTRAIT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait write aborted'));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredPortrait(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ACTIVE_PORTRAIT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB portrait delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB portrait delete aborted'));
    });
  } finally {
    database.close();
  }
}
