export const SIDECAR_REQUEST_SPEC = 'mullet_sidecar_request_v1' as const;
export const SIDECAR_RESULT_SPEC = 'mullet_sidecar_result_v1' as const;
export const SIDECAR_STATE_SPEC = 'mullet_sidecar_state_v1' as const;
export const SIDECAR_TIMEOUT_MS = 30_000 as const;

export const ST_EXPRESSION_SOURCE_REVISION = '30eaf26a438fd629e43492bfe82f05d976766208' as const;

export const EXPRESSION_LABELS = Object.freeze([
  'admiration',
  'amusement',
  'anger',
  'annoyance',
  'approval',
  'caring',
  'confusion',
  'curiosity',
  'desire',
  'disappointment',
  'disapproval',
  'disgust',
  'embarrassment',
  'excitement',
  'fear',
  'gratitude',
  'grief',
  'joy',
  'love',
  'nervousness',
  'optimism',
  'pride',
  'realization',
  'relief',
  'remorse',
  'sadness',
  'surprise',
  'neutral'
] as const);

export type ExpressionLabel = (typeof EXPRESSION_LABELS)[number];

export type ExpressionSidecarRequest = {
  spec: typeof SIDECAR_REQUEST_SPEC;
  kind: 'expression';
  source: {
    conversationId: string;
    messageCount: number;
    messageIndex: number;
    role: 'assistant';
  };
  text: string;
};

export type ExpressionSidecarResult = {
  spec: typeof SIDECAR_RESULT_SPEC;
  kind: 'expression';
  source: ExpressionSidecarRequest['source'] & {
    fingerprint: string;
  };
  model: string;
  output: {
    expression: ExpressionLabel;
  };
};

export type SidecarState = {
  spec: typeof SIDECAR_STATE_SPEC;
  conversationId: string;
  channels: {
    expression?: ExpressionSidecarResult;
  };
};

type TranscriptMessage = {
  role: string;
  content: string;
};

const DEFAULT_LLM_PROMPT = 'Ignore previous instructions. Classify the emotion of the last message. Output just one word, e.g. "joy" or "anger". Choose only one of the following labels: {{labels}}';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^\d+:[0-9a-f]{8}$/;
const expressionSet = new Set<string>(EXPRESSION_LABELS);

