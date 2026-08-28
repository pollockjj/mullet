import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLivingHistoryRequest,
  createLivingHistoryResult
} from '../src/lib/living-history.ts';
import {
  STORED_LIVING_HISTORY_SPEC,
  clearLivingHistoryAtEpoch,
  commitLivingHistoryResult,
  restoreLivingHistoryResult,
  unwrapStoredLivingHistory
} from '../src/lib/living-history-storage.ts';

function result() {
  const request = buildLivingHistoryRequest(
    '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    [
      { role: 'user', content: 'I ask Avon to make me captain.' },
      { role: 'assistant', content: 'Avon refuses. Blake remains in command.' }
    ],
    null
  );
  return createLivingHistoryResult(request, 'gemma-4-ortenzya', 'Avon rejected the user’s command proposal. Blake remains in command.');
}

test('persists only the bounded derived result rather than raw sidecar turns', () => {
  const serialized = JSON.stringify(result());
  assert.equal(serialized.includes('"turn"'), false);
  assert.equal(serialized.includes('I ask Avon to make me captain.'), false);
  assert.equal(serialized.includes('Avon refuses. Blake remains in command.'), false);
});

test('loads writer envelopes while retaining legacy direct-result compatibility', () => {
  const legacy = result();
  const epochA = '11111111-1111-4111-8111-111111111111';
  const epochB = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(unwrapStoredLivingHistory(legacy), legacy);
  assert.deepEqual(unwrapStoredLivingHistory({
    spec: STORED_LIVING_HISTORY_SPEC,
    writeId: 'writer-a',
    epoch: epochA,
    result: legacy
  }), legacy);
  assert.deepEqual(unwrapStoredLivingHistory(legacy, epochA, true), legacy);
  assert.equal(unwrapStoredLivingHistory(legacy, epochA, false), null);
  assert.deepEqual(unwrapStoredLivingHistory({
    spec: STORED_LIVING_HISTORY_SPEC,
    writeId: 'writer-a',
    epoch: epochA,
    result: legacy
  }, epochA, false), legacy);
  assert.equal(unwrapStoredLivingHistory({
    spec: STORED_LIVING_HISTORY_SPEC,
    writeId: 'writer-a',
    epoch: epochA,
    result: legacy
  }, epochB, false), null);
  assert.throws(
    () => unwrapStoredLivingHistory({ spec: STORED_LIVING_HISTORY_SPEC, writeId: '' }),
    /envelope is invalid/
  );
});

