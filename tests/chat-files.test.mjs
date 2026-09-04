import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CHAT_RECORD_SPEC, chatFileName, serializeChatRecord } from '../src/lib/chat-record.ts';
import {
  ChatNotFoundError,
  chatsDirectory,
  deleteChat,
  duplicateChat,
  importChat,
  listChats,
  readChat,
  renameChat,
  writeChat
} from '../src/lib/server/chat-files.ts';

async function dataDirectory() {
  return mkdtemp(join(tmpdir(), 'mullet-chat-files-'));
}

function chat({
  id = '11111111-1111-4111-8111-111111111111',
  title = 'A quiet room',
  card = 'jenna-stannis',
  starter = 'the door opens',
  createdAt = '2026-09-01T00:00:00.000Z',
  updatedAt = createdAt,
  messages
} = {}) {
  return {
    header: { spec: CHAT_RECORD_SPEC, id, title, card, starter, createdAt, updatedAt },
    messages: messages ?? [
      { role: 'user', content: 'Are you awake?', at: createdAt },
      { role: 'assistant', content: 'I have been for a while.', at: updatedAt }
    ]
  };
}

async function chatFiles(dataDir) {
  const names = await readdir(chatsDirectory(dataDir));
  return names.sort();
}

/** Mirrors the file-name normalization the module applies to `chatFileName`. */
function expectedFile(header) {
  const name = chatFileName({ id: header.id, title: header.title });
  return name.endsWith('.jsonl') ? name : `${name}.jsonl`;
}

async function captureWarnings(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };
  try {
    const result = await run();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

function withBadLine(text) {
  const lines = text.split('\n');
  lines.splice(1, 0, '{ this line is not json at all');
  return lines.join('\n');
}

test('chatsDirectory names <dataDir>/chats and listing creates it on demand', async () => {
  const dataDir = await dataDirectory();
  assert.equal(chatsDirectory(dataDir), join(dataDir, 'chats'));
  assert.deepEqual(await listChats(dataDir), []);
  await access(chatsDirectory(dataDir));
});

test('writes, lists and reads a chat back', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  const summary = await writeChat(dataDir, record);

  assert.equal(summary.id, record.header.id);
  assert.equal(summary.title, 'A quiet room');
  assert.equal(summary.card, 'jenna-stannis');
  assert.equal(summary.starter, 'the door opens');
  assert.equal(summary.messageCount, 2);
  assert.ok(summary.bytes > 0);
  assert.equal(summary.file, expectedFile(record.header));
  assert.equal(summary.path, join(chatsDirectory(dataDir), summary.file));

  const listed = await listChats(dataDir);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], summary);

  const loaded = await readChat(dataDir, record.header.id);
  assert.equal(loaded.path, summary.path);
  assert.deepEqual(loaded.skipped, []);
  assert.equal(loaded.record.header.id, record.header.id);
  assert.deepEqual(loaded.record.messages, record.messages);
});

test('lists the newest updatedAt first', async () => {
  const dataDir = await dataDirectory();
  await writeChat(dataDir, chat({ id: 'a1a1a1a1-0001-4001-8001-000000000001', title: 'Oldest', updatedAt: '2026-09-01T01:00:00.000Z' }));
  await writeChat(dataDir, chat({ id: 'c3c3c3c3-0003-4003-8003-000000000003', title: 'Newest', updatedAt: '2026-09-03T01:00:00.000Z' }));
  await writeChat(dataDir, chat({ id: 'b2b2b2b2-0002-4002-8002-000000000002', title: 'Middle', updatedAt: '2026-09-02T01:00:00.000Z' }));

  const listed = await listChats(dataDir);
  assert.deepEqual(listed.map((entry) => entry.title), ['Newest', 'Middle', 'Oldest']);
});

test('renaming changes the file name and leaves exactly one file', async () => {
  const dataDir = await dataDirectory();
  const record = chat({ title: 'A quiet room' });
  const before = await writeChat(dataDir, record);

  const after = await renameChat(dataDir, record.header.id, 'A louder room', '2026-09-04T09:00:00.000Z');
  assert.equal(after.title, 'A louder room');
  assert.equal(after.updatedAt, '2026-09-04T09:00:00.000Z');
  assert.equal(after.createdAt, record.header.createdAt);
  assert.notEqual(after.file, before.file);

  assert.deepEqual(await chatFiles(dataDir), [after.file]);
  const loaded = await readChat(dataDir, record.header.id);
  assert.equal(loaded.record.header.title, 'A louder room');
  assert.equal(loaded.record.messages.length, 2);
});

