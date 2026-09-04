// Saved chat transcripts as files the operator can open, hand-edit, copy and delete.
//
// The on-disk format is JSONL: line 1 is the header, every later line is one message.
// That shape is chosen for the editor, not for us — a human can delete a message by
// deleting a line, and a half-written line damages only itself. So the parser is
// lenient by default: a bad message line is skipped and reported, never fatal. Only a
// missing or invalid header is fatal, because without it the file is not a transcript.
//
// This module is the format layer alone: no filesystem, no fetch, no Node APIs.

export const CHAT_RECORD_SPEC = 'mullet_chat_v1' as const;
export const CHAT_MAX_MESSAGES = 10_000 as const;
export const CHAT_MAX_CONTENT_CHARS = 200_000 as const;

const CHAT_TITLE_MAX_CHARS = 200 as const;
const CHAT_SLUG_MAX_CHARS = 60 as const;
const CHAT_DERIVED_TITLE_MAX_CHARS = 60 as const;
const DEFAULT_CHAT_TITLE = 'New chat' as const;
const DEFAULT_CHAT_SLUG = 'chat' as const;

export type ChatHeader = {
  spec: typeof CHAT_RECORD_SPEC;
  id: string;
  title: string;
  card: string;
  starter: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: string;
};

export type ChatRecord = {
  header: ChatHeader;
  messages: ChatMessage[];
};

export type SkippedChatLine = {
  line: number;
  reason: string;
};

const HEADER_FIELDS = ['spec', 'id', 'title', 'card', 'starter', 'createdAt', 'updatedAt'] as const;
const HEADER_FIELD_SET: ReadonlySet<string> = new Set<string>(HEADER_FIELDS);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

