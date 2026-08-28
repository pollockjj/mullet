import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssistantMemoryRequest,
  createAssistantMemoryResult,
  parseAssistantMemoryResponse
} from '../src/lib/assistant-memory.ts';
import {
  assistantMemoryInjectionStatusText,
  assistantMemoryPendingAlreadyCommitted,
  assistantMemoryReadyForSend,
  assistantMemoryRequestKey,
  currentAssistantMemoryRequest,
  parseAssistantMemoryActiveHeader
} from '../src/lib/assistant-memory-client.ts';
import { createStoredAssistantMemoryPendingTurn } from '../src/lib/assistant-memory-storage.ts';
import {
  CONVERSATION_MODE_FICTION,
  CONVERSATION_MODE_PERSONAL_ASSISTANT
} from '../src/lib/personal-assistant.ts';

const memoryId = 'a1304ec0-6907-4f94-a419-d4b46e922621';
const epoch = 'b2681883-7715-4414-aad6-3252981aba99';

function fixture(previous = null) {
  const request = buildAssistantMemoryRequest(memoryId, crypto.randomUUID(), [
    { role: 'user', content: 'I prefer concise updates.' },
    { role: 'assistant', content: 'I will keep updates concise.' }
  ], previous);
  const pending = createStoredAssistantMemoryPendingTurn(memoryId, epoch, request.source, request.turns);
  return { request, pending };
}

test('rebuilds the exact pending turn against the latest global parent', () => {
  const first = fixture();
  const firstResult = createAssistantMemoryResult(first.request, 'gemma-4-ortenzya', parseAssistantMemoryResponse(JSON.stringify({
    facts: [],
    preferences: [{
      operation: 'create', key: 'update-style', value: 'I prefer concise updates',
      evidence: { message_index: 0, text: 'I prefer concise updates' }
    }],
    tasks: []
  }), first.request));
  const second = fixture(firstResult);
  const rebuilt = currentAssistantMemoryRequest(memoryId, second.pending, firstResult);
  assert.deepEqual(rebuilt, second.request);
  assert.equal(assistantMemoryRequestKey(rebuilt, second.pending), `${second.pending.turnKey}:${second.request.parentFingerprint}`);
  assert.equal(currentAssistantMemoryRequest(crypto.randomUUID(), second.pending, firstResult), null);
});

test('recognizes a workspace outbox already committed to active memory', () => {
  const first = fixture();
  const result = createAssistantMemoryResult(first.request, 'gemma-4-ortenzya', parseAssistantMemoryResponse(JSON.stringify({
    facts: [], preferences: [], tasks: []
  }), first.request));
  assert.equal(assistantMemoryPendingAlreadyCommitted(first.pending, result), true);
  assert.equal(assistantMemoryPendingAlreadyCommitted(first.pending, null), false);
  assert.equal(assistantMemoryPendingAlreadyCommitted(null, result), false);
});

test('blocks every assistant send until persistence is ready and the pending update commits', () => {
  const { pending } = fixture();
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_FICTION, false, false, true, true, pending), true);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, false, true, false, false, null), false);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, true, false, false, false, null), false);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, true, true, true, false, null), false);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, true, true, false, true, null), false);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, true, true, false, false, pending), false);
  assert.equal(assistantMemoryReadyForSend(CONVERSATION_MODE_PERSONAL_ASSISTANT, true, true, false, false, null), true);
});

test('parses only exact assistant-memory activation headers', () => {
  assert.equal(parseAssistantMemoryActiveHeader('1'), true);
  assert.equal(parseAssistantMemoryActiveHeader('0'), false);
  assert.equal(parseAssistantMemoryActiveHeader(null), null);
  assert.equal(parseAssistantMemoryActiveHeader('true'), null);
});

test('reports only persisted completed-chat injection receipts', () => {
  assert.equal(assistantMemoryInjectionStatusText(0, null), 'No completed assistant chat yet.');
  assert.equal(
    assistantMemoryInjectionStatusText(2, null),
    'No memory-injection receipt is available for this restored transcript.'
  );
  assert.equal(
    assistantMemoryInjectionStatusText(2, false),
    'No active stored memory was injected into the last completed chat.'
  );
  assert.equal(
    assistantMemoryInjectionStatusText(2, true),
    'Active stored memory was injected into the last completed chat.'
  );
});
