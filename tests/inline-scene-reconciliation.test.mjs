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

  const decodeHandler = sourceBetween(
    'function handleInlineSceneVideoDecodeError()',
    'async function loadInlineSceneGenerator()'
  );
  assert.match(decodeHandler, /inlineSceneVideoDecodeFailureTransition\([\s\S]*?inlineSceneVideoComponentDestroying,[\s\S]*?inlineSceneVideoRequest[\s\S]*?\);/);
  assert.match(decodeHandler, /if \(transition\.action === 'ignore'\) return;/);
  assert.match(decodeHandler, /lastInlineSceneVideoAttemptKey = transition\.attemptKey;/);
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
