import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_MAX_CONTENT_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_RECORD_SPEC,
  chatFileName,
  chatTitleFromMessages,
  newChatHeader,
  normalizeChatHeader,
  normalizeChatMessage,
  parseChatRecord,
  serializeChatRecord
} from '../src/lib/chat-record.ts';

const ID = '2f1a6c40-7b3e-4d51-9f2a-6c1d8b0e4a77';
const CREATED = '2026-09-04T10:15:00.000Z';
const UPDATED = '2026-09-04T10:42:31.500Z';

const header = (overrides = {}) => ({
  spec: CHAT_RECORD_SPEC,
  id: ID,
  title: 'Liberator, six hours out',
  card: 'blakes-7-post-gan',
  starter: 'flight-deck',
  createdAt: CREATED,
  updatedAt: UPDATED,
  ...overrides
});

const message = (overrides = {}) => ({
  role: 'user',
  content: 'Where are we going?',
  at: CREATED,
  ...overrides
});

const jsonl = (...lines) => `${lines.join('\n')}\n`;

test('a record survives a serialize/parse round trip unchanged', () => {
  const record = {
    header: normalizeChatHeader(header()),
    messages: [
      normalizeChatMessage(message()),
      normalizeChatMessage(message({
        role: 'assistant',
        content: 'Nowhere pleasant.\n\n"Set a course," she said — and the deck lurched. 🚀',
        at: UPDATED
      })),
      normalizeChatMessage(message({ role: 'user', content: '', at: UPDATED }))
    ]
  };

  const text = serializeChatRecord(record);
  assert.ok(text.endsWith('\n'));
  assert.equal(text.split('\n').length, 5, 'header + 3 messages + trailing newline');

  const { record: parsed, skipped } = parseChatRecord(text);
  assert.deepEqual(skipped, []);
  assert.deepEqual(parsed, record);
  assert.equal(serializeChatRecord(parsed), text);
});

test('a message with newlines stays on exactly one line', () => {
  const text = serializeChatRecord({
    header: normalizeChatHeader(header()),
    messages: [normalizeChatMessage(message({ content: 'one\ntwo\r\nthree' }))]
  });
  const lines = text.split('\n').filter((line) => line !== '');
  assert.equal(lines.length, 2);
  assert.equal(parseChatRecord(text).record.messages[0].content, 'one\ntwo\r\nthree');
});

test('lenient parse keeps the good messages and reports the bad lines', () => {
  const text = [
    JSON.stringify(header()),                                            // 1
    JSON.stringify(message({ content: 'First question.' })),             // 2
    '{"role":"assistant","content":"truncated mid-w',                    // 3
    '',                                                                  // 4
    'the operator typed a note here by hand',                            // 5
    JSON.stringify(message({ role: 'wizard', content: 'Nope.' })),       // 6
    JSON.stringify(message({ role: 'assistant', content: 'Second.' })),  // 7
    '',                                                                  // 8
    '   '                                                                // 9
  ].join('\n');

  const { record, skipped } = parseChatRecord(text);
  assert.deepEqual(record.messages.map((entry) => entry.content), ['First question.', 'Second.']);
  assert.deepEqual(skipped.map((entry) => entry.line), [3, 5, 6]);
  assert.equal(skipped[0].reason, 'not valid JSON');
  assert.equal(skipped[1].reason, 'not valid JSON');
  assert.match(skipped[2].reason, /role/);
  assert.equal(record.header.title, 'Liberator, six hours out');
});

test('blank lines and CRLF are ignored rather than skipped with a reason', () => {
  const text = [
    '',
    '',
    JSON.stringify(header()),
    '',
    JSON.stringify(message()),
    ''
  ].join('\r\n');
  const { record, skipped } = parseChatRecord(text);
  assert.deepEqual(skipped, []);
  assert.equal(record.messages.length, 1);
});

