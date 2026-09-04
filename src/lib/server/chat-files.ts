import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  CHAT_RECORD_SPEC,
  chatFileName,
  parseChatRecord,
  serializeChatRecord,
  type ChatHeader,
  type ChatRecord
} from '../chat-record.ts';

export const CHAT_DIRECTORY_NAME = 'chats';
export const CHAT_FILE_EXTENSION = '.jsonl';

const MAX_ID_LENGTH = 200;

export type ChatSummary = {
  id: string;
  title: string;
  card: string;
  starter: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  bytes: number;
  file: string;
  path: string;
};

export type ChatSkip = { line: number; reason: string };

/**
 * Thrown whenever an operation names a chat id that is not present in the chat
 * directory. Routes map this to 404; every other failure is a 500.
 */
export class ChatNotFoundError extends Error {
  readonly operation: string;
  readonly chatId: string;

  constructor(operation: string, id: string) {
    super(`${operation} failed: no chat with id ${JSON.stringify(String(id))}`);
    this.name = 'ChatNotFoundError';
    this.operation = operation;
    this.chatId = String(id);
  }
}

function failure(operation: string, id: string, reason: string): Error {
  return new Error(`${operation} failed for chat ${JSON.stringify(String(id))}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ids are compared against parsed file headers, never joined into a path, so
 * this is defence in depth rather than the only barrier. A traversal attempt,
 * an embedded separator or a null byte can never name a real chat, so callers
 * see the same not-found result they would see for any unknown id.
 */
function isSafeId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('\0')
  );
}

function isChatFileName(name: string): boolean {
  return name.endsWith(CHAT_FILE_EXTENSION) && name.length > CHAT_FILE_EXTENSION.length && !name.startsWith('.');
}

function isUsableHeader(value: unknown): value is ChatHeader {
  if (!isRecord(value)) return false;
  if (value.spec !== CHAT_RECORD_SPEC) return false;
  if (!isSafeId(value.id)) return false;
  return (
    typeof value.title === 'string' &&
    typeof value.card === 'string' &&
    typeof value.starter === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

/** `<dataDir>/chats` — the only directory this module ever touches. */
export function chatsDirectory(dataDir: string): string {
  return join(dataDir, CHAT_DIRECTORY_NAME);
}

async function ensureChatsDirectory(dataDir: string): Promise<string> {
  const directory = chatsDirectory(dataDir);
  await mkdir(directory, { recursive: true });
  return directory;
}

/**
 * The on-disk name comes from the record's own header, never from a caller
 * string. The result is still reduced to a bare basename so a future change to
 * the naming rule cannot reach out of the chat directory.
 */
function chatFileNameFor(header: { id: string; title: string }, operation: string): string {
  let raw: string;
  try {
    raw = chatFileName({ id: header.id, title: header.title });
  } catch (error) {
    throw failure(operation, header.id, `the chat has no usable file name: ${String(error)}`);
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw failure(operation, header.id, 'the chat record module produced an empty file name');
  }
  const bare = basename(raw);
  if (
    bare !== raw ||
    bare === '.' ||
    bare === '..' ||
    bare.includes('/') ||
    bare.includes('\\') ||
    bare.includes('\0')
  ) {
    throw failure(operation, header.id, `the chat file name ${JSON.stringify(raw)} is not a plain file name`);
  }
  return bare.endsWith(CHAT_FILE_EXTENSION) ? bare : `${bare}${CHAT_FILE_EXTENSION}`;
}

function summarize(record: ChatRecord, file: string, path: string, bytes: number): ChatSummary {
  return {
    id: record.header.id,
    title: record.header.title,
    card: record.header.card,
    starter: record.header.starter,
    createdAt: record.header.createdAt,
    updatedAt: record.header.updatedAt,
    messageCount: record.messages.length,
    bytes,
    file,
    path
  };
}

type ChatEntry = {
  summary: ChatSummary;
  record: ChatRecord;
  skipped: ChatSkip[];
};

type ChatScan = {
  directory: string;
  entries: ChatEntry[];
  /** Files that are chat files by name but whose header could not be read. */
  unreadable: string[];
};

function compareDescending(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Reads the chat directory and builds the id to path map. Every lookup in this
 * module goes through here, which is what keeps caller-supplied ids off the
 * filesystem. A file that cannot be read as a chat is reported and skipped so a
 * single hand-edit accident cannot take the whole list down.
 */
async function scanChats(dataDir: string): Promise<ChatScan> {
  const directory = await ensureChatsDirectory(dataDir);
  const dirents = await readdir(directory, { withFileTypes: true });
  const entries: ChatEntry[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();

  for (const dirent of dirents) {
    // Directories, symlinks and every non-.jsonl file (temp files included) are ignored.
    if (!dirent.isFile()) continue;
    const file = dirent.name;
    if (!isChatFileName(file)) continue;
    const path = join(directory, file);

    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      unreadable.push(file);
      console.warn(`chat file ${file} could not be read and was skipped: ${String(error)}`);
      continue;
    }

    let parsed: { record: ChatRecord; skipped: ChatSkip[] };
    try {
      parsed = parseChatRecord(text, { lenient: true });
    } catch (error) {
      unreadable.push(file);
      console.warn(`chat file ${file} could not be parsed and was skipped: ${String(error)}`);
      continue;
    }

    if (!parsed || !isRecord(parsed.record) || !isUsableHeader(parsed.record.header) || !Array.isArray(parsed.record.messages)) {
      unreadable.push(file);
      console.warn(`chat file ${file} has an unusable header and was skipped`);
      continue;
    }

    if (seen.has(parsed.record.header.id)) {
      unreadable.push(file);
      console.warn(`chat file ${file} repeats chat id ${JSON.stringify(parsed.record.header.id)} and was skipped`);
      continue;
    }
    seen.add(parsed.record.header.id);

    entries.push({
      summary: summarize(parsed.record, file, path, Buffer.byteLength(text, 'utf8')),
      record: parsed.record,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : []
    });
  }

  entries.sort((left, right) => {
    const byUpdated = compareDescending(
      timestampValue(left.summary.updatedAt),
      timestampValue(right.summary.updatedAt)
    );
    if (byUpdated !== 0) return byUpdated;
    const byCreated = compareDescending(
      timestampValue(left.summary.createdAt),
      timestampValue(right.summary.createdAt)
    );
    if (byCreated !== 0) return byCreated;
    return left.summary.file < right.summary.file ? -1 : left.summary.file > right.summary.file ? 1 : 0;
  });

  return { directory, entries, unreadable };
}

function requireEntry(scan: ChatScan, id: string, operation: string): ChatEntry {
  if (!isSafeId(id)) throw new ChatNotFoundError(operation, String(id));
  const entry = scan.entries.find((candidate) => candidate.summary.id === id);
  if (!entry) throw new ChatNotFoundError(operation, id);
  return entry;
}

/** Every saved chat, newest `updatedAt` first. */
export async function listChats(dataDir: string): Promise<ChatSummary[]> {
  const scan = await scanChats(dataDir);
  return scan.entries.map((entry) => entry.summary);
}

/**
 * Loads one chat by id. `skipped` carries the lines a lenient parse dropped so
 * the caller can tell the operator what their hand-edit cost them.
 */
export async function readChat(
  dataDir: string,
  id: string
): Promise<{ record: ChatRecord; skipped: ChatSkip[]; path: string }> {
  const scan = await scanChats(dataDir);
  const entry = requireEntry(scan, id, 'readChat');
  return { record: entry.record, skipped: entry.skipped, path: entry.summary.path };
}

function requireWritableRecord(record: ChatRecord, operation: string): void {
  if (!isRecord(record) || !isRecord((record as { header?: unknown }).header)) {
    throw failure(operation, 'unknown', 'the chat record has no header');
  }
  if (!isSafeId(record.header.id)) {
    throw failure(operation, String(record.header.id), 'the chat id is not usable as a chat id');
  }
  if (record.header.spec !== CHAT_RECORD_SPEC) {
    throw failure(operation, record.header.id, `the chat record spec must be ${CHAT_RECORD_SPEC}`);
  }
  if (typeof record.header.title !== 'string' || record.header.title.trim().length === 0) {
    throw failure(operation, record.header.id, 'the chat title is empty');
  }
  if (!Array.isArray(record.messages)) {
    throw failure(operation, record.header.id, 'the chat messages are not a list');
  }
}

/**
 * Writes a chat by streaming it into a temp file in the same directory and
 * renaming it over the target, so an interrupted write can never truncate a
 * saved chat. When the title changed the file name changes with it: the new
 * file lands first and only then is the stale file removed.
 */
export async function writeChat(dataDir: string, record: ChatRecord): Promise<ChatSummary> {
  const operation = 'writeChat';
  requireWritableRecord(record, operation);
  const id = record.header.id;

  const scan = await scanChats(dataDir);
  const existing = scan.entries.find((candidate) => candidate.summary.id === id) ?? null;
  const file = chatFileNameFor(record.header, operation);
  const path = join(scan.directory, file);

  const occupant = scan.entries.find((candidate) => candidate.summary.file === file);
  if (occupant && occupant.summary.id !== id) {
    throw failure(
      operation,
      id,
      `the file ${file} already holds chat ${JSON.stringify(occupant.summary.id)} and will not be overwritten`
    );
  }
  if (scan.unreadable.includes(file)) {
    throw failure(operation, id, `the file ${file} could not be read and will not be overwritten`);
  }

  let text: string;
  try {
    text = serializeChatRecord(record);
  } catch (error) {
    throw failure(operation, id, `the chat record is not serializable: ${String(error)}`);
  }
  if (typeof text !== 'string') {
    throw failure(operation, id, 'the chat record module did not serialize the record to text');
  }

  const temporaryPath = join(scan.directory, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw failure(operation, id, `the chat could not be written: ${String(error)}`);
  }

  if (existing && existing.summary.path !== path) {
    // The replacement is already in place, so losing this removal costs a stale
    // duplicate, never the chat itself.
    await unlink(existing.summary.path).catch(() => {});
  }

  return summarize(record, file, path, Buffer.byteLength(text, 'utf8'));
}

/** Retitles a chat, which also renames its file. */
export async function renameChat(
  dataDir: string,
  id: string,
  title: string,
  now: string
): Promise<ChatSummary> {
  const operation = 'renameChat';
  const scan = await scanChats(dataDir);
  const entry = requireEntry(scan, id, operation);
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw failure(operation, id, 'the new chat title is empty');
  }
  if (typeof now !== 'string' || now.length === 0) {
    throw failure(operation, id, 'the timestamp is empty');
  }
  const record: ChatRecord = {
    header: { ...entry.record.header, title, updatedAt: now },
    messages: entry.record.messages.map((message) => ({ ...message }))
  };
  return writeChat(dataDir, record);
}

/** Removes exactly one file. Nothing recursive, and no directory is removed. */
export async function deleteChat(dataDir: string, id: string): Promise<void> {
  const operation = 'deleteChat';
  const scan = await scanChats(dataDir);
  const entry = requireEntry(scan, id, operation);
  try {
    await unlink(entry.summary.path);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') throw new ChatNotFoundError(operation, id);
    throw failure(operation, id, `the chat file could not be removed: ${String(error)}`);
  }
}

/**
 * Copies a chat under a new id and a ` (copy)` title. The copy is a new chat as
 * of `now`; the original is not touched.
 */
export async function duplicateChat(
  dataDir: string,
  id: string,
  newId: string,
  now: string
): Promise<ChatSummary> {
  const operation = 'duplicateChat';
  const scan = await scanChats(dataDir);
  const entry = requireEntry(scan, id, operation);
  if (!isSafeId(newId)) throw failure(operation, id, 'the new chat id is not usable as a chat id');
  if (newId === id) throw failure(operation, id, 'the new chat id repeats the id being copied');
  if (scan.entries.some((candidate) => candidate.summary.id === newId)) {
    throw failure(operation, id, `chat ${JSON.stringify(newId)} already exists`);
  }
  if (typeof now !== 'string' || now.length === 0) throw failure(operation, id, 'the timestamp is empty');

  const record: ChatRecord = {
    header: {
      ...entry.record.header,
      id: newId,
      title: `${entry.record.header.title} (copy)`,
      createdAt: now,
      updatedAt: now
    },
    messages: entry.record.messages.map((message) => ({ ...message }))
  };
  return writeChat(dataDir, record);
}

/**
 * Takes a chat file the operator supplied, parses it leniently so a damaged
 * line costs one message rather than the whole import, and saves it as a new
 * chat. The dropped lines come back so the caller can say what was lost.
 */
export async function importChat(
  dataDir: string,
  text: string,
  newId: string,
  now: string
): Promise<{ summary: ChatSummary; skipped: ChatSkip[] }> {
  const operation = 'importChat';
  if (!isSafeId(newId)) throw failure(operation, String(newId), 'the new chat id is not usable as a chat id');
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw failure(operation, newId, 'the imported chat is empty');
  }
  if (typeof now !== 'string' || now.length === 0) throw failure(operation, newId, 'the timestamp is empty');

  let parsed: { record: ChatRecord; skipped: ChatSkip[] };
  try {
    parsed = parseChatRecord(text, { lenient: true });
  } catch (error) {
    throw failure(operation, newId, `the imported chat could not be parsed: ${String(error)}`);
  }
  if (!parsed || !isRecord(parsed.record) || !isRecord(parsed.record.header)) {
    throw failure(operation, newId, 'the imported chat has no header');
  }

  const scan = await scanChats(dataDir);
  if (scan.entries.some((candidate) => candidate.summary.id === newId)) {
    throw failure(operation, newId, `chat ${JSON.stringify(newId)} already exists`);
  }

  const header = parsed.record.header;
  const record: ChatRecord = {
    header: {
      spec: CHAT_RECORD_SPEC,
      id: newId,
      title: typeof header.title === 'string' && header.title.trim().length > 0 ? header.title : 'Imported chat',
      card: typeof header.card === 'string' ? header.card : '',
      starter: typeof header.starter === 'string' ? header.starter : '',
      createdAt: now,
      updatedAt: now
    },
    messages: Array.isArray(parsed.record.messages) ? parsed.record.messages.map((message) => ({ ...message })) : []
  };

  const summary = await writeChat(dataDir, record);
  return { summary, skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [] };
}
