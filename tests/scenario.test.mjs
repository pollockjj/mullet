import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compileCharacterMessages,
  firstCharacterMessage,
  substituteCardMacros
} from '../src/lib/character-card.ts';
import { combineLorebooks, injectLoreContext, normalizeLorebook, scanLorebooks } from '../src/lib/lorebook.ts';
import {
  defaultScenarioPortraitProfile,
  isScenarioCard,
  normalizeScenarioCatalog,
  scenarioStarterMessage,
  scenarioStarterPortraitProfile,
  scenarioStarters,
  scenarioPortraitGenerationReady,
  validateScenarioPackage
} from '../src/lib/scenario.ts';
import {
  PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID
} from '../src/lib/portrait.ts';

const asset = (name) => JSON.parse(readFileSync(new URL(`../static/scenarios/${name}`, import.meta.url), 'utf8'));
const scenarioExpectations = new Map([
  ['blakes-7-post-gan', {
    defaultStarterId: 'jenna',
    starterIds: ['jenna', 'cally', 'servalan'],
    portraitProfileIds: ['jenna-stannis', 'cally', 'servalan']
  }],
  ['summer-cabin-weekend', {
    defaultStarterId: 'jan',
    starterIds: ['jan', 'kristi', 'angela'],
    portraitProfileIds: ['jan-pollock', 'kristi-bentler', 'angela-pollock']
  }]
]);

function bundledScenarios() {
  const catalog = normalizeScenarioCatalog(asset('catalog.json'));
  return {
    catalog,
    scenarios: catalog.scenarios.map((entry) => ({
      entry,
      cardRaw: asset(entry.card),
      lorebookRaw: asset(entry.lorebook)
    }))
  };
}

function bundledScenario() {
  return bundledScenarioById('blakes-7-post-gan');
}

function bundledScenarioById(id) {
  const { catalog, scenarios } = bundledScenarios();
  const selected = scenarios.find(({ entry }) => entry.id === id);
  assert.ok(selected, `missing bundled scenario ${id}`);
  const { entry, cardRaw, lorebookRaw } = selected;
  return {
    catalog,
    entry,
    cardRaw,
    lorebookRaw
  };
}

