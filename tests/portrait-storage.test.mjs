import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORED_PORTRAIT_SPEC,
  commitStoredPortrait,
  loadStoredPortrait,
  normalizeStoredPortrait,
  verifyStoredPortrait
} from '../src/lib/portrait-storage.ts';
import {
  PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
  PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID,
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
  PORTRAIT_TEMPLATE_ID
} from '../src/lib/portrait.ts';

function png(width = 576, height = 1024) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

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
    modelTemplate: PORTRAIT_TEMPLATE_ID,
    promptId: '11111111-1111-4111-8111-111111111111',
    seed: 17,
    width: 576,
    height: 1024,
    generatedAt: 1,
    image: new Blob([png()], { type: 'image/png' }),
    ...overrides
  };
}

test('normalizes a generated portrait without any canonical transcript text', () => {
  const result = normalizeStoredPortrait(stored());
  assert.equal(result.image.type, 'image/png');
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('accepts persisted results from every additive image model', () => {
  for (const modelTemplate of [
    PORTRAIT_TEMPLATE_ID,
    PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID,
    PORTRAIT_FLUX2_REFERENCE_TEMPLATE_ID,
    PORTRAIT_MAGE_REFERENCE_TEMPLATE_ID
  ]) {
    assert.equal(normalizeStoredPortrait(stored({ modelTemplate })).modelTemplate, modelTemplate);
  }
});

test('rejects portraits for another conversation, non-image results, or non-9:16 dimensions', () => {
  assert.throws(() => normalizeStoredPortrait(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortrait(stored({ image: new Blob(['no'], { type: 'text/plain' }) })), /image is invalid/);
  assert.throws(() => normalizeStoredPortrait(stored({ width: 768, height: 1152 })), /supported 9:16 expression size/);
});

test('rejects a stored portrait whose PNG IHDR contradicts its fixed-portrait metadata', async () => {
  await assert.rejects(
    verifyStoredPortrait(stored({ image: new Blob([png(576, 960)], { type: 'image/png' }) })),
    /dimensions do not match/
  );
});

test('ignores every legacy portrait envelope, including the superseded 2:3 v4 state', async () => {
  const originalIndexedDb = globalThis.indexedDB;
  try {
    for (const spec of [
      'mullet_stored_portrait_v1',
      'mullet_stored_portrait_v2',
      'mullet_stored_portrait_v3',
      'mullet_stored_portrait_v4'
    ]) {
      const legacyPortrait = stored({
        spec,
        ...(spec.endsWith('_v1') ? { width: 768, height: 1152 } : spec.endsWith('_v2') ? {
          modelTemplate: 'mage-flow-edit-turbo-reference-v1'
        } : spec.endsWith('_v3') ? { width: 704, height: 704 } : { width: 768, height: 1152 })
      });
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
      assert.equal(await loadStoredPortrait(), null);
      assert.equal(closed, true);
      assert.throws(() => normalizeStoredPortrait(legacyPortrait), /invalid stored portrait/);
    }
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
