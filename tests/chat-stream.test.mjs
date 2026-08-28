import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFinalizedChatStream, parseChatStreamPayload } from '../src/lib/chat-stream.ts';

test('requires terminal SSE evidence before a partial response can finalize', () => {
  const partial = parseChatStreamPayload('{"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}');
  assert.equal(partial.token, 'partial');
  assert.equal(partial.terminal, false);
  assert.throws(() => assertFinalizedChatStream(partial.terminal, partial.token), /without a terminal event/);
});

test('accepts stop, length, and DONE terminals while rejecting empty completions', () => {
  const stop = parseChatStreamPayload('{"choices":[{"delta":{},"finish_reason":"stop"}]}');
  const length = parseChatStreamPayload('{"choices":[{"delta":{},"finish_reason":"length"}]}');
  const done = parseChatStreamPayload('[DONE]');
  assert.equal(stop.terminal, true);
  assert.equal(length.terminal, true);
  assert.equal(length.hitTokenLimit, true);
  assert.equal(done.terminal, true);
  assert.doesNotThrow(() => assertFinalizedChatStream(stop.terminal, 'complete'));
  assert.throws(() => assertFinalizedChatStream(done.terminal, '   '), /empty response/);
});
