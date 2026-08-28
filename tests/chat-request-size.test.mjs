import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CHAT_REQUEST_BYTES, serializeChatRequest } from '../src/lib/chat-request-size.ts';

test('keeps browser chat requests below the deployed body-size limit', () => {
  assert.equal(MAX_CHAT_REQUEST_BYTES, 31 * 1024 * 1024);
  assert.equal(serializeChatRequest({ message: 'ok' }, 64), '{"message":"ok"}');
  assert.throws(
    () => serializeChatRequest({ message: 'four-byte: 😀' }, 20),
    /requires fewer messages or active lorebooks/
  );
});
