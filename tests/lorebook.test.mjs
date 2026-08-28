import assert from 'node:assert/strict';
import test from 'node:test';

import { compileCharacterMessages, normalizeCharacterCard } from '../src/lib/character-card.ts';
import {
  DEFAULT_LOREBOOK_SETTINGS,
  compileUnboundLoreMessages,
  injectLoreContext,
  injectLoreDepth,
  lorePromptContextTokens,
  normalizeLoreTimedState,
  normalizeLorebook,
  reconcileLorebookRecursionControls,
  resolveLorebookSettings,
  scanLorebooks
} from '../src/lib/lorebook.ts';
import { extractPngLorebook } from '../src/lib/png-lorebook.ts';
import { countModelTokens, getModelContextTokens } from '../src/lib/server/model-tokenizer.ts';
import { RegexSandbox } from '../src/lib/server/regex-sandbox.ts';

const directRegexTest = async (source, flags, haystack) => {
  try {
    return { matched: new RegExp(source, flags).test(haystack) };
  } catch {
    return { matched: false, invalid: true };
  }
};

function nativeEntry(overrides = {}) {
  return {
    uid: 0,
    key: ['trigger'],
    keysecondary: [],
    comment: 'Test entry',
    content: 'LORE CONTENT',
    constant: false,
    selective: true,
    selectiveLogic: 0,
    order: 100,
    position: 0,
    disable: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    ignoreBudget: false,
    ...overrides
  };
}

function nativeBook(entries, name = 'Native book', origin = 'imported') {
  return normalizeLorebook({
    name,
    entries: Object.fromEntries(entries.map((entry, index) => [String(index), { ...entry, uid: entry.uid ?? index }])),
    unknown_book_field: { preserved: true }
  }, name, origin);
}

function history(...contents) {
  return contents.map((content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }));
}

test('matches the operator SillyTavern lore settings and UI ranges', async () => {
  assert.deepEqual(DEFAULT_LOREBOOK_SETTINGS, {
    scanDepth: 228,
    minActivations: 0,
    minActivationsDepthMax: 0,
    budgetPercent: 25,
    includeNames: true,
    recursive: true,
    caseSensitive: false,
    matchWholeWords: true,
    maxContextTokens: 262_144,
    budgetCap: 0,
    maxRecursionSteps: 0,
    useGroupScoring: false,
    characterStrategy: 1
  });
  assert.equal((await scanLorebooks([], [], DEFAULT_LOREBOOK_SETTINGS)).budgetTokens, 65_536);
  const defaultPromptContext = lorePromptContextTokens(262_144, 8_096);
  assert.equal(defaultPromptContext, 254_048);
  assert.equal((await scanLorebooks([], [], resolveLorebookSettings({}, defaultPromptContext))).budgetTokens, 63_512);
  const maximumReplyPromptContext = lorePromptContextTokens(262_144, 128_000);
  assert.equal(maximumReplyPromptContext, 134_144);
  assert.equal((await scanLorebooks([], [], resolveLorebookSettings({}, maximumReplyPromptContext))).budgetTokens, 33_536);
  assert.equal(resolveLorebookSettings({ scanDepth: 0 }).scanDepth, 0);
  assert.equal(resolveLorebookSettings({ scanDepth: 1000 }).scanDepth, 1000);
  assert.equal(resolveLorebookSettings({ minActivations: 100 }).minActivations, 100);
  assert.equal(resolveLorebookSettings({ minActivationsDepthMax: 100 }).minActivationsDepthMax, 100);
  assert.equal(resolveLorebookSettings({ budgetPercent: 1 }).budgetPercent, 1);
  assert.equal(resolveLorebookSettings({ budgetPercent: 100 }).budgetPercent, 100);
  assert.equal(resolveLorebookSettings({}).characterStrategy, 1);
  assert.equal(resolveLorebookSettings({ characterStrategy: 0 }).characterStrategy, 0);
  assert.equal(resolveLorebookSettings({ characterStrategy: 2 }).characterStrategy, 2);
  assert.equal(resolveLorebookSettings({ maxContextTokens: 999 }).maxContextTokens, 262_144);
  assert.throws(() => resolveLorebookSettings({ scanDepth: 1001 }), /between 0 and 1000/);
  assert.throws(() => resolveLorebookSettings({ minActivations: 101 }), /between 0 and 100/);
  assert.throws(() => resolveLorebookSettings({ minActivationsDepthMax: -1 }), /between 0 and 100/);
  assert.throws(() => resolveLorebookSettings({ budgetPercent: 0 }), /between 1 and 100/);
  assert.throws(() => resolveLorebookSettings({ characterStrategy: -1 }), /between 0 and 2/);
  assert.throws(() => resolveLorebookSettings({ characterStrategy: 3 }), /between 0 and 2/);
  assert.throws(
    () => resolveLorebookSettings({ minActivations: 2, maxRecursionSteps: 1 }),
    /mutually exclusive/
  );
  const maxWins = reconcileLorebookRecursionControls(
    { ...DEFAULT_LOREBOOK_SETTINGS, minActivations: 2, maxRecursionSteps: 1 },
    'maxRecursionSteps'
  );
  assert.equal(maxWins.minActivations, 0);
  assert.equal(maxWins.maxRecursionSteps, 1);
  const minimumWins = reconcileLorebookRecursionControls(
    { ...DEFAULT_LOREBOOK_SETTINGS, minActivations: 2, maxRecursionSteps: 1 },
    'minActivations'
  );
  assert.equal(minimumWins.minActivations, 2);
  assert.equal(minimumWins.maxRecursionSteps, 0);
});