test('strict parse throws on the first bad line and names it', () => {
  const badJson = jsonl(JSON.stringify(header()), '{"role":"user"');
  assert.throws(
    () => parseChatRecord(badJson, { lenient: false }),
    /chat record line 2 is not valid JSON/
  );

  const badRole = jsonl(JSON.stringify(header()), JSON.stringify(message({ role: 'system' })));
  assert.throws(() => parseChatRecord(badRole, { lenient: false }), /line 2.*role/);
  assert.deepEqual(parseChatRecord(badRole).record.messages, []);
});

test('a missing or unparseable header is fatal in both modes', () => {
  for (const options of [undefined, { lenient: true }, { lenient: false }]) {
    assert.throws(() => parseChatRecord('', options), /missing its header/);
    assert.throws(() => parseChatRecord('\n\n   \n', options), /missing its header/);
    assert.throws(() => parseChatRecord('not json at all\n', options), /header on line 1 is not valid JSON/);
    assert.throws(
      () => parseChatRecord(jsonl(JSON.stringify(message()))),
      /chat header has an unknown field "role"/
    );
    assert.throws(
      () => parseChatRecord(jsonl(JSON.stringify(header({ spec: 'other_v1' }))), options),
      /chat header spec/
    );
    assert.throws(
      () => parseChatRecord(jsonl(JSON.stringify(header({ id: 'not-a-uuid' }))), options),
      /chat header id must be a UUID/
    );
  }
  assert.throws(() => parseChatRecord(jsonl('[]')), /chat header must be a JSON object/);
});

test('the header is strict about unknown, missing and malformed fields', () => {
  assert.throws(
    () => normalizeChatHeader({ ...header(), tags: ['extra'] }),
    /chat header has an unknown field "tags"/
  );
  for (const field of ['spec', 'id', 'title', 'card', 'starter', 'createdAt', 'updatedAt']) {
    const partial = header();
    delete partial[field];
    assert.throws(() => normalizeChatHeader(partial), new RegExp(`chat header is missing "${field}"`));
  }
  assert.throws(() => normalizeChatHeader(header({ title: '' })), /chat header title/);
  assert.throws(() => normalizeChatHeader(header({ title: 'x'.repeat(201) })), /chat header title/);
  assert.throws(() => normalizeChatHeader(header({ card: null })), /chat header card/);
  assert.throws(() => normalizeChatHeader(header({ starter: 3 })), /chat header starter/);
  assert.throws(() => normalizeChatHeader(header({ createdAt: 'yesterday' })), /createdAt must be an ISO-8601/);
  assert.throws(() => normalizeChatHeader(header({ updatedAt: '2026-09-04 10:15:00' })), /updatedAt must be an ISO-8601/);
  assert.throws(() => normalizeChatHeader(header({ createdAt: '2026-02-30T00:00:00Z' })), /createdAt must be an ISO-8601/);

  const accepted = normalizeChatHeader(header({ title: 'x'.repeat(200), card: '', starter: '', createdAt: '2026-09-04T10:15:00+01:00' }));
  assert.equal(accepted.card, '');
  assert.equal(accepted.starter, '');
  assert.equal(accepted.createdAt, '2026-09-04T10:15:00+01:00');
});

test('a message tolerates and drops unknown keys but rejects bad values', () => {
  const dropped = normalizeChatMessage({ ...message(), id: 7, tokens: 42, extra: { deep: true } });
  assert.deepEqual(dropped, { role: 'user', content: 'Where are we going?', at: CREATED });
  assert.deepEqual(Object.keys(dropped), ['role', 'content', 'at']);

  assert.deepEqual(normalizeChatMessage(message({ content: '' })).content, '');

  assert.throws(() => normalizeChatMessage(message({ role: 'system' })), /chat message role/);
  assert.throws(() => normalizeChatMessage(message({ content: 12 })), /chat message content must be a string/);
  assert.throws(() => normalizeChatMessage(message({ at: '2026-09-04' })), /chat message at must be an ISO-8601/);
  assert.throws(() => normalizeChatMessage(message({ at: undefined })), /chat message at must be an ISO-8601/);
  assert.throws(() => normalizeChatMessage('a line of prose'), /chat message must be a JSON object/);
  assert.throws(() => normalizeChatMessage([message()]), /chat message must be a JSON object/);
});

