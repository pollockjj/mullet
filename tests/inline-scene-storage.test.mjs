import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INLINE_SCENE_IMAGE_REQUEST_SPEC,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  inlineSceneImageRequestKey,
  inlineSceneSourceForScenarioOpening
} from '../src/lib/inline-scene.ts';
import {
  MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES,
  inlineSceneVideoReferenceName
} from '../src/lib/inline-scene-video.ts';
import {
  STORED_INLINE_SCENE_ENVELOPE_SPEC,
  STORED_INLINE_SCENE_SPEC,
  StoredInlineSceneIntegrityError,
  commitStoredInlineScene,
  normalizeStoredInlineScene,
  restoreStoredInlineScene,
  unwrapStoredInlineScene,
  verifyStoredInlineScene
} from '../src/lib/inline-scene-storage.ts';

const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: 'c'.repeat(64),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});

const candidate = Object.freeze({
  id: 'jenna-stannis',
  displayName: 'Jenna Stannis',
  aliases: Object.freeze(['Jenna', 'Jenna Stannis']),
  profileFingerprint: '1234abcd'
});

const secondCandidate = Object.freeze({
  id: 'cally',
  displayName: 'Cally',
  aliases: Object.freeze(['Cally']),
  profileFingerprint: 'beef5678'
});

const jennaIdentity = Object.freeze({
  profileId: candidate.id,
  profileFingerprint: candidate.profileFingerprint,
  displayName: candidate.displayName,
  subject: 'Jenna Stannis, an adult blonde woman aboard the Liberator',
  referenceImage: canonicalReference,
  bodyReferenceImage: null
});

const callyIdentity = Object.freeze({
  profileId: secondCandidate.id,
  profileFingerprint: secondCandidate.profileFingerprint,
  displayName: secondCandidate.displayName,
  subject: 'Cally, an adult dark-haired Auron woman aboard the Liberator',
  referenceImage: Object.freeze({
    name: 'cally-v1.jpg',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: 'e'.repeat(64),
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  }),
  bodyReferenceImage: null
});

// One-to-one by design (operator order, 2026-09-03): the director selects exactly one
// subject, so a stored scene can only ever carry a solo cast. Cally stays as the foreign
// subject a stored reference must never smuggle into that cast.
const soloCast = Object.freeze({ kind: 'solo', identities: Object.freeze([jennaIdentity]) });

const SCENE_VIEWS = Object.freeze(['face', 'threequarter', 'waistup']);

function request(overrides = {}) {
  return {
    spec: INLINE_SCENE_IMAGE_REQUEST_SPEC,
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    source: {
      sourceKind: 'completed_turn',
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: `sha256:${'a'.repeat(64)}`,
      turnFingerprint: `sha256:${'b'.repeat(64)}`,
      sidecarModel: 'gemma-4-ortenzya',
      promptSha256: `sha256:${'f'.repeat(64)}`
    },
    prompt: 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.',
    cast: soloCast,
    lora: {
      path: 'zimage/jenna6.safetensors',
      trigger: 'jennastannis',
      modelHash: 'd'.repeat(64)
    },
    aspectRatio: '3:2',
    megapixels: 0.5,
    ...overrides
  };
}

function openingRequest() {
  const sceneRequest = request();
  const opening = [{
    role: 'assistant',
    content: 'Jenna steadies herself beside the Liberator flight console as the ship emerges from hyperspace.'
  }];
  sceneRequest.source = {
    ...inlineSceneSourceForScenarioOpening(sceneRequest.source.conversationId, opening, {
      scenarioId: 'blakes-7-after-false-control',
      scenarioVersion: '3.0',
      starterId: 'jenna',
      expectedGreeting: opening[0].content
    }),
    sidecarModel: 'gemma-4-ortenzya',
    promptSha256: sceneRequest.source.promptSha256
  };
  return sceneRequest;
}

// A prepared reference picture on the loop lane: the name is bound to the subject's
// profile fingerprint, the sha256 is the hash of the prepared PNG itself.
function reference(profileId, view, { salt = 0, profileFingerprint } = {}) {
  const identity = [jennaIdentity, callyIdentity].find((entry) => entry.profileId === profileId);
  const fingerprint = profileFingerprint ?? identity?.profileFingerprint;
  if (typeof fingerprint !== 'string') throw new Error(`no fixture fingerprint for ${profileId}`);
  return {
    profileId,
    view,
    sha256: createHash('sha256').update(`${profileId}:${view}:${salt}`).digest('hex'),
    name: inlineSceneVideoReferenceName(profileId, view, fingerprint)
  };
}

function referencesFor(sceneRequest, views = SCENE_VIEWS) {
  return sceneRequest.cast.identities.flatMap(({ profileId }) => views.map((view) => reference(profileId, view)));
}

// The stored hash is sha256 over the ordered reference hashes joined with newlines.
function referencesSha256(references) {
  return createHash('sha256').update(references.map(({ sha256 }) => sha256).join('\n')).digest('hex');
}

