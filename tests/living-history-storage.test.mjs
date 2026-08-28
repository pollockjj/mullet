import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLivingHistoryRequest,
  createLivingHistoryResult
} from '../src/lib/living-history.ts';
import { commitLivingHistoryResult, restoreLivingHistoryResult } from '../src/lib/living-history-storage.ts';

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

test('discards a history result when reset lands during its storage write', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let discardedRevision = 0;
  const committing = commitLivingHistoryResult(result(), {
    save: async () => saveBlocked,
    isCurrent: () => current,
    discard: async (stale) => { discardedRevision = stale.output.revision; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discardedRevision, 1);
});

test('does not resurrect history when clear lands during a delayed restore', async () => {
  let resolveLoad;
  const delayedLoad = new Promise((resolve) => { resolveLoad = resolve; });
  let current = true;
  let accepted = false;
  const restoring = restoreLivingHistoryResult({
    load: async () => delayedLoad,
    isCurrent: () => current,
    accepts: () => { accepted = true; return true; },
    discard: async () => {}
  });
  current = false;
  resolveLoad(result());
  assert.equal(await restoring, null);
  assert.equal(accepted, false);
});
