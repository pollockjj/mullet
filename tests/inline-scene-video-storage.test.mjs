import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey,
  inlineSceneSourceForScenarioOpening
} from '../src/lib/inline-scene.ts';
import {
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  buildInlineSceneVideoRequest,
  inlineSceneVideoDecodeFailureTransition,
  inlineSceneVideoDimensions,
  inlineSceneVideoReconciliationAllowed,
  inlineSceneVideoRequestKey
} from '../src/lib/inline-scene-video.ts';
import {
  STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC,
  STORED_INLINE_SCENE_VIDEO_SPEC,
  StoredInlineSceneVideoIntegrityError,
  commitStoredInlineSceneVideo,
  normalizeStoredInlineSceneVideo,
  restoreStoredInlineSceneVideo,
  unwrapStoredInlineSceneVideo,
  verifyStoredInlineSceneVideo
} from '../src/lib/inline-scene-video-storage.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const staticPromptId = '22222222-2222-4222-8222-222222222222';
const motionPromptId = '33333333-3333-4333-8333-333333333333';
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const minimaxMp4Bytes = buildH264AacMp4Fixture();
const ltxMp4Bytes = buildH264AacMp4Fixture({ width: 1344, height: 768, frames: 121, includeAudio: false });
const sceneLora = Object.freeze({
  path: 'zimage/jenna6.safetensors',
  trigger: 'jennastannis',
  modelHash: 'c'.repeat(64)
});
const sceneCandidate = Object.freeze({
  id: 'jenna',
  displayName: 'Jenna Stannis',
  aliases: ['Jenna', 'Jenna Stannis'],
  profileFingerprint: 'd'.repeat(64)
});
const soloCast = Object.freeze({
  kind: 'solo',
  identities: [{
    profileId: sceneCandidate.id,
    profileFingerprint: sceneCandidate.profileFingerprint,
    displayName: sceneCandidate.displayName,
    subject: 'Jenna Stannis',
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: 'e'.repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    }
  }]
});

function request(sourceKind = 'completed_turn', modelTemplate = LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID) {
  const messages = sourceKind === 'scenario_opening'
    ? [{
        role: 'assistant',
        content: 'Jenna steadies herself beside the Liberator flight console as the ship emerges from hyperspace.'
      }]
    : [
        { role: 'user', content: 'What is happening on the flight deck?' },
        { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
      ];
  const sidecar = sourceKind === 'scenario_opening'
    ? {
        spec: 'mullet_inline_scene_request_v3',
        kind: 'inline_scene',
        source: inlineSceneSourceForScenarioOpening(conversationId, messages, {
          scenarioId: 'blakes-7-after-false-control',
          scenarioVersion: '3.0',
          starterId: 'jenna',
          expectedGreeting: messages[0].content
        }),
        turns: messages,
        candidates: [sceneCandidate]
      }
    : buildInlineSceneRequest(
        conversationId,
        messages,
        livingHistorySourceForMessages(conversationId, messages),
        [sceneCandidate]
      );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: [sceneCandidate.id]
  });
  const sceneRequest = buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast: soloCast,
    lora: sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
  const dimensions = inlineSceneDimensions('16:9', 1);
  return buildInlineSceneVideoRequest({
    conversationId,
    epoch,
    requestKey: inlineSceneImageRequestKey(sceneRequest),
    request: sceneRequest,
    promptId: staticPromptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 17,
    imageSha256: 'a'.repeat(64)
  }, modelTemplate);
}

function stored(overrides = {}, motionRequest = request()) {
  const dimensions = inlineSceneVideoDimensions(motionRequest.aspectRatio, motionRequest.modelTemplate);
  const isLtx = motionRequest.modelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID;
  const bytes = isLtx ? ltxMp4Bytes : minimaxMp4Bytes;
  return {
    spec: STORED_INLINE_SCENE_VIDEO_SPEC,
    conversationId,
    epoch,
    requestKey: inlineSceneVideoRequestKey(motionRequest),
    request: motionRequest,
    modelTemplate: motionRequest.modelTemplate,
    mode: motionRequest.mode,
    promptId: motionPromptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    frames: dimensions.frames,
    fps: dimensions.fps,
    durationSeconds: isLtx ? 121 / 24 : 124 / 24,
    audioTracks: isLtx ? 0 : 1,
    generatedAt: 18,
    inputImageSha256: 'a'.repeat(64),
    videoSha256: createHash('sha256').update(bytes).digest('hex'),
    video: new Blob([bytes], { type: 'video/mp4' }),
    ...overrides
  };
}