function stored(overrides = {}, sceneRequest = request()) {
  sceneRequest.source.promptSha256 = `sha256:${createHash('sha256').update(sceneRequest.prompt).digest('hex')}`;
  const references = overrides.references ?? referencesFor(sceneRequest);
  return {
    spec: STORED_INLINE_SCENE_SPEC,
    conversationId: sceneRequest.source.conversationId,
    epoch: '22222222-2222-4222-8222-222222222222',
    requestKey: inlineSceneImageRequestKey(sceneRequest),
    request: sceneRequest,
    modelTemplate: sceneRequest.modelTemplate,
    generatedAt: 17,
    references,
    referencesSha256: referencesSha256(references),
    ...overrides
  };
}

test('normalizes a scene description plus its prepared reference pack', async () => {
  const record = stored();
  const scene = normalizeStoredInlineScene(record);
  assert.equal(STORED_INLINE_SCENE_SPEC, 'mullet_stored_inline_scene_v7');
  assert.equal(STORED_INLINE_SCENE_ENVELOPE_SPEC, 'mullet_stored_inline_scene_envelope_v7');
  assert.equal(scene.requestKey, inlineSceneImageRequestKey(scene.request));
  assert.equal(scene.conversationId, scene.request.source.conversationId);
  assert.equal(scene.modelTemplate, scene.request.modelTemplate);
  assert.equal(scene.generatedAt, 17);
  assert.deepEqual(scene.request.cast, soloCast);
  assert.equal(scene.request.lora.path, 'zimage/jenna6.safetensors');
  assert.deepEqual(scene.references, record.references);
  assert.equal(scene.references[0].name, `jenna-stannis-face-${candidate.profileFingerprint}.png`);
  assert.equal(scene.referencesSha256, referencesSha256(record.references));
  // The still is gone: nothing about a rendered image survives in the record.
  for (const absent of ['image', 'promptId', 'seed', 'width', 'height', 'imageSha256', 'continuityMasterImage']) {
    assert.equal(absent in scene, false, `${absent} must not be stored`);
  }
  assert.deepEqual(await verifyStoredInlineScene(scene), scene);
  assert.deepEqual(normalizeStoredInlineScene(JSON.parse(JSON.stringify(scene))), scene);
  assert.equal(JSON.stringify(scene).includes('transcript'), false);
});

test('preserves a Qwen reference-edit solo cast in the v7 envelope', async () => {
  const qwenRequest = request({
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    lora: null
  });
  const scene = normalizeStoredInlineScene(stored({}, qwenRequest));
  assert.equal(scene.modelTemplate, INLINE_SCENE_QWEN_TEMPLATE_ID);
  assert.equal(scene.request.cast.kind, 'solo');
  assert.deepEqual(scene.request.cast.identities[0].referenceImage, canonicalReference);
  assert.equal(scene.request.lora, null);
  assert.equal(scene.references.length, 3);
  await verifyStoredInlineScene(scene);
});

test('carries the solo cast reference pack, up to nine pictures', async () => {
  const everyView = referencesFor(request(), [...SCENE_VIEWS, 'identity']);
  const pack = normalizeStoredInlineScene(stored({
    references: everyView,
    referencesSha256: referencesSha256(everyView)
  }));
  assert.equal(pack.references.length, 4);
  assert.deepEqual([...new Set(pack.references.map(({ profileId }) => profileId))], ['jenna-stannis']);
  await verifyStoredInlineScene(pack);

  const tenReferences = [
    ...everyView,
    ...[1, 2, 3, 4, 5, 6].map((salt) => reference('jenna-stannis', 'face', { salt }))
  ];
  assert.equal(tenReferences.length, MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES + 1);
  assert.throws(
    () => normalizeStoredInlineScene(stored({ references: tenReferences })),
    /between 1 and 9 references/
  );
  assert.throws(() => normalizeStoredInlineScene(stored({ references: [] })), /references are invalid/);
});

test('preserves scenario-opening identity through reference-pack persistence', async () => {
  const completed = stored();
  const opening = normalizeStoredInlineScene(stored({}, openingRequest()));
  assert.equal(opening.request.source.sourceKind, 'scenario_opening');
  assert.equal(opening.request.source.scenarioId, 'blakes-7-after-false-control');
  assert.equal(opening.request.source.scenarioVersion, '3.0');
  assert.equal(opening.request.source.starterId, 'jenna');
  assert.notEqual(opening.requestKey, completed.requestKey);
  await verifyStoredInlineScene(opening);
});

test('rejects a mismatched request key and a reference hash that does not cover the pack', async () => {
  assert.throws(() => normalizeStoredInlineScene(stored({ requestKey: 'wrong' })), /request key/);
  assert.throws(() => normalizeStoredInlineScene(stored({ referencesSha256: 'c'.repeat(64) })), /hash does not match/);
  assert.throws(() => normalizeStoredInlineScene(stored({ referencesSha256: 'not-a-hash' })), /reference hash is invalid/);
  // Repointing one picture without rewriting the hash is the same rejection.
  const references = referencesFor(request());
  assert.throws(
    () => normalizeStoredInlineScene(stored({
      references: [reference('jenna-stannis', 'face', { salt: 9 }), ...references.slice(1)],
      referencesSha256: referencesSha256(references)
    })),
    /hash does not match/
  );
  await assert.rejects(verifyStoredInlineScene(stored({ referencesSha256: 'c'.repeat(64) })), /hash does not match/);
});

