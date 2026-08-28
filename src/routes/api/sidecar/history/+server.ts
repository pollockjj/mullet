import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  LIVING_HISTORY_SYSTEM_PROMPT,
  LIVING_HISTORY_TIMEOUT_MS,
  createLivingHistoryResult,
  livingHistoryModelInput,
  normalizeLivingHistoryRequest,
  parseLivingHistoryResponse
} from '$lib/living-history';
import { runSidecarCompletion } from '$lib/server/sidecar-model';
import { runtime } from '$lib/server/runtime';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let historyRequest;
  try {
    historyRequest = normalizeLivingHistoryRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid living-history request');
  }

  try {
    const completion = await runSidecarCompletion(fetch, {
      baseUrl: runtime.modelBaseUrl,
      model: runtime.modelId,
      systemPrompt: LIVING_HISTORY_SYSTEM_PROMPT,
      input: livingHistoryModelInput(historyRequest),
      maxTokens: 1024,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(LIVING_HISTORY_TIMEOUT_MS)])
    });
    const summary = parseLivingHistoryResponse(completion);
    return json(createLivingHistoryResult(historyRequest, runtime.modelId, summary), {
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('living-history sidecar failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The living-history sidecar failed to update session continuity.');
  }
};
