import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeChatHeader, normalizeChatMessage, type ChatRecord } from '$lib/chat-record';
import { chatsDirectory, listChats, writeChat } from '$lib/server/chat-files';
import { runtime } from '$lib/server/runtime';

const BODY_LIMIT_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The record arrives from the operator's own browser, but it is still normalized field by
// field before it is written: a saved chat is a file they will later open by hand, and a
// malformed one is worse than a rejected save.
function chatRecordFromBody(value: unknown): ChatRecord {
  if (!isRecord(value) || !isRecord(value.header) || !Array.isArray(value.messages)) {
    throw error(400, 'chat record must carry a header and a message list');
  }
  try {
    return {
      header: normalizeChatHeader(value.header),
      messages: value.messages.map(normalizeChatMessage)
    };
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'chat record is invalid');
  }
}

export const GET: RequestHandler = async () => {
  try {
    const chats = await listChats(runtime.dataDir);
    return json({ chats, directory: chatsDirectory(runtime.dataDir) }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('chat listing failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The saved chats could not be listed.');
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) {
    await request.text().catch(() => undefined);
    throw error(413, 'chat record is too large');
  }
  const body = await request.json().catch(() => null);
  const record = chatRecordFromBody(isRecord(body) ? body.record : null);
  try {
    return json({ summary: await writeChat(runtime.dataDir, record) });
  } catch (cause) {
    console.error('chat save failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be saved.');
  }
};
