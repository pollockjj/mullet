import assert from 'node:assert/strict';
import test from 'node:test';

import { STORED_PORTRAIT_SPEC, commitStoredPortrait, loadStoredPortrait, normalizeStoredPortrait } from '../src/lib/portrait-storage.ts';

function stored(overrides = {}) {
  return {
    spec: STORED_PORTRAIT_SPEC,
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    requestKey: 'opaque-settings-fingerprint',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: '4:1234abcd',
      expression: 'joy'
    },
    modelTemplate: 'z-image-turbo-v1',
    promptId: '11111111-1111-4111-8111-111111111111',
    seed: 17,
    width: 704,
    height: 704,
    generatedAt: 1,
    image: new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }),
    ...overrides
  };
}

test('normalizes a generated portrait without any canonical transcript text', () => {
  const result = normalizeStoredPortrait(stored());
  assert.equal(result.image.type, 'image/png');
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('rejects portraits for another conversation, non-image results, or non-1:1 dimensions', () => {
  assert.throws(() => normalizeStoredPortrait(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortrait(stored({ image: new Blob(['no'], { type: 'text/plain' }) })), /image is invalid/);
  assert.throws(() => normalizeStoredPortrait(stored({ width: 704, height: 1056 })), /supported 1:1 expression size/);
});

test('ignores the legacy stored portrait v1 instead of rendering its old portrait geometry', async () => {
  const legacyPortrait = stored({
    spec: 'mullet_stored_portrait_v1',
    width: 768,
    height: 1152
  });
  const originalIndexedDb = globalThis.indexedDB;
  let closed = false;
  globalThis.indexedDB = {
    open: () => {
      const openRequest = {};
      queueMicrotask(() => {
        openRequest.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const transaction = {};
            transaction.objectStore = () => ({
              get: () => {
                const readRequest = {};
                queueMicrotask(() => {
                  readRequest.result = legacyPortrait;
                  readRequest.onsuccess();
                });
                return readRequest;
              }
            });
            return transaction;
          },
          close: () => { closed = true; }
        };
        openRequest.onsuccess();
      });
      return openRequest;
    }
  };
  try {
    assert.equal(await loadStoredPortrait(), null);
    assert.equal(closed, true);
    assert.throws(() => normalizeStoredPortrait(legacyPortrait), /invalid stored portrait/);
  } finally {
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
});

test('discards a portrait when its conversation becomes stale during the storage write', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let discardedPromptId = '';
  const committing = commitStoredPortrait(stored(), {
    save: async () => saveBlocked,
    isCurrent: () => current,
    discard: async (portrait) => { discardedPromptId = portrait.promptId; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discardedPromptId, '11111111-1111-4111-8111-111111111111');
});