test('validates the generic bundled-scenario catalog and rejects unsafe or duplicate entries', () => {
  const { catalog, entry } = bundledScenario();
  assert.equal(catalog.spec, 'mullet_scenario_catalog_v2');
  assert.equal(entry.id, 'blakes-7-post-gan');
  assert.match(entry.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(entry.starters.map((starter) => starter.id), ['jenna', 'cally', 'servalan']);
  assert.deepEqual(entry.starters.map((starter) => starter.label), ['Jenna', 'Cally', 'Servalan']);

  const duplicate = asset('catalog.json');
  duplicate.scenarios.push(structuredClone(duplicate.scenarios[0]));
  assert.throws(() => normalizeScenarioCatalog(duplicate), /duplicate scenario id/);

  const unsafe = asset('catalog.json');
  unsafe.scenarios[0].card = '../private.json';
  assert.throws(() => normalizeScenarioCatalog(unsafe), /safe JSON filename/);

  const duplicateStarter = asset('catalog.json');
  duplicateStarter.scenarios[0].starters.push(structuredClone(duplicateStarter.scenarios[0].starters[0]));
  assert.throws(() => normalizeScenarioCatalog(duplicateStarter), /duplicate.*starter|starter.*duplicate/i);
  assert.throws(() => normalizeScenarioCatalog({ spec: 'wrong', scenarios: [] }), /scenario catalog spec/);
});

test('validates every bundled package and selects three distinct starter messages and identities', () => {
  const { catalog, scenarios } = bundledScenarios();
  assert.equal(scenarios.length, catalog.scenarios.length);
  assert.ok(scenarios.length > 0);

  for (const { entry, cardRaw, lorebookRaw } of scenarios) {
    const expectation = scenarioExpectations.get(entry.id);
    assert.ok(expectation, `missing test expectation for ${entry.id}`);
    const packaged = validateScenarioPackage(entry, cardRaw, lorebookRaw);
    const starters = scenarioStarters(packaged.card);
    assert.deepEqual(packaged.starters, starters);
    assert.equal(starters.spec, 'mullet_scenario_starters_v1');
    assert.equal(starters.defaultStarterId, expectation.defaultStarterId);
    assert.equal(starters.starters.length, 3);
    assert.deepEqual(starters.starters.map((starter) => starter.id), expectation.starterIds);
    assert.deepEqual(starters.starters.map((starter) => starter.portraitProfileId), expectation.portraitProfileIds);
    assert.deepEqual(
      starters.starters.map(({ id, label }) => ({ id, label })),
      entry.starters
    );
    assert.equal(new Set(starters.starters.map((starter) => starter.greetingIndex)).size, 3);
    assert.ok(starters.starters.every((starter) => starter.title.trim() && starter.summary.trim()));

    const messages = starters.starters.map((starter) => {
      const message = scenarioStarterMessage(packaged.card, starter.id, 'Test Pilot');
      const sourceMessage = starter.greetingIndex === 0
        ? packaged.card.data.firstMes
        : packaged.card.data.alternateGreetings[starter.greetingIndex - 1];
      assert.equal(
        message,
        substituteCardMacros(
          sourceMessage,
          packaged.card.data.nickname || packaged.card.data.name,
          'Test Pilot'
        )
      );
      return message;
    });
    assert.equal(messages[0], firstCharacterMessage(packaged.card, 'Test Pilot'));
    assert.equal(new Set(messages).size, 3);
    assert.ok(messages.every((message) => message.trim().length > 0));

    const profiles = starters.starters.map((starter) => {
      const profile = scenarioStarterPortraitProfile(packaged.card, starter.id);
      assert.ok(profile);
      assert.equal(profile.id, starter.portraitProfileId);
      assert.deepEqual(
        profile,
        packaged.portraitCast.profiles.find((candidate) => candidate.id === starter.portraitProfileId)
      );
      return profile;
    });
    assert.equal(new Set(profiles.map((profile) => profile.id)).size, 3);
    assert.equal(new Set(profiles.map((profile) => profile.fingerprint)).size, 3);
    assert.equal(new Set(profiles.map((profile) => profile.referenceImage.name)).size, 3);
    assert.equal(new Set(profiles.map((profile) => profile.referenceImage.sha256)).size, 3);

    assert.equal(cardRaw.data.extensions.mullet.scenario_id, entry.id);
    assert.equal(cardRaw.data.extensions.mullet.scenario_version, entry.version);
    assert.equal(lorebookRaw.data.extensions.mullet.scenario_id, entry.id);
    assert.equal(lorebookRaw.data.extensions.mullet.scenario_version, entry.version);
    assert.deepEqual(cardRaw.data.character_book, lorebookRaw.data);
  }
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
  assert.equal(scenarioPortraitGenerationReady(packaged.card, false), false);
  assert.equal(scenarioPortraitGenerationReady(packaged.card, true), true);
  assert.equal(scenarioPortraitGenerationReady(null, false), true);
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
  assert.match(cardRaw.data.character_version, /^\d+\.\d+\.\d+$/);
  assert.equal(cardRaw.data.extensions.mullet.user_definition, 'female_she_her');
  assert.equal(lorebookRaw.data.extensions.mullet.user_definition, 'female_she_her');
  assert.equal(packaged.portraitCast.defaultProfileId, 'jenna-stannis');
  assert.equal(packaged.portraitCast.spec, 'mullet_portrait_cast_v2');
  const portraitProfile = defaultScenarioPortraitProfile(packaged.card);
  assert.equal(portraitProfile.id, 'jenna-stannis');
  assert.equal(portraitProfile.displayName, 'Jenna Stannis');
  assert.match(portraitProfile.subject, /Sally Knyvette portraying Jenna Stannis/);
  assert.match(portraitProfile.attire, /burgundy, maroon, and silver-grey leather/);
  assert.match(portraitProfile.setting, /Liberator flight deck/);
  assert.equal(portraitProfile.seed, 19790213);
  assert.match(portraitProfile.expressionPrompts.fear, /fearful, alert facial expression/);
  assert.match(portraitProfile.expressionPrompts.fear, /No text, watermark, modern zipper, or contemporary clothing\.$/);
  assert.equal(portraitProfile.modelTemplate, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID);
  assert.equal(portraitProfile.referenceImage.name, 'jenna-stannis-v1.jpg');
  assert.equal(portraitProfile.referenceImage.sha256, 'c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8');
  assert.equal(portraitProfile.referenceImage.width, 400);
  assert.equal(portraitProfile.referenceImage.height, 600);
  assert.equal(portraitProfile.referenceImage.aspectRatio, '2:3');
  assert.match(portraitProfile.fingerprint, /^[0-9a-f]{8}$/);
  const protagonist = lorebookRaw.data.entries.find((loreEntry) => loreEntry.id === 1);
  assert.match(protagonist.content, /protagonist is a woman and uses she\/her pronouns/);
  assert.equal(protagonist.extensions.mullet.user_definition, 'female_she_her');
  assert.doesNotMatch(protagonist.content, /no predefined[^.]*gender/);

  const ids = lorebookRaw.data.entries.map((loreEntry) => String(loreEntry.id));
  assert.equal(new Set(ids).size, ids.length);
  lorebookRaw.data.entries.forEach((loreEntry) => {
    for (const field of ['keys', 'content', 'extensions', 'enabled', 'insertion_order', 'use_regex', 'constant', 'selective', 'secondary_keys']) {
      assert.ok(Object.hasOwn(loreEntry, field), `${loreEntry.id}.${field}`);
    }
  });
});

test('ships the private cabin lore with three byte-exact Qwen identity references', () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenarioById('summer-cabin-weekend');
  const packaged = validateScenarioPackage(entry, cardRaw, lorebookRaw);

  assert.equal(packaged.card.spec, 'chara_card_v3');
  assert.equal(packaged.card.specVersion, '3.0');
  assert.equal(lorebookRaw.spec, 'lorebook_v3');
  assert.deepEqual(cardRaw.data.character_book, lorebookRaw.data);
  assert.equal(packaged.lorebook.entries.length, 7);
  assert.deepEqual(packaged.lorebook.diagnostics, []);
  assert.equal(lorebookRaw.data.extensions.mullet.source_format, 'sillytavern_world_info');
  assert.equal(
    lorebookRaw.data.extensions.mullet.source_sha256,
    'b63f72e576bbd954292d99c35b180674728dd358584ef79f05d981909970ec81'
  );
  assert.equal(packaged.starters.defaultStarterId, 'jan');
  assert.deepEqual(
    packaged.starters.starters.map(({ id, portraitProfileId }) => ({ id, portraitProfileId })),
    [
      { id: 'jan', portraitProfileId: 'jan-pollock' },
      { id: 'kristi', portraitProfileId: 'kristi-bentler' },
      { id: 'angela', portraitProfileId: 'angela-pollock' }
    ]
  );

  const references = new Map([
    ['jan-pollock', {
      name: 'cabin-jan-v1.png',
      sha256: '5fb84b3a0a3a2cff07488e3799d89e5a3539e90bd01932c7bb44e58fad4a832f',
      width: 1024,
      height: 1024
    }],
    ['kristi-bentler', {
      name: 'cabin-kristi-v1.png',
      sha256: 'faea3ae4289d2443a9bd22b8d3c329972470d97b9488c2c7f549431a0159f4ea',
      width: 2048,
      height: 2048
    }],
    ['angela-pollock', {
      name: 'cabin-angela-v1.png',
      sha256: '73615e29527ff93f93f4371e614decbc66dfb07d35b1f420cfe5f4d4ef40fcf3',
      width: 1024,
      height: 1024
    }]
  ]);
  for (const profile of packaged.portraitCast.profiles) {
    const expected = references.get(profile.id);
    assert.ok(expected, `unexpected cabin portrait profile ${profile.id}`);
    assert.equal(profile.modelTemplate, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID);
    assert.deepEqual(profile.referenceImage, {
      name: expected.name,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: expected.sha256,
      width: expected.width,
      height: expected.height,
      aspectRatio: '1:1'
    });

    const bytes = readFileSync(
      new URL(`../static/scenarios/summer-cabin-weekend.references/${expected.name}`, import.meta.url)
    );
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(bytes.readUInt32BE(16), expected.width);
    assert.equal(bytes.readUInt32BE(20), expected.height);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  }

  const serialized = JSON.stringify({ cardRaw, lorebookRaw });
  assert.doesNotMatch(serialized, /clearly sexually active/i);
  const kristi = lorebookRaw.data.entries.find(({ id }) => id === 2);
  assert.match(kristi.content, /adopted 13-year-old daughter, Celia/);
  assert.doesNotMatch(kristi.content, /sexual/i);
  const minerva = lorebookRaw.data.entries.find(({ id }) => id === 4);
  assert.equal(minerva.enabled, false);
  assert.equal(packaged.lorebook.entries.find(({ id }) => id === '4').enabled, false);
  const angela = lorebookRaw.data.entries.find(({ id }) => id === 6);
  assert.match(angela.content, /adult niece and works for the VA/);
  assert.match(angela.content, /no other biographical or personality facts/);
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

  const duplicateAliasLore = structuredClone(lorebookRaw);
  duplicateAliasLore.data.extensions.mullet.portrait_cast_v2.profiles.push({
    ...structuredClone(duplicateAliasLore.data.extensions.mullet.portrait_cast_v2.profiles[0]),
    id: 'duplicate-jenna'
  });
  const duplicateAliasCard = structuredClone(cardRaw);
  duplicateAliasCard.data.character_book = structuredClone(duplicateAliasLore.data);
  assert.throws(() => validateScenarioPackage(entry, duplicateAliasCard, duplicateAliasLore), /duplicate scenario portrait alias/);

  const missingProfileLore = structuredClone(lorebookRaw);
  missingProfileLore.data.extensions.mullet.portrait_cast_v2.default_profile_id = 'unknown-character';
  const missingProfileCard = structuredClone(cardRaw);
  missingProfileCard.data.character_book = structuredClone(missingProfileLore.data);
  assert.throws(() => validateScenarioPackage(entry, missingProfileCard, missingProfileLore), /default profile does not exist/);

  const wrongGeometryLore = structuredClone(lorebookRaw);
  wrongGeometryLore.data.extensions.mullet.portrait_cast_v2.profiles[0].visual_profile.reference_image.aspect_ratio = '9:16';
  const wrongGeometryCard = structuredClone(cardRaw);
  wrongGeometryCard.data.character_book = structuredClone(wrongGeometryLore.data);
  assert.throws(
    () => validateScenarioPackage(entry, wrongGeometryCard, wrongGeometryLore),
    /aspect_ratio must be the exact GCD-reduced dimensions 2:3/
  );
});

