import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORED_WORKSPACE_SPEC,
  WORKSPACE_MAX_MESSAGES,
  createStoredWorkspace,
  normalizeStoredWorkspace,
  workspaceReadyForCompletedTurn
} from '../src/lib/workspace-state.ts';
import {
  CONVERSATION_MODE_FICTION,
  CONVERSATION_MODE_PERSONAL_ASSISTANT
} from '../src/lib/personal-assistant.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';

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