test('rejects a reference naming a profile outside the cast', () => {
  assert.throws(
    () => normalizeStoredInlineScene(stored({
      references: [...referencesFor(request()), reference('cally', 'face')]
    })),
    /does not belong to the scene cast/
  );
});

test('rejects a reference name that is not bound to its subject fingerprint', () => {
  assert.throws(
    () => normalizeStoredInlineScene(stored({
      references: [reference('jenna-stannis', 'face', { profileFingerprint: 'deadbeef' })]
    })),
    /does not match its subject fingerprint/
  );
});

test('unwraps writer envelopes and rejects malformed writer ownership', () => {
  const scene = stored();
  assert.deepEqual(unwrapStoredInlineScene(scene), scene);
  assert.deepEqual(unwrapStoredInlineScene({ spec: STORED_INLINE_SCENE_ENVELOPE_SPEC, writeId: 'writer-a', scene }), scene);
  assert.throws(() => unwrapStoredInlineScene({ spec: STORED_INLINE_SCENE_ENVELOPE_SPEC, writeId: '' }), /envelope/);
});

test('rolls back a writer that becomes stale before installation', async () => {
  let current = true;
  let installed = false;
  let rolledBack = '';
  const committed = await commitStoredInlineScene(stored(), {
    exclusive: async (operation) => operation(),
    save: async () => {
      current = false;
      return { writeId: 'writer-a', previousRaw: null };
    },
    isCurrent: () => current,
    rollback: async (receipt) => { rolledBack = receipt.writeId; },
    install: () => { installed = true; }
  });
  assert.equal(committed, false);
  assert.equal(installed, false);
  assert.equal(rolledBack, 'writer-a');
});

test('restores only accepted current source inside the lock', async () => {
  let lockHeld = false;
  let installedWhileLocked = false;
  const record = stored();
  const restored = await restoreStoredInlineScene({
    exclusive: async (operation) => {
      lockHeld = true;
      try { return await operation(); } finally { lockHeld = false; }
    },
    load: async () => record,
    discardInvalid: async () => assert.fail('valid restore was discarded'),
    isCurrent: () => true,
    accepts: () => true,
    install: () => { installedWhileLocked = lockHeld; }
  });
  assert.equal(restored?.referencesSha256, record.referencesSha256);
  assert.deepEqual(restored?.references, record.references);
  assert.equal(installedWhileLocked, true);

  let installed = false;
  const rejected = await restoreStoredInlineScene({
    exclusive: async (operation) => operation(),
    load: async () => stored(),
    discardInvalid: async () => assert.fail('valid rejected restore was discarded'),
    isCurrent: () => true,
    accepts: () => false,
    install: () => { installed = true; }
  });
  assert.equal(rejected, null);
  assert.equal(installed, false);
});

test('discards an unverifiable reference pack inside the original restore lock', async () => {
  let lockHeld = false;
  let discardedWhileLocked = false;
  await assert.rejects(
    restoreStoredInlineScene({
      exclusive: async (operation) => {
        lockHeld = true;
        try { return await operation(); } finally { lockHeld = false; }
      },
      load: async () => stored({ referencesSha256: 'c'.repeat(64) }),
      discardInvalid: async () => { discardedWhileLocked = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('corrupt restore installed')
    }),
    (cause) => cause instanceof StoredInlineSceneIntegrityError
  );
  assert.equal(discardedWhileLocked, true);
});

test('silently discards obsolete v1 through v6 scenes inside the restore lock', async () => {
  for (const spec of [
    'mullet_stored_inline_scene_v1',
    'mullet_stored_inline_scene_envelope_v1',
    'mullet_stored_inline_scene_v2',
    'mullet_stored_inline_scene_envelope_v2',
    'mullet_stored_inline_scene_v3',
    'mullet_stored_inline_scene_envelope_v3',
    'mullet_stored_inline_scene_v4',
    'mullet_stored_inline_scene_envelope_v4',
    'mullet_stored_inline_scene_v5',
    'mullet_stored_inline_scene_envelope_v5',
    'mullet_stored_inline_scene_v6',
    'mullet_stored_inline_scene_envelope_v6'
  ]) {
    let lockHeld = false;
    let discardedWhileLocked = false;
    const restored = await restoreStoredInlineScene({
      exclusive: async (operation) => {
        lockHeld = true;
        try { return await operation(); } finally { lockHeld = false; }
      },
      load: async () => ({ spec }),
      discardInvalid: async () => { discardedWhileLocked = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('obsolete scene installed')
    });
    assert.equal(restored, null);
    assert.equal(discardedWhileLocked, true);
  }
});