test('a file written by another tool still loads, minus its extra message keys', () => {
  const text = jsonl(
    JSON.stringify(header()),
    JSON.stringify({ ...message(), foreign_id: 'abc', swipes: [1, 2, 3] })
  );
  const { record, skipped } = parseChatRecord(text);
  assert.deepEqual(skipped, []);
  assert.deepEqual(record.messages[0], { role: 'user', content: 'Where are we going?', at: CREATED });
});

test('message content is capped at CHAT_MAX_CONTENT_CHARS', () => {
  assert.equal(CHAT_MAX_CONTENT_CHARS, 200_000);
  const atCap = normalizeChatMessage(message({ content: 'x'.repeat(CHAT_MAX_CONTENT_CHARS) }));
  assert.equal(atCap.content.length, CHAT_MAX_CONTENT_CHARS);
  assert.throws(
    () => normalizeChatMessage(message({ content: 'x'.repeat(CHAT_MAX_CONTENT_CHARS + 1) })),
    /chat message content must be at most 200000 characters/
  );
  assert.throws(
    () => serializeChatRecord({
      header: normalizeChatHeader(header()),
      messages: [message({ content: 'x'.repeat(CHAT_MAX_CONTENT_CHARS + 1) })]
    }),
    /chat message content must be at most/
  );
});

test('a record is capped at CHAT_MAX_MESSAGES on serialize and on parse', () => {
  assert.equal(CHAT_MAX_MESSAGES, 10_000);
  const one = normalizeChatMessage(message({ content: 'hi' }));
  const full = { header: normalizeChatHeader(header()), messages: Array.from({ length: CHAT_MAX_MESSAGES }, () => one) };
  assert.equal(parseChatRecord(serializeChatRecord(full)).record.messages.length, CHAT_MAX_MESSAGES);

  const over = { header: full.header, messages: [...full.messages, one] };
  assert.throws(() => serializeChatRecord(over), /at most 10000 messages/);

  const overText = jsonl(JSON.stringify(header()), ...Array.from({ length: CHAT_MAX_MESSAGES + 1 }, () => JSON.stringify(one)));
  assert.throws(() => parseChatRecord(overText), /at most 10000 messages/);
});

test('chatFileName slugs a title and appends the first eight hex of the id', () => {
  assert.equal(chatFileName({ id: ID, title: 'Liberator, Six Hours Out!' }), 'liberator-six-hours-out-2f1a6c40.jsonl');
  assert.equal(chatFileName({ id: ID, title: '  --Hello,   World!!  ' }), 'hello-world-2f1a6c40.jsonl');
  assert.throws(() => chatFileName({ id: 'nope', title: 'x' }), /chat header id must be a UUID/);
});

test('a hostile title can never produce an unsafe file name', () => {
  const hostile = [
    '../../etc/passwd',
    '..',
    '.',
    '....',
    '/',
    '\\',
    'con',
    'CON',
    'nul',
    'COM1',
    'lpt9',
    '.hidden',
    '~/.ssh/authorized_keys',
    'C:\\Windows\\System32',
    '🎭🎭🎭',
    '',
    '   ',
    '\u0000\u0001',
    'A'.repeat(500),
    'a b '.repeat(200)
  ];
  for (const title of hostile) {
    const name = chatFileName({ id: ID, title });
    assert.match(name, /^[a-z0-9][a-z0-9-]*-2f1a6c40\.jsonl$/, `unsafe name for ${JSON.stringify(title)}`);
    assert.ok(!name.includes('/') && !name.includes('\\'), `separator in ${name}`);
    assert.ok(!name.includes('..'), `dot-dot in ${name}`);
    assert.ok(!name.startsWith('.'), `leading dot in ${name}`);
    assert.equal(name, name.trim());
    const stem = name.slice(0, name.length - '-2f1a6c40.jsonl'.length);
    assert.ok(stem.length >= 1 && stem.length <= 60, `stem length ${stem.length}`);
    assert.ok(!['con', 'prn', 'aux', 'nul', 'com1', 'lpt9'].includes(stem), `reserved stem ${stem}`);
  }
  assert.equal(chatFileName({ id: ID, title: '../../etc/passwd' }), 'etc-passwd-2f1a6c40.jsonl');
  assert.equal(chatFileName({ id: ID, title: '..' }), 'chat-2f1a6c40.jsonl');
  assert.equal(chatFileName({ id: ID, title: '🎭🎭🎭' }), 'chat-2f1a6c40.jsonl');
  assert.equal(chatFileName({ id: ID, title: 'con' }), 'con-chat-2f1a6c40.jsonl');
});