test('normalizes and byte-verifies the default static-scene-bound silent H.264 MP4', async () => {
  const normalized = normalizeStoredInlineSceneVideo(stored());
  assert.equal(STORED_INLINE_SCENE_VIDEO_SPEC, 'mullet_stored_inline_scene_video_v9');
  assert.equal(STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC, 'mullet_stored_inline_scene_video_envelope_v9');
  assert.equal(normalized.requestKey, inlineSceneVideoRequestKey(normalized.request));
  assert.equal((await verifyStoredInlineSceneVideo(normalized)).video.type, 'video/mp4');
  assert.equal(normalized.audioTracks, 0);
  assert.equal(normalized.request.source.scenePromptId, staticPromptId);
});

test('retains byte-verified MiniMax H.264/AAC persistence as an additive selection', async () => {
  const minimax = normalizeStoredInlineSceneVideo(stored(
    {},
    request('completed_turn', MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID)
  ));
  assert.equal(minimax.video.type, 'video/mp4');
  assert.equal(minimax.frames, 124);
  assert.equal(minimax.audioTracks, 1);
  await verifyStoredInlineSceneVideo(minimax);
});

test('preserves scenario-opening identity through motion persistence', async () => {
  const completed = stored();
  const opening = normalizeStoredInlineSceneVideo(stored({}, request('scenario_opening')));
  assert.equal(opening.request.source.sceneRequest.source.sourceKind, 'scenario_opening');
  assert.equal(opening.request.source.sceneRequest.source.scenarioId, 'blakes-7-after-false-control');
  assert.equal(opening.request.source.sceneRequest.source.scenarioVersion, '3.0');
  assert.equal(opening.request.source.sceneRequest.source.starterId, 'jenna');
  assert.notEqual(opening.requestKey, completed.requestKey);
  await verifyStoredInlineSceneVideo(opening);
});

test('rejects mismatched source, key, dimensions, timing, hashes, and blobs', async () => {
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ epoch: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ requestKey: 'wrong' })), /request key is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ width: 512 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ frames: 48 })), /timing is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ durationSeconds: Number.NaN })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ inputImageSha256: 'c'.repeat(64) })), /does not match/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ video: new Blob(['no'], { type: 'text/plain' }) })), /video is invalid/);
  await assert.rejects(verifyStoredInlineSceneVideo(stored({ videoSha256: 'd'.repeat(64) })), /hash does not match/);
  await assert.rejects(verifyStoredInlineSceneVideo(stored({ durationSeconds: 5.0398 })), /encoded duration/);
  const wrongSizeBytes = buildH264AacMp4Fixture({ width: 640, height: 768, frames: 121, includeAudio: false });
  await assert.rejects(
    verifyStoredInlineSceneVideo(stored({
      video: new Blob([wrongSizeBytes], { type: 'video/mp4' }),
      videoSha256: createHash('sha256').update(wrongSizeBytes).digest('hex')
    })),
    /dimensions/
  );
});

test('unwraps writer envelopes and rejects malformed ownership', () => {
  const value = stored();
  assert.deepEqual(unwrapStoredInlineSceneVideo(value), value);
  assert.deepEqual(unwrapStoredInlineSceneVideo({
    spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC,
    writeId: 'writer-a',
    video: value
  }), value);
  assert.throws(
    () => unwrapStoredInlineSceneVideo({ spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC, writeId: '' }),
    /envelope is invalid/
  );
});

