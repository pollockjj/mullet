import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importChat } from '$lib/server/chat-files';
import { runtime } from '$lib/server/runtime';

const IMPORT_LIMIT_BYTES = 8 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMPORT_LIMIT_BYTES) {
    await request.text().catch(() => undefined);
    throw error(413, 'imported chat is too large');
  }
  const text = await request.text().catch(() => '');
  if (text.trim().length < 1) throw error(400, 'imported chat is empty');
  try {
    const { summary, skipped } = await importChat(runtime.dataDir, text, crypto.randomUUID(), new Date().toISOString());
    return json({ summary, skipped });
  } catch (cause) {
    console.error('chat import failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(400, cause instanceof Error ? cause.message : 'The chat could not be imported.');
  }
};
