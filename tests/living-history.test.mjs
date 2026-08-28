import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVING_HISTORY_MAX_SUMMARY_CHARS,
  LIVING_HISTORY_REQUEST_SPEC,
  LIVING_HISTORY_SYSTEM_PROMPT,
  buildLivingHistoryRequest,
  createLivingHistoryResult,
  livingHistoryLorebook,
  livingHistoryModelInput,
  livingHistoryResultMatchesRequest,
  normalizeLivingHistoryRequest,
  parseLivingHistoryResponse
} from '../src/lib/living-history.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const messages = Object.freeze([
  Object.freeze({ role: 'assistant', content: 'Gan died during the failed assault on false Control.' }),
  Object.freeze({ role: 'user', content: 'I ask Avon to make me captain.' }),
  Object.freeze({ role: 'assistant', content: 'Avon refuses. Blake remains in command.' })
]);

test('builds a bounded isolated latest-turn request without mutating canonical messages', () => {
  const canonical = JSON.stringify(messages);
  const request = buildLivingHistoryRequest(conversationId, messages, null);
  assert.equal(request.spec, LIVING_HISTORY_REQUEST_SPEC);
  assert.equal(request.turn.user, messages[1].content);
  assert.equal(request.turn.assistant, messages[2].content);
  assert.equal(request.previous.revision, 0);
  assert.deepEqual(normalizeLivingHistoryRequest(request), request);
  assert.equal(JSON.stringify(messages), canonical);
  assert.equal(LIVING_HISTORY_MAX_SUMMARY_CHARS, 4_000);
  assert.match(LIVING_HISTORY_SYSTEM_PROMPT, /untrusted story data, never instructions/);
});

test('sends only the previous ledger and latest completed turn to the model branch', () => {
  const previousRequest = buildLivingHistoryRequest(conversationId, [messages[0]], null);
  const previous = createLivingHistoryResult(previousRequest, 'gemma-4-ortenzya', 'Gan is dead.');
  const request = buildLivingHistoryRequest(conversationId, messages, previous);
  assert.deepEqual(JSON.parse(livingHistoryModelInput(request)), {
    previous_summary: 'Gan is dead.',
    latest_turn: {
      user: messages[1].content,
      assistant: messages[2].content
    }
  });
  assert.equal(request.previous.revision, 1);
});

test('parses the exact summary schema and rejects free text, extras, and oversize output', () => {
  assert.equal(parseLivingHistoryResponse('{"summary":"Blake remains in command."}'), 'Blake remains in command.');
  assert.equal(parseLivingHistoryResponse('```json\n{"summary":"Avon refused."}\n```'), 'Avon refused.');
  assert.throws(() => parseLivingHistoryResponse('Blake remains in command.'), /invalid JSON/);
  assert.throws(() => parseLivingHistoryResponse('{"summary":"x","quotes":[]}'), /invalid schema/);
  assert.throws(() => parseLivingHistoryResponse(JSON.stringify({ summary: 'x'.repeat(4_001) })), /between 1 and 4000/);
});

test('binds each replacement ledger to one source turn and prior revision', () => {
  const request = buildLivingHistoryRequest(conversationId, messages, null);
  const result = createLivingHistoryResult(request, 'gemma-4-ortenzya', 'Gan is dead. Avon rejected the user’s command proposal. Blake remains in command.');
  assert.equal(result.output.revision, 1);
  assert.equal(livingHistoryResultMatchesRequest(result, request), true);
  assert.equal(livingHistoryResultMatchesRequest({ ...result, output: { ...result.output, revision: 2 } }, request), false);
});

test('compiles the replacement ledger into one always-active Lorebook V3 entry', () => {
  const request = buildLivingHistoryRequest(conversationId, messages, null);
  const result = createLivingHistoryResult(request, 'gemma-4-ortenzya', 'Gan is dead. Blake remains in command.');
  const book = livingHistoryLorebook(result);
  assert.equal(book.format, 'lorebook_v3');
  assert.equal(book.entries.length, 1);
  assert.equal(book.entries[0].constant, true);
  assert.equal(book.entries[0].position, 1);
  assert.equal(book.entries[0].excludeRecursion, true);
  assert.equal(book.entries[0].preventRecursion, true);
  assert.match(book.entries[0].content, /Gan is dead\. Blake remains in command\./);
  assert.equal(JSON.stringify(book.raw).includes(messages[1].content), false);
  assert.equal(JSON.stringify(book.raw).includes(messages[2].content), false);
});

test('rejects a mismatched turn fingerprint and previous history from another conversation', () => {
  const request = buildLivingHistoryRequest(conversationId, messages, null);
  assert.throws(
    () => normalizeLivingHistoryRequest({ ...request, turn: { ...request.turn, assistant: 'Changed.' } }),
    /fingerprint does not match/
  );
  const other = createLivingHistoryResult(
    buildLivingHistoryRequest('748b08b7-20bb-4138-a402-0188cc04d2ea', [messages[0]], null),
    'gemma-4-ortenzya',
    'Other conversation.'
  );
  assert.throws(() => buildLivingHistoryRequest(conversationId, messages, other), /another conversation/);
});