export const EXPRESSION_CLASSIFIER_PROMPT = DEFAULT_LLM_PROMPT.replace(
  '{{labels}}',
  EXPRESSION_LABELS.map((label) => `"${label}"`).join(', ')
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

export function isSidecarConversationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isExpressionLabel(value: unknown): value is ExpressionLabel {
  return typeof value === 'string' && expressionSet.has(value);
}

export function cleanExpressionInput(text: string): string {
  return text.replace(/[*"]/g, '').trim();
}

export function expressionSourceFingerprint(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `${bytes.byteLength}:${hash.toString(16).padStart(8, '0')}`;
}

export function buildExpressionSidecarRequest(
  conversationId: string,
  messages: readonly TranscriptMessage[]
): ExpressionSidecarRequest {
  if (!isSidecarConversationId(conversationId)) throw new Error('conversationId must be a UUID');
  if (messages.length < 1 || messages.length > 1000) throw new Error('messages must contain between 1 and 1000 items');
  const messageIndex = messages.length - 1;
  const message = messages[messageIndex];
  if (message.role !== 'assistant' || typeof message.content !== 'string' || message.content.trim().length === 0) {
    throw new Error('the latest message must be a non-empty assistant response');
  }
  if (message.content.length > 100_000) throw new Error('expression source text exceeds 100000 characters');
  return {
    spec: SIDECAR_REQUEST_SPEC,
    kind: 'expression',
    source: {
      conversationId,
      messageCount: messages.length,
      messageIndex,
      role: 'assistant'
    },
    text: message.content
  };
}

export function normalizeExpressionSidecarRequest(value: unknown): ExpressionSidecarRequest {
  if (!isRecord(value)) throw new Error('sidecar request must be an object');
  if (value.spec !== SIDECAR_REQUEST_SPEC) throw new Error(`sidecar spec must be ${SIDECAR_REQUEST_SPEC}`);
  if (value.kind !== 'expression') throw new Error('sidecar kind must be expression');
  if (!isRecord(value.source)) throw new Error('sidecar source must be an object');
  if (!isSidecarConversationId(value.source.conversationId)) throw new Error('source conversationId must be a UUID');
  const messageCount = integer(value.source.messageCount, 'source messageCount', 1, 1000);
  const messageIndex = integer(value.source.messageIndex, 'source messageIndex', 0, 999);
  if (messageIndex !== messageCount - 1) throw new Error('source messageIndex must identify the latest message');
  if (value.source.role !== 'assistant') throw new Error('source role must be assistant');
  if (typeof value.text !== 'string' || value.text.trim().length === 0 || value.text.length > 100_000) {
    throw new Error('sidecar text must be a non-empty string of at most 100000 characters');
  }
  return {
    spec: SIDECAR_REQUEST_SPEC,
    kind: 'expression',
    source: {
      conversationId: value.source.conversationId,
      messageCount,
      messageIndex,
      role: 'assistant'
    },
    text: value.text
  };
}

function withoutReasoning(value: string): string {
  return value
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json|text)?\s*([\s\S]*?)```/gi, '$1')
    .trim();
}

// Near-misses the classifier actually produces. Observed 2026-09-02 00:03 on the served
// build: the second turn of a session returned an off-vocabulary word, the strict parser
// threw "unknown label", and the turn ended with no portrait and no scene.
const EXPRESSION_SYNONYMS: Readonly<Record<string, ExpressionLabel>> = Object.freeze({
  fearful: 'fear', afraid: 'fear', scared: 'fear', terrified: 'fear', frightened: 'fear', dread: 'fear', alarmed: 'fear',
  anxious: 'nervousness', nervous: 'nervousness', worried: 'nervousness', uneasy: 'nervousness', tense: 'nervousness',
  apprehensive: 'nervousness', wary: 'nervousness', cautious: 'nervousness', unsettled: 'nervousness',
  tension: 'nervousness', tensed: 'nervousness', strained: 'nervousness', concern: 'caring',
  happy: 'joy', joyful: 'joy', delighted: 'joy', cheerful: 'joy', glad: 'joy', elated: 'joy',
  sad: 'sadness', sorrow: 'sadness', sorrowful: 'sadness', melancholy: 'sadness', unhappy: 'sadness', downcast: 'sadness',
  angry: 'anger', furious: 'anger', rage: 'anger', enraged: 'anger', irritated: 'annoyance', annoyed: 'annoyance',
  frustrated: 'annoyance', exasperated: 'annoyance', impatient: 'annoyance',
  surprised: 'surprise', astonished: 'surprise', shocked: 'surprise', startled: 'surprise', stunned: 'surprise',
  curious: 'curiosity', intrigued: 'curiosity', interested: 'curiosity', inquisitive: 'curiosity',
  confused: 'confusion', puzzled: 'confusion', bewildered: 'confusion', perplexed: 'confusion',
  excited: 'excitement', eager: 'excitement', thrilled: 'excitement', exhilarated: 'excitement',
  calm: 'neutral', composed: 'neutral', focused: 'neutral', determined: 'neutral', serious: 'neutral', attentive: 'neutral',
  alert: 'neutral', resolute: 'neutral', steady: 'neutral', stoic: 'neutral', none: 'neutral', vigilant: 'neutral',
  disgusted: 'disgust', repulsed: 'disgust', embarrassed: 'embarrassment', ashamed: 'embarrassment', proud: 'pride',
  relieved: 'relief', loving: 'love', affectionate: 'love', tender: 'love', amused: 'amusement', wry: 'amusement',
  approving: 'approval', disappointed: 'disappointment', disapproving: 'disapproval', optimistic: 'optimism',
  hopeful: 'optimism', remorseful: 'remorse', guilty: 'remorse', regretful: 'remorse', grateful: 'gratitude',
  thankful: 'gratitude', admiring: 'admiration', impressed: 'admiration', grieving: 'grief', mournful: 'grief',
  bereaved: 'grief', concerned: 'caring', protective: 'caring', compassionate: 'caring', sympathetic: 'caring',
  longing: 'desire', yearning: 'desire', wistful: 'desire', realizing: 'realization', realized: 'realization',
  dawning: 'realization'
});

function earliestLabel(lower: string): ExpressionLabel | null {
  let best: { label: ExpressionLabel; at: number } | null = null;
  for (const label of EXPRESSION_LABELS) {
    let from = 0;
    while (from <= lower.length) {
      const start = lower.indexOf(label, from);
      if (start < 0) break;
      const before = start === 0 ? '' : lower[start - 1];
      const after = start + label.length >= lower.length ? '' : lower[start + label.length];
      if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) {
        if (!best || start < best.at) best = { label, at: start };
        break;
      }
      from = start + 1;
    }
  }
  return best?.label ?? null;
}

// Resolves the classifier's text to one label. Prefers the JSON contract, then the first
// vocabulary word in the text, then a synonym, and finally "neutral" rather than failing
// the turn: a neutral portrait is better than none, and the route logs the raw text.
export function parseExpressionResponse(value: unknown): ExpressionLabel {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('expression classifier returned no text');
  const cleaned = withoutReasoning(value);
  try {
    const parsed = JSON.parse(cleaned);
    if (isRecord(parsed)) {
      for (const candidate of Object.values(parsed)) {
        const expression = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
        if (isExpressionLabel(expression)) return expression;
        if (expression && EXPRESSION_SYNONYMS[expression]) return EXPRESSION_SYNONYMS[expression];
      }
    }
  } catch {
    // Plain-text output is the default SillyTavern LLM classifier contract.
  }
  const lower = cleaned.toLowerCase();
  const direct = earliestLabel(lower);
  if (direct) return direct;
  for (const word of lower.match(/[a-z]+/g) ?? []) {
    const synonym = EXPRESSION_SYNONYMS[word];
    if (synonym) return synonym;
  }
  return 'neutral';
}

export function expressionResponseWasRecognized(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const lower = withoutReasoning(value).toLowerCase();
  if (earliestLabel(lower)) return true;
  return (lower.match(/[a-z]+/g) ?? []).some((word) => Boolean(EXPRESSION_SYNONYMS[word]));
}

export function createExpressionSidecarResult(
  request: ExpressionSidecarRequest,
  model: string,
  expression: ExpressionLabel
): ExpressionSidecarResult {
  const normalized = normalizeExpressionSidecarRequest(request);
  if (typeof model !== 'string' || model.trim().length === 0 || model.length > 200) {
    throw new Error('sidecar model must be a non-empty string of at most 200 characters');
  }
  if (!isExpressionLabel(expression)) throw new Error('invalid expression label');
  return {
    spec: SIDECAR_RESULT_SPEC,
    kind: 'expression',
    source: {
      ...normalized.source,
      fingerprint: expressionSourceFingerprint(normalized.text)
    },
    model,
    output: { expression }
  };
}

export function normalizeExpressionSidecarResult(value: unknown): ExpressionSidecarResult {
  if (!isRecord(value)) throw new Error('expression sidecar result must be an object');
  if (value.spec !== SIDECAR_RESULT_SPEC || value.kind !== 'expression') throw new Error('invalid expression sidecar result spec');
  if (!isRecord(value.source)) throw new Error('expression sidecar result source must be an object');
  if (!isSidecarConversationId(value.source.conversationId)) throw new Error('result conversationId must be a UUID');
  const messageCount = integer(value.source.messageCount, 'result messageCount', 1, 1000);
  const messageIndex = integer(value.source.messageIndex, 'result messageIndex', 0, 999);
  if (messageIndex !== messageCount - 1 || value.source.role !== 'assistant') throw new Error('invalid expression result source');
  if (typeof value.source.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.source.fingerprint)) {
    throw new Error('invalid expression result fingerprint');
  }
  if (typeof value.model !== 'string' || value.model.trim().length === 0 || value.model.length > 200) {
    throw new Error('invalid expression result model');
  }
  if (!isRecord(value.output) || !isExpressionLabel(value.output.expression)) throw new Error('invalid expression result output');
  return {
    spec: SIDECAR_RESULT_SPEC,
    kind: 'expression',
    source: {
      conversationId: value.source.conversationId,
      messageCount,
      messageIndex,
      role: 'assistant',
      fingerprint: value.source.fingerprint
    },
    model: value.model,
    output: { expression: value.output.expression }
  };
}

export function expressionResultMatchesRequest(
  result: ExpressionSidecarResult,
  request: ExpressionSidecarRequest
): boolean {
  return result.source.conversationId === request.source.conversationId
    && result.source.messageCount === request.source.messageCount
    && result.source.messageIndex === request.source.messageIndex
    && result.source.role === request.source.role
    && result.source.fingerprint === expressionSourceFingerprint(request.text);
}

export function emptySidecarState(conversationId: string): SidecarState {
  if (!isSidecarConversationId(conversationId)) throw new Error('conversationId must be a UUID');
  return { spec: SIDECAR_STATE_SPEC, conversationId, channels: {} };
}

export function withExpressionSidecarResult(state: SidecarState, result: ExpressionSidecarResult): SidecarState {
  if (state.conversationId !== result.source.conversationId) throw new Error('sidecar result belongs to another conversation');
  return {
    spec: SIDECAR_STATE_SPEC,
    conversationId: state.conversationId,
    channels: { ...state.channels, expression: result }
  };
}

export function normalizeSidecarState(value: unknown): SidecarState {
  if (!isRecord(value) || value.spec !== SIDECAR_STATE_SPEC || !isSidecarConversationId(value.conversationId) || !isRecord(value.channels)) {
    throw new Error('invalid sidecar state');
  }
  const expression = value.channels.expression === undefined
    ? undefined
    : normalizeExpressionSidecarResult(value.channels.expression);
  if (expression && expression.source.conversationId !== value.conversationId) {
    throw new Error('sidecar channel belongs to another conversation');
  }
  return {
    spec: SIDECAR_STATE_SPEC,
    conversationId: value.conversationId,
    channels: expression ? { expression } : {}
  };
}