test('deleting removes the file and a missing id is a not-found error', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  await writeChat(dataDir, record);

  await deleteChat(dataDir, record.header.id);
  assert.deepEqual(await chatFiles(dataDir), []);
  assert.deepEqual(await listChats(dataDir), []);

  await assert.rejects(() => deleteChat(dataDir, record.header.id), (error) => {
    assert.ok(error instanceof ChatNotFoundError);
    assert.match(error.message, /deleteChat/);
    assert.ok(error.message.includes(record.header.id));
    return true;
  });
});

test('duplicating copies under a new id and leaves the original untouched', async () => {
  const dataDir = await dataDirectory();
  const record = chat({ title: 'A quiet room', createdAt: '2026-09-01T00:00:00.000Z' });
  const original = await writeChat(dataDir, record);

  const copy = await duplicateChat(
    dataDir,
    record.header.id,
    '22222222-2222-4222-8222-222222222222',
    '2026-09-04T10:00:00.000Z'
  );

  assert.equal(copy.id, '22222222-2222-4222-8222-222222222222');
  assert.equal(copy.title, 'A quiet room (copy)');
  assert.equal(copy.createdAt, '2026-09-04T10:00:00.000Z');
  assert.equal(copy.updatedAt, '2026-09-04T10:00:00.000Z');
  assert.equal(copy.messageCount, record.messages.length);
  assert.notEqual(copy.file, original.file);

  const listed = await listChats(dataDir);
  assert.equal(listed.length, 2);
  const kept = listed.find((entry) => entry.id === record.header.id);
  assert.deepEqual(kept, original);

  const loadedCopy = await readChat(dataDir, copy.id);
  assert.deepEqual(loadedCopy.record.messages, record.messages);
});

