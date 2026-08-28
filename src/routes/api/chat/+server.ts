import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runtime } from '$lib/server/runtime';

type Role = 'system' | 'user' | 'assistant';
type ChatMessage = { role: Role; content: string };

const roles = new Set<Role>(['system', 'user', 'assistant']);

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw error(400, 'messages must contain between 1 and 200 items');
  }

  return value.map((candidate, index) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('role' in candidate) ||
      !roles.has(candidate.role as Role) ||
      !('content' in candidate) ||
      typeof candidate.content !== 'string' ||
      candidate.content.trim().length === 0 ||
      candidate.content.length > 100_000
    ) {
      throw error(400, `invalid message at index ${index}`);
    }

    return {
      role: candidate.role as Role,
      content: candidate.content
    };
  });
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  const messages = validateMessages(body?.messages);

  let upstream: Response;
  try {
    upstream = await fetch(`${runtime.modelBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: runtime.modelId,
        messages,
        stream: true,
        max_tokens: runtime.maxTokens,
        temperature: runtime.temperature
      }),
      signal: request.signal
    });
  } catch (cause) {
    console.error('model connection failed', cause);
    throw error(502, 'The local model endpoint is unavailable.');
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error('model request failed', upstream.status, detail);
    throw error(502, `The local model rejected the request (${upstream.status}).`);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};

