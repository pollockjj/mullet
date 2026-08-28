import assert from 'node:assert/strict';
import test from 'node:test';

import { STORED_PORTRAIT_SPEC, commitStoredPortrait, normalizeStoredPortrait } from '../src/lib/portrait-storage.ts';

function stored(overrides = {}) {
  return {
    spec: STORED_PORTRAIT_SPEC,
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    requestKey: 'opaque-settings-fingerprint',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: '4:1234abcd',
      expression: 'joy'
    },
    modelTemplate: 'z-image-turbo-v1',
    promptId: '11111111-1111-4111-8111-111111111111',
    seed: 17,
    width: 768,
    height: 1152,
    generatedAt: 1,
    image: new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }),
    ...overrides
  };
}

test('normalizes a generated portrait without any canonical transcript text', () => {
  const result = normalizeStoredPortrait(stored());
  assert.equal(result.image.type, 'image/png');
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('rejects portraits for another conversation or non-image results', () => {
  assert.throws(() => normalizeStoredPortrait(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortrait(stored({ image: new Blob(['no'], { type: 'text/plain' }) })), /image is invalid/);
});

test('discards a portrait when its conversation becomes stale during the storage write', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let discardedPromptId = '';
  const committing = commitStoredPortrait(stored(), {
    save: async () => saveBlocked,
    isCurrent: () => current,
    discard: async (portrait) => { discardedPromptId = portrait.promptId; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discardedPromptId, '11111111-1111-4111-8111-111111111111');
});
