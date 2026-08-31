import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuthoredOpeningReceipt,
  createCompletedFictionResponseReceipt,
  expressionRequestForFinalizedFictionResponse,
  fictionResponseReceiptMatchesMessages,
  normalizeFictionResponseReceipt
} from '../src/lib/fiction-finalization.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const otherConversationId = '29105fd4-7ee4-4909-af15-b7cb790b4c7e';

test('cryptographically receipts one authored assistant opening and exposes its expression request', () => {
  const messages = [{ role: 'assistant', content: 'Jenna watches you enter the flight deck.' }];
  const receipt = createAuthoredOpeningReceipt(conversationId, messages);

  assert.equal(receipt.kind, 'authored_opening');
  assert.deepEqual(receipt.source, {
    conversationId,
    messageCount: 1,
    messageIndex: 0,
    role: 'assistant',
    fingerprint: receipt.source.fingerprint
  });
  assert.match(receipt.source.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(normalizeFictionResponseReceipt(receipt, conversationId, messages), receipt);
  assert.deepEqual(expressionRequestForFinalizedFictionResponse(receipt, conversationId, messages), {
    spec: 'mullet_sidecar_request_v1',
    kind: 'expression',
    source: {
      conversationId,
      messageCount: 1,
      messageIndex: 0,
      role: 'assistant'
    },
    text: messages[0].content
  });
  assert.throws(
    () => createAuthoredOpeningReceipt(conversationId, [
      { role: 'user', content: 'Not an authored opening.' },
      { role: 'assistant', content: 'Nor is this.' }
    ]),
    /exactly one/
  );
});

test('uses living-history provenance for the latest completed user-assistant turn', () => {
  const messages = [
    { role: 'assistant', content: 'An authored opening.' },
    { role: 'user', content: 'Where are we?' },
    { role: 'assistant', content: 'Aboard the Liberator.' }
  ];
  const receipt = createCompletedFictionResponseReceipt(conversationId, messages);

  assert.equal(receipt.kind, 'completed_turn');
  assert.equal(receipt.source.messageCount, messages.length);
  assert.equal(receipt.source.messageIndex, messages.length - 1);
  assert.match(receipt.source.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.source.turnFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.source.rawFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fictionResponseReceiptMatchesMessages(receipt, conversationId, messages), true);
  assert.equal(
    expressionRequestForFinalizedFictionResponse(receipt, conversationId, messages)?.text,
    'Aboard the Liberator.'
  );
});

test('an aborted nonempty partial assistant response cannot inherit the prior finalized receipt', () => {
  const completed = [
    { role: 'user', content: 'Report.' },
    { role: 'assistant', content: 'All systems are nominal.' }
  ];
  const receipt = createCompletedFictionResponseReceipt(conversationId, completed);
  const abortedWithPartial = [
    ...completed,
    { role: 'user', content: 'And the pursuit ships?' },
    { role: 'assistant', content: 'They are' }
  ];

  assert.equal(fictionResponseReceiptMatchesMessages(receipt, conversationId, abortedWithPartial), false);
  assert.equal(
    expressionRequestForFinalizedFictionResponse(receipt, conversationId, abortedWithPartial),
    null
  );
});

test('an empty failed response that leaves a trailing user also has no finalized expression source', () => {
  const completed = [
    { role: 'user', content: 'Report.' },
    { role: 'assistant', content: 'All systems are nominal.' }
  ];
  const receipt = createCompletedFictionResponseReceipt(conversationId, completed);
  const failedWithoutAssistantText = [
    ...completed,
    { role: 'user', content: 'And the pursuit ships?' }
  ];

  assert.equal(fictionResponseReceiptMatchesMessages(receipt, conversationId, failedWithoutAssistantText), false);
  assert.equal(
    expressionRequestForFinalizedFictionResponse(receipt, conversationId, failedWithoutAssistantText),
    null
  );
});

test('rejects forged, stale, cross-conversation, and transcript-prefix receipts', () => {
  const messages = [
    { role: 'user', content: 'Report.' },
    { role: 'assistant', content: 'All systems are nominal.' }
  ];
  const completed = createCompletedFictionResponseReceipt(conversationId, messages);
  const openingMessages = [{ role: 'assistant', content: 'A canonical opening.' }];
  const opening = createAuthoredOpeningReceipt(conversationId, openingMessages);

  assert.equal(fictionResponseReceiptMatchesMessages({
    ...completed,
    source: { ...completed.source, fingerprint: `sha256:${'0'.repeat(64)}` }
  }, conversationId, messages), false);
  assert.equal(fictionResponseReceiptMatchesMessages(completed, otherConversationId, messages), false);
  assert.equal(fictionResponseReceiptMatchesMessages(completed, conversationId, [
    messages[0],
    { role: 'assistant', content: `${messages[1].content} ` }
  ]), false);
  assert.equal(fictionResponseReceiptMatchesMessages(completed, conversationId, [
    ...messages,
    { role: 'user', content: 'A later pending turn.' }
  ]), false);
  assert.equal(fictionResponseReceiptMatchesMessages(opening, conversationId, [
    { role: 'assistant', content: 'A forged replacement opening.' }
  ]), false);
  assert.equal(fictionResponseReceiptMatchesMessages({
    ...opening,
    source: { ...opening.source, fingerprint: `sha256:${'f'.repeat(64)}` }
  }, conversationId, openingMessages), false);
});
