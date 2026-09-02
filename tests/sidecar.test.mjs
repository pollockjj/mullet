import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expressionResponseWasRecognized,
  EXPRESSION_CLASSIFIER_PROMPT,
  EXPRESSION_LABELS,
  SIDECAR_TIMEOUT_MS,
  ST_EXPRESSION_SOURCE_REVISION,
  buildExpressionSidecarRequest,
  cleanExpressionInput,
  createExpressionSidecarResult,
  emptySidecarState,
  expressionResultMatchesRequest,
  normalizeExpressionSidecarRequest,
  normalizeSidecarState,
  parseExpressionResponse,
  withExpressionSidecarResult
} from '../src/lib/sidecar.ts';
import { runSidecarCompletion } from '../src/lib/server/sidecar-model.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';

test('pins the current SillyTavern staging expression vocabulary and prompt', () => {
  assert.equal(ST_EXPRESSION_SOURCE_REVISION, '30eaf26a438fd629e43492bfe82f05d976766208');
  assert.equal(SIDECAR_TIMEOUT_MS, 30_000);
  assert.deepEqual(EXPRESSION_LABELS, [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity',
    'desire', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
    'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief',
    'remorse', 'sadness', 'surprise', 'neutral'
  ]);
  assert.match(EXPRESSION_CLASSIFIER_PROMPT, /^Ignore previous instructions\. Classify the emotion/);
  assert.match(EXPRESSION_CLASSIFIER_PROMPT, /"admiration", "amusement"/);
  assert.match(EXPRESSION_CLASSIFIER_PROMPT, /"surprise", "neutral"$/);
});

test('matches SillyTavern LLM input cleanup and parses one known label only', () => {
  assert.equal(cleanExpressionInput('  *He said "hello".*  '), 'He said hello.');
  assert.equal(parseExpressionResponse('grief'), 'grief');
  assert.equal(parseExpressionResponse('{"emotion":"JOY"}'), 'joy');
  assert.equal(parseExpressionResponse('<think>private reasoning</think>\nThe emotion is fear.'), 'fear');
  // Several labels: the first one stated wins. A near-miss resolves through synonyms.
  assert.equal(parseExpressionResponse('joy and anger'), 'joy');
  assert.equal(parseExpressionResponse('melancholy'), 'sadness');
});

test('validates expression sidecar snapshots against the latest assistant response', () => {
  const request = buildExpressionSidecarRequest(conversationId, [
    { role: 'user', content: 'Where are we?' },
    { role: 'assistant', content: 'Aboard the Liberator.' }
  ]);
  assert.deepEqual(normalizeExpressionSidecarRequest(request), request);
  assert.equal(request.source.messageCount, 2);
  assert.equal(request.source.messageIndex, 1);
  assert.throws(
    () => normalizeExpressionSidecarRequest({ ...request, source: { ...request.source, messageIndex: 0 } }),
    /latest message/
  );
  assert.throws(
    () => buildExpressionSidecarRequest(conversationId, [{ role: 'user', content: 'No assistant yet.' }]),
    /latest message must be/
  );
});

test('keeps sidecar work byte-identical outside the canonical transcript', () => {
  const transcript = Object.freeze([
    Object.freeze({ role: 'user', content: 'What happened?' }),
    Object.freeze({ role: 'assistant', content: 'Gan is gone.' })
  ]);
  const canonicalBefore = JSON.stringify(transcript);
  const request = buildExpressionSidecarRequest(conversationId, transcript);
  const result = createExpressionSidecarResult(request, 'gemma-4-ortenzya', parseExpressionResponse('grief'));
  const state = withExpressionSidecarResult(emptySidecarState(conversationId), result);
  assert.deepEqual(normalizeSidecarState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(expressionResultMatchesRequest(result, request), true);
  assert.equal(JSON.stringify(transcript), canonicalBefore);
  assert.equal(JSON.stringify(state).includes('Gan is gone.'), false);
});

test('sends only the fixed classifier prompt and target response to the sidecar model', async () => {
  let observedUrl = '';
  let observedBody;
  const fetcher = async (url, init) => {
    observedUrl = String(url);
    observedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'grief' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const content = await runSidecarCompletion(fetcher, {
    baseUrl: 'http://hammerhead:1234/v1/',
    model: 'gemma-4-ortenzya',
    systemPrompt: EXPRESSION_CLASSIFIER_PROMPT,
    input: 'Gan is gone.',
    maxTokens: 64
  });
  assert.equal(content, 'grief');
  assert.equal(observedUrl, 'http://hammerhead:1234/v1/chat/completions');
  assert.deepEqual(observedBody, {
    model: 'gemma-4-ortenzya',
    messages: [
      { role: 'system', content: EXPRESSION_CLASSIFIER_PROMPT },
      { role: 'user', content: 'Gan is gone.' }
    ],
    stream: false,
    max_tokens: 64,
    temperature: 0
  });
});

test('forwards cancellation to a hung sidecar model request', async () => {
  const controller = new AbortController();
  const fetcher = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  const completion = runSidecarCompletion(fetcher, {
    baseUrl: 'http://hammerhead:1234/v1',
    model: 'gemma-4-ortenzya',
    systemPrompt: EXPRESSION_CLASSIFIER_PROMPT,
    input: 'A response that never completes.',
    maxTokens: 64,
    signal: controller.signal
  });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(completion, (cause) => cause instanceof DOMException && cause.name === 'AbortError');
});

// Observed 2026-09-02 00:03 on the served build: the classifier answered off-vocabulary
// for the second turn of a session and the strict parser failed the whole turn.
test('resolves near-miss classifier answers instead of failing the turn', () => {
  assert.equal(parseExpressionResponse('The character is clearly fearful and tense.'), 'fear');
  assert.equal(parseExpressionResponse('curiosity, then surprise'), 'curiosity');
  assert.equal(parseExpressionResponse('{"emotion":"Worried"}'), 'nervousness');
  assert.equal(parseExpressionResponse('She looks focused and alert.'), 'neutral');
  assert.equal(parseExpressionResponse('no idea'), 'neutral');
  assert.equal(expressionResponseWasRecognized('no idea'), false);
  assert.equal(expressionResponseWasRecognized('fearful'), true);
});
