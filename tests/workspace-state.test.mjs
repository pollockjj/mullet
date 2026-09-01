// Fiction workspace persistence.
//
// The migration test is the one that matters: personal-assistant mode was removed and
// the stored envelope went v3 -> v4. If that migration is wrong, an operator with a live
// conversation in localStorage loses it on the next load.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_WORKSPACE_V3_STORAGE_KEY,
  STORED_WORKSPACE_SPEC,
  WORKSPACE_STORAGE_KEY,
  createStoredWorkspace,
  loadStoredWorkspace,
  normalizeStoredWorkspace,
  saveStoredWorkspace,
  workspaceCompletedTurnCapacityError,
  workspaceMutationFingerprint,
  workspaceReadyForCompletedTurn
} from '../src/lib/workspace-state.ts';

const CONVERSATION = '11111111-2222-4333-8444-555555555555';
const FRESH = '99999999-8888-4777-8666-555555555555';
const MESSAGES = [
  { role: 'user', content: 'Jenna, take the helm.' },
  { role: 'assistant', content: 'She braces against the console and nods.' }
];

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map
  };
}

test('round-trips a fiction workspace', () => {
  const storage = memoryStorage();
  const workspace = createStoredWorkspace(CONVERSATION, MESSAGES);
  saveStoredWorkspace(storage, workspace);
  const loaded = loadStoredWorkspace(storage, FRESH);
  assert.equal(loaded.disposition, 'current');
  assert.equal(loaded.workspace.conversationId, CONVERSATION);
  assert.deepEqual(loaded.workspace.messages, MESSAGES);
  assert.equal(loaded.workspace.finalizedFictionResponse, null);
});

test('migrates a v3 envelope without losing the operator transcript', () => {
  const storage = memoryStorage({
    [LEGACY_WORKSPACE_V3_STORAGE_KEY]: JSON.stringify({
      spec: 'mullet_workspace_v3',
      mode: 'fiction',
      conversationId: CONVERSATION,
      messages: MESSAGES,
      assistantMemory: null,
      finalizedFictionResponse: null
    })
  });
  const loaded = loadStoredWorkspace(storage, FRESH);
  assert.equal(loaded.disposition, 'migrated');
  assert.equal(loaded.workspace.spec, STORED_WORKSPACE_SPEC);
  assert.equal(loaded.workspace.conversationId, CONVERSATION);
  assert.deepEqual(loaded.workspace.messages, MESSAGES);
  assert.equal(storage.getItem(LEGACY_WORKSPACE_V3_STORAGE_KEY), null);
  assert.notEqual(storage.getItem(WORKSPACE_STORAGE_KEY), null);
});

test('migrates a v3 personal-assistant envelope by keeping its transcript and dropping the mode', () => {
  const storage = memoryStorage({
    [LEGACY_WORKSPACE_V3_STORAGE_KEY]: JSON.stringify({
      spec: 'mullet_workspace_v3',
      mode: 'personal_assistant',
      conversationId: CONVERSATION,
      messages: MESSAGES,
      assistantMemory: { memoryId: CONVERSATION, epoch: FRESH, pending: null, lastCompletedChat: null },
      finalizedFictionResponse: null
    })
  });
  const loaded = loadStoredWorkspace(storage, FRESH);
  assert.equal(loaded.disposition, 'migrated');
  assert.deepEqual(loaded.workspace.messages, MESSAGES);
  assert.ok(!('mode' in loaded.workspace));
  assert.ok(!('assistantMemory' in loaded.workspace));
});

test('keeps the transcript when only the finalized receipt is corrupt', () => {
  const storage = memoryStorage({
    [WORKSPACE_STORAGE_KEY]: JSON.stringify({
      spec: STORED_WORKSPACE_SPEC,
      conversationId: CONVERSATION,
      messages: MESSAGES,
      finalizedFictionResponse: { garbage: true }
    })
  });
  const loaded = loadStoredWorkspace(storage, FRESH);
  assert.equal(loaded.disposition, 'repaired');
  assert.deepEqual(loaded.workspace.messages, MESSAGES);
  assert.equal(loaded.workspace.finalizedFictionResponse, null);
});

test('resets only when the envelope is unusable', () => {
  const storage = memoryStorage({ [WORKSPACE_STORAGE_KEY]: 'not json' });
  const loaded = loadStoredWorkspace(storage, FRESH);
  assert.equal(loaded.disposition, 'reset');
  assert.equal(loaded.workspace.conversationId, FRESH);
  assert.deepEqual(loaded.workspace.messages, []);
});

test('rejects a foreign or malformed envelope shape', () => {
  assert.throws(() => normalizeStoredWorkspace({ spec: 'mullet_workspace_v3', conversationId: CONVERSATION, messages: [], finalizedFictionResponse: null }), /spec is invalid/);
  assert.throws(() => normalizeStoredWorkspace({ spec: STORED_WORKSPACE_SPEC, conversationId: 'nope', messages: [], finalizedFictionResponse: null }), /must be a UUID/);
});

test('fingerprints the exact conversation and transcript', () => {
  const one = workspaceMutationFingerprint(CONVERSATION, MESSAGES);
  assert.equal(one, workspaceMutationFingerprint(CONVERSATION, MESSAGES));
  assert.notEqual(one, workspaceMutationFingerprint(FRESH, MESSAGES));
  assert.notEqual(one, workspaceMutationFingerprint(CONVERSATION, MESSAGES.slice(0, 1).concat({ role: 'assistant', content: 'other' })));
});

test('reserves two slots for a completed turn', () => {
  assert.equal(workspaceReadyForCompletedTurn(998), true);
  assert.equal(workspaceReadyForCompletedTurn(999), false);
  assert.equal(workspaceCompletedTurnCapacityError(998), null);
  assert.match(workspaceCompletedTurnCapacityError(999), /two free message slots/);
});
