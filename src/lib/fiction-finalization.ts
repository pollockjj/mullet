import {
  livingHistorySourceForMessages,
  livingHistorySourceMatchesMessages,
  normalizeLivingHistorySource,
  type LivingHistorySource,
  type TranscriptMessage
} from './living-history.ts';
import {
  buildExpressionSidecarRequest,
  isSidecarConversationId,
  type ExpressionSidecarRequest
} from './sidecar.ts';
import { sha256Hex } from './sha256.ts';

export const FICTION_AUTHORED_OPENING_RECEIPT_KIND = 'authored_opening' as const;
export const FICTION_COMPLETED_TURN_RECEIPT_KIND = 'completed_turn' as const;

export type FictionAuthoredOpeningReceipt = {
  kind: typeof FICTION_AUTHORED_OPENING_RECEIPT_KIND;
  source: {
    conversationId: string;
    messageCount: 1;
    messageIndex: 0;
    role: 'assistant';
    fingerprint: string;
  };
};

export type FictionCompletedTurnReceipt = {
  kind: typeof FICTION_COMPLETED_TURN_RECEIPT_KIND;
  source: LivingHistorySource & {
    rawFingerprint: string;
  };
};

export type FictionResponseReceipt = FictionAuthoredOpeningReceipt | FictionCompletedTurnReceipt;

type WorkspaceMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const AUTHORED_OPENING_FINGERPRINT_DOMAIN = 'mullet-fiction-authored-opening-v1';
const COMPLETED_RESPONSE_FINGERPRINT_DOMAIN = 'mullet-fiction-completed-response-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (
    !isRecord(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))
  ) throw new Error(`${name} has an invalid schema`);
  return value;
}

function authoredOpeningFingerprint(conversationId: string, content: string): string {
  return `sha256:${sha256Hex(JSON.stringify([
    AUTHORED_OPENING_FINGERPRINT_DOMAIN,
    conversationId,
    'assistant',
    content
  ]))}`;
}

function completedResponseRawFingerprint(
  conversationId: string,
  messages: readonly TranscriptMessage[]
): string {
  return `sha256:${sha256Hex(JSON.stringify([
    COMPLETED_RESPONSE_FINGERPRINT_DOMAIN,
    conversationId,
    messages.map((message) => [message.role, message.content])
  ]))}`;
}

function authoredOpeningSource(
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): FictionAuthoredOpeningReceipt['source'] {
  if (!isSidecarConversationId(conversationId)) throw new Error('conversationId must be a UUID');
  if (
    messages.length !== 1
    || messages[0]?.role !== 'assistant'
    || typeof messages[0].content !== 'string'
    || messages[0].content.trim().length === 0
    || messages[0].content.length > 100_000
  ) throw new Error('an authored opening must be exactly one non-empty assistant message');
  return {
    conversationId,
    messageCount: 1,
    messageIndex: 0,
    role: 'assistant',
    fingerprint: authoredOpeningFingerprint(conversationId, messages[0].content)
  };
}

export function createAuthoredOpeningReceipt(
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): FictionAuthoredOpeningReceipt {
  return {
    kind: FICTION_AUTHORED_OPENING_RECEIPT_KIND,
    source: authoredOpeningSource(conversationId, messages)
  };
}

export function createCompletedFictionResponseReceipt(
  conversationId: string,
  messages: readonly TranscriptMessage[]
): FictionCompletedTurnReceipt {
  const source = livingHistorySourceForMessages(conversationId, messages);
  return {
    kind: FICTION_COMPLETED_TURN_RECEIPT_KIND,
    source: {
      ...source,
      rawFingerprint: completedResponseRawFingerprint(conversationId, messages)
    }
  };
}

export function normalizeFictionResponseReceipt(
  value: unknown,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): FictionResponseReceipt | null {
  if (value === null) return null;
  if (!isSidecarConversationId(conversationId)) throw new Error('fiction receipt conversationId must be a UUID');
  const receipt = exactRecord(value, ['kind', 'source'], 'stored workspace fiction-response receipt');

  if (receipt.kind === FICTION_AUTHORED_OPENING_RECEIPT_KIND) {
    const source = exactRecord(
      receipt.source,
      ['conversationId', 'messageCount', 'messageIndex', 'role', 'fingerprint'],
      'stored workspace authored-opening source'
    );
    if (
      source.conversationId !== conversationId
      || source.messageCount !== 1
      || source.messageIndex !== 0
      || source.role !== 'assistant'
      || typeof source.fingerprint !== 'string'
      || !FINGERPRINT_PATTERN.test(source.fingerprint)
    ) throw new Error('stored workspace authored-opening receipt is invalid');
    const expected = authoredOpeningSource(conversationId, messages);
    if (source.fingerprint !== expected.fingerprint) {
      throw new Error('stored workspace authored-opening receipt does not match its transcript');
    }
    return {
      kind: FICTION_AUTHORED_OPENING_RECEIPT_KIND,
      source: expected
    };
  }

  if (receipt.kind === FICTION_COMPLETED_TURN_RECEIPT_KIND) {
    const sourceRecord = exactRecord(
      receipt.source,
      ['conversationId', 'messageCount', 'messageIndex', 'fingerprint', 'turnFingerprint', 'rawFingerprint'],
      'stored workspace completed-turn source'
    );
    const source = normalizeLivingHistorySource(sourceRecord);
    if (
      source.conversationId !== conversationId
      || source.messageCount !== messages.length
      || !livingHistorySourceMatchesMessages(source, conversationId, messages)
      || typeof sourceRecord.rawFingerprint !== 'string'
      || !FINGERPRINT_PATTERN.test(sourceRecord.rawFingerprint)
      || sourceRecord.rawFingerprint !== completedResponseRawFingerprint(conversationId, messages)
    ) throw new Error('stored workspace completed-turn receipt does not match its whole transcript');
    return {
      kind: FICTION_COMPLETED_TURN_RECEIPT_KIND,
      source: {
        ...source,
        rawFingerprint: sourceRecord.rawFingerprint
      }
    };
  }

  throw new Error('stored workspace fiction-response receipt kind is invalid');
}

export function fictionResponseReceiptMatchesMessages(
  receipt: unknown,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): receipt is FictionResponseReceipt {
  try {
    return normalizeFictionResponseReceipt(receipt, conversationId, messages) !== null;
  } catch {
    return false;
  }
}

export function expressionRequestForFinalizedFictionResponse(
  receipt: unknown,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): ExpressionSidecarRequest | null {
  if (!fictionResponseReceiptMatchesMessages(receipt, conversationId, messages)) return null;
  try {
    return buildExpressionSidecarRequest(conversationId, messages);
  } catch {
    return null;
  }
}
