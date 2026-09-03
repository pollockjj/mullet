import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_TEMPLATE_ID,
  buildInlineSceneVideoRequest,
  inlineSceneVideoDecodeFailureTransition,
  inlineSceneVideoDimensions,
  inlineSceneVideoReconciliationAllowed,
  inlineSceneVideoReferenceName,
  inlineSceneVideoReferencesSha256,
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

const clipMp4Bytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73, includeAudio: false });
const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const motionPromptId = '33333333-3333-4333-8333-333333333333';
const messages = [
  { role: 'user', content: 'What is happening on the flight deck?' },
  { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
];
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
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
const callyCandidate = Object.freeze({
  id: 'cally',
  displayName: 'Cally',
  aliases: ['Cally'],
  profileFingerprint: 'f'.repeat(64)
});
const jennaIdentity = Object.freeze({
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
  },
  bodyReferenceImage: null
});
const callyIdentity = Object.freeze({
  profileId: callyCandidate.id,
  profileFingerprint: callyCandidate.profileFingerprint,
  displayName: callyCandidate.displayName,
  subject: 'Cally',
  referenceImage: {
    name: 'cally-v2.jpg',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: '5'.repeat(64),
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  },
  bodyReferenceImage: null
});
// One-to-one by design (operator order, 2026-09-03): the director selects exactly one
// subject, so a stored clip can only ever carry a solo cast. Cally stays as the foreign
// subject a stored reference must never smuggle into that cast.
const soloCast = Object.freeze({ kind: 'solo', identities: [jennaIdentity] });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A prepared reference on the loop lane, named by profile, view, and the subject's
// fingerprint; sha256 is the hash of the prepared PNG.
function reference(identity, view, salt = 0) {
  const digest = sha256(`${identity.profileId}:${view}:${salt}`);
  return {
    profileId: identity.profileId,
    view,
    sha256: digest,
    name: inlineSceneVideoReferenceName(identity.profileId, view, identity.profileFingerprint)
  };
}

function referencesFor(cast, views = ['face', 'threequarter', 'waistup']) {
  return cast.identities.flatMap((identity) => views.map((view) => reference(identity, view)));
}

function sceneRequest(cast = soloCast) {
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    [sceneCandidate]
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: cast.identities.map(({ profileId }) => profileId)
  });
  return buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast,
    lora: sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
}

function request(cast = soloCast, references = referencesFor(cast)) {
  return buildInlineSceneVideoRequest({ conversationId, epoch, request: sceneRequest(cast), references });
}

function stored(overrides = {}, motionRequest = request()) {
  const dimensions = inlineSceneVideoDimensions(motionRequest.aspectRatio, motionRequest.modelTemplate);
  const bytes = clipMp4Bytes;
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
    durationSeconds: 73 / 24,
    audioTracks: 0,
    generatedAt: 18,
    referencesSha256: inlineSceneVideoReferencesSha256(motionRequest),
    videoSha256: sha256(bytes),
    video: new Blob([bytes], { type: 'video/mp4' }),
    ...overrides
  };
}

test('normalizes and byte-verifies the reference-conditioned silent H.264 MP4', async () => {
  const normalized = normalizeStoredInlineSceneVideo(stored());
  assert.equal(STORED_INLINE_SCENE_VIDEO_SPEC, 'mullet_stored_inline_scene_video_v10');
  assert.equal(STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC, 'mullet_stored_inline_scene_video_envelope_v10');
  assert.equal(normalized.requestKey, inlineSceneVideoRequestKey(normalized.request));
  assert.equal(normalized.modelTemplate, INLINE_SCENE_VIDEO_TEMPLATE_ID);
  assert.equal(normalized.mode, 'ref2v');
  assert.equal(normalized.width, 1024);
  assert.equal(normalized.height, 576);
  assert.equal(normalized.frames, 73);
  assert.equal(normalized.fps, 24);
  assert.equal(normalized.durationSeconds, 73 / 24);
  assert.equal(normalized.audioTracks, 0);
  const expectedReferencesSha256 = sha256(normalized.request.source.references.map((entry) => entry.sha256).join('\n'));
  assert.equal(normalized.referencesSha256, expectedReferencesSha256);
  assert.deepEqual(normalized.request.source.references.map(({ name }) => name), [
    `jenna-face-${'d'.repeat(16)}.png`,
    `jenna-threequarter-${'d'.repeat(16)}.png`,
    `jenna-waistup-${'d'.repeat(16)}.png`
  ]);
  assert.equal('inputImageSha256' in normalized, false);
  assert.equal('scenePromptId' in normalized.request.source, false);
  assert.equal('sceneImageSha256' in normalized.request.source, false);
  const verified = await verifyStoredInlineSceneVideo(normalized);
  assert.equal(verified.video.type, 'video/mp4');
  assert.equal(verified.videoSha256, sha256(clipMp4Bytes));
});

