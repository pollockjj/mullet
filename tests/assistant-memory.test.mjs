import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTANT_MEMORY_FACT_LIMIT,
  ASSISTANT_MEMORY_LOREBOOK_NAME,
  ASSISTANT_MEMORY_MAX_TOKENS,
  ASSISTANT_MEMORY_PREFERENCE_LIMIT,
  ASSISTANT_MEMORY_REQUEST_SPEC,
  ASSISTANT_MEMORY_SYSTEM_PROMPT,
  ASSISTANT_MEMORY_TASK_LIMIT,
  ASSISTANT_MEMORY_TIMEOUT_MS,
  ASSISTANT_MEMORY_TOTAL_RECORD_LIMIT,
  assistantMemoryEmptyFingerprint,
  assistantMemoryLorebook,
  assistantMemoryModelInput,
  assistantMemoryResultMatchesRequest,
  assistantMemoryStateFingerprint,
  buildAssistantMemoryRequest,
  createAssistantMemoryResult,
  isAssistantMemoryLorebook,
  normalizeAssistantMemoryRequest,
  parseAssistantMemoryResponse
} from '../src/lib/assistant-memory.ts';

const memoryId = 'a1304ec0-6907-4f94-a419-d4b46e922621';
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const messages = Object.freeze([
  Object.freeze({
    role: 'user',
    content: 'Remember that I work on Atlas. I prefer concise status reports. I need to submit the Atlas proposal by Friday.'
  }),
  Object.freeze({ role: 'assistant', content: 'I will keep reports concise and track the proposal task.' })
]);

function mutationResponse(overrides = {}) {
  return JSON.stringify({
    facts: [{
      operation: 'create',
      key: 'atlas-project',
      value: 'The user works on Atlas.',
      evidence: { message_index: 0, text: 'I work on Atlas' }
    }],
    preferences: [{
      operation: 'create',
      key: 'status-report-style',
      value: 'Concise status reports.',
      evidence: { message_index: 0, text: 'I prefer concise status reports' }
    }],
    tasks: [{
      operation: 'create',
      key: 'submit-atlas-proposal',
      text: 'Submit the Atlas proposal.',
      due_text: 'Friday',
      evidence: { message_index: 0, text: 'I need to submit the Atlas proposal by Friday' }
    }],
    ...overrides
  });
}

function firstResult() {
  const request = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  return createAssistantMemoryResult(request, 'gemma-4-ortenzya', parseAssistantMemoryResponse(mutationResponse(), request));
}

test('builds one isolated completed-turn request without mutating canonical chat', () => {
  const canonical = JSON.stringify(messages);
  const request = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  assert.equal(request.spec, ASSISTANT_MEMORY_REQUEST_SPEC);
  assert.equal(request.memoryId, memoryId);
  assert.equal(request.parentFingerprint, assistantMemoryEmptyFingerprint(memoryId));
  assert.equal(request.previous.revision, 0);
  assert.deepEqual(request.turns, [
    { role: 'user', messageIndex: 0, content: messages[0].content },
    { role: 'assistant', messageIndex: 1, content: messages[1].content }
  ]);
  assert.deepEqual(JSON.parse(assistantMemoryModelInput(request)), {
    previous_memory: { revision: 0, facts: [], preferences: [], tasks: [] },
    current_turn: [
      { role: 'user', message_index: 0, content: messages[0].content },
      { role: 'assistant', message_index: 1, content: messages[1].content }
    ]
  });
  assert.deepEqual(normalizeAssistantMemoryRequest(request), request);
  assert.equal(JSON.stringify(messages), canonical);
  assert.equal(ASSISTANT_MEMORY_MAX_TOKENS, 3_072);
  assert.equal(ASSISTANT_MEMORY_TIMEOUT_MS, 60_000);
  assert.equal(ASSISTANT_MEMORY_FACT_LIMIT, 16);
  assert.equal(ASSISTANT_MEMORY_PREFERENCE_LIMIT, 16);
  assert.equal(ASSISTANT_MEMORY_TASK_LIMIT, 16);
  assert.equal(ASSISTANT_MEMORY_TOTAL_RECORD_LIMIT, 24);
  assert.match(ASSISTANT_MEMORY_SYSTEM_PROMPT, /current USER message/);
  assert.match(ASSISTANT_MEMORY_SYSTEM_PROMPT, /assistant message.*never evidence/i);
});

test('creates provenance-bound facts, preferences, and open tasks', () => {
  const request = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  const operations = parseAssistantMemoryResponse(mutationResponse(), request);
  const result = createAssistantMemoryResult(request, 'gemma-4-ortenzya', operations);
  assert.equal(result.output.revision, 1);
  assert.equal(result.output.facts[0].status, 'active');
  assert.equal(result.output.preferences[0].status, 'active');
  assert.equal(result.output.tasks[0].status, 'open');
  assert.equal(result.output.tasks[0].dueText, 'Friday');
  assert.deepEqual(result.output.tasks[0].evidence, [{
    conversationId,
    messageIndex: 0,
    turnFingerprint: request.source.turnFingerprint,
    text: 'I need to submit the Atlas proposal by Friday'
  }]);
  assert.equal(assistantMemoryResultMatchesRequest(result, request), true);
  assert.match(assistantMemoryStateFingerprint(result), /^sha256:[0-9a-f]{64}$/);
});

