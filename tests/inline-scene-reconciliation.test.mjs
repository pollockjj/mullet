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

test('reload holds automatic scene-motion reconciliation until static and motion restoration finish', () => {
  const restoration = sourceBetween(
    'async function restoreInlineSceneAndMotion()',
    'function currentInlineSceneVideoRequest('
  );
  assert.match(
    restoration,
    /await runInlineSceneVideoRestoration\(async \(\) => \{\s+await restoreGeneratedInlineScene\(\);\s+await loadInlineSceneGenerator\(\);\s+await tick\(\);\s+await restoreGeneratedInlineSceneVideo\(\);\s+\}\);/
  );
  assert.match(pageSource, /install: \(scene\) => installGeneratedInlineScene\(scene, true\)/);
  assert.match(
    pageSource,
    /scheduleInlineSceneVideoReconciliation\([\s\S]*?inlineSceneVideoRestorationPending,[\s\S]*?inlineSceneVideoCurrent\s+\);/
  );
});

test('page teardown and DOM playback errors never delete verified persisted scene motion', () => {
  const teardown = sourceBetween('onDestroy(() => {', 'function restorePortraitSettings()');
  assert.match(teardown, /inlineSceneVideoComponentDestroying = true;/);
  assert.ok(
    teardown.indexOf('inlineSceneVideoComponentDestroying = true;')
      < teardown.indexOf('URL.revokeObjectURL(generatedInlineSceneVideoUrl)'),
    'the teardown guard must be set before revoking the scene-motion Blob URL'
  );

  const decodeHandler = sourceBetween(
    'function handleInlineSceneVideoDecodeError()',
    'async function loadInlineSceneGenerator()'
  );
  assert.match(decodeHandler, /if \(inlineSceneVideoComponentDestroying\) return;/);
  assert.match(decodeHandler, /lastInlineSceneVideoAttemptKey = inlineSceneVideoRequestKey\(inlineSceneVideoRequest\);/);
  assert.match(decodeHandler, /removeInstalledInlineSceneVideo\(\);/);
  assert.doesNotMatch(decodeHandler, /clearInlineSceneVideoAtGeneration|clearStoredInlineSceneVideo/);
});

test('installing a genuinely new static scene still invalidates its predecessor motion', () => {
  const invalidation = sourceBetween(
    'function invalidateInlineSceneVideoForNewStaticScene()',
    'function inlineSceneVideoSourceIsCurrent('
  );
  assert.match(invalidation, /suspendInlineSceneVideoForStaticChange\(\);/);
  assert.match(invalidation, /removeInstalledInlineSceneVideo\(\);/);
  assert.match(invalidation, /clearInlineSceneVideoAtGeneration\(inlineSceneVideoGeneration\);/);

  const suspension = sourceBetween(
    'function suspendInlineSceneVideoForStaticChange()',
    'async function clearInlineSceneVideoAtGeneration('
  );
  assert.match(suspension, /inlineSceneVideoError = '';/);
  assert.match(suspension, /lastInlineSceneVideoAttemptKey = '';/);
});
