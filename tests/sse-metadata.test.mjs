import assert from 'node:assert/strict';
import test from 'node:test';

import { prependSseMetadata } from '../src/lib/server/sse-metadata.ts';

test('prefixes opaque MULLET metadata without changing the upstream SSE stream', async () => {
  const encoder = new TextEncoder();
  const sourceText = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sourceText));
      controller.close();
    }
  });
  const response = new Response(prependSseMetadata(source, {
    loreTimedState: { sticky: {}, cooldown: {} }
  }));
  const text = await response.text();

  assert.match(text, /^data: {"mullet":{"loreTimedState":{"sticky":{},"cooldown":{}}}}\n\n/);
  assert.ok(text.endsWith(sourceText));
  assert.equal((text.match(/"choices"/g) ?? []).length, 1);
});
