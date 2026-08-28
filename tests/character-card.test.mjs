import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  characterDepthPrompt,
  compileCharacterMessages,
  embeddedLoreEntryCount,
  firstCharacterMessage,
  normalizeCharacterCard,
  parseCharacterCardJson
} from '../src/lib/character-card.ts';
import { extractPngCharacterCard } from '../src/lib/png-character-card.ts';

const v2Data = {
  name: 'Vila Restal',
  description: 'A gifted thief aboard the Liberator.',
  personality: 'Cowardly, funny, and observant.',
  scenario: '{{char}} is speaking with {{user}} after a narrow escape.',
  first_mes: '"You look useful, {{user}}."',
  mes_example: '<START>\n{{user}}: Trouble?\n{{char}}: Inevitably.',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: 'Remain {{char}}.',
  alternate_greetings: [],
  tags: ['Blake\'s 7'],
  creator: 'MULLET test',
  character_version: '1',
  extensions: { vendor_namespace: { preserved: true } },
  character_book: {
    extensions: { book_namespace: 7 },
    entries: [{ keys: ['Liberator'], content: 'A highly advanced alien ship.', enabled: true }]
  },
  unknown_data_field: { must: 'survive' }
};

function v2Card() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: structuredClone(v2Data),
    unknown_root_field: ['also', 'preserved']
  };
}

function v3Card(name = 'Kerr Avon') {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...structuredClone(v2Data),
      name,
      group_only_greetings: ['Do try to keep up, {{user}}.'],
      assets: [{ type: 'icon', uri: 'embeded://avatar.png', name: 'main', ext: 'png' }]
    }
  };
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function metadataChunk(keyword, card) {
  const encoded = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
  return pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'ascii'), Buffer.from([0]), Buffer.from(encoded, 'ascii')]));
}

function cardPng(chunks) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    ...chunks,
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    pngChunk('IEND')
  ]));
}

test('imports legacy V1 and canonical V2/V3 cards', () => {
  const v1 = normalizeCharacterCard({
    name: 'Blake',
    description: 'Resistance leader',
    personality: 'Driven',
    scenario: 'Aboard the Liberator',
    first_mes: 'We have work to do.',
    mes_example: ''
  });
  assert.equal(v1.version, 1);
  assert.equal(v1.data.name, 'Blake');

  assert.equal(normalizeCharacterCard(v2Card()).version, 2);
  assert.equal(normalizeCharacterCard(v3Card()).version, 3);
});

test('accepts SillyTavern quasi-V3 and other 3.x cards without deleting fields', () => {
  const quasiV3 = v3Card();
  quasiV3.spec_version = '3.5';
  delete quasiV3.data.group_only_greetings;
  const imported = normalizeCharacterCard(quasiV3);

  assert.equal(imported.version, 3);
  assert.equal(imported.specVersion, '3.5');
  assert.deepEqual(imported.data.groupOnlyGreetings, []);
  assert.deepEqual(imported.raw, quasiV3);
});

test('preserves unknown fields, extensions, and embedded lore losslessly', () => {
  const original = v2Card();
  const imported = parseCharacterCardJson(JSON.stringify(original));

  assert.deepEqual(imported.raw, original);
  assert.deepEqual(imported.data.extensions, v2Data.extensions);
  assert.equal(embeddedLoreEntryCount(imported), 1);
});

test('PNG ccv3 metadata takes precedence over chara regardless of chunk order', () => {
  const imported = extractPngCharacterCard(cardPng([
    metadataChunk('chara', v2Card()),
    metadataChunk('CCV3', v3Card('Servalan'))
  ]));

  assert.equal(imported.version, 3);
  assert.equal(imported.data.name, 'Servalan');
});

test('PNG chara metadata imports when ccv3 is absent', () => {
  const imported = extractPngCharacterCard(cardPng([metadataChunk('chara', v2Card())]));
  assert.equal(imported.version, 2);
  assert.equal(imported.data.name, 'Vila Restal');
});