test('keeps minimum-depth expansion and maximum recursion caps as distinct modes', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Older key', key: ['older'], content: 'OLDER' }),
    nativeEntry({ uid: 1, comment: 'Recursion seed', key: ['recent'], content: 'recursive-key' }),
    nativeEntry({ uid: 2, comment: 'Recursive result', key: ['recursive-key'], content: 'RECURSIVE' })
  ]);
  const minimumMode = await scanLorebooks([book], history('older', 'recent'), {
    scanDepth: 1,
    minActivations: 2,
    maxRecursionSteps: 0,
    recursive: false
  });
  assert.deepEqual(minimumMode.activated.map((entry) => entry.name), ['Recursion seed', 'Older key']);

  const cappedMode = await scanLorebooks([book], history('recent'), {
    minActivations: 0,
    maxRecursionSteps: 1,
    recursive: true
  });
  assert.deepEqual(cappedMode.activated.map((entry) => entry.name), ['Recursion seed']);
});

test('matches SillyTavern embedded-character and imported-global insertion strategies', async () => {
  const embedded = nativeBook([
    nativeEntry({ uid: 0, comment: 'Character lore', constant: true, group: 'source-choice', order: 10, content: 'CHARACTER' })
  ], 'Character book', 'embedded');
  const imported = nativeBook([
    nativeEntry({ uid: 0, comment: 'Global lore', constant: true, group: 'source-choice', order: 100, content: 'GLOBAL' })
  ], 'Global book', 'imported');
  const options = { random: () => 0 };

  const characterFirst = await scanLorebooks([embedded, imported], [], { recursive: false, characterStrategy: 1 }, options);
  assert.deepEqual(characterFirst.activated.map((entry) => entry.name), ['Character lore']);

  const globalFirst = await scanLorebooks([embedded, imported], [], { recursive: false, characterStrategy: 2 }, options);
  assert.deepEqual(globalFirst.activated.map((entry) => entry.name), ['Global lore']);

  const evenly = await scanLorebooks([embedded, imported], [], { recursive: false, characterStrategy: 0 }, options);
  assert.deepEqual(evenly.activated.map((entry) => entry.name), ['Global lore']);
});

