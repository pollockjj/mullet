import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ChatNotFoundError, duplicateChat } from '$lib/server/chat-files';
import { runtime } from '$lib/server/runtime';

export const POST: RequestHandler = async ({ params }) => {
  try {
    return json({ summary: await duplicateChat(runtime.dataDir, params.id, crypto.randomUUID(), new Date().toISOString()) });
  } catch (cause) {
    if (cause instanceof ChatNotFoundError) throw error(404, cause.message);
    console.error('chat duplicate failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be duplicated.');
  }
};