test('importing parses leniently, reassigns the id and reports the dropped line', async () => {
  const dataDir = await dataDirectory();
  const source = chat({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', title: 'Handed over', createdAt: '2020-01-01T00:00:00.000Z' });
  const damaged = withBadLine(serializeChatRecord(source));

  const { summary, skipped } = await importChat(
    dataDir,
    damaged,
    '33333333-3333-4333-8333-333333333333',
    '2026-09-04T11:00:00.000Z'
  );

  assert.equal(summary.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(summary.title, 'Handed over');
  assert.equal(summary.createdAt, '2026-09-04T11:00:00.000Z');
  assert.equal(summary.updatedAt, '2026-09-04T11:00:00.000Z');
  assert.equal(summary.messageCount, source.messages.length);

  assert.ok(skipped.length >= 1, 'the damaged line is reported to the caller');
  assert.equal(typeof skipped[0].line, 'number');
  assert.equal(typeof skipped[0].reason, 'string');

  const loaded = await readChat(dataDir, summary.id);
  assert.deepEqual(loaded.record.messages, source.messages);
});

test('readChat returns the lines a hand-edit dropped', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  const summary = await writeChat(dataDir, record);

  await writeFile(summary.path, withBadLine(await readFile(summary.path, 'utf8')), 'utf8');

  const loaded = await readChat(dataDir, record.header.id);
  assert.ok(loaded.skipped.length >= 1, 'the operator can be told their edit dropped a line');
  assert.deepEqual(loaded.record.messages, record.messages);
});

test('a hostile id cannot escape the chat directory or reach another chat', async () => {
  const dataDir = await dataDirectory();
  const mine = chat({ id: '44444444-4444-4444-8444-444444444444', title: 'Mine' });
  const neighbour = chat({ id: '55555555-5555-4555-8555-555555555555', title: 'Neighbour' });
  await writeChat(dataDir, mine);
  const neighbourSummary = await writeChat(dataDir, neighbour);

  const outsidePath = join(dataDir, 'secret.jsonl');
  await writeFile(outsidePath, serializeChatRecord(chat({ id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', title: 'Secret' })), 'utf8');

  const hostile = [
    '../../etc/passwd',
    '../secret',
    '../secret.jsonl',
    'foo/bar',
    'foo\\bar',
    `has\0null`,
    '..',
    '.',
    '/etc/passwd',
    ''
  ];

  for (const id of hostile) {
    await assert.rejects(
      () => readChat(dataDir, id),
      (error) => {
        assert.ok(error instanceof ChatNotFoundError, `readChat ${JSON.stringify(id)} must be not-found`);
        assert.match(error.message, /readChat/);
        return true;
      }
    );
    await assert.rejects(
      () => deleteChat(dataDir, id),
      (error) => {
        assert.ok(error instanceof ChatNotFoundError, `deleteChat ${JSON.stringify(id)} must be not-found`);
        return true;
      }
    );
    await assert.rejects(() => renameChat(dataDir, id, 'Renamed', '2026-09-04T12:00:00.000Z'), ChatNotFoundError);
    await assert.rejects(
      () => duplicateChat(dataDir, id, '66666666-6666-4666-8666-666666666666', '2026-09-04T12:00:00.000Z'),
      ChatNotFoundError
    );
  }

  // Nothing outside the chat directory was read, moved or removed.
  await access(outsidePath);
  const listed = await listChats(dataDir);
  assert.deepEqual(listed.map((entry) => entry.id).sort(), [mine.header.id, neighbour.header.id].sort());
  assert.deepEqual(await chatFiles(dataDir), [expectedFile(mine.header), neighbourSummary.file].sort());
});

test('a corrupt chat file is skipped with a warning instead of failing the list', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  await writeChat(dataDir, record);
  await writeFile(join(chatsDirectory(dataDir), 'broken.jsonl'), 'this is not a chat header\nnor is this\n', 'utf8');

  const { result, warnings } = await captureWarnings(() => listChats(dataDir));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, record.header.id);
  assert.ok(
    warnings.some((line) => line.includes('broken.jsonl')),
    `a warning must name the corrupt file, got ${JSON.stringify(warnings)}`
  );
});

test('files that are not .jsonl are ignored', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  await writeChat(dataDir, record);
  await writeFile(join(chatsDirectory(dataDir), 'notes.txt'), 'operator scratch notes', 'utf8');
  await writeFile(join(chatsDirectory(dataDir), 'README.md'), '# chats', 'utf8');
  await writeFile(join(chatsDirectory(dataDir), 'chat.jsonl.bak'), 'garbage', 'utf8');

  const { result, warnings } = await captureWarnings(() => listChats(dataDir));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, record.header.id);
  assert.deepEqual(warnings, []);
});

test('writes are atomic and leave no temp files behind', async () => {
  const dataDir = await dataDirectory();
  const record = chat();
  await writeChat(dataDir, record);
  await renameChat(dataDir, record.header.id, 'Renamed once', '2026-09-04T13:00:00.000Z');
  await duplicateChat(dataDir, record.header.id, '77777777-7777-4777-8777-777777777777', '2026-09-04T13:30:00.000Z');
  await importChat(
    dataDir,
    serializeChatRecord(chat({ id: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e', title: 'Imported' })),
    '88888888-8888-4888-8888-888888888888',
    '2026-09-04T14:00:00.000Z'
  );

  const names = await chatFiles(dataDir);
  assert.equal(names.length, 3);
  for (const name of names) {
    assert.ok(name.endsWith('.jsonl'), `${name} must be a chat file`);
    assert.ok(!name.includes('.tmp'), `${name} must not be a leftover temp file`);
  }
});

test('two chats with the same title get distinct files', async () => {
  const dataDir = await dataDirectory();
  const first = chat({ id: 'd1d1d1d1-1111-4111-8111-aaaaaaaaaaaa', title: 'Same title' });
  const second = chat({ id: 'e2e2e2e2-2222-4222-8222-bbbbbbbbbbbb', title: 'Same title' });

  const firstSummary = await writeChat(dataDir, first);
  const secondSummary = await writeChat(dataDir, second);

  assert.notEqual(firstSummary.file, secondSummary.file);
  assert.equal((await chatFiles(dataDir)).length, 2);
  assert.equal((await listChats(dataDir)).length, 2);
  assert.equal((await readChat(dataDir, first.header.id)).record.header.id, first.header.id);
  assert.equal((await readChat(dataDir, second.header.id)).record.header.id, second.header.id);
});

test('writeChat refuses a record whose id does not match the file it would replace', async () => {
  const dataDir = await dataDirectory();
  const squatter = chat({ id: 'aaaabbbb-cccc-4ddd-8eee-ffff00001111', title: 'Squatter' });
  const incoming = chat({ id: 'bbbbcccc-dddd-4eee-8fff-000011112222', title: 'Incoming' });

  // Park the squatter's content at the exact path the incoming record would claim.
  await listChats(dataDir); // creates the directory
  const contested = join(chatsDirectory(dataDir), expectedFile(incoming.header));
  const squatterText = serializeChatRecord(squatter);
  await writeFile(contested, squatterText, 'utf8');

  await assert.rejects(() => writeChat(dataDir, incoming), (error) => {
    assert.ok(!(error instanceof ChatNotFoundError));
    assert.match(error.message, /writeChat/);
    assert.ok(error.message.includes(incoming.header.id));
    return true;
  });

  assert.equal(await readFile(contested, 'utf8'), squatterText);
});
