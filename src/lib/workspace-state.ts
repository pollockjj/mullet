import {
  normalizeConversationMode,
  type ConversationMode
} from './personal-assistant.ts';
import { isSidecarConversationId } from './sidecar.ts';

export const STORED_WORKSPACE_SPEC = 'mullet_workspace_v1' as const;

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
  if (!Array.isArray(value.messages) || value.messages.length > 1000) {
    throw new Error('stored workspace messages must contain at most 1000 items');
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
