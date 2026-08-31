import {
  livingHistorySourceMatchesMessages,
  livingHistorySourcesMatch,
  normalizeLivingHistorySource,
  type LivingHistorySource
} from './living-history.ts';
import {
  normalizeStoredAssistantMemoryPendingTurn,
  type StoredAssistantMemoryPendingTurn
} from './assistant-memory-storage.ts';
import {
  CONVERSATION_MODE_FICTION,
  CONVERSATION_MODE_PERSONAL_ASSISTANT,
  normalizeConversationMode,
  type ConversationMode
} from './personal-assistant.ts';
import {
  normalizeFictionResponseReceipt,
  type FictionResponseReceipt
} from './fiction-finalization.ts';
import { isSidecarConversationId } from './sidecar.ts';
import { sha256Hex } from './sha256.ts';

export const STORED_WORKSPACE_SPEC = 'mullet_workspace_v3' as const;
export const LEGACY_STORED_WORKSPACE_V2_SPEC = 'mullet_workspace_v2' as const;
export const LEGACY_STORED_WORKSPACE_SPEC = 'mullet_workspace_v1' as const;
export const WORKSPACE_MAX_MESSAGES = 1000 as const;
export const WORKSPACE_STORAGE_KEY = 'mullet.workspace.v3' as const;
export const LEGACY_WORKSPACE_V2_STORAGE_KEY = 'mullet.workspace.v2' as const;
export const LEGACY_WORKSPACE_V1_STORAGE_KEY = 'mullet.workspace.v1' as const;
export const LEGACY_WORKSPACE_MODE_KEY = 'mullet.conversation-mode' as const;
export const LEGACY_WORKSPACE_CONVERSATION_ID_KEY = 'mullet.conversation-id' as const;
export const LEGACY_WORKSPACE_MESSAGES_KEY = 'mullet.checkpoint-one.messages' as const;

export type WorkspaceMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type WorkspaceAssistantMemoryReceipt = {
  source: LivingHistorySource;
  active: boolean;
};

export type WorkspaceAssistantMemoryState = {
  memoryId: string;
  epoch: string;
  pending: StoredAssistantMemoryPendingTurn | null;
  lastCompletedChat: WorkspaceAssistantMemoryReceipt | null;
};

export type StoredWorkspace = {
  spec: typeof STORED_WORKSPACE_SPEC;
  mode: ConversationMode;
  conversationId: string;
  messages: WorkspaceMessage[];
  assistantMemory: WorkspaceAssistantMemoryState | null;
  finalizedFictionResponse: FictionResponseReceipt | null;
};

type LegacyStoredWorkspaceV2 = {
  spec: typeof LEGACY_STORED_WORKSPACE_V2_SPEC;
  mode: ConversationMode;
  conversationId: string;
  messages: WorkspaceMessage[];
  assistantMemory: WorkspaceAssistantMemoryState | null;
};

type LegacyStoredWorkspace = {
  spec: typeof LEGACY_STORED_WORKSPACE_SPEC;
  mode: ConversationMode;
  conversationId: string;
  messages: WorkspaceMessage[];
};

export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadedStoredWorkspace = {
  workspace: StoredWorkspace;
  disposition: 'current' | 'migrated' | 'repaired' | 'reset';
};

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

function normalizeMessages(value: unknown): WorkspaceMessage[] {
  if (!Array.isArray(value) || value.length > WORKSPACE_MAX_MESSAGES) {
    throw new Error(`stored workspace messages must contain at most ${WORKSPACE_MAX_MESSAGES} items`);
  }
  return value.map((message, index): WorkspaceMessage => {
    if (
      !isRecord(message)
      || Object.keys(message).length !== 2
      || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.content !== 'string'
      || message.content.length < 1
      || message.content.length > 100_000
    ) throw new Error(`stored workspace message ${index} is invalid`);
    return { role: message.role, content: message.content };
  });
}

