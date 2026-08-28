import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { compileCharacterMessages } from '../src/lib/character-card.ts';
import { combineLorebooks, injectLoreContext, normalizeLorebook, scanLorebooks } from '../src/lib/lorebook.ts';
import {
  isScenarioCard,
  normalizeScenarioCatalog,
  validateScenarioPackage
} from '../src/lib/scenario.ts';

const asset = (name) => JSON.parse(readFileSync(new URL(`../static/scenarios/${name}`, import.meta.url), 'utf8'));

function bundledScenario() {
  const catalog = normalizeScenarioCatalog(asset('catalog.json'));
  const entry = catalog.scenarios[0];
  return {
    catalog,
    entry,
    cardRaw: asset(entry.card),
    lorebookRaw: asset(entry.lorebook)
  };
}

test('validates the generic bundled-scenario catalog and rejects unsafe or duplicate entries', () => {
  const { catalog, entry } = bundledScenario();
  assert.equal(catalog.spec, 'mullet_scenario_catalog_v1');
  assert.equal(entry.id, 'blakes-7-post-gan');
  assert.equal(entry.version, '1.0.0');

  const duplicate = asset('catalog.json');
  duplicate.scenarios.push(structuredClone(duplicate.scenarios[0]));
  assert.throws(() => normalizeScenarioCatalog(duplicate), /duplicate scenario id/);

  const unsafe = asset('catalog.json');
  unsafe.scenarios[0].card = '../private.json';
  assert.throws(() => normalizeScenarioCatalog(unsafe), /safe JSON filename/);
  assert.throws(() => normalizeScenarioCatalog({ spec: 'wrong', scenarios: [] }), /scenario catalog spec/);
});

test('ships a canonical CCv3 scenario with an identical standalone Lorebook V3', () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenario();
  const packaged = validateScenarioPackage(entry, cardRaw, lorebookRaw);

  assert.equal(packaged.card.spec, 'chara_card_v3');
  assert.equal(packaged.card.specVersion, '3.0');
  assert.equal(lorebookRaw.spec, 'lorebook_v3');
  assert.deepEqual(Object.keys(lorebookRaw).sort(), ['data', 'spec']);
  assert.deepEqual(cardRaw.data.character_book, lorebookRaw.data);
  assert.equal(packaged.lorebook.entries.length, 18);
  assert.deepEqual(packaged.lorebook.diagnostics, []);
  assert.equal(isScenarioCard(packaged.card), true);
  assert.equal(JSON.stringify(cardRaw).includes('{{user}}'), false);
  assert.equal(JSON.stringify(lorebookRaw).includes('{{user}}'), false);

  const requiredStrings = [
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'creator', 'character_version'
  ];
  requiredStrings.forEach((field) => assert.equal(typeof cardRaw.data[field], 'string', field));
  ['alternate_greetings', 'group_only_greetings', 'tags'].forEach((field) => {
    assert.ok(Array.isArray(cardRaw.data[field]), field);
    assert.ok(cardRaw.data[field].every((value) => typeof value === 'string'), field);
  });
  assert.equal(typeof cardRaw.data.extensions, 'object');

  const ids = lorebookRaw.data.entries.map((loreEntry) => String(loreEntry.id));
  assert.equal(new Set(ids).size, ids.length);
  lorebookRaw.data.entries.forEach((loreEntry) => {
    for (const field of ['keys', 'content', 'extensions', 'enabled', 'insertion_order', 'use_regex', 'constant', 'selective', 'secondary_keys']) {
      assert.ok(Object.hasOwn(loreEntry, field), `${loreEntry.id}.${field}`);
    }
  });
});

test('rejects mismatched or malformed scenario packages before activation', () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenario();
  const wrongIdentity = structuredClone(cardRaw);
  wrongIdentity.data.extensions.mullet.scenario_id = 'different-scenario';
  assert.throws(() => validateScenarioPackage(entry, wrongIdentity, lorebookRaw), /identity does not match/);

  const divergentLore = structuredClone(lorebookRaw);
  divergentLore.data.entries[0].content = 'DIVERGENT';
  assert.throws(() => validateScenarioPackage(entry, cardRaw, divergentLore), /must be identical/);

  const duplicateLore = structuredClone(lorebookRaw);
  duplicateLore.data.entries[1].id = duplicateLore.data.entries[0].id;
  duplicateLore.data.entries[1].content = cardRaw.data.character_book.entries[1].content;
  const duplicateCard = structuredClone(cardRaw);
  duplicateCard.data.character_book = structuredClone(duplicateLore.data);
  assert.throws(() => validateScenarioPackage(entry, duplicateCard, duplicateLore), /entry ids must be unique/);
});

test('keeps validated embedded scenario lore authoritative over same-name imported state', () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenario();
  const { card } = validateScenarioPackage(entry, cardRaw, lorebookRaw);
  const embedded = normalizeLorebook(card.data.characterBook, entry.title, 'embedded');
  const staleRaw = structuredClone(lorebookRaw);
  staleRaw.data.entries[0].content = 'STALE IMPORT WITHOUT THE TIMELINE GATE';
  const staleImported = normalizeLorebook(staleRaw, entry.title, 'imported');

  assert.equal(combineLorebooks(embedded, [staleImported], false)[0].origin, 'imported');
  const scenarioStack = combineLorebooks(embedded, [staleImported], true);
  assert.equal(scenarioStack.length, 1);
  assert.equal(scenarioStack[0].origin, 'embedded');
  assert.match(scenarioStack[0].entries[0].content, /present is locked to the minutes after/i);
});

test('activates the scenario timeline and named cast without polluting canonical history', async () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenario();
  const { card } = validateScenarioPackage(entry, cardRaw, lorebookRaw);
  const embedded = normalizeLorebook(card.data.characterBook, `${card.data.name} lore`, 'embedded');
  const history = [{ role: 'user', content: 'Avon challenges Blake while the Liberator holds position.' }];
  const lore = await scanLorebooks([embedded], history, { recursive: true }, { card, userName: 'You' });
  const names = lore.activated.map((activation) => activation.name);
  assert.ok(names.includes('Timeline gate'));
  assert.ok(names.includes('Player-character sovereignty'));
  assert.ok(names.includes('Immediate dramatic state'));
  assert.ok(names.includes('Roj Blake'));
  assert.ok(names.includes('Kerr Avon'));
  assert.ok(names.includes('The Liberator and Zen'));

  const compiled = compileCharacterMessages(card, injectLoreContext(history, lore), 'You', lore);
  assert.match(compiled[0].content, /timeline begins immediately after the failed assault/i);
  assert.match(compiled[0].content, /player-controlled protagonist has no predefined name/i);
  assert.deepEqual(compiled.find((message) => message.role === 'user'), history[0]);
  assert.doesNotMatch(JSON.stringify(compiled), /\bOOC\b|sidecar/i);
});
