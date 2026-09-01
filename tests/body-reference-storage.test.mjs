import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPngFixture } from './png-fixture.mjs';

import {
  BODY_REFERENCE_MAX_BYTES,
  BODY_REFERENCE_OVERLAY_SPEC,
  applyBodyReferenceOverlay,
  bodyReferenceImageName,
  bodyReferenceMergedProfileFingerprint,
  bodyReferenceOverlayKey,
  createBodyReferenceOverlay,
  loadBodyReferenceOverlay,
  loadBodyReferenceOverlays,
  normalizeBodyReferenceOverlay,
  removeBodyReferenceOverlay,
  runBodyReferenceOverlayExclusive,
  saveBodyReferenceOverlay,
  verifyBodyReferenceOverlay
} from '../src/lib/body-reference-storage.ts';

const png = buildPngFixture;

function pngBlob(width = 576, height = 1024, marker = 0) {
  return new Blob([png(width, height, marker)], { type: 'image/png' });
}

function profile(overrides = {}) {
  return {
    id: 'jenna-stannis',
    displayName: 'Jenna Stannis',
    aliases: ['Jenna'],
    subject: 'Sally Knyvette portraying Jenna Stannis',
    attire: 'burgundy-and-silver flight costume',
    setting: 'the Liberator flight deck',
    seed: 42,
    expressionPrompts: {},
    modelTemplate: 'qwen-image-edit-2511-reference-v1',
    subjectLora: null,
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: '1'.repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: null,
    fingerprint: '1234abcd',
    ...overrides
  };
}

function installFakePersistence(context) {
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const records = new Map();
  const lockNames = [];
  let lockTail = Promise.resolve();
  let activeLocks = 0;
  let maximumActiveLocks = 0;

  function transaction() {
    let outstanding = 0;
    let completionQueued = false;
    const tx = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => ({
        get: (key) => request(() => records.get(key)),
        getAll: () => request(() => [...records.values()]),
        getAllKeys: () => request(() => [...records.keys()]),
        put: (value, key) => request(() => {
          records.set(key, value);
          return key;
        }),
        delete: (key) => request(() => records.delete(key))
      })
    };
    const completeWhenIdle = () => {
      if (outstanding !== 0 || completionQueued) return;
      completionQueued = true;
      queueMicrotask(() => {
        completionQueued = false;
        if (outstanding === 0) tx.oncomplete?.();
      });
    };
    const request = (operation) => {
      outstanding += 1;
      const result = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        try {
          result.result = operation();
          result.onsuccess?.();
        } catch (cause) {
          result.error = cause;
          tx.error = cause;
          result.onerror?.();
          tx.onerror?.();
        } finally {
          outstanding -= 1;
          completeWhenIdle();
        }
      });
      return result;
    };
    return tx;
  }

  const indexedDB = {
    open: () => {
      const openRequest = { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      queueMicrotask(() => {
        openRequest.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
          transaction,
          close: () => undefined,
          onversionchange: null
        };
        openRequest.onsuccess?.();
      });
      return openRequest;
    }
  };
  const locks = {
    request: (name, options, operation) => {
      lockNames.push([name, options]);
      const run = lockTail.then(async () => {
        activeLocks += 1;
        maximumActiveLocks = Math.max(maximumActiveLocks, activeLocks);
        try {
          return await operation({ name, mode: options.mode });
        } finally {
          activeLocks -= 1;
        }
      });
      lockTail = run.catch(() => undefined);
      return run;
    }
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: indexedDB
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { locks }
  });
  context.after(() => {
    if (indexedDbDescriptor) Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
    else delete globalThis.indexedDB;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  });
  return {
    records,
    lockNames,
    maximumActiveLocks: () => maximumActiveLocks
  };
}