test('rolls back a write that becomes stale before installation', async () => {
  let current = true;
  let installed = false;
  let rolledBack = '';
  const result = await commitStoredInlineSceneVideo(stored(), {
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

test('discards corrupt motion inside its restore lock without touching static state', async () => {
  let lockHeld = false;
  let discardedInsideLock = false;
  let staticScenePresent = true;
  await assert.rejects(
    restoreStoredInlineSceneVideo({
      exclusive: async (operation) => {
        lockHeld = true;
        try {
          return await operation();
        } finally {
          lockHeld = false;
        }
      },
      load: async () => stored({ videoSha256: 'd'.repeat(64) }),
      discardInvalid: async () => { discardedInsideLock = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('corrupt motion installed')
    }),
    StoredInlineSceneVideoIntegrityError
  );
  assert.equal(discardedInsideLock, true);
  assert.equal(staticScenePresent, true);
});

test('discards a malformed writer envelope inside its restore lock', async () => {
  let lockHeld = false;
  let discardedInsideLock = false;
  await assert.rejects(
    restoreStoredInlineSceneVideo({
      exclusive: async (operation) => {
        lockHeld = true;
        try {
          return await operation();
        } finally {
          lockHeld = false;
        }
      },
      load: async () => ({
        spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC,
        writeId: '',
        video: stored()
      }),
      discardInvalid: async () => { discardedInsideLock = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('malformed envelope installed')
    }),
    StoredInlineSceneVideoIntegrityError
  );
  assert.equal(discardedInsideLock, true);
});

test('silently discards obsolete v1 through v8 motion inside the restore lock', async () => {
  for (const spec of [
    'mullet_stored_inline_scene_video_v1',
    'mullet_stored_inline_scene_video_envelope_v1',
    'mullet_stored_inline_scene_video_v2',
    'mullet_stored_inline_scene_video_envelope_v2',
    'mullet_stored_inline_scene_video_v3',
    'mullet_stored_inline_scene_video_envelope_v3',
    'mullet_stored_inline_scene_video_v4',
    'mullet_stored_inline_scene_video_envelope_v4',
    'mullet_stored_inline_scene_video_v5',
    'mullet_stored_inline_scene_video_envelope_v5',
    'mullet_stored_inline_scene_video_v6',
    'mullet_stored_inline_scene_video_envelope_v6',
    'mullet_stored_inline_scene_video_v7',
    'mullet_stored_inline_scene_video_envelope_v7',
    'mullet_stored_inline_scene_video_v8',
    'mullet_stored_inline_scene_video_envelope_v8'
  ]) {
    let lockHeld = false;
    let discardedInsideLock = false;
    const restored = await restoreStoredInlineSceneVideo({
      exclusive: async (operation) => {
        lockHeld = true;
        try {
          return await operation();
        } finally {
          lockHeld = false;
        }
      },
      load: async () => ({ spec }),
      discardInvalid: async () => { discardedInsideLock = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('obsolete motion installed')
    });
    assert.equal(restored, null);
    assert.equal(discardedInsideLock, true);
  }
});

test('restores only accepted current motion and installs before releasing the lock', async () => {
  let lockHeld = false;
  let installedWhileLocked = false;
  const restored = await restoreStoredInlineSceneVideo({
    exclusive: async (operation) => {
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
      }
    },
    load: async () => stored(),
    discardInvalid: async () => assert.fail('valid motion discarded'),
    isCurrent: () => true,
    accepts: (video) => video.epoch === epoch,
    install: () => { installedWhileLocked = lockHeld; }
  });
  assert.equal(restored?.request.source.scenePromptId, staticPromptId);
  assert.equal(installedWhileLocked, true);
});

test('verified persisted motion remains restorable across a playback fallback and page reload', async () => {
  const persisted = {
    spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC,
    writeId: 'writer-a',
    video: stored()
  };
  let discarded = 0;
  let replacementPosts = 0;
  const installed = [];
  const restore = () => restoreStoredInlineSceneVideo({
    exclusive: async (operation) => operation(),
    load: async () => persisted,
    discardInvalid: async () => { discarded += 1; },
    isCurrent: () => true,
    accepts: (video) => video.requestKey === inlineSceneVideoRequestKey(request()),
    install: (video) => { installed.push(video.promptId); }
  });

  const beforePlaybackFallback = await restore();
  assert.deepEqual(
    inlineSceneVideoDecodeFailureTransition(true, request()),
    { action: 'ignore' }
  );
  const fallback = inlineSceneVideoDecodeFailureTransition(false, request());
  assert.equal(fallback.action, 'show-static-fallback');
  const ready = {
    scenesEnabled: true,
    motionEnabled: true,
    capabilitiesReady: true,
    persistenceReady: true,
    persistenceAvailable: true,
    restorationPending: false,
    streaming: false,
    sceneBusy: false,
    videoBusy: false,
    videoError: true,
    requestReady: true,
    current: false
  };
  if (inlineSceneVideoReconciliationAllowed(ready)) replacementPosts += 1;
  const afterPageReload = await restore();
  if (inlineSceneVideoReconciliationAllowed({ ...ready, videoError: false, current: true })) {
    replacementPosts += 1;
  }

  assert.equal(beforePlaybackFallback?.promptId, motionPromptId);
  assert.equal(afterPageReload?.promptId, motionPromptId);
  assert.deepEqual(installed, [motionPromptId, motionPromptId]);
  assert.equal(discarded, 0);
  assert.equal(replacementPosts, 0);
  assert.equal(persisted.video.promptId, motionPromptId);
  assert.equal(persisted.video.videoSha256, createHash('sha256').update(ltxMp4Bytes).digest('hex'));
});
