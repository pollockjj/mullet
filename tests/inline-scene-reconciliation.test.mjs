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

test('page teardown and DOM playback failures never delete or replace verified persisted scene motion', () => {
  const mount = sourceBetween('onMount(() => {', 'function restoreWorkspaceState()');
  assert.match(mount, /window\.addEventListener\('pagehide', handleInlineSceneVideoPageHide\);/);
  assert.match(mount, /window\.addEventListener\('pageshow', handleInlineSceneVideoPageShow\);/);

  const pageLifecycle = sourceBetween(
    'function handleInlineSceneVideoPageHide()',
    'onMount(() => {'
  );
  assert.match(pageLifecycle, /inlineSceneVideoComponentDestroying = true;/);
  assert.match(pageLifecycle, /inlineSceneVideoComponentDestroying = false;/);

  const teardown = sourceBetween('onDestroy(() => {', 'function restorePortraitSettings()');
  assert.match(teardown, /inlineSceneVideoComponentDestroying = true;/);
  assert.match(teardown, /window\.removeEventListener\('pagehide', handleInlineSceneVideoPageHide\);/);
  assert.match(teardown, /window\.removeEventListener\('pageshow', handleInlineSceneVideoPageShow\);/);
  assert.ok(
    teardown.indexOf('inlineSceneVideoComponentDestroying = true;')
      < teardown.indexOf('URL.revokeObjectURL(generatedInlineSceneVideoUrl)'),
    'the teardown guard must be set before revoking the scene-motion Blob URL'
  );

  const playback = sourceBetween(
    'function clearInlineSceneVideoPlaybackTimer()',
    'function removeInstalledInlineSceneVideo()'
  );
  assert.match(playback, /element\.muted = true;/);
  assert.match(playback, /element\.defaultMuted = true;/);
  assert.match(playback, /element\.play\(\)\.catch\(\(\) => showInlineSceneVideoStaticFallback\(element, sourceUrl, token\)\)/);
  assert.match(
    playback,
    /window\.setTimeout\([\s\S]*?showInlineSceneVideoStaticFallback\(element, sourceUrl, token\)[\s\S]*?MEDIA_PLAYBACK_START_TIMEOUT_MS/
  );
  assert.match(
    playback,
    /mediaPlaybackTimeAdvanced\([\s\S]*?inlineSceneVideoPlaybackStartSeconds,[\s\S]*?element\.currentTime,[\s\S]*?generatedInlineSceneVideo\.fps,[\s\S]*?generatedInlineSceneVideo\.durationSeconds[\s\S]*?\)/
  );
  assert.ok(
    playback.indexOf("inlineSceneVideoPlaybackState = 'playing';")
      > playback.indexOf('mediaPlaybackTimeAdvanced('),
    'scene motion may become visible only after measured media-time advancement'
  );

  const fallback = sourceBetween(
    'function showInlineSceneVideoStaticFallback(',
    'function attemptInlineSceneVideoPlayback('
  );
  assert.match(fallback, /inlineSceneVideoDecodeFailureTransition\([\s\S]*?inlineSceneVideoComponentDestroying,[\s\S]*?inlineSceneVideoRequest[\s\S]*?\);/);
  assert.match(fallback, /if \(transition\.action === 'ignore'\) return;/);
  assert.match(fallback, /inlineSceneVideoPlaybackState = 'fallback';/);
  assert.match(fallback, /inlineSceneVideoPlaybackError = transition\.error;/);
  assert.match(fallback, /lastInlineSceneVideoAttemptKey = transition\.attemptKey;/);

  const retry = sourceBetween(
    'function retryInlineSceneVideoPlayback()',
    'function removeInstalledInlineSceneVideo()'
  );
  assert.match(retry, /resetInlineSceneVideoPlayback\('starting'\);/);
  assert.match(retry, /attemptInlineSceneVideoPlayback\(element\);/);

  const decodeHandler = sourceBetween(
    'function handleInlineSceneVideoDecodeError(event: Event)',
    'async function loadInlineSceneGenerator()'
  );
  assert.match(decodeHandler, /showInlineSceneVideoStaticFallback\([\s\S]*?inlineSceneVideoPlaybackToken[\s\S]*?\);/);

  for (const nonMutatingPlaybackPath of [fallback, retry, decodeHandler]) {
    assert.doesNotMatch(
      nonMutatingPlaybackPath,
      /removeInstalledInlineSceneVideo|clearInlineSceneVideoAtGeneration|clearStoredInlineSceneVideo|saveStoredInlineSceneVideo|rollbackStoredInlineSceneVideoWrite|commitStoredInlineSceneVideo|restoreStoredInlineSceneVideo|generateInlineSceneVideo|fetch\(/
    );
  }
});

test('scene motion stays behind its static source until explicit playback measurably advances', () => {
  const sceneMedia = sourceBetween(
    '{#if generatedInlineSceneUrl && inlineSceneApplies}',
    '<figcaption>'
  );
  assert.ok(
    sceneMedia.indexOf('<img src={generatedInlineSceneUrl}')
      < sceneMedia.indexOf('{#if inlineSceneVideoMounted}'),
    'the verified static scene must render beneath pending motion'
  );
  assert.match(sceneMedia, /class:playback-confirmed=\{inlineSceneVideoVisible\}/);
  assert.match(sceneMedia, /bind:this=\{inlineSceneVideoElement\}/);
  assert.match(sceneMedia, /preload="auto"/);
  assert.match(sceneMedia, /on:canplay=\{handleInlineSceneVideoCanPlay\}/);
  assert.match(sceneMedia, /on:timeupdate=\{handleInlineSceneVideoTimeUpdate\}/);
  assert.match(sceneMedia, /on:error=\{handleInlineSceneVideoDecodeError\}/);
  assert.doesNotMatch(sceneMedia, /\bautoplay\b/);
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

test('restores or republishes a packaged opening source without inventing a user turn', () => {
  const mount = sourceBetween('onMount(() => {', 'function restoreWorkspaceState()');
  assert.match(mount, /restoreInlineSceneFinalizedSource\(\);/);
  assert.match(mount, /restoreScenarioOpeningInlineSceneSourceIfNeeded\(\);/);
  assert.ok(
    mount.indexOf('restoreInlineSceneFinalizedSource();')
      < mount.indexOf('restoreScenarioOpeningInlineSceneSourceIfNeeded();'),
    'a valid persisted source must be restored before considering an opening-source replacement'
  );

  const sourceRestoration = sourceBetween(
    'function restoreInlineSceneFinalizedSource()',
    'function removeInstalledInlineScene()'
  );
  assert.match(sourceRestoration, /normalizeInlineSceneSource\(parsed\.source\)/);
  assert.match(
    sourceRestoration,
    /inlineSceneSourceForCompletedTurn\(normalizeLivingHistorySource\(parsed\.source\)\)/
  );
  assert.match(sourceRestoration, /if \(source\.sourceKind === 'scenario_opening' && !scenarioCatalogSettled\) return;/);
  assert.match(sourceRestoration, /inlineSceneSourceMatchesMessages\(source, conversationId, messages\)/);
  assert.match(sourceRestoration, /inlineSceneSourceMatchesActiveScenario\(source\)/);
  assert.match(
    sourceRestoration,
    /localStorage\.setItem\(inlineSceneFinalizedStorageKey, JSON\.stringify\(\{ epoch: parsed\.epoch, source \}\)\)/
  );

  const enabling = sourceBetween(
    'function persistInlineScenesEnabled()',
    'function publishFinalizedInlineSceneSource('
  );
  assert.match(enabling, /if \(inlineScenesEnabled\) restoreScenarioOpeningInlineSceneSourceIfNeeded\(\);/);

  const openingPublication = sourceBetween(
    'function scenarioOpeningIdentity()',
    'async function resetInlineSceneForConversation()'
  );
  assert.match(openingPublication, /containsOnlyOpeningGreeting\(activeCard\)/);
  assert.match(openingPublication, /inlineSceneSourceForScenarioOpening\(conversationId, messages, identity\)/);
  assert.doesNotMatch(openingPublication, /role:\s*'user'/);
});

test('catalog settlement repairs a missing starter before restoring or publishing opening provenance', () => {
  const catalogLoad = sourceBetween(
    'async function loadScenarioCatalog()',
    'async function loadScenarioPackage('
  );
  assert.match(catalogLoad, /scenarioCatalogSettled = true;/);
  assert.match(catalogLoad, /if \(activeScenario\) \{\s*const packaged = await loadScenarioPackage\(activeScenario\);/);
  assert.match(catalogLoad, /activeCard = packaged\.card;/);
  assert.match(catalogLoad, /restoreInlineSceneFinalizedSource\(\);/);
  assert.match(catalogLoad, /restoreScenarioOpeningInlineSceneSourceIfNeeded\(\);/);
  assert.ok(
    catalogLoad.indexOf('scenarioCatalogSettled = true;')
      < catalogLoad.indexOf('restoreInlineSceneFinalizedSource();'),
    'opening restoration must wait for catalog validation and starter repair'
  );

  const openingIdentity = sourceBetween(
    'function scenarioOpeningIdentity()',
    'function publishScenarioOpeningInlineSceneSource()'
  );
  assert.match(openingIdentity, /!scenarioCatalogSettled/);
  assert.match(openingIdentity, /catalogScenario\.version !== scenarioVersion/);
  assert.match(openingIdentity, /catalogScenario\.starters\.some\(\(starter\) => starter\.id === activeScenarioStarterId\)/);
  assert.match(openingIdentity, /cardStarters\?\.starters\.some\(\(starter\) => starter\.id === activeScenarioStarterId\)/);

  const activeMatch = sourceBetween(
    'function inlineSceneSourceMatchesActiveScenario(',
    'function publishScenarioOpeningInlineSceneSource()'
  );
  assert.match(activeMatch, /source\.scenarioId === identity\.scenarioId/);
  assert.match(activeMatch, /source\.scenarioVersion === identity\.scenarioVersion/);
  assert.match(activeMatch, /source\.starterId === identity\.starterId/);
  assert.match(activeMatch, /containsOnlyOpeningGreeting\(activeCard\)/);
});

test('completed responses retain completed-turn provenance while an opening can render at message zero', () => {
  const sendTurn = sourceBetween('async function sendChatTurn(', 'function composerKeydown(');
  assert.match(
    sendTurn,
    /inlineSceneSourceForCompletedTurn\(livingHistorySourceForMessages\(conversationId, messages\)\)/
  );

  assert.match(
    pageSource,
    /finalizedInlineSceneSource\?\.messageIndex === messageIndex/
  );
  assert.match(pageSource, /inlineSceneSourcesMatch\(scene\.request\.source, source\)/);
  assert.match(
    pageSource,
    /inlineSceneSourceMatchesMessages\(scene\.request\.source, currentConversationId, currentMessages\)/
  );
});