test('rejects mismatched source, key, template, timing, hashes, references, and blobs', async () => {
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ spec: 'mullet_stored_inline_scene_video_v9' })), /invalid stored inline-scene video/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ epoch: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ requestKey: 'wrong' })), /request key is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ modelTemplate: 'minimax-h3-fl2va-scene-loop-v1' })), /template is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ mode: 'flf2v_loop' })), /mode is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ promptId: 'not-a-uuid' })), /prompt ID is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ width: 512 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ height: 768 })), /dimensions are invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ frames: 48 })), /timing is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ fps: 30 })), /timing is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ durationSeconds: Number.NaN })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ durationSeconds: 3 })), /encoded duration is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ audioTracks: 1 })), /audio-track count is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ referencesSha256: 'c'.repeat(64) })), /reference hash does not match its request/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ referencesSha256: undefined })), /reference hash is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ referencesSha256: 'C'.repeat(64) })), /reference hash is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ generatedAt: 0 })), /timestamp is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ video: new Blob(['no'], { type: 'text/plain' }) })), /video is invalid/);
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({ video: new Blob([clipMp4Bytes], { type: 'video/webm' }) })), /video is invalid/);

  // The stored request is re-validated: references must belong to and cover the cast.
  const valid = request();
  const foreign = {
    ...valid,
    source: { ...valid.source, references: [...valid.source.references, reference(callyIdentity, 'face')] }
  };
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({}, foreign)), /does not belong to the scene cast/);
  const empty = { ...valid, source: { ...valid.source, references: [] } };
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({}, empty)), /between 1 and 9 references/);
  const misnamed = {
    ...valid,
    source: {
      ...valid.source,
      references: [{ ...valid.source.references[0], name: inlineSceneVideoReferenceName('jenna', 'face', 'a'.repeat(64)) }]
    }
  };
  assert.throws(() => normalizeStoredInlineSceneVideo(stored({}, misnamed)), /does not match its subject fingerprint/);
  const rehashed = {
    ...valid,
    source: { ...valid.source, references: [{ ...valid.source.references[0], sha256: 'a'.repeat(64) }, ...valid.source.references.slice(1)] }
  };
  assert.throws(
    () => normalizeStoredInlineSceneVideo(stored({ referencesSha256: inlineSceneVideoReferencesSha256(valid) }, rehashed)),
    /reference hash does not match its request/
  );

  await assert.rejects(verifyStoredInlineSceneVideo(stored({ videoSha256: 'd'.repeat(64) })), /hash does not match/);
  const wrongSizeBytes = buildH264AacMp4Fixture({ width: 640, height: 768, frames: 73, includeAudio: false });
  await assert.rejects(
    verifyStoredInlineSceneVideo(stored({
      video: new Blob([wrongSizeBytes], { type: 'video/mp4' }),
      videoSha256: sha256(wrongSizeBytes)
    })),
    /dimensions/
  );
  const wrongLengthBytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 49, includeAudio: false });
  await assert.rejects(
    verifyStoredInlineSceneVideo(stored({
      video: new Blob([wrongLengthBytes], { type: 'video/mp4' }),
      videoSha256: sha256(wrongLengthBytes)
    })),
    /frame count/
  );
  const audioBearingBytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73 });
  await assert.rejects(
    verifyStoredInlineSceneVideo(stored({
      video: new Blob([audioBearingBytes], { type: 'video/mp4' }),
      videoSha256: sha256(audioBearingBytes)
    })),
    /audio track/
  );
  const slowBytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73, fps: 12, includeAudio: false });
  await assert.rejects(
    verifyStoredInlineSceneVideo(stored({
      video: new Blob([slowBytes], { type: 'video/mp4' }),
      videoSha256: sha256(slowBytes)
    })),
    /encoded duration does not match its bytes/
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
  assert.equal(unwrapStoredInlineSceneVideo(null), null);
  assert.throws(
    () => unwrapStoredInlineSceneVideo({ spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC, writeId: '' }),
    /envelope is invalid/
  );
  assert.throws(
    () => unwrapStoredInlineSceneVideo({ spec: STORED_INLINE_SCENE_VIDEO_ENVELOPE_SPEC, writeId: 'writer-a' }),
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

test('commits only a byte-verified clip and installs it before releasing the lock', async () => {
  let lockHeld = false;
  let installedWhileLocked = false;
  let saved = null;
  const result = await commitStoredInlineSceneVideo(stored(), {
    exclusive: async (operation) => {
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
      }
    },
    save: async (video) => {
      saved = video;
      return { writeId: 'writer-b', previousRaw: null };
    },
    isCurrent: () => true,
    rollback: async () => assert.fail('verified write rolled back'),
    install: () => { installedWhileLocked = lockHeld; }
  });
  assert.equal(result, true);
  assert.equal(installedWhileLocked, true);
  assert.equal(saved?.referencesSha256, inlineSceneVideoReferencesSha256(request()));
  let saves = 0;
  await assert.rejects(
    commitStoredInlineSceneVideo(stored({ referencesSha256: 'c'.repeat(64) }), {
      exclusive: async (operation) => operation(),
      save: async () => { saves += 1; return { writeId: 'writer-c', previousRaw: null }; },
      isCurrent: () => true,
      rollback: async () => {},
      install: () => assert.fail('unverified clip installed')
    }),
    /reference hash does not match/
  );
  assert.equal(saves, 0);
});

test('discards corrupt motion inside its restore lock without touching static state', async () => {
  for (const corrupt of [
    stored({ videoSha256: 'd'.repeat(64) }),
    stored({ referencesSha256: 'd'.repeat(64) }),
    stored({ audioTracks: 1 })
  ]) {
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
        load: async () => corrupt,
        discardInvalid: async () => { discardedInsideLock = lockHeld; },
        isCurrent: () => true,
        accepts: () => true,
        install: () => assert.fail('corrupt motion installed')
      }),
      StoredInlineSceneVideoIntegrityError
    );
    assert.equal(discardedInsideLock, true);
    assert.equal(staticScenePresent, true);
  }
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

