// Transcript provenance: which exact conversation prefix produced a derived artifact.
//
// The core loop depends on this. An expression label, a portrait, a scene still and a
// scene motion clip are each bound to the finalized response that produced them, so a
// reload can tell "this media is current" from "this media is stale" without
// regenerating. It lived inside the living-history summarization module; it is not part
// of that feature and outlives it.

import { isSidecarConversationId } from './sidecar.ts';
import { sha256Hex } from './sha256.ts';

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
// Must stay byte-identical to the value living-history.ts used, or every fingerprint
// changes and all of the operator's stored portraits, scenes and clips read as stale.
const TRANSCRIPT_SEED = `sha256:${sha256Hex('mullet-living-history-transcript-v1')}`;

export type TranscriptMessage = {
  role: string;
  content: string;
};

export type TranscriptSource = {
  conversationId: string;
  messageCount: number;
  messageIndex: number;
  fingerprint: string;
  turnFingerprint: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function normalizedTranscript(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  return messages.map((message, index) => {
    if (!isRecord(message) || typeof message.role !== 'string' || typeof message.content !== 'string') {
      throw new Error(`transcript message ${index} is invalid`);
    }
    const role = message.role.trim();
    const content = message.content.trim();
    if (!role || content.length > 100_000) throw new Error(`transcript message ${index} is invalid`);
    return { role, content };
  });
}

function transcriptFingerprint(messages: readonly TranscriptMessage[]): string {
  return normalizedTranscript(messages).reduce(
    (fingerprint, message) => `sha256:${sha256Hex(JSON.stringify([fingerprint, message.role, message.content]))}`,
    TRANSCRIPT_SEED
  );
}

function latestTurnFingerprint(user: string, assistant: string): string {
  return `sha256:${sha256Hex(JSON.stringify([user, assistant]))}`;
}

function sourceForNormalizedMessages(
  conversationId: string,
  messages: readonly TranscriptMessage[]
): TranscriptSource {
  const messageIndex = messages.length - 1;
  const assistant = messages[messageIndex];
  if (assistant?.role !== 'assistant' || assistant.content.length === 0) {
    throw new Error('the latest message must be a non-empty assistant response');
  }
  const user = messages[messageIndex - 1];
  if (user?.role !== 'user' || user.content.length === 0) {
    throw new Error('the latest assistant response must follow a non-empty user turn');
  }
  return {
    conversationId,
    messageCount: messages.length,
    messageIndex,
    fingerprint: transcriptFingerprint(messages),
    turnFingerprint: latestTurnFingerprint(user.content, assistant.content)
  };
}

export function transcriptSourceForMessages(
  conversationId: string,
  messages: readonly TranscriptMessage[]
): TranscriptSource {
  if (!isSidecarConversationId(conversationId)) throw new Error('conversationId must be a UUID');
  if (messages.length < 2 || messages.length > 1000) throw new Error('messages must contain between 2 and 1000 items');
  return sourceForNormalizedMessages(conversationId, normalizedTranscript(messages));
}

export function normalizeTranscriptSource(value: unknown): TranscriptSource {
  if (!isRecord(value) || !isSidecarConversationId(value.conversationId)) {
    throw new Error('transcript source conversationId must be a UUID');
  }
  const messageCount = integer(value.messageCount, 'transcript source messageCount', 2, 1000);
  const messageIndex = integer(value.messageIndex, 'transcript source messageIndex', 1, 999);
  if (
    messageIndex !== messageCount - 1
    || typeof value.fingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(value.fingerprint)
    || typeof value.turnFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(value.turnFingerprint)
  ) {
    throw new Error('transcript source is invalid');
  }
  return {
    conversationId: value.conversationId,
    messageCount,
    messageIndex,
    fingerprint: value.fingerprint,
    turnFingerprint: value.turnFingerprint
  };
}

export function transcriptSourcesMatch(left: unknown, right: unknown): boolean {
  try {
    const normalizedLeft = normalizeTranscriptSource(left);
    const normalizedRight = normalizeTranscriptSource(right);
    return normalizedLeft.conversationId === normalizedRight.conversationId
      && normalizedLeft.messageCount === normalizedRight.messageCount
      && normalizedLeft.messageIndex === normalizedRight.messageIndex
      && normalizedLeft.fingerprint === normalizedRight.fingerprint
      && normalizedLeft.turnFingerprint === normalizedRight.turnFingerprint;
  } catch {
    return false;
  }
}

export function transcriptSourceMatchesMessages(
  source: unknown,
  conversationId: string,
  messages: readonly TranscriptMessage[]
): boolean {
  let normalizedSource: TranscriptSource;
  try {
    normalizedSource = normalizeTranscriptSource(source);
  } catch {
    return false;
  }
  if (normalizedSource.conversationId !== conversationId || normalizedSource.messageCount > messages.length) return false;
  try {
    return transcriptSourcesMatch(
      normalizedSource,
      transcriptSourceForMessages(conversationId, messages.slice(0, normalizedSource.messageCount))
    );
  } catch {
    return false;
  }
}
