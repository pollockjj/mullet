import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEDIA_PLAYBACK_START_TIMEOUT_MS,
  mediaPlaybackTimeAdvanced
} from '../src/lib/media-playback.ts';

test('uses a five-second media-playback start deadline', () => {
  assert.equal(MEDIA_PLAYBACK_START_TIMEOUT_MS, 5_000);
});

test('requires at least half a frame of forward playback time', () => {
  const fps = 24;
  const durationSeconds = 49 / fps;

  assert.equal(mediaPlaybackTimeAdvanced(0, 0, fps, durationSeconds), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, (0.5 / fps) - 0.000_001, fps, durationSeconds), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 0.5 / fps, fps, durationSeconds), true);
  assert.equal(mediaPlaybackTimeAdvanced(0.25, 0.5, fps, durationSeconds), true);
});

test('measures forward progress across a looping media-time wrap', () => {
  const fps = 24;
  const durationSeconds = 49 / fps;

  assert.equal(mediaPlaybackTimeAdvanced(durationSeconds - 0.01, 0.005, fps, durationSeconds), false);
  assert.equal(mediaPlaybackTimeAdvanced(durationSeconds - 0.02, 0.005, fps, durationSeconds), true);
});

test('rejects nonfinite and out-of-envelope playback measurements', () => {
  const valid = [0, 0.1, 24, 49 / 24];
  for (let index = 0; index < valid.length; index += 1) {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const values = [...valid];
      values[index] = invalid;
      assert.equal(mediaPlaybackTimeAdvanced(...values), false);
    }
  }

  assert.equal(mediaPlaybackTimeAdvanced(-0.01, 0.1, 24, 49 / 24), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, -0.01, 24, 49 / 24), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 0.1, 0, 49 / 24), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 0.1, -24, 49 / 24), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 0.1, 24, 0), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 0.1, 24, -1), false);
  assert.equal(mediaPlaybackTimeAdvanced(3, 0.1, 24, 49 / 24), false);
  assert.equal(mediaPlaybackTimeAdvanced(0, 3, 24, 49 / 24), false);
});
