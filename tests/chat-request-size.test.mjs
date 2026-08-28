import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CHAT_REQUEST_BYTES,
  assertChatRequestTextSize,
  chatRequestByteLength,
  serializeChatRequest
} from '../src/lib/chat-request-size.ts';

test('keeps browser chat requests below the deployed body-size limit', () => {
  assert.equal(MAX_CHAT_REQUEST_BYTES, 31 * 1024 * 1024);
  assert.equal(serializeChatRequest({ message: 'ok' }, 64), '{"message":"ok"}');
  assert.throws(
    () => serializeChatRequest({ message: 'four-byte: 😀' }, 20),
    /requires fewer messages or active lorebooks/
  );
});

test('enforces the same UTF-8 request bound on the server text body', () => {
  assert.equal(chatRequestByteLength('😀'), 4);
  assert.doesNotThrow(() => assertChatRequestTextSize('x'.repeat(64), 64));
  assert.throws(() => assertChatRequestTextSize(`${'x'.repeat(61)}😀`, 64), /requires fewer messages or active lorebooks/);
});