function normalizeReceipt(
  value: unknown,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): WorkspaceAssistantMemoryReceipt | null {
  if (value === null) return null;
  const record = exactRecord(value, ['source', 'active'], 'stored workspace assistant-memory receipt');
  if (typeof record.active !== 'boolean') throw new Error('stored workspace assistant-memory receipt active flag is invalid');
  const source = normalizeLivingHistorySource(record.source);
  if (
    source.messageCount !== messages.length
    || !livingHistorySourceMatchesMessages(source, conversationId, messages)
  ) throw new Error('stored workspace assistant-memory receipt does not match its completed transcript');
  return { source, active: record.active };
}

function normalizeAssistantMemoryState(
  value: unknown,
  mode: ConversationMode,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): WorkspaceAssistantMemoryState | null {
  if (mode === CONVERSATION_MODE_FICTION) {
    if (value !== null) throw new Error('fiction workspace cannot contain assistant-memory state');
    return null;
  }
  const record = exactRecord(
    value,
    ['memoryId', 'epoch', 'pending', 'lastCompletedChat'],
    'stored workspace assistant-memory state'
  );
  if (!isSidecarConversationId(record.memoryId)) throw new Error('stored workspace assistant-memory ID must be a UUID');
  if (!isSidecarConversationId(record.epoch)) throw new Error('stored workspace assistant-memory epoch must be a UUID');
  const pending = record.pending === null
    ? null
    : normalizeStoredAssistantMemoryPendingTurn(record.pending);
  if (pending && (
    pending.memoryId !== record.memoryId
    || pending.epoch !== record.epoch
    || pending.source.messageCount !== messages.length
    || !livingHistorySourceMatchesMessages(pending.source, conversationId, messages)
  )) throw new Error('stored workspace assistant-memory outbox does not match its completed transcript');
  const lastCompletedChat = normalizeReceipt(record.lastCompletedChat, conversationId, messages);
  if (pending && (!lastCompletedChat || !livingHistorySourcesMatch(pending.source, lastCompletedChat.source))) {
    throw new Error('stored workspace assistant-memory outbox lacks its completed-chat receipt');
  }
  return {
    memoryId: record.memoryId,
    epoch: record.epoch,
    pending,
    lastCompletedChat
  };
}

export function normalizeStoredWorkspace(value: unknown): StoredWorkspace {
  const record = exactRecord(
    value,
    ['spec', 'mode', 'conversationId', 'messages', 'assistantMemory', 'finalizedFictionResponse'],
    'stored workspace'
  );
  if (record.spec !== STORED_WORKSPACE_SPEC) throw new Error('stored workspace spec is invalid');
  const mode = normalizeConversationMode(record.mode);
  if (!isSidecarConversationId(record.conversationId)) {
    throw new Error('stored workspace conversationId must be a UUID');
  }
  const messages = normalizeMessages(record.messages);
  const assistantMemory = normalizeAssistantMemoryState(
    record.assistantMemory,
    mode,
    record.conversationId,
    messages
  );
  if (mode === CONVERSATION_MODE_PERSONAL_ASSISTANT && record.finalizedFictionResponse !== null) {
    throw new Error('personal-assistant workspace cannot contain a fiction-response receipt');
  }
  return {
    spec: STORED_WORKSPACE_SPEC,
    mode,
    conversationId: record.conversationId,
    messages,
    assistantMemory,
    finalizedFictionResponse: mode === CONVERSATION_MODE_FICTION
      ? normalizeFictionResponseReceipt(record.finalizedFictionResponse, record.conversationId, messages)
      : null
  };
}

function normalizeStoredWorkspaceWithoutFictionReceipt(value: unknown): StoredWorkspace {
  if (!isRecord(value) || value.finalizedFictionResponse === null) {
    throw new Error('stored workspace has no repairable fiction-response receipt');
  }
  return normalizeStoredWorkspace({ ...value, finalizedFictionResponse: null });
}

