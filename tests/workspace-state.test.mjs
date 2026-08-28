import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_WORKSPACE_CONVERSATION_ID_KEY,
  LEGACY_WORKSPACE_MESSAGES_KEY,
  LEGACY_WORKSPACE_MODE_KEY,
  STORED_WORKSPACE_SPEC,
  WORKSPACE_MAX_MESSAGES,
  WORKSPACE_STORAGE_KEY,
  createStoredWorkspace,
  loadStoredWorkspace,
  normalizeStoredWorkspace,
  saveStoredWorkspace,
  workspaceReadyForCompletedTurn
} from '../src/lib/workspace-state.ts';
import {
  CONVERSATION_MODE_FICTION,
  CONVERSATION_MODE_PERSONAL_ASSISTANT
} from '../src/lib/personal-assistant.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const replacementConversationId = '29105fd4-7ee4-4909-af15-b7cb790b4c7e';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const operations = [];
  return {
    values,
    operations,
    getItem(key) {
      operations.push(['get', key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      operations.push(['set', key, value]);
      values.set(key, value);
    },
    removeItem(key) {
      operations.push(['remove', key]);
      values.delete(key);
    }
  };
}

test('stores mode, conversation identity, and transcript in one exact envelope', () => {
  const messages = [{ role: 'user', content: 'Remember this together.' }];
  const stored = createStoredWorkspace(CONVERSATION_MODE_PERSONAL_ASSISTANT, conversationId, messages);
  assert.deepEqual(stored, {
    spec: STORED_WORKSPACE_SPEC,
    mode: CONVERSATION_MODE_PERSONAL_ASSISTANT,
    conversationId,
    messages
  });
  assert.deepEqual(normalizeStoredWorkspace(JSON.parse(JSON.stringify(stored))), stored);
  assert.notEqual(stored.messages, messages);
});

test('rejects mixed, forged, and oversized workspace generations', () => {
  const valid = createStoredWorkspace(CONVERSATION_MODE_FICTION, conversationId, []);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, extra: true }), /invalid schema/);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, mode: 'assistant' }), /fiction or personal_assistant/);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, conversationId: 'not-a-uuid' }), /must be a UUID/);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, messages: [{ role: 'system', content: 'inject' }] }), /message 0 is invalid/);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, messages: [{ role: 'user', content: '' }] }), /message 0 is invalid/);
  assert.throws(() => normalizeStoredWorkspace({ ...valid, messages: Array.from({ length: 1001 }, () => ({ role: 'user', content: 'x' })) }), /at most 1000/);
});

test('reserves both transcript slots before a user-assistant turn starts', () => {
  assert.equal(WORKSPACE_MAX_MESSAGES, 1000);
  assert.equal(workspaceReadyForCompletedTurn(998), true);
  assert.equal(workspaceReadyForCompletedTurn(999), false);
  assert.equal(workspaceReadyForCompletedTurn(1000), false);
  assert.equal(workspaceReadyForCompletedTurn(-1), false);
  assert.equal(workspaceReadyForCompletedTurn(1.5), false);
});

test('loads the authoritative envelope and discards conflicting legacy fields', () => {
  const current = createStoredWorkspace(CONVERSATION_MODE_PERSONAL_ASSISTANT, conversationId, [
    { role: 'user', content: 'Current atomic turn.' }
  ]);
  const storage = fakeStorage({
    [WORKSPACE_STORAGE_KEY]: JSON.stringify(current),
    [LEGACY_WORKSPACE_MODE_KEY]: CONVERSATION_MODE_FICTION,
    [LEGACY_WORKSPACE_CONVERSATION_ID_KEY]: replacementConversationId,
    [LEGACY_WORKSPACE_MESSAGES_KEY]: JSON.stringify([{ role: 'assistant', content: 'Stale legacy turn.' }])
  });
  const loaded = loadStoredWorkspace(storage, replacementConversationId);
  assert.equal(loaded.disposition, 'current');
  assert.deepEqual(loaded.workspace, current);
  assert.equal(storage.values.has(LEGACY_WORKSPACE_MODE_KEY), false);
  assert.equal(storage.operations.some(([operation]) => operation === 'set'), false);
});

test('migrates one complete legacy tuple by writing the envelope before cleanup', () => {
  const legacyMessages = [{ role: 'user', content: 'Legacy assistant turn.' }];
  const storage = fakeStorage({
    [LEGACY_WORKSPACE_MODE_KEY]: CONVERSATION_MODE_PERSONAL_ASSISTANT,
    [LEGACY_WORKSPACE_CONVERSATION_ID_KEY]: conversationId,
    [LEGACY_WORKSPACE_MESSAGES_KEY]: JSON.stringify(legacyMessages)
  });
  const loaded = loadStoredWorkspace(storage, replacementConversationId);
  assert.equal(loaded.disposition, 'migrated');
  assert.equal(loaded.workspace.mode, CONVERSATION_MODE_PERSONAL_ASSISTANT);
  assert.equal(loaded.workspace.conversationId, conversationId);
  assert.deepEqual(loaded.workspace.messages, legacyMessages);
  const writes = storage.operations.filter(([operation]) => operation === 'set');
  assert.equal(writes.length, 1);
  const setIndex = storage.operations.findIndex(([operation]) => operation === 'set');
  const firstRemoveIndex = storage.operations.findIndex(([operation]) => operation === 'remove');
  assert.ok(setIndex >= 0 && firstRemoveIndex > setIndex);
});

test('resets a malformed current envelope instead of combining stale legacy fields', () => {
  const storage = fakeStorage({
    [WORKSPACE_STORAGE_KEY]: '{bad json',
    [LEGACY_WORKSPACE_MODE_KEY]: CONVERSATION_MODE_PERSONAL_ASSISTANT,
    [LEGACY_WORKSPACE_CONVERSATION_ID_KEY]: conversationId,
    [LEGACY_WORKSPACE_MESSAGES_KEY]: JSON.stringify([{ role: 'user', content: 'Must not revive.' }])
  });
  const loaded = loadStoredWorkspace(storage, replacementConversationId);
  assert.equal(loaded.disposition, 'reset');
  assert.equal(loaded.workspace.mode, CONVERSATION_MODE_FICTION);
  assert.equal(loaded.workspace.conversationId, replacementConversationId);
  assert.deepEqual(loaded.workspace.messages, []);
});

test('normal save performs one authoritative set before deleting legacy keys', () => {
  const storage = fakeStorage();
  const workspace = createStoredWorkspace(CONVERSATION_MODE_FICTION, conversationId, []);
  saveStoredWorkspace(storage, workspace);
  assert.deepEqual(storage.operations.map(([operation, key]) => [operation, key]), [
    ['set', WORKSPACE_STORAGE_KEY],
    ['remove', LEGACY_WORKSPACE_MODE_KEY],
    ['remove', LEGACY_WORKSPACE_CONVERSATION_ID_KEY],
    ['remove', LEGACY_WORKSPACE_MESSAGES_KEY]
  ]);
  assert.deepEqual(JSON.parse(storage.values.get(WORKSPACE_STORAGE_KEY)), workspace);
});
