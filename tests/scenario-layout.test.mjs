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

test('shows every packaged starter as a compact explicit button instead of a closed selector', () => {
  const picker = pageSource.match(
    /<section class="scenario-picker" aria-label="Bundled scenarios">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.match(picker, /\{#each selectedScenario\.starters as starter\}/);
  assert.match(picker, /class="scenario-starter/);
  assert.match(picker, /\{starter\.label\}/);
  assert.match(picker, /startSelectedScenario\(starter\.id\)/);
  assert.doesNotMatch(picker, /<select\b/);
  assert.match(pageSource, /\.scenario-starters\s*\{[^}]*display:\s*grid;/);
  assert.match(pageSource, /\.scenario-starter(?:\s|\{|\.)/);
});

test('activates the clicked starter and publishes its opening only after sidecar reset', () => {
  const activation = sourceBetween(
    'async function startSelectedScenario(',
    'function persist()'
  );
  assert.match(activation, /startSelectedScenario\(starterId: string\)/);
  assert.match(activation, /activeScenarioStarterId = starterId;/);
  assert.match(activation, /messages = freshConversation\(\);/);
  assert.match(activation, /await resetSidecarForConversation\(\);/);
  assert.match(activation, /publishScenarioOpeningInlineSceneSource\(\)/);
  assert.ok(
    activation.indexOf('activeScenarioStarterId = starterId;')
      < activation.indexOf('messages = freshConversation();'),
    'the selected starter must be active before its opening transcript is created'
  );
  assert.ok(
    activation.indexOf('messages = freshConversation();')
      < activation.indexOf('await resetSidecarForConversation();'),
    'the starter opening must be created before the sidecar branch is reset'
  );
  assert.ok(
    activation.indexOf('await resetSidecarForConversation();')
      < activation.indexOf('publishScenarioOpeningInlineSceneSource()'),
    'the scenario-opening source must use the new conversation created by the reset'
  );
  assert.ok(
    activation.indexOf('publishScenarioOpeningInlineSceneSource()')
      < activation.indexOf('persist();', activation.indexOf('publishScenarioOpeningInlineSceneSource()')),
    'the scenario-opening source must be published before the new workspace is persisted'
  );

  const freshConversation = sourceBetween(
    'function freshConversation()',
    'function embeddedLoreFromCard('
  );
  assert.match(
    freshConversation,
    /scenarioStarterMessage\(activeCard, activeScenarioStarterId\)/
  );
  assert.match(freshConversation, /\[\{ role: 'assistant', content: greeting \}\]/);
  assert.doesNotMatch(freshConversation, /role: 'user'/);

  const openingPublication = sourceBetween(
    'function scenarioOpeningIdentity()',
    'async function resetInlineSceneForConversation()'
  );
  assert.match(openingPublication, /scenarioStarterMessage\(activeCard, activeScenarioStarterId\)/);
  assert.match(openingPublication, /inlineSceneSourceForScenarioOpening\(conversationId, messages, identity\)/);
  assert.doesNotMatch(openingPublication, /role:\s*'user'/);
});
