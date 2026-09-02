import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  INLINE_SCENE_SYSTEM_PROMPT,
  INLINE_SCENE_TIMEOUT_MS,
  createInlineSceneResult,
  normalizeInlineSceneRequest,
  parseInlineSceneResponse
} from '$lib/inline-scene';
import { runSidecarCompletion } from '$lib/server/sidecar-model';
import { runtime } from '$lib/server/runtime';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => {
    throw error(400, 'request body must be JSON');
  });
  let sceneRequest;
  try {
    sceneRequest = normalizeInlineSceneRequest(body);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'invalid inline-scene request');
  }

  try {
    const completion = await runSidecarCompletion(fetch, {
      baseUrl: runtime.modelBaseUrl,
      model: runtime.modelId,
      systemPrompt: INLINE_SCENE_SYSTEM_PROMPT,
      input: JSON.stringify({ candidates: sceneRequest.candidates, turns: sceneRequest.turns }),
      maxTokens: 384,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(INLINE_SCENE_TIMEOUT_MS)])
    });
    let direction;
    try {
      direction = parseInlineSceneResponse(completion, sceneRequest.candidates);
    } catch (cause) {
      console.error('inline-scene sidecar raw text:', String(completion).slice(0, 400).replace(/\s+/g, ' '));
      throw cause;
    }
    return json(createInlineSceneResult(sceneRequest, runtime.modelId, direction), {
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('inline-scene sidecar failed', cause instanceof Error ? cause.message : 'unknown failure');
    throw error(502, 'The inline-scene sidecar failed to direct the latest response.');
  }
};