test('accepts the canonical identity reference only with the Qwen reference editor', () => {
  const { entry, cardRaw, lorebookRaw } = bundledScenario();
  const packaged = validateScenarioPackage(entry, cardRaw, lorebookRaw);
  assert.equal(packaged.portraitCast.profiles[0].modelTemplate, PORTRAIT_QWEN_REFERENCE_TEMPLATE_ID);
  assert.deepEqual(packaged.portraitCast.profiles[0].referenceImage, {
    name: 'jenna-stannis-v1.jpg',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: 'c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8',
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  });

  const retiredLore = structuredClone(lorebookRaw);
  retiredLore.data.extensions.mullet.portrait_cast_v2.profiles[0].visual_profile.model_template = 'retired-reference-editor-v1';
  const retiredCard = structuredClone(cardRaw);
  retiredCard.data.character_book = structuredClone(retiredLore.data);
  assert.throws(
    () => validateScenarioPackage(entry, retiredCard, retiredLore),
    /must use the reference-conditioned portrait template/
  );
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
  assert.ok(names.includes('Female player-character sovereignty'));
  assert.ok(names.includes('Immediate dramatic state'));
  assert.ok(names.includes('Roj Blake'));
  assert.ok(names.includes('Kerr Avon'));
  assert.ok(names.includes('The Liberator and Zen'));

  const compiled = compileCharacterMessages(card, injectLoreContext(history, lore), 'You', lore);
  assert.match(compiled[0].content, /timeline begins immediately after the failed assault/i);
  assert.match(compiled[0].content, /player-controlled protagonist is a woman and uses she\/her pronouns/i);
  assert.match(compiled[0].content, /She has no predefined name/i);
  assert.deepEqual(compiled.find((message) => message.role === 'user'), history[0]);
  assert.doesNotMatch(JSON.stringify(compiled), /\bOOC\b|sidecar/i);
});
