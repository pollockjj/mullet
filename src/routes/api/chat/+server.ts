import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runtime } from '$lib/server/runtime';
import { resolveTokenLimit } from '$lib/token-limit';
import {
  compileCharacterMessages,
  normalizeCharacterCard,
  type ChatMessage,
  type ImportedCharacterCard
} from '$lib/character-card';

type Role = 'system' | 'user' | 'assistant';

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
  let characterCard: ImportedCharacterCard | null = null;
  let upstreamMessages = messages;

  if (body?.characterCard !== undefined && body.characterCard !== null) {
    try {
      characterCard = normalizeCharacterCard(body.characterCard);
    } catch (cause) {
      throw error(400, cause instanceof Error ? cause.message : 'invalid character card');
    }

    const userName = body?.userName === undefined ? 'You' : body.userName;
    if (typeof userName !== 'string' || userName.trim().length === 0 || userName.length > 100) {
      throw error(400, 'userName must be a non-empty string of at most 100 characters');
    }
    upstreamMessages = compileCharacterMessages(characterCard, messages, userName.trim());
  }
  let tokenLimit: number;
  try {
    tokenLimit = resolveTokenLimit(body?.maxTokens, runtime.maxTokens, runtime.defaultMaxTokens);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid maxTokens');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${runtime.modelBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: runtime.modelId,
        messages: upstreamMessages,
        stream: true,
        max_tokens: tokenLimit,
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

  const headers: Record<string, string> = {
    'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-mullet-token-limit': String(tokenLimit)
  };
  if (characterCard) {
    headers['x-mullet-character'] = encodeURIComponent(characterCard.data.name);
    headers['x-mullet-card-spec'] = `${characterCard.spec}@${characterCard.specVersion}`;
  }

  return new Response(upstream.body, {
    status: 200,
    headers
  });
};
