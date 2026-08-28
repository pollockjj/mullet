import assert from 'node:assert/strict';
import test from 'node:test';

import { compileCharacterMessages, normalizeCharacterCard } from '../src/lib/character-card.ts';
import {
  DEFAULT_LOREBOOK_SETTINGS,
  compileUnboundLoreMessages,
  injectLoreDepth,
  normalizeLorebook,
  resolveLorebookSettings,
  scanLorebooks
} from '../src/lib/lorebook.ts';
import { extractPngLorebook } from '../src/lib/png-lorebook.ts';
import { countModelTokens, getModelContextTokens } from '../src/lib/server/model-tokenizer.ts';

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
    budgetPercent: 25,
    includeNames: true,
    recursive: true,
    caseSensitive: false,
    matchWholeWords: true,
    maxContextTokens: 262_144,
    budgetCap: 0,
    maxRecursionSteps: 0,
    useGroupScoring: false
  });
  assert.equal((await scanLorebooks([], [], DEFAULT_LOREBOOK_SETTINGS)).budgetTokens, 65_536);
  assert.equal(resolveLorebookSettings({ scanDepth: 0 }).scanDepth, 0);
  assert.equal(resolveLorebookSettings({ scanDepth: 1000 }).scanDepth, 1000);
  assert.equal(resolveLorebookSettings({ budgetPercent: 1 }).budgetPercent, 1);
  assert.equal(resolveLorebookSettings({ budgetPercent: 100 }).budgetPercent, 100);
  assert.equal(resolveLorebookSettings({ maxContextTokens: 999 }).maxContextTokens, 262_144);
  assert.throws(() => resolveLorebookSettings({ scanDepth: 1001 }), /between 0 and 1000/);
  assert.throws(() => resolveLorebookSettings({ budgetPercent: 0 }), /between 1 and 100/);
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

test('supports slash regex, canonical regex, invalid regex, and card macros', async () => {
  const book = nativeBook([
    nativeEntry({ uid: 0, comment: 'Slash', key: ['/liber[a-z]+/i'] }),
    nativeEntry({ uid: 1, comment: 'Canonical regex', key: ['danger\\d+'], use_regex: true }),
    nativeEntry({ uid: 2, comment: 'Invalid regex', key: ['['], use_regex: true }),
    nativeEntry({ uid: 3, comment: 'Macro', key: ['{{char}}'], content: '{{char}} knows {{user}}.' })
  ]);
  const result = await scanLorebooks([book], history('Avon found Liberator and danger7'), {}, { assistantName: 'Avon', userName: 'John' });

  assert.deepEqual(result.activated.map((entry) => entry.name), ['Slash', 'Canonical regex', 'Macro']);
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