function normalizeLegacyStoredWorkspaceV2(value: unknown): LegacyStoredWorkspaceV2 {
  const record = exactRecord(
    value,
    ['spec', 'mode', 'conversationId', 'messages', 'assistantMemory'],
    'legacy v2 stored workspace'
  );
  if (record.spec !== LEGACY_STORED_WORKSPACE_V2_SPEC) {
    throw new Error('legacy v2 stored workspace spec is invalid');
  }
  const mode = normalizeConversationMode(record.mode);
  if (!isSidecarConversationId(record.conversationId)) {
    throw new Error('legacy v2 stored workspace conversationId must be a UUID');
  }
  const messages = normalizeMessages(record.messages);
  return {
    spec: LEGACY_STORED_WORKSPACE_V2_SPEC,
    mode,
    conversationId: record.conversationId,
    messages,
    assistantMemory: normalizeAssistantMemoryState(
      record.assistantMemory,
      mode,
      record.conversationId,
      messages
    )
  };
}

function normalizeLegacyStoredWorkspace(value: unknown): LegacyStoredWorkspace {
  const record = exactRecord(value, ['spec', 'mode', 'conversationId', 'messages'], 'legacy stored workspace');
  if (record.spec !== LEGACY_STORED_WORKSPACE_SPEC) throw new Error('legacy stored workspace spec is invalid');
  const mode = normalizeConversationMode(record.mode);
  if (!isSidecarConversationId(record.conversationId)) {
    throw new Error('legacy stored workspace conversationId must be a UUID');
  }
  return {
    spec: LEGACY_STORED_WORKSPACE_SPEC,
    mode,
    conversationId: record.conversationId,
    messages: normalizeMessages(record.messages)
  };
}

export function workspaceReadyForCompletedTurn(messageCount: number): boolean {
  return Number.isSafeInteger(messageCount)
    && messageCount >= 0
    && messageCount <= WORKSPACE_MAX_MESSAGES - 2;
}

export function workspaceCompletedTurnCapacityError(messageCount: number): string | null {
  if (workspaceReadyForCompletedTurn(messageCount)) return null;
  if (!Number.isSafeInteger(messageCount) || messageCount < 0 || messageCount > WORKSPACE_MAX_MESSAGES) {
    return 'The stored conversation message count is invalid. Reset the chat before sending another turn.';
  }
  return `This conversation has ${messageCount} of ${WORKSPACE_MAX_MESSAGES} messages; a completed turn requires two free message slots. Reset the chat before sending another turn.`;
}

export function workspaceMutationFingerprint(
  mode: ConversationMode,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): string {
  const normalizedMode = normalizeConversationMode(mode);
  if (!isSidecarConversationId(conversationId)) throw new Error('workspace conversationId must be a UUID');
  const normalizedMessages = normalizeMessages(messages);
  return `sha256:${sha256Hex(JSON.stringify([normalizedMode, conversationId, normalizedMessages]))}`;
}

export function rollbackFailedWorkspaceTurn(
  messages: readonly WorkspaceMessage[],
  draft: string
): { messages: WorkspaceMessage[]; draft: string } {
  return {
    messages: messages.map((message) => ({ ...message })),
    draft
  };
}

export function createStoredWorkspace(
  mode: ConversationMode,
  conversationId: string,
  messages: readonly WorkspaceMessage[],
  assistantMemory: WorkspaceAssistantMemoryState | null,
  finalizedFictionResponse: FictionResponseReceipt | null = null
): StoredWorkspace {
  return normalizeStoredWorkspace({
    spec: STORED_WORKSPACE_SPEC,
    mode,
    conversationId,
    messages: messages.map((message) => ({ ...message })),
    assistantMemory,
    finalizedFictionResponse
  });
}

function migratedAssistantMemoryState(
  mode: ConversationMode,
  memoryId: string,
  epoch: string
): WorkspaceAssistantMemoryState | null {
  return mode === CONVERSATION_MODE_PERSONAL_ASSISTANT
    ? { memoryId, epoch, pending: null, lastCompletedChat: null }
    : null;
}

function clearLegacyWorkspace(storage: WorkspaceStorage): void {
  storage.removeItem(LEGACY_WORKSPACE_V2_STORAGE_KEY);
  storage.removeItem(LEGACY_WORKSPACE_V1_STORAGE_KEY);
  storage.removeItem(LEGACY_WORKSPACE_MODE_KEY);
  storage.removeItem(LEGACY_WORKSPACE_CONVERSATION_ID_KEY);
  storage.removeItem(LEGACY_WORKSPACE_MESSAGES_KEY);
}