test('normalizes native ST, canonical Character Book, and lorebook_v3 without losing raw fields', () => {
  const nativeRaw = { entries: { 7: nativeEntry({ uid: 7 }) }, extension_namespace: { keep: true } };
  const native = normalizeLorebook(nativeRaw, 'ST export');
  assert.equal(native.format, 'sillytavern');
  assert.equal(native.entries[0].id, '7');
  assert.deepEqual(native.raw, nativeRaw);

  const characterBookRaw = {
    name: 'Embedded',
    extensions: { keep: true },
    entries: [{
      id: 'canon',
      keys: ['Liberator'],
      secondary_keys: [],
      content: 'Canonical lore',
      enabled: true,
      constant: false,
      selective: false,
      insertion_order: 42,
      position: 'after_char',
      extensions: { custom: 'preserved' }
    }]
  };
  const embedded = normalizeLorebook(characterBookRaw, 'fallback', 'embedded');
  assert.equal(embedded.format, 'character_book');
  assert.equal(embedded.origin, 'embedded');
  assert.equal(embedded.entries[0].position, 1);
  assert.deepEqual(embedded.raw, characterBookRaw);

  const v3 = normalizeLorebook({ spec: 'lorebook_v3', spec_version: '3.0', data: characterBookRaw });
  assert.equal(v3.format, 'lorebook_v3');
  assert.equal(v3.name, 'Embedded');
});

test('skips malformed individual entries while retaining the usable book', () => {
  const book = normalizeLorebook({ entries: [{ nope: true }, nativeEntry({ uid: 1 })] });
  assert.equal(book.entries.length, 1);
  assert.deepEqual(book.diagnostics, ['Skipped malformed entry 0']);
});

test('honors scan depth, constants, disabled entries, whole words, and case overrides', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Too old', key: ['oldest-only'] }),
    nativeEntry({ uid: 1, comment: 'Recent', key: ['recent'] }),
    nativeEntry({ uid: 2, comment: 'Constant', key: [], constant: true }),
    nativeEntry({ uid: 3, comment: 'Disabled', constant: true, disable: true }),
    nativeEntry({ uid: 4, comment: 'Partial word', key: ['lib'] }),
    nativeEntry({ uid: 5, comment: 'Whole word', key: ['Liberator'] }),
    nativeEntry({ uid: 6, comment: 'Case override', key: ['LIBERATOR'], caseSensitive: true })
  ]);
  const result = await scanLorebooks(book ? [book] : [], history('oldest-only', 'the Liberator', 'recent'), { scanDepth: 2 });
  const names = result.activated.map((entry) => entry.name);

  assert.deepEqual(names, ['Recent', 'Constant', 'Whole word']);
});

test('implements all four SillyTavern selective-key logic modes', async () => {
  const book = nativeBook([0, 1, 2, 3].map((logic) => nativeEntry({
    uid: logic,
    comment: ['AND_ANY', 'NOT_ALL', 'NOT_ANY', 'AND_ALL'][logic],
    key: ['trigger'],
    keysecondary: ['one', 'two'],
    selectiveLogic: logic
  })));
  const partial = await scanLorebooks([book], history('trigger one'), { recursive: false });
  assert.deepEqual(partial.activated.map((entry) => entry.name), ['AND_ANY', 'NOT_ALL']);

  const complete = await scanLorebooks([book], history('trigger one two'), { recursive: false });
  assert.deepEqual(complete.activated.map((entry) => entry.name), ['AND_ANY', 'AND_ALL']);
});

test('treats only slash-notation keys as regex even when Character Book use_regex is true', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Slash', key: ['/liber[a-z]+/i'] }),
    nativeEntry({ uid: 1, comment: 'Literal dot', key: ['.'], use_regex: true }),
    nativeEntry({ uid: 2, comment: 'Literal C++', key: ['C++'], use_regex: true }),
    nativeEntry({ uid: 3, comment: 'Macro', key: ['{{char}}'], content: '{{char}} knows {{user}}.' }),
    nativeEntry({ uid: 4, comment: 'Escaped slash', key: ['/a\\/b/i'] }),
    nativeEntry({ uid: 5, comment: 'All flags', key: ['/.*alpha/gimsuy'] }),
    nativeEntry({ uid: 6, comment: 'Invalid slash is plaintext', key: ['/[/'] })
  ]);
  const result = await scanLorebooks([book], history('Avon found Liberator, C++, a/b, alpha, and /[/'), {}, {
    assistantName: 'Avon',
    userName: 'John',
    regexTest: directRegexTest
  });

  assert.deepEqual(result.activated.map((entry) => entry.name), [
    'Slash',
    'Literal C++',
    'Macro',
    'Escaped slash',
    'All flags',
    'Invalid slash is plaintext'
  ]);
  assert.match(result.beforeCharacter.join('\n'), /Avon knows John\./);
});

