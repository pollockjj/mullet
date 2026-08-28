import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  ASSISTANT_MEMORY_MAX_TOKENS,
  ASSISTANT_MEMORY_SYSTEM_PROMPT,
  ASSISTANT_MEMORY_TIMEOUT_MS,
  assistantMemoryModelInput,
  createAssistantMemoryResult,
  normalizeAssistantMemoryRequest,
  parseAssistantMemoryResponse
} from '$lib/assistant-memory';
import { runSidecarCompletion } from '$lib/server/sidecar-model';
import { runtime } from '$lib/server/runtime';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let memoryRequest;
  try {
    memoryRequest = normalizeAssistantMemoryRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid assistant-memory request');
  }

  try {
    const completion = await runSidecarCompletion(fetch, {
      baseUrl: runtime.modelBaseUrl,
      model: runtime.modelId,
      systemPrompt: ASSISTANT_MEMORY_SYSTEM_PROMPT,
      input: assistantMemoryModelInput(memoryRequest),
      maxTokens: ASSISTANT_MEMORY_MAX_TOKENS,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(ASSISTANT_MEMORY_TIMEOUT_MS)])
    });
    const operations = parseAssistantMemoryResponse(completion, memoryRequest);
    return json(createAssistantMemoryResult(memoryRequest, runtime.modelId, operations), {
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('assistant-memory sidecar failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The assistant-memory sidecar failed to update durable memory.');
  }
};
