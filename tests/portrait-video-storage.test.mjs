import assert from 'node:assert/strict';
import test from 'node:test';

import { portraitVideoRequestKey } from '../src/lib/portrait-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';
import {
  STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC,
  STORED_PORTRAIT_VIDEO_SPEC,
  commitStoredPortraitVideo,
  normalizeStoredPortraitVideo,
  restoreStoredPortraitVideo,
  unwrapStoredPortraitVideo
} from '../src/lib/portrait-video-storage.ts';

function request(overrides = {}) {
  return {
    spec: 'mullet_portrait_video_request_v4',
    modelTemplate: 'minimax-h3-fl2va-portrait-v1',
    endFrameModelTemplate: null,
    mode: 'i2v',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      portraitRequestKey: 'opaque-portrait-request-key',
      portraitPromptId: '11111111-1111-4111-8111-111111111111',
      portraitSeed: 41,
      portraitGeneratedAt: 17,
      portraitWidth: 768,
      portraitHeight: 1152,
      portraitImageSha256: 'a'.repeat(64),
      portraitSource: {
        conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
        messageCount: 4,
        messageIndex: 3,
        fingerprint: '12:1234abcd',
        expression: 'grief'
      }
    },
    aspectRatio: '2:3',
    durationSeconds: 3,
    ...overrides
  };
}

function stored(overrides = {}) {
  const motionRequest = request();
  return {
    spec: STORED_PORTRAIT_VIDEO_SPEC,
    conversationId: motionRequest.source.conversationId,
    requestKey: portraitVideoRequestKey(motionRequest),
    request: motionRequest,
    modelTemplate: motionRequest.modelTemplate,
    mode: motionRequest.mode,
    promptId: '22222222-2222-4222-8222-222222222222',
    seed: 42,
    width: 768,
    height: 1152,
    frames: 73,
    fps: 24,
    durationSeconds: 3,
    encodedDurationSeconds: 3.042,
    generatedAt: 18,
    inputImageSha256: 'a'.repeat(64),
    endFrame: null,
    videoSha256: 'b'.repeat(64),
    video: new Blob([buildH264AacMp4Fixture({ width: 768, height: 1152, frames: 73 })], { type: 'video/mp4' }),
    ...overrides
  };
}

test('normalizes a provenance-bound H.264/AAC MP4 without canonical transcript text', () => {
  const result = normalizeStoredPortraitVideo(stored());
  assert.equal(result.video.type, 'video/mp4');
  assert.equal(result.frames, 73);
  assert.equal(result.fps, 24);
  assert.equal(result.durationSeconds, 3);
  assert.equal(result.encodedDurationSeconds, 3.042);
  assert.equal(result.mode, 'i2v');
  assert.equal(result.endFrame, null);
  assert.equal(result.requestKey, portraitVideoRequestKey(result.request));
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('rejects unmatched request keys, conversations, hashes, timing, dimensions, and blobs', () => {
  assert.throws(() => normalizeStoredPortraitVideo(stored({ requestKey: 'wrong' })), /request key is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ inputImageSha256: 'c'.repeat(64) })), /does not match/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ mode: 'flf2v_loop' })), /mode is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ frames: 72 })), /timing is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ encodedDurationSeconds: Number.NaN })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ width: 512 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ video: new Blob(['no'], { type: 'text/plain' }) })), /video is invalid/);
});

test('unwraps writer-owned envelopes and rejects malformed envelopes', () => {
  const value = stored();
  assert.deepEqual(unwrapStoredPortraitVideo(value), value);
  assert.deepEqual(unwrapStoredPortraitVideo({
    spec: STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC,
    writeId: 'writer-a',
    video: value
  }), value);
  assert.throws(() => unwrapStoredPortraitVideo({ spec: STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC, writeId: '' }), /envelope is invalid/);
});

test('discards obsolete v1/v2/v3 direct values and envelopes for automatic regeneration', () => {
  assert.equal(unwrapStoredPortraitVideo({ spec: 'mullet_stored_portrait_video_v1' }), null);
  assert.equal(unwrapStoredPortraitVideo({
    spec: 'mullet_stored_portrait_video_envelope_v1',
    writeId: 'legacy-writer',
    video: { spec: 'mullet_stored_portrait_video_v1' }
  }), null);
  assert.equal(unwrapStoredPortraitVideo({ spec: 'mullet_stored_portrait_video_v2' }), null);
  assert.equal(unwrapStoredPortraitVideo({
    spec: 'mullet_stored_portrait_video_envelope_v2',
    writeId: 'legacy-writer',
    video: { spec: 'mullet_stored_portrait_video_v2' }
  }), null);
  assert.equal(unwrapStoredPortraitVideo({ spec: 'mullet_stored_portrait_video_v3' }), null);
  assert.equal(unwrapStoredPortraitVideo({
    spec: 'mullet_stored_portrait_video_envelope_v3',
    writeId: 'legacy-writer',
    video: { spec: 'mullet_stored_portrait_video_v3' }
  }), null);
});

