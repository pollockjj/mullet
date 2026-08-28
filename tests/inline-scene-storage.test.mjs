import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { inlineSceneImageRequestKey } from '../src/lib/inline-scene.ts';
import {
  STORED_INLINE_SCENE_ENVELOPE_SPEC,
  STORED_INLINE_SCENE_SPEC,
  commitStoredInlineScene,
  normalizeStoredInlineScene,
  restoreStoredInlineScene,
  unwrapStoredInlineScene,
  verifyStoredInlineScene
} from '../src/lib/inline-scene-storage.ts';

function request(overrides = {}) {
  return {
    spec: 'mullet_inline_scene_image_request_v1',
    modelTemplate: 'z-image-turbo-scene-v1',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: `sha256:${'a'.repeat(64)}`,
      turnFingerprint: `sha256:${'b'.repeat(64)}`,
      sidecarModel: 'gemma-4-ortenzya',
      promptSha256: `sha256:${'f'.repeat(64)}`
    },
    prompt: 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.',
    lora: null,
    aspectRatio: '3:2',
    megapixels: 0.5,
    ...overrides
  };
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

function stored(overrides = {}) {
  const imageBytes = png();
  const sceneRequest = request();
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
    ...overrides
  };
}

test('normalizes and byte-verifies a provenance-bound inline PNG', async () => {
  const scene = normalizeStoredInlineScene(stored());
  assert.equal(scene.requestKey, inlineSceneImageRequestKey(scene.request));
  assert.equal((await verifyStoredInlineScene(scene)).image.type, 'image/png');
  assert.equal(JSON.stringify(scene).includes('transcript'), false);
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
    isCurrent: () => true,
    accepts: () => false,
    install: () => { installed = true; }
  });
  assert.equal(rejected, null);
  assert.equal(installed, false);
});