test('decodes large in-limit PNG metadata without overflowing the JavaScript call stack', () => {
  const source = v2Card();
  source.data.description = 'x'.repeat(200_000);
  const imported = extractPngCharacterCard(cardPng([metadataChunk('chara', source)]));
  assert.equal(imported.data.description.length, 200_000);
});

test('compiles card context before history and post-history instructions after it', () => {
  const source = v2Card();
  source.data.system_prompt = 'MAIN {{char}} and {{user}}';
  source.data.description = 'DESCRIPTION {{char}}';
  source.data.personality = 'PERSONALITY';
  source.data.scenario = 'SCENARIO {{user}}';
  source.data.mes_example = '<START>\nJohn: EXAMPLE ONE\nVila Restal: Reply one\n<START>\nJohn: EXAMPLE TWO\nVila Restal: Reply two';
  source.data.post_history_instructions = 'PHI {{char}}';
  const card = normalizeCharacterCard(source);
  const compiled = compileCharacterMessages(card, [{ role: 'user', content: 'HISTORY' }], 'John');

  const context = compiled[0].content;
  const orderedMarkers = ['MAIN', 'DESCRIPTION', 'PERSONALITY', 'SCENARIO'];
  const positions = orderedMarkers.map((marker) => context.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(context, /MAIN Vila Restal and John/);
  assert.match(compiled[1].content, /EXAMPLE ONE/);
  assert.match(compiled[2].content, /EXAMPLE TWO/);
  assert.doesNotMatch(compiled[1].content + compiled[2].content, /<START>/i);
  assert.deepEqual(compiled[3], { role: 'user', content: 'HISTORY' });
  assert.deepEqual(compiled[4], { role: 'system', content: 'PHI Vila Restal' });
  assert.equal(firstCharacterMessage(card, 'John'), '"You look useful, John."');
});

test('injects the character depth prompt at its configured depth and role', () => {
  const source = v3Card('Gem');
  source.data.extensions.depth_prompt = { prompt: 'Private note for {{char}} and {{user}}.', depth: 1, role: 'assistant' };
  const card = normalizeCharacterCard(source);
  assert.deepEqual(characterDepthPrompt(card, 'Avon'), {
    content: 'Private note for Gem and Avon.',
    depth: 1,
    role: 'assistant'
  });
  const compiled = compileCharacterMessages(card, [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' }
  ], 'Avon');
  assert.deepEqual(compiled.slice(-4, -1), [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'Private note for Gem and Avon.' },
    { role: 'assistant', content: 'two' }
  ]);
});

test('uses the V3 nickname for character macros while retaining the full card name', () => {
  const source = v3Card('Kerr Avon');
  source.data.nickname = 'Avon';
  source.data.first_mes = '{{char}} distrusts {{user}}.';
  source.data.system_prompt = 'Speak as <bot> to <user>.';
  const card = normalizeCharacterCard(source);

  assert.equal(card.data.name, 'Kerr Avon');
  assert.equal(firstCharacterMessage(card, 'John'), 'Avon distrusts John.');
  assert.equal(compileCharacterMessages(card, [{ role: 'user', content: 'Hello' }], 'John')[0].content.split('\n')[0], 'Speak as Avon to John.');
});

test('rejects malformed and unsupported cards with field-specific errors', () => {
  assert.throws(() => normalizeCharacterCard({}), /field "name"/);
  assert.throws(
    () => normalizeCharacterCard({ spec: 'chara_card_v2', spec_version: '2.1', data: v2Data }),
    /spec_version/
  );
  assert.throws(
    () => normalizeCharacterCard({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Only name' } }),
    /data.description/
  );
  assert.throws(
    () => normalizeCharacterCard({ spec: 'chara_card_v3', spec_version: '3.0', data: [] }),
    /field "data"/
  );
  assert.throws(() => extractPngCharacterCard(new Uint8Array([1, 2, 3])), /not a PNG/);
});