test('silently discards obsolete v1 through v9 motion inside the restore lock', async () => {
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
    'mullet_stored_inline_scene_video_envelope_v8',
    'mullet_stored_inline_scene_video_v9',
    'mullet_stored_inline_scene_video_envelope_v9'
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
  // A v9 record that still looks complete (it carried the still's hash) is discarded on
  // spec alone, without an integrity error.
  let discarded = 0;
  const staleRecord = await restoreStoredInlineSceneVideo({
    exclusive: async (operation) => operation(),
    load: async () => ({
      spec: 'mullet_stored_inline_scene_video_envelope_v9',
      writeId: 'writer-a',
      video: { ...stored(), spec: 'mullet_stored_inline_scene_video_v9', inputImageSha256: 'a'.repeat(64) }
    }),
    discardInvalid: async () => { discarded += 1; },
    isCurrent: () => true,
    accepts: () => true,
    install: () => assert.fail('v9 motion installed')
  });
  assert.equal(staleRecord, null);
  assert.equal(discarded, 1);
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
  assert.equal(restored?.promptId, motionPromptId);
  assert.equal(restored?.referencesSha256, inlineSceneVideoReferencesSha256(request()));
  assert.equal(restored?.request.mode, 'ref2v');
  assert.equal(installedWhileLocked, true);

  let installed = false;
  const rejected = await restoreStoredInlineSceneVideo({
    exclusive: async (operation) => operation(),
    load: async () => stored(),
    discardInvalid: async () => assert.fail('valid rejected motion discarded'),
    isCurrent: () => true,
    accepts: () => false,
    install: () => { installed = true; }
  });
  assert.equal(rejected, null);
  assert.equal(installed, false);
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
  assert.equal(persisted.video.videoSha256, sha256(clipMp4Bytes));
});
