import {
  buildAssistantMemoryRequestFromTurn,
  type AssistantMemoryRequest,
  type AssistantMemoryResult
} from './assistant-memory.ts';
import {
  normalizeStoredAssistantMemoryPendingTurn,
  type StoredAssistantMemoryPendingTurn
} from './assistant-memory-storage.ts';
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