test('recursively activates entries from newly injected lore and honors recursion exclusion', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Seed', key: ['seed'], content: 'cascade-key' }),
    nativeEntry({ uid: 1, comment: 'Recursive', key: ['cascade-key'], content: 'recursion worked' }),
    nativeEntry({ uid: 2, comment: 'Excluded', key: ['cascade-key'], content: 'must not fire', excludeRecursion: true })
  ]);
  assert.deepEqual(
    (await scanLorebooks([book], history('seed'), { recursive: true })).activated.map((entry) => entry.name),
    ['Seed', 'Recursive']
  );
  assert.deepEqual(
    (await scanLorebooks([book], history('seed'), { recursive: false })).activated.map((entry) => entry.name),
    ['Seed']
  );
});

test('enforces the percentage budget and supports ignoreBudget', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Fits', constant: true, content: '1234' }),
    nativeEntry({ uid: 1, comment: 'Rejected', constant: true, content: '1234567890123456' }),
    nativeEntry({ uid: 2, comment: 'Bypass', constant: true, content: '1234567890123456', ignoreBudget: true }),
    nativeEntry({ uid: 3, comment: 'Must not resume', constant: true, content: 'x' })
  ]);
  const result = await scanLorebooks([book], [], { maxContextTokens: 20, budgetPercent: 25, recursive: false });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Fits', 'Bypass']);
  assert.equal(result.budgetTokens, 5);
  assert.equal(result.skipped.length, 1);
});

test('compiles lore in main-before-description-after-examples-history-PHI order and depth injects', async () => {
  const card = normalizeCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Avon',
      description: 'DESCRIPTION',
      personality: 'PERSONALITY',
      scenario: 'SCENARIO',
      first_mes: '',
      mes_example: '<START>\nYou: EXAMPLE\nAvon: Reply',
      creator_notes: '',
      system_prompt: 'MAIN',
      post_history_instructions: 'PHI',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: {}
    }
  });
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Before', constant: true, content: 'BEFORE', position: 0 }),
    nativeEntry({ uid: 1, comment: 'After', constant: true, content: 'AFTER', position: 1 }),
    nativeEntry({ uid: 2, comment: 'Depth', constant: true, content: 'DEPTH', position: 4, depth: 0 })
  ]);
  const originalHistory = [{ role: 'user', content: 'HISTORY' }];
  const lore = await scanLorebooks([book], originalHistory, { recursive: false }, { card });
  const withDepth = injectLoreDepth(originalHistory, lore.depth);
  const compiled = compileCharacterMessages(card, withDepth, 'You', lore);
  const prompt = compiled.map((message) => message.content).join('\n');

  const markers = ['MAIN', 'BEFORE', 'DESCRIPTION', 'PERSONALITY', 'SCENARIO', 'AFTER', 'EXAMPLE', 'HISTORY', 'DEPTH', 'PHI'];
  const positions = markers.map((marker) => prompt.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  const unbound = compileUnboundLoreMessages(originalHistory, lore);
  assert.match(unbound[0].content, /BEFORE/);
  assert.match(unbound[1].content, /AFTER/);
  assert.equal(unbound.at(-1).content, 'DEPTH');
});

