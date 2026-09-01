import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORED_PORTRAIT_ENVELOPE_SPEC,
  STORED_PORTRAIT_SPEC,
  commitStoredPortrait,
  loadStoredPortrait,
  normalizeStoredPortrait,
  restoreStoredPortrait,
  unwrapStoredPortrait,
  verifyStoredPortrait
} from '../src/lib/portrait-storage.ts';
import {
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

test('unwraps raw v6 portraits and writer-owned envelopes while rejecting malformed ownership', () => {
  const portrait = stored();
  assert.deepEqual(unwrapStoredPortrait(portrait), portrait);
  assert.deepEqual(unwrapStoredPortrait({
    spec: STORED_PORTRAIT_ENVELOPE_SPEC,
    writeId: 'writer-a',
    portrait
  }), portrait);
  assert.throws(
    () => unwrapStoredPortrait({ spec: STORED_PORTRAIT_ENVELOPE_SPEC, writeId: '', portrait }),
    /envelope is invalid/
  );
  assert.throws(
    () => unwrapStoredPortrait({ spec: STORED_PORTRAIT_ENVELOPE_SPEC, writeId: 'writer-a' }),
    /envelope is invalid/
  );
});

test('ignores every legacy portrait envelope through v5', async () => {
  const originalIndexedDb = globalThis.indexedDB;
  try {
    for (const spec of [
      'mullet_stored_portrait_v1',
      'mullet_stored_portrait_v2',
      'mullet_stored_portrait_v3',
      'mullet_stored_portrait_v4',
      'mullet_stored_portrait_v5'
    ]) {
      const legacyPortrait = stored({
        spec,
        ...(spec.endsWith('_v1') ? { width: 768, height: 1152 } : spec.endsWith('_v2') ? {
          modelTemplate: 'retired-reference-editor-v1'
        } : spec.endsWith('_v3') ? { width: 704, height: 704 } : { width: 768, height: 1152 })
      });
      const version = spec.at(-1);
      const legacyEnvelope = {
        spec: `mullet_stored_portrait_envelope_v${version}`,
        writeId: `legacy-v${version}`,
        portrait: legacyPortrait
      };
      for (const persisted of [legacyPortrait, legacyEnvelope]) {
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
                        readRequest.result = persisted;
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
      }
      assert.throws(() => normalizeStoredPortrait(legacyPortrait), /invalid stored portrait/);
    }
  } finally {
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
});

test('rolls back a portrait when its conversation becomes stale during the storage write', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let rolledBack = '';
  const committing = commitStoredPortrait(stored(), {
    exclusive: async (operation) => operation(),
    save: async () => {
      await saveBlocked;
      return { writeId: 'writer-a', previousRaw: null };
    },
    isCurrent: () => current,
    rollback: async (receipt) => { rolledBack = receipt.writeId; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(rolledBack, 'writer-a');
});

test('serializes writers so a later stale portrait restores the valid prior envelope', async () => {
  let persisted = null;
  let currentA = true;
  let installedB = false;
  let tail = Promise.resolve();
  const exclusive = async (operation) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const save = async (portrait, writeId) => {
    const previousRaw = persisted;
    persisted = { spec: STORED_PORTRAIT_ENVELOPE_SPEC, writeId, portrait };
    return { writeId, previousRaw };
  };
  const rollback = async (receipt) => {
    if (persisted?.writeId === receipt.writeId) persisted = receipt.previousRaw;
  };

  await commitStoredPortrait(stored({ promptId: '22222222-2222-4222-8222-222222222222' }), {
    exclusive,
    save: (portrait) => save(portrait, 'writer-b'),
    isCurrent: () => true,
    rollback,
    install: () => { installedB = true; }
  });
  const staleA = commitStoredPortrait(stored(), {
    exclusive,
    save: async (portrait) => {
      const receipt = await save(portrait, 'writer-a');
      currentA = false;
      return receipt;
    },
    isCurrent: () => currentA,
    rollback,
    install: () => assert.fail('stale portrait installed')
  });

  assert.equal(await staleA, false);
  assert.equal(installedB, true);
  assert.equal(persisted?.writeId, 'writer-b');
  assert.equal(persisted?.portrait.promptId, '22222222-2222-4222-8222-222222222222');
});

test('checks currentness before loading and installs accepted restores inside the lock', async () => {
  let current = false;
  let loaded = false;
  const stale = await restoreStoredPortrait({
    exclusive: async (operation) => operation(),
    load: async () => { loaded = true; return stored(); },
    isCurrent: () => current,
    accepts: () => true,
    install: () => assert.fail('stale restore installed')
  });
  assert.equal(stale, null);
  assert.equal(loaded, false);

  let lockHeld = false;
  let installedWhileLocked = false;
  current = true;
  const restored = await restoreStoredPortrait({
    exclusive: async (operation) => {
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
      }
    },
    load: async () => stored(),
    isCurrent: () => current,
    accepts: () => true,
    install: async () => {
      await Promise.resolve();
      installedWhileLocked = lockHeld;
    }
  });
  assert.equal(restored?.promptId, '11111111-1111-4111-8111-111111111111');
  assert.equal(installedWhileLocked, true);
});

test('does not install a valid portrait after the active request changes during restore', async () => {
  let selectedRequestKey = 'opaque-settings-fingerprint';
  let installed = false;
  const restored = await restoreStoredPortrait({
    exclusive: async (operation) => operation(),
    load: async () => {
      const portrait = stored();
      selectedRequestKey = 'new-settings-fingerprint';
      return portrait;
    },
    isCurrent: () => selectedRequestKey === 'opaque-settings-fingerprint',
    accepts: (portrait) => portrait.requestKey === selectedRequestKey,
    install: () => { installed = true; }
  });
  assert.equal(restored, null);
  assert.equal(installed, false);
});
