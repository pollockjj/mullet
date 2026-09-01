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

test('expression, portrait, and portrait motion derive only from a durable finalized fiction response', () => {
  assert.match(
    pageSource,
    /\$: expressionSnapshot = conversationMode === CONVERSATION_MODE_FICTION\s+\? currentExpressionSnapshot\(finalizedFictionResponse, conversationId, messages\)/
  );
  assert.match(
    pageSource,
    /return expressionRequestForFinalizedFictionResponse\(receipt, currentConversationId, currentMessages\);/
  );
  assert.match(
    sourceBetween('async function determineExpression(', 'async function loadScenarioCatalog()'),
    /selectedSnapshot \?\? currentExpressionSnapshot\(finalizedFictionResponse, conversationId, messages\)/
  );
  assert.doesNotMatch(pageSource, /\bbuildExpressionSidecarRequest\b/);
  assert.match(pageSource, /\$: expressionCurrent = Boolean\(expressionResult && expressionSnapshot/);
  assert.match(pageSource, /\$: portraitRequest = currentPortraitRequest\(\s+expressionResult,\s+expressionCurrent,/);
  assert.match(pageSource, /\$: portraitVideoRequest = currentPortraitVideoRequest\(\s+generatedPortrait,\s+portraitCurrent,/);
});

test('terminal chat finalization is atomic and every failed post-append fiction stream clears eligibility', () => {
  const sendTurn = sourceBetween('async function sendChatTurn(', 'function composerKeydown(');
  assert.match(
    sendTurn,
    /assertFinalizedChatStream\([\s\S]*?if \(fictionMode\) {\s+finalizedFictionResponse = createCompletedFictionResponseReceipt\(conversationId, messages\);[\s\S]*?persist\(\);\s+completedResponse = true;/
  );
  assert.match(
    sendTurn,
    /if \(fictionMode\) {\s+finalizedFictionResponse = null;\s+if \(messages\.at\(-1\)\?\.content === ''\) messages = messages\.slice\(0, -1\);\s+persist\(\);/
  );
});

test('restore, authored openings, and workspace saves carry the exact fiction receipt', () => {
  assert.match(
    sourceBetween('function restoreWorkspaceState()', 'onDestroy(() => {'),
    /finalizedFictionResponse = loaded\.workspace\.finalizedFictionResponse;/
  );
  assert.match(
    sourceBetween('function persist()', 'function freshConversation()'),
    /conversationMode === CONVERSATION_MODE_FICTION \? finalizedFictionResponse : null/
  );
  assert.match(
    sourceBetween('onMount(() => {', 'function restoreWorkspaceState()'),
    /messages = freshConversation\(\);\s+bindAuthoredFictionOpeningReceipt\(\);\s+persist\(\);/
  );
  for (const [start, end] of [
    ['async function startSelectedScenario(', 'function persist()'],
    ['async function replaceConversationMode(', 'async function startPersonalAssistant()'],
    ['async function clearConversation()', 'async function portraitFromPng('],
    ['async function importCharacterCard(', 'function removeCharacterCard()']
  ]) {
    assert.match(sourceBetween(start, end), /await resetSidecarForConversation\(\);\s+bindAuthoredFictionOpeningReceipt\(\);/);
  }
  assert.match(
    sourceBetween('async function resetSidecarForConversation()', 'function assistantMemoryIsCurrent('),
    /conversationId = crypto\.randomUUID\(\);\s+finalizedFictionResponse = null;/
  );
});

test('never renders a restored expression portrait unless it matches the current request', () => {
  assert.match(pageSource, /generatedPortraitUrl && portraitCurrent\} class="portrait"/);
  assert.match(pageSource, /\{:else if expressionsEnabled && generatedPortraitUrl && portraitCurrent\}/);
  assert.doesNotMatch(pageSource, /\{:else if expressionsEnabled && generatedPortraitUrl\}/);
});

test('an unavailable selected expression model exposes an in-place capability refresh', () => {
  assert.match(pageSource, /selectedPortraitCapability && !portraitSelectedModelAvailable/);
  assert.match(pageSource, /class="error-retry" on:click=\{\(\) => void loadPortraitGenerator\(\)\}/);
  assert.match(pageSource, /portraitCapabilitiesLoading \? 'Checking…' : 'Refresh models'/);
});

test('an unavailable scenario identity LoRA blocks portrait requests and exposes an in-place refresh', () => {
  assert.match(
    pageSource,
    /portraitSelectedModelAvailable && portraitSelectedSubjectLoraAvailable/
  );
  assert.match(
    pageSource,
    /portraitDisplayProfile\?\.subjectLora && !portraitSelectedModelUsesReference && !portraitSelectedSubjectLoraAvailable/
  );
  assert.match(pageSource, /Linked identity LoRA is unavailable · \{portraitDisplayProfile\.subjectLora\.name\}/);
  assert.match(
    pageSource,
    /\$: portraitRequest = currentPortraitRequest\([\s\S]*?effectiveScenarioPortraitProfile,/
  );
  assert.match(pageSource, /portraitCapabilitiesLoading \? 'Checking…' : 'Refresh models'/);
});

test('each automatic expression stage receives at most one delayed retry per failed key', () => {
  for (const stage of ['Expression', 'Portrait', 'PortraitVideo']) {
    assert.match(pageSource, new RegExp(`function queue${stage}AutomaticRetry\\(key: string\\)`));
  }
  assert.match(pageSource, /expressionRetriedKey === key\) return;/);
  assert.match(pageSource, /portraitRetriedKey === key\) return;/);
  assert.match(pageSource, /portraitVideoRetriedKey === key\) return;/);
  assert.match(pageSource, /queueExpressionAutomaticRetry\(key\);/);
  assert.match(pageSource, /queuePortraitAutomaticRetry\(key\);/);
  assert.match(pageSource, /queuePortraitVideoAutomaticRetry\(key\);/);
  assert.match(pageSource, /automaticExpressionRetryDelayMs = 1_500/);
});

test('each delayed retry directly wakes its reconciliation scheduler with live state', () => {
  assert.match(
    pageSource,
    /if \(lastExpressionAttemptKey !== key\) return;\s+lastExpressionAttemptKey = '';\s+scheduleExpressionReconciliation\(/
  );
  assert.match(
    pageSource,
    /if \(lastPortraitAttemptKey !== key\) return;\s+lastPortraitAttemptKey = '';\s+schedulePortraitReconciliation\(/
  );
  assert.match(
    pageSource,
    /if \(lastPortraitVideoAttemptKey !== key\) return;\s+lastPortraitVideoAttemptKey = '';\s+schedulePortraitVideoReconciliation\(/
  );
});

test('static expression portraits use locked restore, commit, rollback, and clear operations', () => {
  assert.match(
    pageSource,
    /await restoreStoredPortrait\(\{\s+exclusive: runStoredPortraitExclusive,[\s\S]*?accepts: \(portrait\) => portrait\.conversationId === restoringConversationId,/
  );
  assert.match(
    pageSource,
    /const committed = await commitStoredPortrait\(stored, \{\s+exclusive: runStoredPortraitExclusive,\s+save: saveStoredPortrait,\s+isCurrent,\s+rollback: rollbackStoredPortraitWrite,/
  );
  assert.match(pageSource, /await runStoredPortraitExclusive\(clearStoredPortrait\);/);
});