test('chatTitleFromMessages takes the first user message, collapsed and cut on a word', () => {
  assert.equal(
    chatTitleFromMessages([message({ content: '  Where\n\tare   we\n going, exactly?  ' })], 'fallback'),
    'Where are we going, exactly?'
  );

  const long = chatTitleFromMessages(
    [message({ content: 'The Liberator is six hours out from Gauda Prime and the detector shields are still down' })],
    'fallback'
  );
  assert.ok(long.length <= 60, `derived title was ${long.length} chars`);
  assert.equal(long, 'The Liberator is six hours out from Gauda Prime and the');
  assert.ok(!long.endsWith(' '));

  assert.equal(
    chatTitleFromMessages([message({ content: 'x'.repeat(200) })], 'fallback'),
    'x'.repeat(60)
  );

  assert.equal(
    chatTitleFromMessages(
      [message({ role: 'assistant', content: 'I speak first.' }), message({ content: 'Then me.' })],
      'fallback'
    ),
    'Then me.'
  );
});

test('chatTitleFromMessages falls back when there is no usable user message', () => {
  assert.equal(chatTitleFromMessages([], 'New chat'), 'New chat');
  assert.equal(chatTitleFromMessages([message({ role: 'assistant' })], 'New chat'), 'New chat');
  assert.equal(chatTitleFromMessages([message({ content: '   \n  ' })], 'New chat'), 'New chat');
  assert.equal(chatTitleFromMessages([message({ content: '' }), message({ content: 'Real.' })], 'New chat'), 'Real.');
});

test('newChatHeader fills the defaults and validates its input', () => {
  const fresh = newChatHeader({ id: ID, now: CREATED });
  assert.deepEqual(fresh, {
    spec: CHAT_RECORD_SPEC,
    id: ID,
    title: 'New chat',
    card: '',
    starter: '',
    createdAt: CREATED,
    updatedAt: CREATED
  });

  const filled = newChatHeader({
    id: ID,
    title: '  Six hours out  ',
    card: 'blakes-7-post-gan',
    starter: 'flight-deck',
    now: UPDATED
  });
  assert.equal(filled.title, 'Six hours out');
  assert.equal(filled.card, 'blakes-7-post-gan');
  assert.equal(filled.starter, 'flight-deck');
  assert.equal(filled.createdAt, filled.updatedAt);

  assert.equal(newChatHeader({ id: ID, title: '   ', now: CREATED }).title, 'New chat');
  assert.throws(() => newChatHeader({ id: 'not-a-uuid', now: CREATED }), /chat header id must be a UUID/);
  assert.throws(() => newChatHeader({ id: ID, now: 'right now' }), /createdAt must be an ISO-8601/);
  assert.throws(() => newChatHeader({ id: ID, title: 'x'.repeat(201), now: CREATED }), /chat header title/);

  const roundTripped = parseChatRecord(serializeChatRecord({ header: fresh, messages: [] }));
  assert.deepEqual(roundTripped.record, { header: fresh, messages: [] });
});
