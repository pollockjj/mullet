import assert from 'node:assert/strict';
import test from 'node:test';

import { validateH264AacMp4 } from '../src/lib/mp4.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const expected = { width: 1344, height: 768, frames: 124, fps: 24 };

test('reads H.264 video and AAC audio metadata from MP4 bytes', () => {
  assert.deepEqual(validateH264AacMp4(buildH264AacMp4Fixture(), expected), {
    videoCodec: 'avc1',
    audioCodec: 'mp4a',
    width: 1344,
    height: 768,
    frameCount: 124,
    fps: 24,
    durationSeconds: 124 / 24
  });
});

test('rejects MP4 with wrong dimensions, frame count, frame rate, codec, or missing audio', () => {
  assert.throws(() => validateH264AacMp4(buildH264AacMp4Fixture({ width: 1376 }), expected), /dimensions/);
  assert.throws(() => validateH264AacMp4(buildH264AacMp4Fixture({ frames: 123 }), expected), /frame count/);
  assert.throws(() => validateH264AacMp4(buildH264AacMp4Fixture({ fps: 25 }), expected), /frame rate/);
  assert.throws(() => validateH264AacMp4(buildH264AacMp4Fixture({ videoCodec: 'av01' }), expected), /H\.264/);
  assert.throws(() => validateH264AacMp4(buildH264AacMp4Fixture({ includeAudio: false }), expected), /audio track/);
  assert.throws(() => validateH264AacMp4(Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), expected), /truncated/);
});

test('bounds MP4 box parsing before adversarial allocation grows with input size', () => {
  const free = Uint8Array.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]);
  const bytes = new Uint8Array(free.length * 5_000);
  for (let offset = 0; offset < bytes.length; offset += free.length) bytes.set(free, offset);
  assert.throws(() => validateH264AacMp4(bytes, expected), /box count/);
});