test('persists probability failures across recursive scans', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Seed', key: ['seed'], content: 'cascade' }),
    nativeEntry({ uid: 1, comment: 'Failed once', key: ['cascade'], content: 'must not fire', probability: 50 }),
    nativeEntry({ uid: 2, comment: 'Carrier', key: ['cascade'], content: 'next-round' })
  ]);
  const rolls = [0.9, 0.1];
  const result = await scanLorebooks([book], history('seed'), { recursive: true }, { random: () => rolls.shift() ?? 0.1 });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Seed', 'Carrier']);
  assert.deepEqual(rolls, [0.1]);
});

test('uses SillyTavern recursion delay levels rather than loop counts', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Seed', key: ['seed'], content: 'cascade' }),
    nativeEntry({ uid: 1, comment: 'Level five', key: ['cascade'], content: 'delayed fired', delayUntilRecursion: 5 })
  ]);
  const result = await scanLorebooks([book], history('seed'), { recursive: true });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Seed', 'Level five']);
});

test('selects one inclusion-group winner before probability and budget checks', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Winner', constant: true, group: 'alternate', groupWeight: 100 }),
    nativeEntry({ uid: 1, comment: 'Loser', constant: true, group: 'alternate', groupWeight: 100 })
  ]);
  const result = await scanLorebooks([book], [], { recursive: false }, { random: () => 0 });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Winner']);
});

test('uses key-match scores when an inclusion group enables scoring', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Two matches', key: ['alpha', 'beta'], group: 'scored', useGroupScoring: true }),
    nativeEntry({ uid: 1, comment: 'One match', key: ['alpha', 'missing'], group: 'scored', useGroupScoring: true })
  ]);
  const result = await scanLorebooks([book], history('alpha beta'), { recursive: false }, { random: () => 0.99 });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Two matches']);
});

test('routes all SillyTavern lore positions including named outlets', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'AN top', constant: true, position: 2, content: 'AN_TOP' }),
    nativeEntry({ uid: 1, comment: 'AN bottom', constant: true, position: 3, content: 'AN_BOTTOM' }),
    nativeEntry({ uid: 2, comment: 'EM top', constant: true, position: 5, content: 'EM_TOP' }),
    nativeEntry({ uid: 3, comment: 'EM bottom', constant: true, position: 6, content: 'EM_BOTTOM' }),
    nativeEntry({ uid: 4, comment: 'Outlet', constant: true, position: 7, outletName: 'facts', content: 'OUTLET' })
  ]);
  const result = await scanLorebooks([book], [], { recursive: false });
  assert.deepEqual(result.authorNoteBefore, ['AN_TOP']);
  assert.deepEqual(result.authorNoteAfter, ['AN_BOTTOM']);
  assert.deepEqual(result.examplesBefore, ['EM_TOP']);
  assert.deepEqual(result.examplesAfter, ['EM_BOTTOM']);
  assert.deepEqual(result.outlets, { facts: ['OUTLET'] });
});

test('groups same-depth same-role entries and wraps author-note lore around the note prompt', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'High', constant: true, position: 4, depth: 2, role: 0, order: 100, content: 'HIGH' }),
    nativeEntry({ uid: 1, comment: 'Low', constant: true, position: 4, depth: 2, role: 0, order: 90, content: 'LOW' }),
    nativeEntry({ uid: 2, comment: 'AN top', constant: true, position: 2, content: 'TOP' }),
    nativeEntry({ uid: 3, comment: 'AN bottom', constant: true, position: 3, content: 'BOTTOM' })
  ]);
  const result = await scanLorebooks([book], [], { recursive: false });
  assert.deepEqual(result.depth, [{ depth: 2, role: 0, content: 'LOW\nHIGH' }]);
  const offCadence = injectLoreContext([{ role: 'user', content: 'HISTORY' }], result, {
    enabled: true, interval: 2, prompt: 'NOTE', depth: 1, role: 2
  });
  assert.doesNotMatch(offCadence.map((message) => message.content).join('\n'), /TOP|NOTE|BOTTOM/);
  const injected = injectLoreContext([
    { role: 'user', content: 'HISTORY ONE' },
    { role: 'assistant', content: 'REPLY' },
    { role: 'user', content: 'HISTORY TWO' }
  ], result, { enabled: true, interval: 2, prompt: 'NOTE', depth: 1, role: 2 });
  assert.deepEqual(injected.find((message) => message.content === 'TOP\nNOTE\nBOTTOM'), { role: 'assistant', content: 'TOP\nNOTE\nBOTTOM' });
});