test('keeps one global ledger across chat resets and preserves task lifecycle values', () => {
  const previous = firstResult();
  const completedConversationId = '29105fd4-7ee4-4909-af15-b7cb790b4c7e';
  const completedMessages = [
    { role: 'user', content: 'I completed the Atlas proposal.' },
    { role: 'assistant', content: 'The proposal is marked complete.' }
  ];
  const completeRequest = buildAssistantMemoryRequest(memoryId, completedConversationId, completedMessages, previous);
  assert.equal(completeRequest.previous.revision, 1);
  assert.equal(completeRequest.source.conversationId, completedConversationId);
  const complete = parseAssistantMemoryResponse(JSON.stringify({
    facts: [],
    preferences: [],
    tasks: [{
      operation: 'complete',
      key: 'submit-atlas-proposal',
      text: 'Submit the Atlas proposal.',
      due_text: 'Friday',
      evidence: { message_index: 0, text: 'I completed the Atlas proposal' }
    }]
  }), completeRequest);
  const completed = createAssistantMemoryResult(completeRequest, 'gemma-4-ortenzya', complete);
  assert.equal(completed.output.tasks[0].status, 'done');
  assert.equal(completed.output.tasks[0].dueText, 'Friday');

  const reopenedConversationId = '7d9f8be1-fd08-42d2-9019-a38af1671bad';
  const reopenRequest = buildAssistantMemoryRequest(memoryId, reopenedConversationId, [
    { role: 'user', content: 'Reopen the Atlas proposal task.' },
    { role: 'assistant', content: 'The task is open again.' }
  ], completed);
  const reopened = createAssistantMemoryResult(reopenRequest, 'gemma-4-ortenzya', parseAssistantMemoryResponse(JSON.stringify({
    facts: [],
    preferences: [],
    tasks: [{
      operation: 'reopen',
      key: 'submit-atlas-proposal',
      text: 'Submit the Atlas proposal.',
      due_text: 'Friday',
      evidence: { message_index: 0, text: 'Reopen the Atlas proposal task' }
    }]
  }), reopenRequest));
  assert.equal(reopened.output.revision, 3);
  assert.equal(reopened.output.tasks[0].status, 'open');
  assert.equal(reopened.output.tasks[0].evidence.length, 3);
});

test('retains forgotten tombstones and excludes closed or forgotten records from prompt projection', () => {
  const previous = firstResult();
  const replaceRequest = buildAssistantMemoryRequest(memoryId, 'bd0e5c6c-25ba-4df6-8b67-c63a3a0877dc', [
    { role: 'user', content: 'I now work on Apollo instead of Atlas.' },
    { role: 'assistant', content: 'I will remember the Apollo correction.' }
  ], previous);
  const replaced = createAssistantMemoryResult(replaceRequest, 'gemma-4-ortenzya', parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'replace',
      key: 'atlas-project',
      value: 'The user works on Apollo.',
      evidence: { message_index: 0, text: 'I now work on Apollo instead of Atlas' }
    }],
    preferences: [],
    tasks: []
  }), replaceRequest));
  assert.equal(replaced.output.facts[0].value, 'The user works on Apollo.');

  const forgetRequest = buildAssistantMemoryRequest(memoryId, 'eff4b1cf-8642-4df4-b8c3-83a46b5b4d38', [
    { role: 'user', content: 'Forget that project fact.' },
    { role: 'assistant', content: 'That project fact is forgotten.' }
  ], replaced);
  const forgotten = createAssistantMemoryResult(forgetRequest, 'gemma-4-ortenzya', parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'forget',
      key: 'atlas-project',
      value: 'The user works on Apollo.',
      evidence: { message_index: 0, text: 'Forget that project fact' }
    }],
    preferences: [],
    tasks: []
  }), forgetRequest));
  assert.equal(forgotten.output.facts[0].status, 'forgotten');
  const book = assistantMemoryLorebook(forgotten);
  assert.ok(book);
  assert.equal(book.entries.some((entry) => entry.content.includes('Apollo')), false);
  const invalidReplaceRequest = buildAssistantMemoryRequest(memoryId, '77949052-41aa-461a-a8d3-a14051c3acf8', [
    { role: 'user', content: 'I now work on Horizon.' },
    { role: 'assistant', content: 'I will update that project fact.' }
  ], forgotten);
  const invalidReplace = parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'replace',
      key: 'atlas-project',
      value: 'The user works on Horizon.',
      evidence: { message_index: 0, text: 'I now work on Horizon' }
    }],
    preferences: [],
    tasks: []
  }), invalidReplaceRequest);
  assert.throws(
    () => createAssistantMemoryResult(invalidReplaceRequest, 'gemma-4-ortenzya', invalidReplace),
    /non-active key/
  );
});

