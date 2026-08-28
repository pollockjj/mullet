import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SUPPLEMENTAL_LOREBOOKS,
  appendLivingHistoryBoundary,
  assembleSupplementalLorebooks,
  currentLivingHistoryRequest,
  livingHistoryAutomaticUpdateDue,
  livingHistoryReadyForChat,
  normalizeStoredLivingHistoryBoundaries,
  pendingLivingHistoryMessageCount
} from '../src/lib/living-history-client.ts';
import {
  buildLivingHistoryRequest,
  createLivingHistoryResult,
  livingHistoryLorebook,
  livingHistorySourceForMessages
} from '../src/lib/living-history.ts';
import { normalizeLorebook } from '../src/lib/lorebook.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';

function transcript(pairCount) {
  return [
    { role: 'assistant', content: 'Opening greeting.' },
    ...Array.from({ length: pairCount }, (_unused, index) => [
      { role: 'user', content: `User ${index + 1}` },
      { role: 'assistant', content: `Assistant ${index + 1}` }
    ]).flat()
  ];
}

function boundaries(messages) {
  return messages.flatMap((message, index) => message.role === 'assistant' && index > 0
    ? [livingHistorySourceForMessages(conversationId, messages.slice(0, index + 1))]
    : []);
}

test('fires at five finalized pairs and sends all ten messages', () => {
  const fourPairs = transcript(4);
  const fourBoundaries = boundaries(fourPairs);
  assert.equal(pendingLivingHistoryMessageCount(fourBoundaries, null), 8);
  assert.equal(livingHistoryAutomaticUpdateDue(8), false);

  const fivePairs = transcript(5);
  const fiveBoundaries = boundaries(fivePairs);
  assert.equal(pendingLivingHistoryMessageCount(fiveBoundaries, null), 10);
  assert.equal(livingHistoryAutomaticUpdateDue(10), true);
  const request = currentLivingHistoryRequest(conversationId, fivePairs, null, fiveBoundaries);
  assert.equal(request?.turns.length, 10);
  assert.deepEqual(normalizeStoredLivingHistoryBoundaries(fiveBoundaries, conversationId, fivePairs), fiveBoundaries);
});

test('blocks the first chat until enabled history finishes restoring', () => {
  assert.equal(livingHistoryReadyForChat(true, false), false);
  assert.equal(livingHistoryReadyForChat(true, true), true);
  assert.equal(livingHistoryReadyForChat(false, false), true);
});

test('appends one finalized boundary idempotently and preserves later pending work', () => {
  const messages = transcript(2);
  const sources = boundaries(messages);
  const first = appendLivingHistoryBoundary([], sources[0]);
  assert.deepEqual(appendLivingHistoryBoundary(first, sources[0]), first);
  const both = appendLivingHistoryBoundary(first, sources[1]);
  const firstResult = createLivingHistoryResult(
    buildLivingHistoryRequest(conversationId, messages.slice(0, 3), null, [sources[0]]),
    'gemma-4-ortenzya',
    'First pair complete.'
  );
  assert.equal(pendingLivingHistoryMessageCount(both, firstResult), 2);
  assert.equal(currentLivingHistoryRequest(conversationId, messages, firstResult, both)?.turns.length, 2);
});

test('reserves one supplemental slot without mutating imported or generated raw books', () => {
  const messages = transcript(1);
  const result = createLivingHistoryResult(
    buildLivingHistoryRequest(conversationId, messages, null),
    'gemma-4-ortenzya',
    'One completed pair.'
  );
  const generated = livingHistoryLorebook(result);
  const imports = Array.from({ length: MAX_SUPPLEMENTAL_LOREBOOKS }, (_unused, index) => normalizeLorebook({
    name: `Book ${index}`,
    entries: { 0: { uid: 0, key: [], keysecondary: [], content: `Entry ${index}`, constant: true, disable: false } }
  }));
  const importedBytes = JSON.stringify(imports.map((book) => book.raw));
  const generatedBytes = JSON.stringify(generated.raw);
  assert.equal(assembleSupplementalLorebooks(imports, null).length, 20);
  assert.equal(assembleSupplementalLorebooks(imports.slice(0, 19), generated).length, 20);
  assert.throws(() => assembleSupplementalLorebooks(imports, generated), /At most 20 supplemental lorebooks/);
  assert.equal(JSON.stringify(imports.map((book) => book.raw)), importedBytes);
  assert.equal(JSON.stringify(generated.raw), generatedBytes);
});

test('updates finalized history through an aborted partial transcript suffix', () => {
  const finalized = transcript(5);
  const finalizedBoundaries = boundaries(finalized);
  const withAbortedPartial = [
    ...finalized,
    { role: 'user', content: 'Abort this turn.' },
    { role: 'assistant', content: 'Partial response that never received a terminal event.' }
  ];
  assert.equal(pendingLivingHistoryMessageCount(finalizedBoundaries, null), 10);
  const request = currentLivingHistoryRequest(conversationId, withAbortedPartial, null, finalizedBoundaries);
  assert.notEqual(request, null);
  assert.equal(request.source.messageCount, finalized.length);
  assert.equal(request.turns.length, 10);
  assert.equal(JSON.stringify(request).includes('Partial response that never received a terminal event.'), false);
});