test('honors normal-generation triggers and lore decorators', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Normal', constant: true, triggers: ['normal'], content: 'NORMAL' }),
    nativeEntry({ uid: 1, comment: 'Continue only', constant: true, triggers: ['continue'], content: 'CONTINUE' }),
    nativeEntry({ uid: 2, comment: 'Forced', key: [], content: '@@activate\nFORCED' }),
    nativeEntry({ uid: 3, comment: 'Suppressed', constant: true, content: '@@dont_activate\nSUPPRESSED' })
  ]);
  const normal = await scanLorebooks([book], [], { recursive: false }, { generationTrigger: 'normal' });
  assert.deepEqual(normal.activated.map((entry) => entry.name), ['Normal', 'Forced']);
  assert.doesNotMatch(normal.beforeCharacter.join('\n'), /@@activate|SUPPRESSED/);
  const continued = await scanLorebooks([book], [], { recursive: false }, { generationTrigger: 'continue' });
  assert.deepEqual(continued.activated.map((entry) => entry.name), ['Continue only', 'Forced']);
});

test('normalizes NovelAI, Agnai, and Risu lorebook exports', () => {
  const novel = normalizeLorebook({ lorebookVersion: 1, entries: [{ keys: ['n'], text: 'Novel', enabled: true, displayName: 'N' }] });
  const agnai = normalizeLorebook({ kind: 'memory', entries: [{ keywords: ['a'], entry: 'Agnai', enabled: true, name: 'A' }] });
  const risu = normalizeLorebook({ type: 'risu', data: [{ key: 'r, s', secondkey: 't', content: 'Risu', comment: 'R' }] });
  assert.equal(novel.format, 'novelai');
  assert.equal(novel.entries[0].content, 'Novel');
  assert.equal(agnai.format, 'agnai');
  assert.deepEqual(agnai.entries[0].keys, ['a']);
  assert.equal(risu.format, 'risu');
  assert.deepEqual(risu.entries[0].keys, ['r', 's']);
});

test('scans persona, character depth prompt, and explicit scan injections only when enabled per entry', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Persona', key: ['pilot'], matchPersonaDescription: true, content: 'PERSONA' }),
    nativeEntry({ uid: 1, comment: 'Depth prompt', key: ['private doubt'], matchCharacterDepthPrompt: true, content: 'DEPTH' }),
    nativeEntry({ uid: 2, comment: 'Injection', key: ['quiet signal'], content: 'INJECTION' })
  ]);
  const result = await scanLorebooks([book], [], { recursive: false }, {
    personaDescription: 'A pilot newly aboard the ship.',
    characterDepthPrompt: 'Show private doubt.',
    scanInjections: ['A quiet signal is active.']
  });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Persona', 'Depth prompt', 'Injection']);
  const depthZero = await scanLorebooks([book], [], { scanDepth: 0, recursive: false }, {
    personaDescription: 'A pilot newly aboard the ship.',
    characterDepthPrompt: 'Show private doubt.',
    scanInjections: ['A quiet signal is active.']
  });
  assert.deepEqual(depthZero.activated, []);
});