test('creates a content-addressed overlay with exact PNG geometry and distinct profile provenance', async () => {
  const sourceProfile = profile();
  const blob = pngBlob();
  const first = await createBodyReferenceOverlay(sourceProfile, blob);
  const second = await createBodyReferenceOverlay(sourceProfile, blob);

  assert.equal(first.spec, BODY_REFERENCE_OVERLAY_SPEC);
  assert.equal(first.profileId, sourceProfile.id);
  assert.equal(first.baseProfileFingerprint, sourceProfile.fingerprint);
  assert.match(first.mergedProfileFingerprint, /^[0-9a-f]{8}$/);
  assert.notEqual(first.mergedProfileFingerprint, sourceProfile.fingerprint);
  assert.equal(first.referenceImage.width, 576);
  assert.equal(first.referenceImage.height, 1024);
  assert.equal(first.referenceImage.aspectRatio, '9:16');
  assert.equal(first.referenceImage.subfolder, 'mullet/identity');
  assert.equal(first.referenceImage.type, 'input');
  assert.equal(
    first.referenceImage.name,
    bodyReferenceImageName(sourceProfile.id, sourceProfile.fingerprint, first.referenceImage.sha256)
  );
  assert.deepEqual(second.referenceImage, first.referenceImage);
  assert.equal(second.mergedProfileFingerprint, first.mergedProfileFingerprint);
  assert.equal(
    first.mergedProfileFingerprint,
    bodyReferenceMergedProfileFingerprint(first.profileId, first.baseProfileFingerprint, first.referenceImage)
  );
  assert.equal(bodyReferenceOverlayKey(first.profileId, first.baseProfileFingerprint), 'jenna-stannis\u001f1234abcd');
  assert.deepEqual(await verifyBodyReferenceOverlay(first), first);
});

test('normalizes only exact metadata and rejects forged hashes, IHDR geometry, aspect, and size', async () => {
  const overlay = await createBodyReferenceOverlay(profile(), pngBlob());
  assert.throws(
    () => normalizeBodyReferenceOverlay({ ...overlay, extra: true }),
    /unexpected fields/
  );
  assert.throws(
    () => normalizeBodyReferenceOverlay({
      ...overlay,
      referenceImage: { ...overlay.referenceImage, aspectRatio: '2:3' }
    }),
    /aspect ratio must be 9:16/
  );
  assert.throws(
    () => normalizeBodyReferenceOverlay({
      ...overlay,
      referenceImage: { ...overlay.referenceImage, name: 'forged.png' }
    }),
    /logical image location/
  );
  assert.throws(
    () => normalizeBodyReferenceOverlay({ ...overlay, mergedProfileFingerprint: 'deadbeef' }),
    /does not match its overlay/
  );
  await assert.rejects(
    verifyBodyReferenceOverlay({ ...overlay, image: pngBlob(640, 960) }),
    /PNG dimensions do not match/
  );
  await assert.rejects(
    verifyBodyReferenceOverlay({ ...overlay, image: pngBlob(576, 1024, 1) }),
    /hash does not match/
  );
  await assert.rejects(
    createBodyReferenceOverlay(profile(), new Blob([png()], { type: 'image/jpeg' })),
    /must be a PNG/
  );
  await assert.rejects(
    createBodyReferenceOverlay(
      profile(),
      new Blob([new Uint8Array(BODY_REFERENCE_MAX_BYTES + 1)], { type: 'image/png' })
    ),
    /at most 20 MiB/
  );
  const invalidIhdr = png();
  invalidIhdr[11] = 12;
  await assert.rejects(
    createBodyReferenceOverlay(profile(), new Blob([invalidIhdr], { type: 'image/png' })),
    /invalid PNG IHDR/
  );
});