export function saveStoredWorkspace(storage: WorkspaceStorage, workspace: StoredWorkspace): void {
  const normalized = normalizeStoredWorkspace(workspace);
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(normalized));
  clearLegacyWorkspace(storage);
}

export function loadStoredWorkspace(
  storage: WorkspaceStorage,
  newConversationId: string,
  memoryId: string,
  epoch: string
): LoadedStoredWorkspace {
  if (!isSidecarConversationId(newConversationId)) throw new Error('new workspace conversationId must be a UUID');
  if (!isSidecarConversationId(memoryId)) throw new Error('workspace assistant-memory ID must be a UUID');
  if (!isSidecarConversationId(epoch)) throw new Error('workspace assistant-memory epoch must be a UUID');
  const current = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (current !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
      const workspace = normalizeStoredWorkspace(parsed);
      clearLegacyWorkspace(storage);
      return { workspace, disposition: 'current' };
    } catch {
      try {
        const workspace = normalizeStoredWorkspaceWithoutFictionReceipt(parsed);
        saveStoredWorkspace(storage, workspace);
        return { workspace, disposition: 'repaired' };
      } catch {
        const workspace = createStoredWorkspace(CONVERSATION_MODE_FICTION, newConversationId, [], null);
        saveStoredWorkspace(storage, workspace);
        return { workspace, disposition: 'reset' };
      }
    }
  }

  const legacyV2Current = storage.getItem(LEGACY_WORKSPACE_V2_STORAGE_KEY);
  if (legacyV2Current !== null) {
    try {
      const legacy = normalizeLegacyStoredWorkspaceV2(JSON.parse(legacyV2Current));
      const workspace = createStoredWorkspace(
        legacy.mode,
        legacy.conversationId,
        legacy.messages,
        legacy.assistantMemory,
        null
      );
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'migrated' };
    } catch {
      const workspace = createStoredWorkspace(CONVERSATION_MODE_FICTION, newConversationId, [], null);
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'reset' };
    }
  }

  const legacyCurrent = storage.getItem(LEGACY_WORKSPACE_V1_STORAGE_KEY);
  if (legacyCurrent !== null) {
    try {
      const legacy = normalizeLegacyStoredWorkspace(JSON.parse(legacyCurrent));
      const workspace = createStoredWorkspace(
        legacy.mode,
        legacy.conversationId,
        legacy.messages,
        migratedAssistantMemoryState(legacy.mode, memoryId, epoch)
      );
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'migrated' };
    } catch {
      const workspace = createStoredWorkspace(CONVERSATION_MODE_FICTION, newConversationId, [], null);
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'reset' };
    }
  }

  let mode: ConversationMode = CONVERSATION_MODE_FICTION;
  try {
    mode = normalizeConversationMode(storage.getItem(LEGACY_WORKSPACE_MODE_KEY));
  } catch {
    mode = CONVERSATION_MODE_FICTION;
  }
  const legacyConversationId = storage.getItem(LEGACY_WORKSPACE_CONVERSATION_ID_KEY);
  const conversationId = isSidecarConversationId(legacyConversationId)
    ? legacyConversationId
    : newConversationId;
  let messages: WorkspaceMessage[] = [];
  const legacyMessages = storage.getItem(LEGACY_WORKSPACE_MESSAGES_KEY);
  if (legacyMessages !== null) {
    try {
      const parsed = JSON.parse(legacyMessages);
      messages = normalizeMessages(Array.isArray(parsed) ? parsed : []);
    } catch {
      messages = [];
    }
  }
  const workspace = createStoredWorkspace(
    mode,
    conversationId,
    messages,
    migratedAssistantMemoryState(mode, memoryId, epoch)
  );
  saveStoredWorkspace(storage, workspace);
  return { workspace, disposition: 'migrated' };
}