test('applies inclusive and exclusive character-name and tag filters', async () => {
  const card = normalizeCharacterCard({
    spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Blake', nickname: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], group_only_greetings: [],
      tags: ['Liberator crew'], creator: '', character_version: '', extensions: {}
    }
  });
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Name include', constant: true, characterFilter: { names: ['Blake'], tags: [], isExclude: false } }),
    nativeEntry({ uid: 1, comment: 'Tag include', constant: true, characterFilter: { names: [], tags: ['crew-tag-id'], isExclude: false } }),
    nativeEntry({ uid: 2, comment: 'Name exclude', constant: true, characterFilter: { names: ['Blake'], tags: [], isExclude: true } }),
    nativeEntry({ uid: 3, comment: 'Other include', constant: true, characterFilter: { names: ['Servalan'], tags: [], isExclude: false } }),
    nativeEntry({ uid: 4, comment: 'Both dimensions required', constant: true, characterFilter: { names: ['Blake'], tags: ['federation-tag-id'], isExclude: false } }),
    nativeEntry({ uid: 5, comment: 'Either exclusion rejects', constant: true, characterFilter: { names: ['Servalan'], tags: ['crew-tag-id'], isExclude: true } })
  ]);
  const result = await scanLorebooks([book], [], { recursive: false }, {
    card,
    characterFilterNames: ['Blake'],
    characterTags: ['crew-tag-id']
  });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Name include', 'Tag include']);
});

test('minimum activations expands only the global scan depth and excludes recursion text during expansion', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Recent', key: ['recent'], content: 'recursion-only-key' }),
    nativeEntry({ uid: 1, comment: 'Older', key: ['older'], content: 'OLDER', excludeRecursion: true }),
    nativeEntry({ uid: 2, comment: 'Must not use recursion', key: ['recursion-only-key'], content: 'BAD' }),
    nativeEntry({ uid: 3, comment: 'Fixed depth', key: ['older'], scanDepth: 1, content: 'FIXED' }),
    nativeEntry({ uid: 4, comment: 'Delayed is recursion-only', key: ['older'], delayUntilRecursion: 1, content: 'DELAYED' })
  ]);
  const result = await scanLorebooks([book], history('older', 'middle', 'recent'), {
    scanDepth: 1,
    minActivations: 2,
    minActivationsDepthMax: 3,
    recursive: false
  });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Recent', 'Older']);
});

test('advances open delayed-recursion levels even when global recursive scanning is disabled', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Level one', key: ['seed'], delayUntilRecursion: 1, content: 'ONE' }),
    nativeEntry({ uid: 1, comment: 'Level two', key: ['seed'], delayUntilRecursion: 2, content: 'TWO' })
  ]);
  const result = await scanLorebooks([book], history('seed'), { recursive: false });
  assert.deepEqual(result.activated.map((entry) => entry.name), ['Level one', 'Level two']);
});

test('persists sticky, cooldown, and delay state without polluting chat history', async () => {
  assert.throws(() => normalizeLoreTimedState({ sticky: { bad: { fingerprint: 'bad' } } }), /invalid loreTimedState.sticky effect/);
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Timed', key: ['alpha'], content: 'TIMED', probability: 50, sticky: 4, cooldown: 3 }),
    nativeEntry({ uid: 1, comment: 'Delayed', key: ['alpha'], content: 'DELAYED', delay: 3 })
  ], 'Timed book');
  const sizedHistory = (length) => Array.from({ length }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === length - 1 ? 'alpha' : 'filler'
  }));

  const first = await scanLorebooks([book], sizedHistory(1), { recursive: false }, { random: () => 0.1 });
  assert.deepEqual(first.activated.map((entry) => entry.name), ['Timed']);
  assert.equal(Object.keys(first.timedState.sticky).length, 1);
  assert.equal(Object.keys(first.timedState.cooldown).length, 1);

  const continued = await scanLorebooks([book], sizedHistory(2), { recursive: false }, {
    timedState: first.timedState,
    random: () => { throw new Error('sticky entries must not reroll probability'); }
  });
  assert.deepEqual(continued.activated.map((entry) => entry.name), ['Timed']);

  const regenerated = await scanLorebooks([book], sizedHistory(1), { recursive: false }, {
    timedState: first.timedState,
    random: () => 0.9
  });
  assert.deepEqual(regenerated.activated, []);
  assert.deepEqual(regenerated.timedState, { sticky: {}, cooldown: {} });

  const stickyExpired = await scanLorebooks([book], sizedHistory(5), { recursive: false }, { timedState: first.timedState });
  assert.deepEqual(stickyExpired.activated.map((entry) => entry.name), ['Delayed']);
  assert.deepEqual(Object.keys(stickyExpired.timedState.sticky), []);
  assert.deepEqual(Object.values(stickyExpired.timedState.cooldown)[0], {
    fingerprint: Object.values(first.timedState.sticky)[0].fingerprint,
    start: 5,
    end: 8,
    protected: true
  });

  const cooldownExpired = await scanLorebooks([book], sizedHistory(8), { recursive: false }, {
    timedState: stickyExpired.timedState,
    random: () => 0.1
  });
  assert.deepEqual(cooldownExpired.activated.map((entry) => entry.name), ['Timed', 'Delayed']);

  const delaySuppressed = await scanLorebooks([book], sizedHistory(2), { recursive: false }, { random: () => 0.1 });
  assert.deepEqual(delaySuppressed.activated.map((entry) => entry.name), ['Timed']);

  const edited = nativeBook([
    nativeEntry({ uid: 0, comment: 'Timed', key: ['alpha'], content: 'EDITED', probability: 0, sticky: 4, cooldown: 3 })
  ], 'Timed book');
  const editedResult = await scanLorebooks([edited], sizedHistory(2), { recursive: false }, {
    timedState: first.timedState,
    random: () => 0.9
  });
  assert.deepEqual(editedResult.activated, []);
});