test('discards a history result when reset lands during its storage write', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let discardedWriteId = '';
  const committing = commitLivingHistoryResult(result(), {
    save: async () => { await saveBlocked; return { writeId: 'reset-writer', previousRaw: null }; },
    isCurrent: () => current,
    discard: async (receipt) => { discardedWriteId = receipt.writeId; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discardedWriteId, 'reset-writer');
});

test('a stale tab cannot delete another tab’s identical committed result', async () => {
  const candidate = result();
  let persisted = null;
  let currentA = true;
  let installedB = false;
  let releaseAWrite;
  let reportAWrite;
  const aWriteReturned = new Promise((resolve) => { releaseAWrite = resolve; });
  const aWritePersisted = new Promise((resolve) => { reportAWrite = resolve; });
  const rollbackOwnedWrite = async (receipt) => {
    if (persisted?.writeId === receipt.writeId) persisted = receipt.previousRaw;
  };

  const tabA = commitLivingHistoryResult(candidate, {
    save: async (stored) => {
      const previousRaw = persisted;
      persisted = { writeId: 'tab-a', result: stored };
      reportAWrite();
      await aWriteReturned;
      return { writeId: 'tab-a', previousRaw };
    },
    isCurrent: () => currentA,
    discard: rollbackOwnedWrite,
    install: () => assert.fail('stale tab A installed its result')
  });
  await aWritePersisted;

  const tabB = await commitLivingHistoryResult(candidate, {
    save: async (stored) => {
      const previousRaw = persisted;
      persisted = { writeId: 'tab-b', result: stored };
      return { writeId: 'tab-b', previousRaw };
    },
    isCurrent: () => true,
    discard: rollbackOwnedWrite,
    install: () => { installedB = true; }
  });
  currentA = false;
  releaseAWrite();

  assert.equal(await tabA, false);
  assert.equal(tabB, true);
  assert.equal(installedB, true);
  assert.equal(persisted?.writeId, 'tab-b');
});

test('a later stale tab restores the valid result it overwrote', async () => {
  const candidate = result();
  let persisted = null;
  let installedB = false;
  const rollbackOwnedWrite = async (receipt) => {
    if (persisted?.writeId === receipt.writeId) persisted = receipt.previousRaw;
  };
  const tabB = await commitLivingHistoryResult(candidate, {
    save: async (stored) => {
      const previousRaw = persisted;
      persisted = { writeId: 'tab-b', result: stored };
      return { writeId: 'tab-b', previousRaw };
    },
    isCurrent: () => true,
    discard: rollbackOwnedWrite,
    install: () => { installedB = true; }
  });

  let currentA = true;
  let releaseAWrite;
  let reportAWrite;
  const aWriteReturned = new Promise((resolve) => { releaseAWrite = resolve; });
  const aWritePersisted = new Promise((resolve) => { reportAWrite = resolve; });
  const tabA = commitLivingHistoryResult(candidate, {
    save: async (stored) => {
      const previousRaw = persisted;
      persisted = { writeId: 'tab-a', result: stored };
      reportAWrite();
      await aWriteReturned;
      return { writeId: 'tab-a', previousRaw };
    },
    isCurrent: () => currentA,
    discard: rollbackOwnedWrite,
    install: () => assert.fail('stale tab A installed its result')
  });
  await aWritePersisted;
  currentA = false;
  releaseAWrite();

  assert.equal(await tabA, false);
  assert.equal(tabB, true);
  assert.equal(installedB, true);
  assert.equal(persisted?.writeId, 'tab-b');
});

test('does not resurrect history when clear lands during a delayed restore', async () => {
  let resolveLoad;
  const delayedLoad = new Promise((resolve) => { resolveLoad = resolve; });
  let current = true;
  let accepted = false;
  let installed = false;
  const restoring = restoreLivingHistoryResult({
    load: async () => delayedLoad,
    isCurrent: () => current,
    accepts: () => { accepted = true; return true; },
    install: () => { installed = true; }
  });
  current = false;
  resolveLoad(result());
  assert.equal(await restoring, null);
  assert.equal(accepted, false);
  assert.equal(installed, false);
});

test('installs a restored result before releasing the storage lock', async () => {
  let lockHeld = false;
  let installedWhileLocked = false;
  const restored = await restoreLivingHistoryResult({
    load: async () => result(),
    isCurrent: () => true,
    accepts: () => true,
    install: () => { installedWhileLocked = lockHeld; },
    exclusive: async (operation) => {
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
      }
    }
  });
  assert.equal(restored?.output.revision, 1);
  assert.equal(installedWhileLocked, true);
});

test('does not migrate legacy storage after losing the epoch while waiting for the lock', async () => {
  let current = true;
  let loaded = false;
  let releaseLock;
  let reportWaiting;
  const lockReleased = new Promise((resolve) => { releaseLock = resolve; });
  const lockWaiting = new Promise((resolve) => { reportWaiting = resolve; });
  const restoring = restoreLivingHistoryResult({
    load: async () => { loaded = true; return result(); },
    isCurrent: () => current,
    accepts: () => true,
    install: () => assert.fail('stale legacy restore installed'),
    exclusive: async (operation) => {
      reportWaiting();
      await lockReleased;
      return operation();
    }
  });
  await lockWaiting;
  current = false;
  releaseLock();

  assert.equal(await restoring, null);
  assert.equal(loaded, false);
});

test('publishes a Clear epoch only after acquiring the exclusive storage lock', async () => {
  const nextEpoch = '33333333-3333-4333-8333-333333333333';
  const events = [];
  let releaseLock;
  let reportWaiting;
  const lockReleased = new Promise((resolve) => { releaseLock = resolve; });
  const lockWaiting = new Promise((resolve) => { reportWaiting = resolve; });
  const clearing = clearLivingHistoryAtEpoch(nextEpoch, {
    exclusive: async (operation) => {
      events.push('waiting');
      reportWaiting();
      await lockReleased;
      events.push('locked');
      const value = await operation();
      events.push('released');
      return value;
    },
    publishEpoch: (epoch) => { events.push(`epoch:${epoch}`); },
    clear: async () => { events.push('clear'); }
  });
  await lockWaiting;
  assert.deepEqual(events, ['waiting']);
  releaseLock();
  await clearing;
  assert.deepEqual(events, ['waiting', 'locked', `epoch:${nextEpoch}`, 'clear', 'released']);
});
