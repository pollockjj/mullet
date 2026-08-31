import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
const scenarioCatalog = JSON.parse(
  readFileSync(new URL('../static/scenarios/catalog.json', import.meta.url), 'utf8')
);

function sourceBetween(start, end) {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return pageSource.slice(startIndex, endIndex);
}

test('lists every bundled package in a compact selector and its starters as explicit buttons', () => {
  const picker = pageSource.match(
    /<section class="scenario-picker" aria-label="Bundled scenarios">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.equal(scenarioCatalog.spec, 'mullet_scenario_catalog_v2');
  assert.ok(scenarioCatalog.scenarios.length > 1);
  assert.equal(
    new Set(scenarioCatalog.scenarios.map(({ id }) => id)).size,
    scenarioCatalog.scenarios.length
  );
  assert.ok(scenarioCatalog.scenarios.every(({ id, title }) => id.trim() && title.trim()));
  assert.match(picker, /<select[\s\S]*?bind:value=\{selectedScenarioId\}/);
  assert.match(picker, /\{#each scenarioCatalog\.scenarios as scenario\}/);
  assert.match(picker, /<option value=\{scenario\.id\}>\{scenario\.title\}<\/option>/);
  assert.match(picker, /\{#each selectedScenario\.starters as starter\}/);
  assert.match(picker, /class="scenario-starter/);
  assert.match(picker, /\{starter\.label\}/);
  assert.match(picker, /startSelectedScenario\(starter\.id\)/);
  assert.match(pageSource, /\.scenario-starters\s*\{[^}]*display:\s*grid;/);
  assert.match(pageSource, /\.scenario-starter(?:\s|\{|\.)/);
});

test('restores and persists a valid selected scenario id', () => {
  const catalogLoad = sourceBetween(
    'async function loadScenarioCatalog()',
    'function persistSelectedScenarioSelection()'
  );
  assert.match(catalogLoad, /const savedScenarioId = localStorage\.getItem\(selectedScenarioStorageKey\) \?\? '';/);
  assert.match(
    catalogLoad,
    /selectedScenarioId = scenarioCatalog\.scenarios\.some\(\(scenario\) => scenario\.id === savedScenarioId\)[\s\S]*?\? savedScenarioId/
  );

  const persistence = sourceBetween(
    'function persistSelectedScenarioSelection()',
    'async function loadScenarioPackage('
  );
  assert.match(
    persistence,
    /if \(!scenarioCatalog\?\.scenarios\.some\(\(scenario\) => scenario\.id === selectedScenarioId\)\) return;/
  );
  assert.match(
    persistence,
    /localStorage\.setItem\(selectedScenarioStorageKey, selectedScenarioId\);/
  );

  const picker = pageSource.match(
    /<section class="scenario-picker" aria-label="Bundled scenarios">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.match(picker, /on:change=\{persistSelectedScenarioSelection\}/);
  assert.match(
    pageSource,
    /\$: selectedScenario = scenarioCatalog\?\.scenarios\.find\(\(scenario\) => scenario\.id === selectedScenarioId\) \?\? null;/
  );
});

test('scopes active starter styling to the active package', () => {
  const picker = pageSource.match(
    /<section class="scenario-picker" aria-label="Bundled scenarios">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  const scopedActiveCondition = /starter\.id === activeScenarioStarterId\s*&&\s*cardSourceIdentifier === characterSourceIdentifier\(selectedScenario\.card\)/;
  assert.match(picker, new RegExp(`class:active=\\{${scopedActiveCondition.source}\\}`));
  assert.match(picker, new RegExp(`aria-pressed=\\{${scopedActiveCondition.source}\\}`));
  assert.doesNotMatch(picker, /class:active=\{starter\.id === activeScenarioStarterId\}/);
});

test('makes the Summer Weekend package reachable with Jan, Kristi, and Angela openings', () => {
  const summerWeekend = scenarioCatalog.scenarios.find(({ id }) => id === 'summer-cabin-weekend');
  assert.ok(summerWeekend);
  assert.equal(summerWeekend.title, 'Summer Weekend at the Cabin');
  assert.deepEqual(
    summerWeekend.starters.map(({ id, label }) => ({ id, label })),
    [
      { id: 'jan', label: 'Jan' },
      { id: 'kristi', label: 'Kristi' },
      { id: 'angela', label: 'Angela' }
    ]
  );

  const picker = pageSource.match(
    /<section class="scenario-picker" aria-label="Bundled scenarios">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.match(picker, /bind:value=\{selectedScenarioId\}/);
  assert.match(picker, /\{#each scenarioCatalog\.scenarios as scenario\}/);
  assert.match(picker, /\{#each selectedScenario\.starters as starter\}/);
  assert.match(picker, /on:click=\{\(\) => void startSelectedScenario\(starter\.id\)\}/);
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
