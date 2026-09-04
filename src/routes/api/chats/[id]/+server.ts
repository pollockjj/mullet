import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ChatNotFoundError, deleteChat, readChat, renameChat } from '$lib/server/chat-files';
import { runtime } from '$lib/server/runtime';

function nowIso(): string {
  return new Date().toISOString();
}

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { record, skipped, path } = await readChat(runtime.dataDir, params.id);
    // `skipped` carries any line a hand-edit broke, so the operator is told rather than
    // silently losing it.
    return json({ record, skipped, path }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ChatNotFoundError) throw error(404, cause.message);
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('chat read failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be read.');
  }
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null);
  const title = body && typeof body === 'object' && 'title' in body ? (body as { title: unknown }).title : null;
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
    throw error(400, 'chat title must be between 1 and 200 characters');
  }
  try {
    return json({ summary: await renameChat(runtime.dataDir, params.id, title.trim(), nowIso()) });
  } catch (cause) {
    if (cause instanceof ChatNotFoundError) throw error(404, cause.message);
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('chat rename failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be renamed.');
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    await deleteChat(runtime.dataDir, params.id);
    return new Response(null, { status: 204 });
  } catch (cause) {
    if (cause instanceof ChatNotFoundError) throw error(404, cause.message);
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('chat delete failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be deleted.');
  }
};
