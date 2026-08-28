import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_RESPONSE_TOKENS, resolveTokenLimit } from '../src/lib/token-limit.ts';

test('defaults every response to a finite 256-token budget', () => {
  assert.equal(DEFAULT_RESPONSE_TOKENS, 256);
  assert.equal(resolveTokenLimit(undefined, 2048), 256);
});

test('accepts a user-selected token budget within the server ceiling', () => {
  assert.equal(resolveTokenLimit(64, 2048), 64);
  assert.equal(resolveTokenLimit(2048, 2048), 2048);
});

test('rejects non-integers and budgets beyond the server ceiling', () => {
  assert.throws(() => resolveTokenLimit(64.5, 2048), /integer between 16 and 2048/);
  assert.throws(() => resolveTokenLimit(4096, 2048), /integer between 16 and 2048/);
  assert.throws(() => resolveTokenLimit('256', 2048), /integer between 16 and 2048/);
});

test('rejects an invalid server default instead of silently changing it', () => {
  assert.throws(() => resolveTokenLimit(undefined, 128, 256), /default token limit/);
});
