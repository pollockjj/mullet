import type { ImportedLorebook } from './lorebook.ts';
import { isSidecarConversationId } from './sidecar.ts';
import {
  LIVING_HISTORY_INTERVAL_MESSAGES,
  buildLivingHistoryRequest,
  livingHistoryResultAppliesToMessages,
  livingHistorySourceMatchesMessages,
  livingHistorySourcesMatch,
  normalizeLivingHistorySource,
  type LivingHistoryRequest,
  type LivingHistoryResult,
  type LivingHistorySource,
  type TranscriptMessage
} from './living-history.ts';

export const MAX_SUPPLEMENTAL_LOREBOOKS = 20 as const;
export const MAX_FINALIZED_HISTORY_BOUNDARIES = 500 as const;

export function normalizeStoredLivingHistoryBoundaries(
  value: unknown,
  conversationId: string,
  messages: readonly TranscriptMessage[]
): LivingHistorySource[] {
  if (!Array.isArray(value) || value.length > MAX_FINALIZED_HISTORY_BOUNDARIES) {
    throw new Error(`living-history finalized boundaries may contain at most ${MAX_FINALIZED_HISTORY_BOUNDARIES} items`);
  }
  const normalized = value.map((boundary) => normalizeLivingHistorySource(boundary));
  normalized.forEach((boundary, index) => {
    if (
      boundary.conversationId !== conversationId
      || (index > 0 && boundary.messageCount <= normalized[index - 1].messageCount)
      || !livingHistorySourceMatchesMessages(boundary, conversationId, messages)
    ) throw new Error('living-history finalized boundary does not match this conversation');
  });
  return normalized;
}

export function appendLivingHistoryBoundary(
  boundaries: readonly LivingHistorySource[],
  source: LivingHistorySource
): LivingHistorySource[] {
  const normalized = normalizeLivingHistorySource(source);
  if (boundaries.some((boundary) => livingHistorySourcesMatch(boundary, normalized))) return [...boundaries];
  const latest = boundaries.at(-1);
  if (latest && latest.messageCount >= normalized.messageCount) {
    throw new Error('living-history finalized boundaries must be appended in transcript order');
  }
  return [...boundaries, normalized].slice(-MAX_FINALIZED_HISTORY_BOUNDARIES);
}

export function pendingLivingHistoryBoundaries(
  boundaries: readonly LivingHistorySource[],
  result: LivingHistoryResult | null
): LivingHistorySource[] {
  const previousCount = result?.source.messageCount ?? 0;
  return boundaries.filter((boundary) => boundary.messageCount > previousCount);
}

export function pendingLivingHistoryMessageCount(
  boundaries: readonly LivingHistorySource[],
  result: LivingHistoryResult | null
): number {
  return pendingLivingHistoryBoundaries(boundaries, result).length * 2;
}

export function livingHistoryAutomaticUpdateDue(pendingMessages: number): boolean {
  return Number.isInteger(pendingMessages) && pendingMessages >= LIVING_HISTORY_INTERVAL_MESSAGES;
}

export function livingHistoryReadyForChat(enabled: boolean, persistenceReady: boolean): boolean {
  return !enabled || persistenceReady;
}

export function parseLivingHistoryActiveHeader(value: string | null): boolean | null {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export function authoritativeLivingHistoryEpoch(currentEpoch: string, storedEpoch: unknown): string {
  return isSidecarConversationId(storedEpoch) ? storedEpoch : currentEpoch;
}

export function currentLivingHistoryRequest(
  conversationId: string,
  messages: readonly TranscriptMessage[],
  result: LivingHistoryResult | null,
  boundaries: readonly LivingHistorySource[]
): LivingHistoryRequest | null {
  if (!conversationId || boundaries.length === 0) return null;
  const applicableResult = result && livingHistoryResultAppliesToMessages(result, conversationId, messages)
    ? result
    : null;
  if (result && !applicableResult) return null;
  const pending = pendingLivingHistoryBoundaries(boundaries, applicableResult);
  if (pending.length === 0) return null;
  const finalizedMessageCount = pending.at(-1)?.messageCount ?? 0;
  try {
    return buildLivingHistoryRequest(
      conversationId,
      messages.slice(0, finalizedMessageCount),
      applicableResult,
      pending
    );
  } catch {
    return null;
  }
}

export function assembleSupplementalLorebooks(
  imported: readonly ImportedLorebook[],
  generated: ImportedLorebook | null
): ImportedLorebook[] {
  const assembled = [...imported, ...(generated ? [generated] : [])];
  if (assembled.length > MAX_SUPPLEMENTAL_LOREBOOKS) {
    throw new Error(`At most ${MAX_SUPPLEMENTAL_LOREBOOKS} supplemental lorebooks can be active; turn off living history or remove an imported lorebook.`);
  }
  return assembled;
}
