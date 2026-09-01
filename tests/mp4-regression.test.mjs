// Regression for a defect observed on the served build, not a byte-layout exercise.
//
// The served build (eef5e127) rejected correct MiniMax H3 portrait motion with
// "MP4 video frame rate does not match the request" and correct scene motion with
// "MP4 video duration disagrees with its sample table". Both came from the validator
// asserting exact equality against values the muxer derives independently.
//
// The fixture is the exact ComfyUI output that was thrown away: a 576x1024 silent
// H.264 loop of 56 frames over exactly 2.000 seconds, fetched from
// firestorm:8189 /view?filename=portrait-motion-loop-flf_00116_.mp4.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateH264VideoOnlyMp4 } from '../src/lib/mp4.ts';

const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/h3-portrait-loop-576x1024-56f-silent.mp4', import.meta.url)))
);

test('accepts real H3 portrait motion whose frame rate differs from the requested rate', () => {
  // MULLET asks for 24 fps; H3 delivers 56 frames across exactly 2.000 seconds, so the
  // container reports 28 fps. The video is correct and must not be discarded.
  const metadata = validateH264VideoOnlyMp4(fixture, { width: 576, height: 1024, frames: 56, fps: 24 });
  assert.equal(metadata.width, 576);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.frameCount, 56);
  assert.equal(metadata.audioTrackCount, 0);
  assert.equal(metadata.videoCodec, 'avc1');
  assert.ok(Math.abs(metadata.durationSeconds - 2) < 0.01, `duration ${metadata.durationSeconds}`);
});

test('still rejects a requested length the output does not deliver', () => {
  assert.throws(
    () => validateH264VideoOnlyMp4(fixture, { width: 576, height: 1024, frames: 73, fps: 24 }),
    /frame count/
  );
});

test('still rejects dimensions the output does not deliver', () => {
  assert.throws(
    () => validateH264VideoOnlyMp4(fixture, { width: 768, height: 1152, frames: 56, fps: 24 }),
    /dimensions/
  );
});
