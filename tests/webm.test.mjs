import assert from 'node:assert/strict';
import test from 'node:test';

import { validateVp9Webm } from '../src/lib/webm.ts';
import { buildVp9WebmFixture } from './webm-fixture.mjs';

const expected = { width: 1024, height: 576, frames: 49, fps: 24 };

test('reads dimensions, frame count, frame rate, and duration from WebM bytes', () => {
  const metadata = validateVp9Webm(buildVp9WebmFixture(), expected);
  assert.deepEqual(metadata, {
    codecId: 'V_VP9',
    width: 1024,
    height: 576,
    frameCount: 49,
    fps: 24,
    durationSeconds: 2,
    containerDurationSeconds: 2.042
  });
});

test('rejects WebM bytes with wrong dimensions, frame count, frame rate, or duration', () => {
  assert.throws(() => validateVp9Webm(buildVp9WebmFixture({ width: 640 }), expected), /dimensions/);
  assert.throws(() => validateVp9Webm(buildVp9WebmFixture({ frames: 48 }), expected), /frame count/);
  assert.throws(() => validateVp9Webm(buildVp9WebmFixture({ fps: 25 }), expected), /frame rate/);
  assert.throws(() => validateVp9Webm(buildVp9WebmFixture({ durationUnits: 3000 }), expected), /container duration/);
  assert.throws(() => validateVp9Webm(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), expected), /truncated/);
});

test('rejects duplicate middle timestamps instead of trusting only the endpoints', () => {
  const timestamps = Array.from({ length: 49 }, (_, index) => (
    index === 48 ? 2000 : 0
  ));
  assert.throws(
    () => validateVp9Webm(buildVp9WebmFixture({ timestamps }), expected),
    /timestamps|cadence/
  );
});

test('rejects malformed lacing that only claims the expected frame count', () => {
  assert.throws(
    () => validateVp9Webm(buildVp9WebmFixture({ malformedXiphLacing: true }), expected),
    /lacing/
  );
});

test('bounds structural element parsing before adversarial allocation grows with input size', () => {
  const bytes = new Uint8Array(10_000);
  for (let offset = 0; offset < bytes.length; offset += 2) {
    bytes[offset] = 0xec;
    bytes[offset + 1] = 0x80;
  }
  assert.throws(() => validateVp9Webm(bytes, expected), /element count/);
});
