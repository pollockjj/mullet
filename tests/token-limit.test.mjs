import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS, resolveTokenLimit } from '../src/lib/token-limit.ts';

test('matches the operator SillyTavern chat-completion value and range', () => {
  assert.equal(DEFAULT_RESPONSE_TOKENS, 65536);
  assert.equal(MAX_RESPONSE_TOKENS, 262144);
  assert.equal(resolveTokenLimit(undefined, MAX_RESPONSE_TOKENS), 65536);
});

test('accepts a user-selected token budget within the server ceiling', () => {
  assert.equal(resolveTokenLimit(1, 262144), 1);
  assert.equal(resolveTokenLimit(65536, 262144), 65536);
  assert.equal(resolveTokenLimit(128000, 128000), 128000);
});

test('rejects non-integers and budgets beyond the server ceiling', () => {
  assert.throws(() => resolveTokenLimit(0, 128000), /integer between 1 and 128000/);
  assert.throws(() => resolveTokenLimit(64.5, 128000), /integer between 1 and 128000/);
  assert.throws(() => resolveTokenLimit(128001, 128000), /integer between 1 and 128000/);
  assert.throws(() => resolveTokenLimit('8096', 128000), /integer between 1 and 128000/);
});

test('rejects an invalid server default instead of silently changing it', () => {
  assert.throws(() => resolveTokenLimit(undefined, 8095, 8096), /default token limit/);
});
