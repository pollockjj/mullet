import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  EXPRESSION_CLASSIFIER_PROMPT,
  SIDECAR_TIMEOUT_MS,
  cleanExpressionInput,
  createExpressionSidecarResult,
  normalizeExpressionSidecarRequest,
  parseExpressionResponse
} from '$lib/sidecar';
import { runSidecarCompletion } from '$lib/server/sidecar-model';
import { runtime } from '$lib/server/runtime';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let sidecarRequest;
  try {
    sidecarRequest = normalizeExpressionSidecarRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid sidecar request');
  }

  try {
    const completion = await runSidecarCompletion(fetch, {
      baseUrl: runtime.modelBaseUrl,
      model: runtime.modelId,
      systemPrompt: EXPRESSION_CLASSIFIER_PROMPT,
      input: cleanExpressionInput(sidecarRequest.text),
      maxTokens: 64,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(SIDECAR_TIMEOUT_MS)])
    });
    const expression = parseExpressionResponse(completion);
    return json(createExpressionSidecarResult(sidecarRequest, runtime.modelId, expression), {
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('expression sidecar failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The expression sidecar failed to classify the latest response.');
  }
};
