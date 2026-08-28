import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssistantMemoryRequest,
  createAssistantMemoryResult,
  parseAssistantMemoryResponse
} from '../src/lib/assistant-memory.ts';
import {
  ASSISTANT_MEMORY_DATABASE_VERSION,
  AssistantMemoryConflictError,
  STORED_ASSISTANT_MEMORY_PENDING_SPEC,
  STORED_ASSISTANT_MEMORY_SPEC,
  assistantMemoryPendingMatchesResult,
  assistantMemoryTurnKey,
  assistantMemoryWriteBaseMatches,
  clearAssistantMemoryAtEpoch,
  commitAssistantMemoryResult,
  createStoredAssistantMemoryPendingTurn,
  normalizeStoredAssistantMemoryPendingTurn,
  restoreAssistantMemoryResult,
  unwrapStoredAssistantMemory,
  unwrapStoredAssistantMemoryPendingTurn
} from '../src/lib/assistant-memory-storage.ts';

const memoryId = 'a1304ec0-6907-4f94-a419-d4b46e922621';
const otherMemoryId = 'c051092a-0605-4965-a4c4-c6db63c4d03f';
const epoch = 'b2681883-7715-4414-aad6-3252981aba99';

function firstPair() {
  const request = buildAssistantMemoryRequest(memoryId, '8d78c151-83f0-4c72-9b9b-1ab957adca78', [
    { role: 'user', content: 'I prefer concise reports.' },
    { role: 'assistant', content: 'I will keep reports concise.' }
  ], null);
  const operations = parseAssistantMemoryResponse(JSON.stringify({
    facts: [],
    preferences: [{
      operation: 'create', key: 'report-style', value: 'I prefer concise reports',
      evidence: { message_index: 0, text: 'I prefer concise reports' }
    }],
    tasks: []
  }), request);
  return { request, result: createAssistantMemoryResult(request, 'gemma-4-ortenzya', operations) };
}

function secondPair(previous) {
  const request = buildAssistantMemoryRequest(memoryId, '92610ce5-4a1e-4382-825e-919da196f9ac', [
    { role: 'user', content: 'Remember that Atlas is my current project.' },
    { role: 'assistant', content: 'I will remember the Atlas project.' }
  ], previous);
  const operations = parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'create', key: 'current-project', value: 'Atlas is my current project',
      evidence: { message_index: 0, text: 'Atlas is my current project' }
    }],
    preferences: [],
    tasks: []
  }), request);
  return { request, result: createAssistantMemoryResult(request, 'gemma-4-ortenzya', operations) };
}

function pendingFromRequest(request) {
  return createStoredAssistantMemoryPendingTurn(memoryId, epoch, request.source, request.turns);
}

test('fences state by ledger-specific ancestry, epoch, and memory ID', () => {
  const first = firstPair().result;
  const next = secondPair(first).result;
  const stale = secondPair(first).result;
  assert.equal(ASSISTANT_MEMORY_DATABASE_VERSION, 1);
  assert.equal(assistantMemoryWriteBaseMatches(null, first), true);
  assert.equal(assistantMemoryWriteBaseMatches(first, next), true);
  assert.equal(assistantMemoryWriteBaseMatches(next, stale), false);
  const crossMemory = structuredClone(first);
  crossMemory.memoryId = otherMemoryId;
  assert.equal(assistantMemoryWriteBaseMatches(first, crossMemory), false);
  assert.equal(new AssistantMemoryConflictError().name, 'AssistantMemoryConflictError');
});

test('unwraps only exact envelopes from the requested generation', () => {
  const first = firstPair().result;
  const envelope = { spec: STORED_ASSISTANT_MEMORY_SPEC, writeId: 'writer-a', epoch, result: first };
  assert.deepEqual(unwrapStoredAssistantMemory(envelope, epoch, memoryId), first);
  assert.equal(unwrapStoredAssistantMemory(first, epoch, memoryId), null);
  assert.equal(unwrapStoredAssistantMemory(envelope, crypto.randomUUID(), memoryId), null);
  assert.equal(unwrapStoredAssistantMemory(envelope, epoch, otherMemoryId), null);
  assert.throws(
    () => unwrapStoredAssistantMemory({ ...envelope, extra: true }, epoch, memoryId),
    /invalid schema/
  );
});

