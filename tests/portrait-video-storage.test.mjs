import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORED_PORTRAIT_VIDEO_SPEC,
  commitStoredPortraitVideo,
  normalizeStoredPortraitVideo
} from '../src/lib/portrait-video-storage.ts';

function stored(overrides = {}) {
  return {
    spec: STORED_PORTRAIT_VIDEO_SPEC,
    conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
    requestKey: 'opaque-motion-request-key',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      portraitRequestKey: 'opaque-portrait-request-key',
      portraitPromptId: '11111111-1111-4111-8111-111111111111',
      portraitGeneratedAt: 17,
      portraitWidth: 768,
      portraitHeight: 1152,
      portraitSource: {
        conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
        messageCount: 4,
        messageIndex: 3,
        fingerprint: '12:1234abcd',
        expression: 'grief'
      }
    },
    modelTemplate: 'wan2.1-i2v-480p-v1',
    aspectRatio: '2:3',
    promptId: '22222222-2222-4222-8222-222222222222',
    seed: 42,
    width: 480,
    height: 720,
    frames: 33,
    fps: 16,
    durationSeconds: 2,
    generatedAt: 18,
    video: new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])], { type: 'video/webm' }),
    ...overrides
  };
}

test('normalizes a provenance-bound WebM without canonical transcript text', () => {
  const result = normalizeStoredPortraitVideo(stored());
  assert.equal(result.video.type, 'video/webm');
  assert.equal(result.frames, 33);
  assert.equal(result.fps, 16);
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('rejects another conversation, wrong timing, dimensions, and non-video blobs', () => {
  assert.throws(() => normalizeStoredPortraitVideo(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ frames: 32 })), /timing is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ width: 512 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ video: new Blob(['no'], { type: 'text/plain' }) })), /video is invalid/);
});

test('discards a motion result when its portrait becomes stale during storage', async () => {
  let resolveSave;
  const saveBlocked = new Promise((resolve) => { resolveSave = resolve; });
  let current = true;
  let installed = false;
  let discardedPromptId = '';
  const committing = commitStoredPortraitVideo(stored(), {
    save: async () => saveBlocked,
    isCurrent: () => current,
    discard: async (video) => { discardedPromptId = video.promptId; },
    install: () => { installed = true; }
  });
  current = false;
  resolveSave();
  assert.equal(await committing, false);
  assert.equal(installed, false);
  assert.equal(discardedPromptId, '22222222-2222-4222-8222-222222222222');
});
