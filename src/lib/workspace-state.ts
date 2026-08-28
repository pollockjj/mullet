import {
  CONVERSATION_MODE_FICTION,
  normalizeConversationMode,
  type ConversationMode
} from './personal-assistant.ts';
import { isSidecarConversationId } from './sidecar.ts';

export const STORED_WORKSPACE_SPEC = 'mullet_workspace_v1' as const;
export const WORKSPACE_MAX_MESSAGES = 1000 as const;
export const WORKSPACE_STORAGE_KEY = 'mullet.workspace.v1' as const;
export const LEGACY_WORKSPACE_MODE_KEY = 'mullet.conversation-mode' as const;
export const LEGACY_WORKSPACE_CONVERSATION_ID_KEY = 'mullet.conversation-id' as const;
export const LEGACY_WORKSPACE_MESSAGES_KEY = 'mullet.checkpoint-one.messages' as const;

export type WorkspaceMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StoredWorkspace = {
  spec: typeof STORED_WORKSPACE_SPEC;
  mode: ConversationMode;
  conversationId: string;
  messages: WorkspaceMessage[];
};

export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadedStoredWorkspace = {
  workspace: StoredWorkspace;
  disposition: 'current' | 'migrated' | 'reset';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeStoredWorkspace(value: unknown): StoredWorkspace {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 4
    || !Object.hasOwn(value, 'spec')
    || !Object.hasOwn(value, 'mode')
    || !Object.hasOwn(value, 'conversationId')
    || !Object.hasOwn(value, 'messages')
    || value.spec !== STORED_WORKSPACE_SPEC
  ) throw new Error('stored workspace has an invalid schema');
  const mode = normalizeConversationMode(value.mode);
  if (!isSidecarConversationId(value.conversationId)) {
    throw new Error('stored workspace conversationId must be a UUID');
  }
  if (!Array.isArray(value.messages) || value.messages.length > WORKSPACE_MAX_MESSAGES) {
    throw new Error(`stored workspace messages must contain at most ${WORKSPACE_MAX_MESSAGES} items`);
  }
  const messages = value.messages.map((message, index): WorkspaceMessage => {
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
  return {
    spec: STORED_WORKSPACE_SPEC,
    mode,
    conversationId: value.conversationId,
    messages
  };
}

export function workspaceReadyForCompletedTurn(messageCount: number): boolean {
  return Number.isSafeInteger(messageCount)
    && messageCount >= 0
    && messageCount <= WORKSPACE_MAX_MESSAGES - 2;
}

export function createStoredWorkspace(
  mode: ConversationMode,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): StoredWorkspace {
  return normalizeStoredWorkspace({
    spec: STORED_WORKSPACE_SPEC,
    mode,
    conversationId,
    messages: messages.map((message) => ({ ...message }))
  });
}

function clearLegacyWorkspace(storage: WorkspaceStorage): void {
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
  newConversationId: string
): LoadedStoredWorkspace {
  if (!isSidecarConversationId(newConversationId)) throw new Error('new workspace conversationId must be a UUID');
  const current = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (current !== null) {
    try {
      const workspace = normalizeStoredWorkspace(JSON.parse(current));
      clearLegacyWorkspace(storage);
      return { workspace, disposition: 'current' };
    } catch {
      const workspace = createStoredWorkspace(CONVERSATION_MODE_FICTION, newConversationId, []);
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
      messages = createStoredWorkspace(mode, conversationId, Array.isArray(parsed) ? parsed : []).messages;
    } catch {
      messages = [];
    }
  }
  const workspace = createStoredWorkspace(mode, conversationId, messages);
  saveStoredWorkspace(storage, workspace);
  return { workspace, disposition: 'migrated' };
}
