import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runtime } from '$lib/server/runtime';
import { countModelTokens, getModelContextTokens } from '$lib/server/model-tokenizer';
import { RegexSandbox } from '$lib/server/regex-sandbox';
import { prependSseMetadata } from '$lib/server/sse-metadata';
import { resolveTokenLimit } from '$lib/token-limit';
import {
  characterDepthPrompt,
  compileCharacterMessages,
  normalizeCharacterCard,
  type ChatMessage,
  type ImportedCharacterCard
} from '$lib/character-card';
import {
  combineLorebooks,
  compileUnboundLoreMessages,
  injectLoreContext,
  lorePromptContextTokens,
  normalizeLorebook,
  resolveLorebookSettings,
  scanLorebooks,
  type ImportedLorebook,
  type LoreScanResult
} from '$lib/lorebook';
import { isScenarioCard } from '$lib/scenario';
import { assertChatRequestTextSize } from '$lib/chat-request-size';

type Role = 'system' | 'user' | 'assistant';

const roles = new Set<Role>(['system', 'user', 'assistant']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw error(400, 'messages must contain between 1 and 1000 items');
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

function validateStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100 || !value.every((item) => typeof item === 'string' && item.length <= 500)) {
    throw error(400, `${name} must be an array of at most 100 strings, each at most 500 characters`);
  }
  return value;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const requestText = await request.text();
  try {
    assertChatRequestTextSize(requestText);
  } catch (cause) {
    throw error(413, cause instanceof Error ? cause.message : 'chat request is too large');
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(requestText);
    if (!isRecord(parsed)) throw new Error('request body must be a JSON object');
    body = parsed;
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'request body must be JSON');
  }
  const messages = validateMessages(body?.messages);
  let characterCard: ImportedCharacterCard | null = null;
  let upstreamMessages = messages;
  let loreResult: LoreScanResult | null = null;
  const userName = body?.userName === undefined ? 'You' : body.userName;
  if (typeof userName !== 'string' || userName.trim().length === 0 || userName.length > 100) {
    throw error(400, 'userName must be a non-empty string of at most 100 characters');
  }
  const personaDescription = body?.personaDescription ?? '';
  if (typeof personaDescription !== 'string' || personaDescription.length > 100_000) {
    throw error(400, 'personaDescription must be a string of at most 100000 characters');
  }
  const characterFilterNames = validateStringArray(body?.characterFilterNames, 'characterFilterNames');
  const characterTagIds = validateStringArray(body?.characterTagIds, 'characterTagIds');
  let tokenLimit: number;
  try {
    tokenLimit = resolveTokenLimit(body?.maxTokens, runtime.maxTokens, runtime.defaultMaxTokens);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid maxTokens');
  }

  if (body?.characterCard !== undefined && body.characterCard !== null) {
    try {
      characterCard = normalizeCharacterCard(body.characterCard);
    } catch (cause) {
      throw error(400, cause instanceof Error ? cause.message : 'invalid character card');
    }

  }

  const loreEnabled = body?.loreEnabled === undefined ? true : body.loreEnabled;
  if (typeof loreEnabled !== 'boolean') throw error(400, 'loreEnabled must be boolean');
  if (loreEnabled) {
    const requestedLorebooks = body?.lorebooks ?? [];
    if (!Array.isArray(requestedLorebooks) || requestedLorebooks.length > 20) {
      throw error(400, 'lorebooks must be an array containing at most 20 books');
    }
    const importedBooks: ImportedLorebook[] = [];
    try {
      requestedLorebooks.forEach((candidate: unknown, index: number) => {
        if (!isRecord(candidate)) throw new Error(`invalid lorebook at index ${index}`);
        const name = typeof candidate.name === 'string' ? candidate.name : `Lorebook ${index + 1}`;
        importedBooks.push(normalizeLorebook(candidate.raw ?? candidate, name, 'imported'));
      });
      const embeddedBook = characterCard?.data.characterBook
        ? normalizeLorebook(characterCard.data.characterBook, `${characterCard.data.name} lore`, 'embedded')
        : null;
      const books = combineLorebooks(embeddedBook, importedBooks, isScenarioCard(characterCard));
      if (books.reduce((total, book) => total + book.entries.length, 0) > 20_000) {
        throw new Error('active lorebooks may contain at most 20000 entries');
      }
      if (books.length) {
        const modelContextTokens = await getModelContextTokens(fetch, runtime.modelBaseUrl, runtime.modelId, request.signal);
        const loreSettings = resolveLorebookSettings(
          body.lorebookSettings,
          lorePromptContextTokens(modelContextTokens, tokenLimit)
        );
        const regexSandbox = new RegexSandbox();
        try {
          loreResult = await scanLorebooks(books, messages, loreSettings, {
            card: characterCard,
            userName: userName.trim(),
            assistantName: runtime.modelId,
            personaDescription,
            characterDepthPrompt: characterCard ? characterDepthPrompt(characterCard, userName.trim())?.content ?? '' : '',
            characterFilterNames,
            characterTags: characterTagIds,
            timedState: body?.loreTimedState,
            tokenCount: (content) => countModelTokens(fetch, runtime.modelBaseUrl, content, request.signal),
            regexTest: (source, flags, haystack) => regexSandbox.test(source, flags, haystack),
            generationTrigger: 'normal'
          });
        } finally {
          await regexSandbox.dispose();
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'invalid lorebooks';
      if (/model (?:metadata|tokenizer)/.test(message)) {
        console.error('model tokenization failed', cause);
        throw error(502, 'The local model tokenizer is unavailable.');
      }
      throw error(400, message);
    }
    }

  if (characterCard) {
    const history = loreResult ? injectLoreContext(messages, loreResult) : messages;
    upstreamMessages = compileCharacterMessages(characterCard, history, userName.trim(), loreResult ?? {});
  } else if (loreResult) {
    upstreamMessages = compileUnboundLoreMessages(messages, loreResult);
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
    'x-mullet-token-limit': String(tokenLimit),
    'x-mullet-mode': 'fiction'
  };
  if (characterCard) {
    headers['x-mullet-character'] = encodeURIComponent(characterCard.data.name);
    headers['x-mullet-card-spec'] = `${characterCard.spec}@${characterCard.specVersion}`;
  }
  if (loreResult) {
    const headerEntries = loreResult.activated.slice(0, 10).map((entry) => ({
      book: entry.book.slice(0, 80),
      entryId: entry.entryId.slice(0, 40),
      name: entry.name.slice(0, 80)
    }));
    headers['x-mullet-lore-active'] = String(loreResult.activated.length);
    headers['x-mullet-lore-skipped'] = String(loreResult.skipped.length);
    headers['x-mullet-lore-budget'] = String(loreResult.budgetTokens);
    headers['x-mullet-lore-tokens'] = String(loreResult.usedTokens);
    headers['x-mullet-lore-entries'] = encodeURIComponent(JSON.stringify(headerEntries));
    headers['x-mullet-lore-sticky'] = String(Object.keys(loreResult.timedState.sticky).length);
    headers['x-mullet-lore-cooldown'] = String(Object.keys(loreResult.timedState.cooldown).length);
  }

  const responseBody = loreResult
    ? prependSseMetadata(upstream.body, { loreTimedState: loreResult.timedState })
    : upstream.body;
  return new Response(responseBody, {
    status: 200,
    headers
  });
};