test('rejects ungrounded, duplicate, oversized, and non-exact sidecar output', () => {
  const request = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  assert.throws(() => parseAssistantMemoryResponse('not json', request), /invalid JSON/);
  assert.throws(() => parseAssistantMemoryResponse('{"facts":[],"preferences":[],"tasks":[],"extra":true}', request), /invalid schema/);
  assert.throws(() => parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'create', key: 'Bad_Key', value: 'x',
      evidence: { message_index: 0, text: 'I work on Atlas' }
    }], preferences: [], tasks: []
  }), request), /lowercase kebab-case/);
  assert.throws(() => parseAssistantMemoryResponse(JSON.stringify({
    facts: [{
      operation: 'create', key: 'invented', value: 'x',
      evidence: { message_index: 1, text: 'keep reports concise' }
    }], preferences: [], tasks: []
  }), request), /not a verbatim excerpt/);
  assert.throws(() => parseAssistantMemoryResponse(JSON.stringify({
    facts: [], preferences: [], tasks: [{
      operation: 'create', key: 'invented-deadline', text: 'Do something.', due_text: 'Monday',
      evidence: { message_index: 0, text: 'I work on Atlas' }
    }]
  }), request), /due_text is not a verbatim excerpt/);
  const duplicate = {
    operation: 'create', key: 'same-key', value: 'x',
    evidence: { message_index: 0, text: 'I work on Atlas' }
  };
  assert.throws(() => parseAssistantMemoryResponse(JSON.stringify({
    facts: [duplicate, duplicate], preferences: [], tasks: []
  }), request), /duplicate operation keys/);
  const fact = (index) => ({
    operation: 'create', key: `fact-${index}`, value: 'x',
    evidence: { message_index: 0, text: 'I work on Atlas' }
  });
  const preference = (index) => ({ ...fact(index), key: `preference-${index}` });
  const task = (index) => ({
    operation: 'create', key: `task-${index}`, text: 'x', due_text: '',
    evidence: { message_index: 0, text: 'I work on Atlas' }
  });
  assert.throws(() => parseAssistantMemoryResponse(JSON.stringify({
    facts: Array.from({ length: 8 }, (_unused, index) => fact(index)),
    preferences: Array.from({ length: 8 }, (_unused, index) => preference(index)),
    tasks: Array.from({ length: 9 }, (_unused, index) => task(index))
  }), request), /at most 24 operations/);
  const bounded = parseAssistantMemoryResponse(JSON.stringify({
    facts: Array.from({ length: 16 }, (_unused, index) => ({ ...fact(index), value: 'x'.repeat(180) })),
    preferences: Array.from({ length: 8 }, (_unused, index) => ({ ...preference(index), value: 'x'.repeat(180) })),
    tasks: []
  }), request);
  assert.throws(() => createAssistantMemoryResult(request, 'gemma-4-ortenzya', bounded), /exceeds 3200 state characters/);
});

test('rejects stale ancestry and transcript tampering', () => {
  const request = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  const badParent = structuredClone(request);
  badParent.parentFingerprint = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => normalizeAssistantMemoryRequest(badParent), /does not match its previous state/);
  const badTurn = structuredClone(request);
  badTurn.turns[0].content = 'A substituted user instruction.';
  assert.throws(() => normalizeAssistantMemoryRequest(badTurn), /source does not match the supplied turn/);
  const result = firstResult();
  const staleResult = structuredClone(result);
  staleResult.source.fingerprint = `sha256:${'1'.repeat(64)}`;
  assert.equal(assistantMemoryResultMatchesRequest(staleResult, request), false);
});

test('projects only active records into a strict generated assistant-memory lorebook', () => {
  const result = firstResult();
  const book = assistantMemoryLorebook(result);
  assert.ok(book);
  assert.equal(book.name, ASSISTANT_MEMORY_LOREBOOK_NAME);
  assert.equal(isAssistantMemoryLorebook(book), true);
  assert.deepEqual(book.entries.map((entry) => entry.insertionOrder), [940, 950, 960]);
  assert.equal(book.entries.every((entry) => (
    entry.constant
    && entry.position === 1
    && entry.ignoreBudget
    && entry.excludeRecursion
    && entry.preventRecursion
  )), true);
  const projection = book.entries.map((entry) => entry.content).join('\n');
  assert.match(projection, /"Concise status reports\."/);
  assert.match(projection, /"Friday"/);
  assert.equal(projection.includes('I prefer concise status reports'), false);

  const tampered = structuredClone(book);
  tampered.raw.extensions.mullet.kind = 'fiction_lore';
  assert.equal(isAssistantMemoryLorebook(tampered), false);

  const emptyRequest = buildAssistantMemoryRequest(memoryId, conversationId, messages, null);
  const emptyResult = createAssistantMemoryResult(emptyRequest, 'gemma-4-ortenzya', {
    facts: [], preferences: [], tasks: []
  });
  assert.equal(assistantMemoryLorebook(emptyResult), null);
});
