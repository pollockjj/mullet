import {
  buildAssistantMemoryRequestFromTurn,
  normalizeAssistantMemoryResult,
  type AssistantMemoryRequest,
  type AssistantMemoryResult
} from './assistant-memory.ts';
import {
  normalizeStoredAssistantMemoryPendingTurn,
  type StoredAssistantMemoryPendingTurn
} from './assistant-memory-storage.ts';
import { livingHistorySourcesMatch } from './living-history.ts';
import {
  CONVERSATION_MODE_PERSONAL_ASSISTANT,
  type ConversationMode
} from './personal-assistant.ts';

export function currentAssistantMemoryRequest(
  memoryId: string,
  pending: StoredAssistantMemoryPendingTurn | null,
  result: AssistantMemoryResult | null
): AssistantMemoryRequest | null {
  if (!pending) return null;
  try {
    const normalizedPending = normalizeStoredAssistantMemoryPendingTurn(pending);
    if (normalizedPending.memoryId !== memoryId) return null;
    return buildAssistantMemoryRequestFromTurn(
      memoryId,
      normalizedPending.source,
      normalizedPending.turns,
      result
    );
  } catch {
    return null;
  }
}

export function assistantMemoryRequestKey(
  request: AssistantMemoryRequest | null,
  pending: StoredAssistantMemoryPendingTurn | null
): string {
  if (!request || !pending) return '';
  return `${pending.turnKey}:${request.parentFingerprint}`;
}

export function assistantMemoryPendingAlreadyCommitted(
  pending: StoredAssistantMemoryPendingTurn | null,
  result: AssistantMemoryResult | null
): boolean {
  if (!pending || !result) return false;
  try {
    const normalizedPending = normalizeStoredAssistantMemoryPendingTurn(pending);
    const normalizedResult = normalizeAssistantMemoryResult(result);
    return normalizedPending.memoryId === normalizedResult.memoryId
      && livingHistorySourcesMatch(normalizedPending.source, normalizedResult.source);
  } catch {
    return false;
  }
}

export function assistantMemoryInjectionStatusText(
  messageCount: number,
  active: boolean | null
): string {
  if (active === true) return 'Active stored memory was injected into the last completed chat.';
  if (active === false) return 'No active stored memory was injected into the last completed chat.';
  return messageCount === 0
    ? 'No completed assistant chat yet.'
    : 'No memory-injection receipt is available for this restored transcript.';
}

export function assistantMemoryReadyForSend(
  mode: ConversationMode,
  persistenceReady: boolean,
  persistenceAvailable: boolean,
  streaming: boolean,
  memoryBusy: boolean,
  pending: StoredAssistantMemoryPendingTurn | null
): boolean {
  if (mode !== CONVERSATION_MODE_PERSONAL_ASSISTANT) return true;
  return persistenceReady && persistenceAvailable && !streaming && !memoryBusy && pending === null;
}

export function parseAssistantMemoryActiveHeader(value: string | null): boolean | null {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}