test('requires exact generated end-frame provenance only for generated FLF mode', () => {
  const generatedRequest = request({
    mode: 'flf2v_generated',
    endFrameModelTemplate: 'qwen-image-edit-2511-lightning-4step-v1'
  });
  const generated = stored({
    request: generatedRequest,
    requestKey: portraitVideoRequestKey(generatedRequest),
    mode: generatedRequest.mode,
    endFrame: {
      modelTemplate: 'qwen-image-edit-2511-lightning-4step-v1',
      promptId: '33333333-3333-4333-8333-333333333333',
      seed: 43,
      width: 768,
      height: 1152,
      imageSha256: 'c'.repeat(64)
    }
  });
  const normalized = normalizeStoredPortraitVideo(generated);
  assert.equal(normalized.endFrame?.seed, 43);
  assert.equal(normalized.endFrame?.imageSha256, 'c'.repeat(64));
  assert.throws(() => normalizeStoredPortraitVideo({ ...generated, endFrame: null }), /end-frame template/);
  assert.throws(() => normalizeStoredPortraitVideo({
    ...generated,
    endFrame: { ...generated.endFrame, seed: 44 }
  }), /seed does not match/);
  assert.throws(() => normalizeStoredPortraitVideo({
    ...generated,
    endFrame: { ...generated.endFrame, imageSha256: 'a'.repeat(64) }
  }), /hash matches/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ endFrame: generated.endFrame })), /invalid for its mode/);
});

test('rolls back a write that becomes stale before installation', async () => {
  let current = true;
  let installed = false;
  let rolledBack = '';
  const result = await commitStoredPortraitVideo(stored(), {
    exclusive: async (operation) => operation(),
    save: async () => {
      current = false;
      return { writeId: 'writer-a', previousRaw: null };
    },
    isCurrent: () => current,
    rollback: async (receipt) => { rolledBack = receipt.writeId; },
    install: () => { installed = true; }
  });
  assert.equal(result, false);
  assert.equal(installed, false);
  assert.equal(rolledBack, 'writer-a');
});

test('serializes writers so a later stale writer restores the valid prior envelope', async () => {
  let persisted = null;
  let currentA = true;
  let installedB = false;
  let tail = Promise.resolve();
  const exclusive = async (operation) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const save = async (video, writeId) => {
    const previousRaw = persisted;
    persisted = { spec: STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC, writeId, video };
    return { writeId, previousRaw };
  };
  const rollback = async (receipt) => {
    if (persisted?.writeId === receipt.writeId) persisted = receipt.previousRaw;
  };

  await commitStoredPortraitVideo(stored(), {
    exclusive,
    save: (video) => save(video, 'writer-b'),
    isCurrent: () => true,
    rollback,
    install: () => { installedB = true; }
  });
  const staleA = commitStoredPortraitVideo(stored(), {
    exclusive,
    save: async (video) => {
      const receipt = await save(video, 'writer-a');
      currentA = false;
      return receipt;
    },
    isCurrent: () => currentA,
    rollback,
    install: () => assert.fail('stale writer installed')
  });

  assert.equal(await staleA, false);
  assert.equal(installedB, true);
  assert.equal(persisted?.writeId, 'writer-b');
});

test('checks currentness before loading and installs restores inside the lock', async () => {
  let current = false;
  let loaded = false;
  const stale = await restoreStoredPortraitVideo({
    exclusive: async (operation) => operation(),
    load: async () => { loaded = true; return stored(); },
    isCurrent: () => current,
    accepts: () => true,
    install: () => assert.fail('stale restore installed')
  });
  assert.equal(stale, null);
  assert.equal(loaded, false);

  let lockHeld = false;
  let installedWhileLocked = false;
  current = true;
  const restored = await restoreStoredPortraitVideo({
    exclusive: async (operation) => {
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
      }
    },
    load: async () => stored(),
    isCurrent: () => current,
    accepts: () => true,
    install: () => { installedWhileLocked = lockHeld; }
  });
  assert.equal(restored?.request.source.portraitPromptId, '11111111-1111-4111-8111-111111111111');
  assert.equal(installedWhileLocked, true);
});

test('does not install a valid prior-mode restore after selection changes', async () => {
  let selectedMode = 'i2v';
  let installed = false;
  const restored = await restoreStoredPortraitVideo({
    exclusive: async (operation) => operation(),
    load: async () => {
      const video = stored();
      selectedMode = 'flf2v_loop';
      return video;
    },
    isCurrent: () => selectedMode === 'i2v',
    accepts: () => true,
    install: () => { installed = true; }
  });
  assert.equal(restored, null);
  assert.equal(installed, false);
});