test('applies only a byte-verified overlay to its exact base profile and invalidates settings', async () => {
  const sourceProfile = profile();
  const overlay = await createBodyReferenceOverlay(sourceProfile, pngBlob());
  const merged = applyBodyReferenceOverlay(sourceProfile, overlay);

  assert.equal(sourceProfile.bodyReferenceImage, null);
  assert.deepEqual(merged.bodyReferenceImage, overlay.referenceImage);
  assert.equal(merged.fingerprint, overlay.mergedProfileFingerprint);
  assert.notEqual(merged.fingerprint, sourceProfile.fingerprint);
  assert.equal(merged.referenceImage, sourceProfile.referenceImage);
  assert.throws(
    () => applyBodyReferenceOverlay(profile({ id: 'cally' }), overlay),
    /does not match its base profile/
  );
  assert.throws(
    () => applyBodyReferenceOverlay(profile({ fingerprint: '87654321' }), overlay),
    /does not match its base profile/
  );
  assert.throws(
    () => applyBodyReferenceOverlay(sourceProfile, {
      ...overlay,
      mergedProfileFingerprint: 'deadbeef'
    }),
    /does not match its overlay/
  );
});

test('saves, overwrites, lists, loads, and removes profile-keyed overlays under exclusive Web Locks', async (context) => {
  const persistence = installFakePersistence(context);
  const jenna = profile();
  const cally = profile({ id: 'cally', displayName: 'Cally', aliases: ['Cally'], fingerprint: '87654321' });
  const firstJenna = await createBodyReferenceOverlay(jenna, pngBlob(576, 1024, 1));
  const secondJenna = await createBodyReferenceOverlay(jenna, pngBlob(576, 1024, 2));
  const callyOverlay = await createBodyReferenceOverlay(cally, pngBlob(768, 1024, 3));

  await Promise.all([
    saveBodyReferenceOverlay(firstJenna),
    saveBodyReferenceOverlay(callyOverlay)
  ]);
  assert.equal(persistence.maximumActiveLocks(), 1);
  assert.ok(persistence.lockNames.every(([name, options]) => (
    name === 'mullet-body-reference-overlays' && options.mode === 'exclusive'
  )));
  assert.equal((await loadBodyReferenceOverlay('jenna-stannis', '1234abcd'))?.referenceImage.sha256, firstJenna.referenceImage.sha256);
  assert.equal(await loadBodyReferenceOverlay('jenna-stannis', '87654321'), null);
  assert.deepEqual(
    (await loadBodyReferenceOverlays()).map(({ profileId, referenceImage }) => [profileId, referenceImage.aspectRatio]),
    [['cally', '3:4'], ['jenna-stannis', '9:16']]
  );

  await saveBodyReferenceOverlay(secondJenna);
  assert.equal((await loadBodyReferenceOverlays()).length, 2);
  assert.equal(
    (await loadBodyReferenceOverlay('jenna-stannis', '1234abcd'))?.referenceImage.sha256,
    secondJenna.referenceImage.sha256
  );
  await removeBodyReferenceOverlay('jenna-stannis', '1234abcd');
  assert.equal(await loadBodyReferenceOverlay('jenna-stannis', '1234abcd'), null);
  assert.deepEqual((await loadBodyReferenceOverlays()).map(({ profileId }) => profileId), ['cally']);
  assert.equal(persistence.records.size, 1);
});

test('fails loudly on corrupt persisted bytes and requires Web Locks for every mutation', async (context) => {
  const persistence = installFakePersistence(context);
  const overlay = await createBodyReferenceOverlay(profile(), pngBlob());
  persistence.records.set(
    bodyReferenceOverlayKey(overlay.profileId, overlay.baseProfileFingerprint),
    { ...overlay, image: pngBlob(576, 1024, 9) }
  );
  await assert.rejects(loadBodyReferenceOverlays(), /hash does not match/);
  await assert.rejects(
    loadBodyReferenceOverlay(overlay.profileId, overlay.baseProfileFingerprint),
    /hash does not match/
  );

  persistence.records.clear();
  persistence.records.set('cally\u001f87654321', overlay);
  await assert.rejects(loadBodyReferenceOverlays(), /stored body-reference key does not match/);

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {}
  });
  await assert.rejects(saveBodyReferenceOverlay(overlay), /Web Locks are required/);
  await assert.rejects(
    removeBodyReferenceOverlay(overlay.profileId, overlay.baseProfileFingerprint),
    /Web Locks are required/
  );
  await assert.rejects(
    runBodyReferenceOverlayExclusive(async () => undefined),
    /Web Locks are required/
  );
});
