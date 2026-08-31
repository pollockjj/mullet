import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
  PORTRAIT_END_FRAME_TEMPLATE_ID,
  PORTRAIT_VIDEO_REQUEST_SPEC,
  portraitVideoRequestKey
} from '../src/lib/portrait-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';
import { buildVp9WebmFixture } from './webm-fixture.mjs';
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
    spec: PORTRAIT_VIDEO_REQUEST_SPEC,
    modelTemplate: LTX25_PORTRAIT_VIDEO_TEMPLATE_ID,
    endFrameModelTemplate: null,
    mode: 'i2v',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      portraitRequestKey: 'opaque-portrait-request-key',
      portraitPromptId: '11111111-1111-4111-8111-111111111111',
      portraitSeed: 41,
      portraitGeneratedAt: 17,
      portraitWidth: 576,
      portraitHeight: 1024,
      portraitImageSha256: 'a'.repeat(64),
      portraitSource: {
        conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
        messageCount: 4,
        messageIndex: 3,
        fingerprint: '12:1234abcd',
        expression: 'grief'
      }
    },
    aspectRatio: '9:16',
    durationSeconds: 2,
    ...overrides
  };
}

function minimaxRequest(overrides = {}) {
  return request({
    modelTemplate: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
    durationSeconds: 3,
    ...overrides
  });
}

function stored(overrides = {}) {
  const motionRequest = overrides.request ?? request();
  const frames = motionRequest.durationSeconds === 2 ? 49 : motionRequest.durationSeconds === 5 ? 124 : 73;
  const bytes = buildH264AacMp4Fixture({ width: 576, height: 1024, frames, includeAudio: false });
  return {
    spec: STORED_PORTRAIT_VIDEO_SPEC,
    conversationId: motionRequest.source.conversationId,
    requestKey: portraitVideoRequestKey(motionRequest),
    request: motionRequest,
    modelTemplate: motionRequest.modelTemplate,
    mode: motionRequest.mode,
    promptId: '22222222-2222-4222-8222-222222222222',
    seed: 42,
    width: 576,
    height: 1024,
    frames,
    fps: 24,
    durationSeconds: motionRequest.durationSeconds,
    encodedDurationSeconds: frames / 24,
    audioTracks: 0,
    generatedAt: 18,
    inputImageSha256: 'a'.repeat(64),
    endFrame: null,
    videoSha256: 'b'.repeat(64),
    video: new Blob([bytes], { type: 'video/mp4' }),
    ...overrides
  };
}

test('normalizes the default two-second silent LTX H.264 MP4', () => {
  const result = normalizeStoredPortraitVideo(stored());
  assert.equal(STORED_PORTRAIT_VIDEO_SPEC, 'mullet_stored_portrait_video_v9');
  assert.equal(STORED_PORTRAIT_VIDEO_ENVELOPE_SPEC, 'mullet_stored_portrait_video_envelope_v9');
  assert.equal(result.modelTemplate, LTX25_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(result.video.type, 'video/mp4');
  assert.equal(result.frames, 49);
  assert.equal(result.fps, 24);
  assert.equal(result.durationSeconds, 2);
  assert.equal(result.encodedDurationSeconds, 49 / 24);
  assert.equal(result.audioTracks, 0);
  assert.equal(result.mode, 'i2v');
  assert.equal(result.endFrame, null);
  assert.equal(result.requestKey, portraitVideoRequestKey(result.request));
  assert.equal(JSON.stringify(result).includes('assistant'), false);
  assert.equal(JSON.stringify(result).includes('transcript'), false);
});

test('normalizes MiniMax H3 MP4 alternatives only with their exact three/five-second timing tuples', () => {
  const threeRequest = minimaxRequest();
  const three = normalizeStoredPortraitVideo(stored({ request: threeRequest }));
  assert.equal(three.modelTemplate, MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID);
  assert.equal(three.video.type, 'video/mp4');
  assert.equal(three.durationSeconds, 3);
  assert.equal(three.frames, 73);
  assert.equal(three.encodedDurationSeconds, 73 / 24);

  const fiveRequest = minimaxRequest({ durationSeconds: 5 });
  const value = stored({
    request: fiveRequest,
    requestKey: portraitVideoRequestKey(fiveRequest)
  });
  const result = normalizeStoredPortraitVideo(value);
  assert.equal(result.durationSeconds, 5);
  assert.equal(result.frames, 124);
  assert.equal(result.encodedDurationSeconds, 124 / 24);
  assert.throws(() => normalizeStoredPortraitVideo({ ...value, frames: 73 }), /timing is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo({ ...value, durationSeconds: 3 }), /timing is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo({ ...value, encodedDurationSeconds: 124 / 24 + 0.001 }), /encoded duration is invalid/);
});

test('rejects unmatched request keys, conversations, hashes, timing, dimensions, and blobs', () => {
  assert.throws(() => normalizeStoredPortraitVideo(stored({ requestKey: 'wrong' })), /request key is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ inputImageSha256: 'c'.repeat(64) })), /does not match/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ mode: 'flf2v_loop' })), /mode is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ frames: 48 })), /timing is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ encodedDurationSeconds: Number.NaN })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ encodedDurationSeconds: 49 / 24 + 0.001 })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ audioTracks: 1 })), /audio-track count is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ width: 512 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({ video: new Blob(['no'], { type: 'text/plain' }) })), /video is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({
    modelTemplate: MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
  })), /template is invalid/);
  assert.throws(() => normalizeStoredPortraitVideo(stored({
    video: new Blob([buildVp9WebmFixture({ width: 576, height: 1024, frames: 49 })], { type: 'video/webm' })
  })), /video is invalid/);
  const minimax = minimaxRequest();
  assert.throws(() => normalizeStoredPortraitVideo(stored({
    request: minimax,
    video: new Blob([buildVp9WebmFixture({ width: 576, height: 1024, frames: 73 })], { type: 'video/webm' })
  })), /video is invalid/);
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

test('discards obsolete v1-v8 direct values and envelopes for automatic regeneration', () => {
  for (let version = 1; version <= 8; version += 1) {
    assert.equal(unwrapStoredPortraitVideo({ spec: `mullet_stored_portrait_video_v${version}` }), null);
    assert.equal(unwrapStoredPortraitVideo({
      spec: `mullet_stored_portrait_video_envelope_v${version}`,
      writeId: 'legacy-writer',
      video: { spec: `mullet_stored_portrait_video_v${version}` }
    }), null);
  }
});

test('requires exact generated end-frame provenance only for generated FLF mode', () => {
  const generatedRequest = request({
    mode: 'flf2v_generated',
    endFrameModelTemplate: PORTRAIT_END_FRAME_TEMPLATE_ID
  });
  const generated = stored({
    request: generatedRequest,
    requestKey: portraitVideoRequestKey(generatedRequest),
    mode: generatedRequest.mode,
    endFrame: {
      modelTemplate: PORTRAIT_END_FRAME_TEMPLATE_ID,
      promptId: '33333333-3333-4333-8333-333333333333',
      seed: 43,
      width: 576,
      height: 1024,
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

test('does not install a valid prior-duration restore after duration selection changes', async () => {
  let selectedDuration = 2;
  let installed = false;
  const restored = await restoreStoredPortraitVideo({
    exclusive: async (operation) => operation(),
    load: async () => {
      const video = stored();
      selectedDuration = 3;
      return video;
    },
    isCurrent: () => selectedDuration === 2,
    accepts: () => true,
    install: () => { installed = true; }
  });
  assert.equal(restored, null);
  assert.equal(installed, false);
});