// Windows refuses these as file names with or without an extension, so a title that
// slugs down to one of them must not become the whole name.
const RESERVED_FILE_STEMS: ReadonlySet<string> = new Set<string>([
  'con', 'prn', 'aux', 'nul',
  'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

// Date.parse is no help here: V8 rolls 2026-02-30 forward to March instead of
// rejecting it, so the calendar is checked by hand.
function isIsoTimestamp(value: unknown): value is string {
  const match = typeof value === 'string' ? ISO_TIMESTAMP_PATTERN.exec(value) : null;
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const months = Number(month);
  const days = Number(day);
  if (months < 1 || months > 12) return false;
  if (days < 1 || days > daysInMonth(Number(year), months)) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function isoTimestamp(value: unknown, name: string): string {
  if (!isIsoTimestamp(value)) throw new Error(`${name} must be an ISO-8601 timestamp`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate one header object. Strict: unknown or missing fields are rejected. */
export function normalizeChatHeader(value: unknown): ChatHeader {
  if (!isRecord(value)) throw new Error('chat header must be a JSON object');
  for (const key of Object.keys(value)) {
    if (!HEADER_FIELD_SET.has(key)) throw new Error(`chat header has an unknown field "${key}"`);
  }
  for (const field of HEADER_FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`chat header is missing "${field}"`);
  }
  const { spec, id, title, card, starter, createdAt, updatedAt } = value;
  if (spec !== CHAT_RECORD_SPEC) throw new Error(`chat header spec must be "${CHAT_RECORD_SPEC}"`);
  if (!isUuid(id)) throw new Error('chat header id must be a UUID');
  if (typeof title !== 'string' || title.length < 1 || title.length > CHAT_TITLE_MAX_CHARS) {
    throw new Error(`chat header title must be a string of 1 to ${CHAT_TITLE_MAX_CHARS} characters`);
  }
  if (typeof card !== 'string') throw new Error('chat header card must be a string');
  if (typeof starter !== 'string') throw new Error('chat header starter must be a string');
  return {
    spec: CHAT_RECORD_SPEC,
    id,
    title,
    card,
    starter,
    createdAt: isoTimestamp(createdAt, 'chat header createdAt'),
    updatedAt: isoTimestamp(updatedAt, 'chat header updatedAt')
  };
}

/** Validate one message object. Tolerant: unknown fields are dropped, not rejected. */
export function normalizeChatMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) throw new Error('chat message must be a JSON object');
  const { role, content, at } = value;
  if (role !== 'user' && role !== 'assistant') {
    throw new Error('chat message role must be "user" or "assistant"');
  }
  if (typeof content !== 'string') throw new Error('chat message content must be a string');
  if (content.length > CHAT_MAX_CONTENT_CHARS) {
    throw new Error(`chat message content must be at most ${CHAT_MAX_CONTENT_CHARS} characters`);
  }
  return { role, content, at: isoTimestamp(at, 'chat message at') };
}

export function serializeChatRecord(record: ChatRecord): string {
  if (!isRecord(record)) throw new Error('chat record must be an object');
  const header = normalizeChatHeader(record.header);
  const { messages } = record;
  if (!Array.isArray(messages)) throw new Error('chat record messages must be an array');
  if (messages.length > CHAT_MAX_MESSAGES) {
    throw new Error(`chat record must contain at most ${CHAT_MAX_MESSAGES} messages`);
  }
  const lines = [JSON.stringify(header)];
  for (const message of messages) lines.push(JSON.stringify(normalizeChatMessage(message)));
  return `${lines.join('\n')}\n`;
}

export function parseChatRecord(
  text: string,
  options: { lenient?: boolean } = {}
): { record: ChatRecord; skipped: SkippedChatLine[] } {
  if (typeof text !== 'string') throw new Error('chat record text must be a string');
  const lenient = options?.lenient !== false;
  const lines = text.split(/\r?\n/);
  const skipped: SkippedChatLine[] = [];
  const messages: ChatMessage[] = [];
  let header: ChatHeader | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    if (line.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (header === null) {
        throw new Error(`chat header on line ${lineNumber} is not valid JSON`);
      }
      if (!lenient) throw new Error(`chat record line ${lineNumber} is not valid JSON`);
      skipped.push({ line: lineNumber, reason: 'not valid JSON' });
      continue;
    }

    if (header === null) {
      header = normalizeChatHeader(parsed);
      continue;
    }

    try {
      messages.push(normalizeChatMessage(parsed));
    } catch (error) {
      if (!lenient) throw new Error(`chat record line ${lineNumber}: ${errorMessage(error)}`);
      skipped.push({ line: lineNumber, reason: errorMessage(error) });
      continue;
    }
    if (messages.length > CHAT_MAX_MESSAGES) {
      throw new Error(`chat record must contain at most ${CHAT_MAX_MESSAGES} messages`);
    }
  }

  if (header === null) throw new Error('chat record is missing its header line');
  return { record: { header, messages }, skipped };
}

export function chatFileName(header: Pick<ChatHeader, 'id' | 'title'>): string {
  if (!isRecord(header)) throw new Error('chat file name needs a header object');
  const { id, title } = header;
  if (!isUuid(id)) throw new Error('chat header id must be a UUID');
  const slug = (typeof title === 'string' ? title : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHAT_SLUG_MAX_CHARS)
    .replace(/-+$/, '');
  const stem = slug === ''
    ? DEFAULT_CHAT_SLUG
    : (RESERVED_FILE_STEMS.has(slug) ? `${slug}-${DEFAULT_CHAT_SLUG}` : slug);
  return `${stem}-${id.slice(0, 8).toLowerCase()}.jsonl`;
}

export function chatTitleFromMessages(messages: readonly ChatMessage[], fallback: string): string {
  const list: readonly unknown[] = Array.isArray(messages) ? messages : [];
  for (const message of list) {
    if (!isRecord(message) || message.role !== 'user' || typeof message.content !== 'string') continue;
    const collapsed = message.content.replace(/\s+/g, ' ').trim();
    if (collapsed === '') continue;
    if (collapsed.length <= CHAT_DERIVED_TITLE_MAX_CHARS) return collapsed;
    const head = collapsed.slice(0, CHAT_DERIVED_TITLE_MAX_CHARS);
    const boundary = head.lastIndexOf(' ');
    return (boundary > 0 ? head.slice(0, boundary) : head).trimEnd();
  }
  return fallback;
}

export function newChatHeader(input: {
  id: string;
  title?: string;
  card?: string;
  starter?: string;
  now: string;
}): ChatHeader {
  if (!isRecord(input)) throw new Error('new chat header needs an input object');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  return normalizeChatHeader({
    spec: CHAT_RECORD_SPEC,
    id: input.id,
    title: title === '' ? DEFAULT_CHAT_TITLE : title,
    card: typeof input.card === 'string' ? input.card : '',
    starter: typeof input.starter === 'string' ? input.starter : '',
    createdAt: input.now,
    updatedAt: input.now
  });
}