test('forces active sticky entries to win inclusion groups', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Sticky winner', key: ['alpha'], content: 'WINNER', group: 'choice', sticky: 4, groupWeight: 100 }),
    nativeEntry({ uid: 1, comment: 'Other member', key: ['alpha'], content: 'OTHER', group: 'choice', groupWeight: 100 })
  ], 'Group book');
  const first = await scanLorebooks([book], history('alpha'), { recursive: false }, { random: () => 0 });
  assert.deepEqual(first.activated.map((entry) => entry.name), ['Sticky winner']);
  const next = await scanLorebooks([book], history('filler', 'alpha'), { recursive: false }, {
    timedState: first.timedState,
    random: () => 0.99
  });
  assert.deepEqual(next.activated.map((entry) => entry.name), ['Sticky winner']);
});

test('imports NovelAI naidata from a PNG lorebook', () => {
  const novel = { lorebookVersion: 1, entries: [{ keys: ['ship'], text: 'Liberator', enabled: true }] };
  const payload = Buffer.from(JSON.stringify(novel), 'utf8').toString('base64');
  const text = Buffer.concat([Buffer.from('naidata\0', 'latin1'), Buffer.from(payload, 'latin1')]);
  const chunk = (type, data = Buffer.alloc(0)) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('tEXt', text), chunk('IEND')]);
  const book = extractPngLorebook(png, 'Novel PNG');
  assert.equal(book.format, 'novelai');
  assert.equal(book.entries[0].content, 'Liberator');
});

test('uses the model server context and exact tokenizer contracts', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'gemma', meta: { n_ctx: 262144 } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ tokens: [1, 2, 3] }), { status: 200 });
  };
  assert.equal(await getModelContextTokens(fetcher, 'http://model:1234/v1', 'gemma'), 262_144);
  assert.equal(await countModelTokens(fetcher, 'http://model:1234/v1', 'hello'), 3);
  assert.equal(calls[1].url, 'http://model:1234/tokenize');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    content: 'hello',
    add_special: false,
    parse_special: true,
    with_pieces: false
  });
});

test('runs imported regex in a killable worker with a hard timeout', async () => {
  const sandbox = new RegexSandbox(50);
  try {
    assert.deepEqual(await sandbox.test('liber[a-z]+', 'i', 'LIBERATOR'), { matched: true, invalid: false });
    const started = Date.now();
    assert.deepEqual(await sandbox.test('^(a+)+$', '', `${'a'.repeat(50_000)}!`), { matched: false, timeout: true });
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(await sandbox.test('recovered', '', 'worker recovered'), { matched: true, invalid: false });
  } finally {
    await sandbox.dispose();
  }
});
