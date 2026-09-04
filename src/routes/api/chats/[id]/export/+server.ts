import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serializeChatRecord } from '$lib/chat-record';
import { ChatNotFoundError, readChat } from '$lib/server/chat-files';
import { runtime } from '$lib/server/runtime';

// The same bytes that are on disk, handed back as a download.
export const GET: RequestHandler = async ({ params }) => {
  try {
    const { record, path } = await readChat(runtime.dataDir, params.id);
    const name = path.split('/').at(-1) ?? `${record.header.id}.jsonl`;
    return new Response(serializeChatRecord(record), {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (cause) {
    if (cause instanceof ChatNotFoundError) throw error(404, cause.message);
    console.error('chat export failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(500, 'The chat could not be exported.');
  }
};
