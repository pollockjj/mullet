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
    '{#if generatedInlineSceneUrl}',
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

test('an ancestral scene restores and remains visible as stale fallback without becoming current', () => {
  const applies = sourceBetween(
    'function inlineSceneAppliesToTranscript(',
    'function inlineSceneSourceBelongsToCurrentAncestry('
  );
  assert.match(applies, /scene\.epoch === epoch/);
  assert.match(applies, /inlineSceneSourcesMatch\(scene\.request\.source, source\)/);
  assert.match(
    pageSource,
    /\$: inlineSceneCurrent = inlineSceneApplies && inlineSceneMatchesSettings\(/
  );

  const restoration = sourceBetween(
    'async function restoreGeneratedInlineScene()',
    'async function restoreInlineSceneAndMotion()'
  );
  assert.match(restoration, /inlineSceneSourceBelongsToCurrentAncestry\(/);
  assert.doesNotMatch(restoration, /accepts: \(scene\) => scene\.epoch === epoch/);
  assert.doesNotMatch(restoration, /inlineSceneSourcesMatch\(scene\.request\.source, source\)/);

  const sceneCard = sourceBetween(
    '<figure\n                  class:stale=',
    '</figure>'
  );
  assert.match(sceneCard, /\{#if generatedInlineSceneUrl\}/);
  assert.doesNotMatch(sceneCard, /\{#if generatedInlineSceneUrl && inlineSceneApplies\}/);
  assert.match(sceneCard, /Prior response · verified static fallback/);
  assert.match(sceneCard, /Updating landscape · prior verified scene shown/);
  assert.match(sceneCard, /generatedInlineScene \? generatedInlineScene\.width/);
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

test('publishing the next finalized source retains the prior verified static master', () => {
  const publication = sourceBetween(
    'function publishFinalizedInlineSceneSource(source: InlineSceneSource)',
    'function scenarioOpeningIdentity()'
  );
  assert.match(publication, /invalidateInlineSceneVideoForNewStaticScene\(\);/);
  assert.match(publication, /finalizedInlineSceneSource = normalizedSource;/);
  assert.match(publication, /inlineSceneEpoch = epoch;/);
  assert.doesNotMatch(publication, /removeInstalledInlineScene\(\)/);
  assert.doesNotMatch(publication, /clearStoredInlineScene\(\)/);
});

test('scene reconciliation supplies the complete scenario cast and compiles the selected solo, duo, or trio', () => {
  assert.match(
    pageSource,
    /\$: scenarioSceneProfiles = conversationMode === CONVERSATION_MODE_FICTION && isScenarioCard\(activeCard\)[\s\S]*?scenarioPortraitCast\(activeCard\)\?\.profiles \?\? \[\]/
  );

  const sidecarRequest = sourceBetween(
    'function currentInlineSceneSidecarRequest(',
    'function inlineSceneAppliesToTranscript('
  );
  assert.match(sidecarRequest, /const candidates: InlineSceneSubjectCandidate\[\] = profiles\.map\(\(profile\) => \(\{/);
  assert.match(sidecarRequest, /id: profile\.id,/);
  assert.match(sidecarRequest, /displayName: profile\.displayName,/);
  assert.match(sidecarRequest, /aliases: profile\.aliases,/);
  assert.match(sidecarRequest, /profileFingerprint: profile\.fingerprint/);
  assert.match(sidecarRequest, /buildInlineSceneRequest\(currentConversationId, currentMessages, source, candidates\)/);

  const castCompiler = sourceBetween(
    'function inlineSceneCastForResult(',
    'function inlineSceneMatchesSettings('
  );
  assert.match(castCompiler, /result\.output\.subjectIds\.map/);
  assert.match(castCompiler, /resultCandidate\.profileFingerprint !== profile\.fingerprint/);
  assert.match(castCompiler, /bodyReferenceImage: profile\.bodyReferenceImage/);
  assert.match(castCompiler, /if \(identities\.length === 1\) return \{ kind: 'solo'/);
  assert.match(castCompiler, /if \(identities\.length === 2\) return \{ kind: 'duo'/);
  assert.match(castCompiler, /if \(identities\.length === 3\) return \{ kind: 'trio'/);
  assert.doesNotMatch(castCompiler, /scenarioStarterPortraitProfile/);

  const reconciliation = sourceBetween(
    'function inlineSceneAttemptKey(',
    'function inlineSceneResponseHash('
  );
  assert.match(reconciliation, /profiles: readonly ScenarioPortraitProfile\[\]/);
  assert.match(reconciliation, /inlineSceneCastForResult\(result, scenarioSceneProfiles\)/);
  assert.match(reconciliation, /inlineSceneDriverForCast\(cast, scenarioSceneProfiles, continuityMaster\)/);
  assert.match(reconciliation, /\.\.\.driver,/);
  assert.doesNotMatch(reconciliation, /inlineSceneProfileDriver/);
});

test('static driver deterministically keeps initial LoRA solos on Z-Image and all other casts on Qwen', () => {
  const driver = sourceBetween(
    'function inlineSceneDriverForCast(',
    'function inlineSceneDriverAvailable('
  );
  assert.match(driver, /cast\.kind === 'solo' && !continuityMaster/);
  assert.match(driver, /candidate\.id === identity\.profileId/);
  assert.match(driver, /candidate\.fingerprint === identity\.profileFingerprint/);
  assert.match(driver, /if \(profile\?\.subjectLora\)/);
  assert.match(driver, /modelTemplate: INLINE_SCENE_TEMPLATE_ID/);
  assert.match(driver, /path: profile\.subjectLora\.name/);
  assert.match(driver, /trigger: profile\.subjectLora\.trigger/);
  assert.match(driver, /modelHash: profile\.subjectLora\.sha256/);
  assert.match(driver, /return \{ modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID, lora: null \};/);

  const matching = sourceBetween(
    'function inlineSceneMatchesSettings(',
    'function removeInstalledInlineScene()'
  );
  assert.match(matching, /inlineSceneDriverForCast\(/);
  assert.match(matching, /scene\.request\.continuityMaster \?\? null/);
  assert.match(matching, /scene\.request\.modelTemplate === driver\.modelTemplate/);
  assert.match(matching, /scene\.request\.lora\?\.modelHash/);

  const potential = sourceBetween(
    'function inlineScenePotentialDriverAvailable(',
    'function inlineSceneCastForResult('
  );
  assert.match(potential, /if \(continuityScene\)/);
  assert.match(potential, /INLINE_SCENE_QWEN_TEMPLATE_ID/);
  assert.match(potential, /INLINE_SCENE_TEMPLATE_ID/);
  assert.match(potential, /capabilities\.loras\.includes\(profile\.subjectLora\.name\)/);

  const generation = sourceBetween(
    'async function generateInlineScene(',
    'function persistInlineScenesEnabled()'
  );
  assert.match(generation, /const driver = inlineSceneDriverForCast\(cast, selectedProfiles, continuityMaster\);/);
  assert.match(generation, /if \(!inlineSceneDriverAvailable\(selectedCapabilities, driver\)\)/);
  assert.match(generation, /Linked scene identity LoRA is unavailable/);
  assert.match(generation, /is unavailable for the selected scene cast/);
  assert.match(generation, /const imageRequest = buildInlineSceneImageRequest\(result, \{\s+\.\.\.driver,/);
  assert.doesNotMatch(generation, /driver\s*=\s*\{ modelTemplate:/);
});

test('scene continuity uses an eligible strict ancestor and falls back fresh for three new subjects', () => {
  const ancestry = sourceBetween(
    'function inlineSceneSourceBelongsToCurrentAncestry(',
    'function inlineSceneCastForResult('
  );
  assert.match(ancestry, /candidate\.messageCount <= current\.messageCount/);
  assert.match(ancestry, /scene\.request\.source\.messageCount >= request\.source\.messageCount/);
  assert.match(ancestry, /createInlineSceneContinuityMaster\(scene\.request/);

  const generation = sourceBetween(
    'async function generateInlineScene(',
    'function persistInlineScenesEnabled()'
  );
  assert.match(generation, /await verifyStoredInlineScene\(selectedContinuityScene\)/);
  assert.match(generation, /if \(inlineSceneContinuityMasterEligible\(cast, candidateMaster\)\)/);
  assert.match(generation, /continuityMaster = candidateMaster;/);
  assert.match(generation, /continuityMasterImage = verifiedMasterScene\.image;/);
  assert.match(generation, /\.\.\.\(continuityMaster \? \{ continuityMaster \} : \{\}\)/);
  assert.match(generation, /imageForm\.append\('request', JSON\.stringify\(imageRequest\)\)/);
  assert.match(generation, /if \(continuityMasterImage\) imageForm\.append\('master'/);
  assert.match(generation, /continuityMasterImage\n/);

});

test('H3 page multipart inherits eligible inclusion plus no-overlap and same-hash omission from the exact reference plan', () => {
  assert.match(pageSource, /inlineSceneH3ReferencePlan,/);
  const generation = sourceBetween(
    'async function generateInlineSceneVideo(',
    'function persistInlineSceneMotionEnabled()'
  );
  assert.match(
    generation,
    /const priorMasterRequired = selectedRequest\.modelTemplate === MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID\s+&& inlineSceneH3ReferencePlan\(selectedRequest\)\.some\(\(\{ kind \}\) => kind === 'prior_master'\);/
  );
  assert.match(generation, /if \(priorMasterRequired\) \{/);
  assert.match(generation, /if \(!selectedScene\.continuityMasterImage\)/);
  assert.match(generation, /form\.append\('master', selectedScene\.continuityMasterImage/);
  assert.doesNotMatch(generation, /&& selectedScene\.request\.continuityMaster/);
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
