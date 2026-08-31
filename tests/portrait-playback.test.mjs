import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return pageSource.slice(startIndex, endIndex);
}

test('portrait motion stays behind its static portrait until playback measurably advances', () => {
  const portraitMedia = sourceBetween(
    '{:else if expressionsEnabled && generatedPortraitUrl && portraitCurrent}',
    '{:else if portraitDataUrl && activeCard}'
  );
  assert.ok(
    portraitMedia.indexOf('<img src={generatedPortraitUrl}')
      < portraitMedia.indexOf('{#if portraitVideoMounted}'),
    'the verified static portrait must render beneath pending motion'
  );
  assert.match(portraitMedia, /class:playback-confirmed=\{portraitVideoVisible\}/);
  assert.match(portraitMedia, /bind:this=\{portraitVideoElement\}/);
  assert.match(portraitMedia, /preload="auto"/);
  assert.match(portraitMedia, /on:canplay=\{handlePortraitVideoCanPlay\}/);
  assert.match(portraitMedia, /on:timeupdate=\{handlePortraitVideoTimeUpdate\}/);
  assert.match(portraitMedia, /on:error=\{handlePortraitVideoPlaybackError\}/);
  assert.doesNotMatch(portraitMedia, /\bautoplay\b/);
});

test('portrait playback explicitly starts muted and reports playing only after time advancement', () => {
  const playback = sourceBetween(
    'function clearPortraitVideoPlaybackTimer()',
    'function removeInstalledPortraitVideo()'
  );
  assert.match(playback, /element === portraitVideoElement/);
  assert.match(playback, /sourceUrl === generatedPortraitVideoUrl/);
  assert.match(playback, /token === portraitVideoPlaybackToken/);
  assert.match(playback, /elementSourceUrl !== sourceUrl/);
  assert.match(playback, /portraitVideoPlaybackAttemptedToken === token/);
  assert.match(playback, /element\.muted = true;/);
  assert.match(playback, /element\.defaultMuted = true;/);
  assert.match(playback, /element\.play\(\)\.catch\(\(\) => showPortraitVideoStaticFallback\(element, sourceUrl, token\)\)/);
  assert.match(
    playback,
    /window\.setTimeout\([\s\S]*?showPortraitVideoStaticFallback\(element, sourceUrl, token\)[\s\S]*?MEDIA_PLAYBACK_START_TIMEOUT_MS/
  );
  assert.match(
    playback,
    /mediaPlaybackTimeAdvanced\([\s\S]*?portraitVideoPlaybackStartSeconds,[\s\S]*?element\.currentTime,[\s\S]*?generatedPortraitVideo\.fps,[\s\S]*?generatedPortraitVideo\.encodedDurationSeconds[\s\S]*?\)/
  );
  assert.ok(
    playback.indexOf("portraitVideoPlaybackState = 'playing';")
      > playback.indexOf('mediaPlaybackTimeAdvanced('),
    'portrait motion may become visible only after measured media-time advancement'
  );
  assert.match(
    pageSource,
    /portraitVideoPlaybackState === 'playing' && portraitVideoCurrent \? 'Motion playing'/
  );
});

test('portrait playback failure and retry preserve the installed video and never regenerate', () => {
  const fallback = sourceBetween(
    'function showPortraitVideoStaticFallback(',
    'function attemptPortraitVideoPlayback('
  );
  const retry = sourceBetween(
    'function retryPortraitVideoPlayback()',
    'function removeInstalledPortraitVideo()'
  );
  assert.match(fallback, /portraitVideoPlaybackState = 'fallback';/);
  assert.match(fallback, /portraitVideoPlaybackError = /);
  assert.match(retry, /resetPortraitVideoPlayback\('starting'\);/);
  assert.match(retry, /attemptPortraitVideoPlayback\(element\);/);

  for (const nonMutatingPlaybackPath of [fallback, retry]) {
    assert.doesNotMatch(
      nonMutatingPlaybackPath,
      /removeInstalledPortraitVideo|URL\.revokeObjectURL|clearStoredPortraitVideo|saveStoredPortraitVideo|rollbackStoredPortraitVideoWrite|commitStoredPortraitVideo|restoreStoredPortraitVideo|generatePortraitVideo|fetch\(/
    );
  }
});