test('normalizes an exact idempotent persisted turn and rejects generation drift', () => {
  const { request } = firstPair();
  const pending = pendingFromRequest(request);
  assert.equal(pending.spec, STORED_ASSISTANT_MEMORY_PENDING_SPEC);
  assert.equal(pending.turnKey, assistantMemoryTurnKey(memoryId, request.source));
  assert.deepEqual(normalizeStoredAssistantMemoryPendingTurn(pending), pending);
  assert.deepEqual(unwrapStoredAssistantMemoryPendingTurn(pending, epoch, memoryId), pending);
  assert.equal(unwrapStoredAssistantMemoryPendingTurn(pending, crypto.randomUUID(), memoryId), null);
  assert.equal(unwrapStoredAssistantMemoryPendingTurn(pending, epoch, otherMemoryId), null);
  assert.throws(
    () => normalizeStoredAssistantMemoryPendingTurn({ ...pending, turnKey: `sha256:${'0'.repeat(64)}` }),
    /turn key is invalid/
  );
});

test('binds an atomic candidate to the exact persisted pending turn', () => {
  const first = firstPair();
  const firstPending = pendingFromRequest(first.request);
  assert.equal(assistantMemoryPendingMatchesResult(firstPending, null, first.result), true);
  const second = secondPair(first.result);
  const secondPending = pendingFromRequest(second.request);
  assert.equal(assistantMemoryPendingMatchesResult(secondPending, first.result, second.result), true);
  assert.equal(assistantMemoryPendingMatchesResult(firstPending, first.result, second.result), false);
  const forged = structuredClone(first.result);
  forged.output.preferences[0].value = 'Mars';
  assert.equal(assistantMemoryPendingMatchesResult(firstPending, null, forged), false);
});

test('conditionally rolls back a delayed commit that loses its generation', async () => {
  const candidate = firstPair().result;
  let current = true;
  let discarded = null;
  let installed = false;
  let releaseSave;
  const saveBlocked = new Promise((resolve) => { releaseSave = resolve; });
  const committing = commitAssistantMemoryResult(candidate, {
    save: async () => {
      await saveBlocked;
      return { writeId: 'stale-writer', previousRaw: null, pendingRaw: { keep: true } };
    },
    isCurrent: () => current,
    discard: async (receipt) => { discarded = receipt; },
    install: () => { installed = true; }
  });
  current = false;
  releaseSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discarded.writeId, 'stale-writer');
  assert.deepEqual(discarded.pendingRaw, { keep: true });
});

test('restores global memory without requiring the current conversation ID', async () => {
  const first = firstPair().result;
  let installed = null;
  const restored = await restoreAssistantMemoryResult({
    load: async () => first,
    isCurrent: () => true,
    accepts: (candidate) => candidate.memoryId === memoryId,
    install: (candidate) => { installed = candidate; }
  });
  assert.equal(restored.source.conversationId, '8d78c151-83f0-4c72-9b9b-1ab957adca78');
  assert.deepEqual(installed, first);
});

test('publishes a new generation under the lock before clearing state and pending work', async () => {
  const nextEpoch = crypto.randomUUID();
  const events = [];
  await clearAssistantMemoryAtEpoch(nextEpoch, {
    exclusive: async (operation) => {
      events.push('locked');
      const value = await operation();
      events.push('released');
      return value;
    },
    publishEpoch: (value) => { events.push(`epoch:${value}`); },
    clear: async () => { events.push('clear-state-and-pending'); }
  });
  assert.deepEqual(events, ['locked', `epoch:${nextEpoch}`, 'clear-state-and-pending', 'released']);
});
