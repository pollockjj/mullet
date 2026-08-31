import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INLINE_SCENE_IMAGE_REQUEST_SPEC,
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  createInlineSceneContinuityMaster,
  inlineSceneImageRequestKey,
  inlineSceneSourceForScenarioOpening
} from '../src/lib/inline-scene.ts';
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

const soloCast = Object.freeze({
  kind: 'solo',
  identities: Object.freeze([Object.freeze({
    profileId: candidate.id,
    profileFingerprint: candidate.profileFingerprint,
    displayName: candidate.displayName,
    subject: 'Jenna Stannis, an adult blonde woman aboard the Liberator',
    referenceImage: canonicalReference,
    bodyReferenceImage: null
  })])
});

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

function png(width = 864, height = 576) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function stored(overrides = {}, sceneRequest = request()) {
  const imageBytes = png();
  sceneRequest.source.promptSha256 = `sha256:${createHash('sha256').update(sceneRequest.prompt).digest('hex')}`;
  return {
    spec: STORED_INLINE_SCENE_SPEC,
    conversationId: sceneRequest.source.conversationId,
    epoch: '22222222-2222-4222-8222-222222222222',
    requestKey: inlineSceneImageRequestKey(sceneRequest),
    request: sceneRequest,
    modelTemplate: sceneRequest.modelTemplate,
    promptId: '33333333-3333-4333-8333-333333333333',
    seed: 42,
    width: 864,
    height: 576,
    generatedAt: 17,
    imageSha256: createHash('sha256').update(imageBytes).digest('hex'),
    image: new Blob([imageBytes], { type: 'image/png' }),
    continuityMasterImage: null,
    ...overrides
  };
}

test('normalizes and byte-verifies a provenance-bound inline PNG', async () => {
  const scene = normalizeStoredInlineScene(stored());
  assert.equal(STORED_INLINE_SCENE_SPEC, 'mullet_stored_inline_scene_v6');
  assert.equal(STORED_INLINE_SCENE_ENVELOPE_SPEC, 'mullet_stored_inline_scene_envelope_v6');
  assert.equal(scene.requestKey, inlineSceneImageRequestKey(scene.request));
  assert.deepEqual(scene.request.cast, soloCast);
  assert.equal(scene.request.lora.path, 'zimage/jenna6.safetensors');
  assert.equal(scene.continuityMasterImage, null);
  assert.equal((await verifyStoredInlineScene(scene)).image.type, 'image/png');
  assert.equal(JSON.stringify(scene).includes('transcript'), false);
});

test('preserves a Qwen reference-edit solo cast in the v6 envelope', async () => {
  const qwenRequest = request({
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    lora: null
  });
  const scene = normalizeStoredInlineScene(stored({}, qwenRequest));
  assert.equal(scene.modelTemplate, INLINE_SCENE_QWEN_TEMPLATE_ID);
  assert.equal(scene.request.cast.kind, 'solo');
  assert.deepEqual(scene.request.cast.identities[0].referenceImage, canonicalReference);
  assert.equal(scene.request.lora, null);
  await verifyStoredInlineScene(scene);
});

test('persists and verifies exactly one flat continuity-master PNG without recursive scene state', async () => {
  const priorRequest = request({
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    lora: null
  });
  stored({}, priorRequest);
  const masterBytes = png();
  const continuityMaster = createInlineSceneContinuityMaster(priorRequest, {
    promptId: '44444444-4444-4444-8444-444444444444',
    seed: 73,
    generatedAt: 19,
    imageSha256: createHash('sha256').update(masterBytes).digest('hex')
  });
  const continuedRequest = request({
    modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID,
    continuityMaster,
    lora: null
  });
  const scene = normalizeStoredInlineScene(stored({
    continuityMasterImage: new Blob([masterBytes], { type: 'image/png' })
  }, continuedRequest));
  const verified = await verifyStoredInlineScene(scene);
  assert.equal(verified.continuityMasterImage?.type, 'image/png');
  assert.equal(verified.request.continuityMaster?.imageSha256, continuityMaster.imageSha256);
  assert.equal('scene' in verified.request.continuityMaster, false);
  assert.equal('request' in verified.request.continuityMaster, false);

  assert.throws(
    () => normalizeStoredInlineScene(stored({}, continuedRequest)),
    /continuity master image is invalid/
  );
  assert.throws(
    () => normalizeStoredInlineScene(stored({
      continuityMasterImage: new Blob([masterBytes], { type: 'image/png' })
    }, priorRequest)),
    /unexpected continuity master image/
  );

  const tampered = masterBytes.slice();
  tampered[8] = 1;
  await assert.rejects(
    verifyStoredInlineScene(stored({
      continuityMasterImage: new Blob([tampered], { type: 'image/png' })
    }, continuedRequest)),
    /continuity master hash does not match/
  );
  await assert.rejects(
    verifyStoredInlineScene(stored({
      continuityMasterImage: new Blob([png(800, 576)], { type: 'image/png' })
    }, continuedRequest)),
    /PNG dimensions/
  );
});

test('preserves scenario-opening identity through static-scene persistence', async () => {
  const completed = stored();
  const opening = normalizeStoredInlineScene(stored({}, openingRequest()));
  assert.equal(opening.request.source.sourceKind, 'scenario_opening');
  assert.equal(opening.request.source.scenarioId, 'blakes-7-after-false-control');
  assert.equal(opening.request.source.scenarioVersion, '3.0');
  assert.equal(opening.request.source.starterId, 'jenna');
  assert.notEqual(opening.requestKey, completed.requestKey);
  await verifyStoredInlineScene(opening);
});

test('rejects mismatched keys, dimensions, bytes, and hashes', async () => {
  assert.throws(() => normalizeStoredInlineScene(stored({ requestKey: 'wrong' })), /request key/);
  assert.throws(() => normalizeStoredInlineScene(stored({ width: 800 })), /dimensions/);
  await assert.rejects(verifyStoredInlineScene(stored({ imageSha256: 'c'.repeat(64) })), /hash does not match/);
  await assert.rejects(verifyStoredInlineScene(stored({ image: new Blob([new Uint8Array(24)], { type: 'image/png' }) })), /PNG header/);
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
  const restored = await restoreStoredInlineScene({
    exclusive: async (operation) => {
      lockHeld = true;
      try { return await operation(); } finally { lockHeld = false; }
    },
    load: async () => stored(),
    discardInvalid: async () => assert.fail('valid restore was discarded'),
    isCurrent: () => true,
    accepts: () => true,
    install: () => { installedWhileLocked = lockHeld; }
  });
  assert.equal(restored?.promptId, '33333333-3333-4333-8333-333333333333');
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

test('discards corrupt bytes inside the original restore lock', async () => {
  let lockHeld = false;
  let discardedWhileLocked = false;
  await assert.rejects(
    restoreStoredInlineScene({
      exclusive: async (operation) => {
        lockHeld = true;
        try { return await operation(); } finally { lockHeld = false; }
      },
      load: async () => stored({ imageSha256: 'c'.repeat(64) }),
      discardInvalid: async () => { discardedWhileLocked = lockHeld; },
      isCurrent: () => true,
      accepts: () => true,
      install: () => assert.fail('corrupt restore installed')
    }),
    (cause) => cause instanceof StoredInlineSceneIntegrityError
  );
  assert.equal(discardedWhileLocked, true);
});

test('silently discards obsolete v1 through v5 scenes inside the restore lock', async () => {
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
    'mullet_stored_inline_scene_envelope_v5'
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
