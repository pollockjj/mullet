// Fiction workspace persistence: the conversation and the finalized-response receipt.
//
// The core loop depends on the receipt: it is what binds an expression label, a
// portrait, a scene still and a scene clip to the exact response that produced them,
// so a reload can tell current media from stale media without regenerating.
//
// This was previously a two-mode envelope carrying personal-assistant memory state and
// three generations of legacy migration. Personal-assistant mode is gone, so v4 stores
// only what fiction needs. v3 is migrated in place, keeping the operator's transcript.

import {
  normalizeTranscriptSource,
  transcriptSourcesMatch,
  type TranscriptSource
} from './transcript-source.ts';
import {
  normalizeFictionResponseReceipt,
  type FictionResponseReceipt
} from './fiction-finalization.ts';
import { isSidecarConversationId } from './sidecar.ts';
import { sha256Hex } from './sha256.ts';

export const STORED_WORKSPACE_SPEC = 'mullet_workspace_v4' as const;
export const LEGACY_STORED_WORKSPACE_V3_SPEC = 'mullet_workspace_v3' as const;
export const WORKSPACE_MAX_MESSAGES = 1000 as const;
export const WORKSPACE_STORAGE_KEY = 'mullet.workspace.v4' as const;
export const LEGACY_WORKSPACE_V3_STORAGE_KEY = 'mullet.workspace.v3' as const;

export type WorkspaceMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StoredWorkspace = {
  spec: typeof STORED_WORKSPACE_SPEC;
  conversationId: string;
  messages: WorkspaceMessage[];
  finalizedFictionResponse: FictionResponseReceipt | null;
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

function normalizeFinalizedResponse(
  value: unknown,
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): FictionResponseReceipt | null {
  return normalizeFictionResponseReceipt(value, conversationId, messages);
}

export function normalizeStoredWorkspace(value: unknown): StoredWorkspace {
  const record = exactRecord(
    value,
    ['spec', 'conversationId', 'messages', 'finalizedFictionResponse'],
    'stored workspace'
  );
  if (record.spec !== STORED_WORKSPACE_SPEC) throw new Error('stored workspace spec is invalid');
  if (!isSidecarConversationId(record.conversationId)) {
    throw new Error('stored workspace conversationId must be a UUID');
  }
  const messages = normalizeMessages(record.messages);
  return {
    spec: STORED_WORKSPACE_SPEC,
    conversationId: record.conversationId,
    messages,
    finalizedFictionResponse: normalizeFinalizedResponse(
      record.finalizedFictionResponse,
      record.conversationId,
      messages
    )
  };
}

// A transcript is worth more than a receipt. If only the receipt is malformed, keep the
// conversation and drop the receipt rather than resetting the operator's chat.
function normalizeStoredWorkspaceWithoutReceipt(value: unknown): StoredWorkspace {
  const record = exactRecord(
    value,
    ['spec', 'conversationId', 'messages', 'finalizedFictionResponse'],
    'stored workspace'
  );
  if (record.spec !== STORED_WORKSPACE_SPEC) throw new Error('stored workspace spec is invalid');
  if (!isSidecarConversationId(record.conversationId)) {
    throw new Error('stored workspace conversationId must be a UUID');
  }
  return {
    spec: STORED_WORKSPACE_SPEC,
    conversationId: record.conversationId,
    messages: normalizeMessages(record.messages),
    finalizedFictionResponse: null
  };
}

// v3 carried `mode` and `assistantMemory`. Both are gone; the transcript is not.
function migrateFromV3(value: unknown, fallbackConversationId: string): StoredWorkspace {
  if (!isRecord(value) || value.spec !== LEGACY_STORED_WORKSPACE_V3_SPEC) {
    throw new Error('legacy v3 workspace spec is invalid');
  }
  const conversationId = isSidecarConversationId(value.conversationId)
    ? value.conversationId
    : fallbackConversationId;
  const messages = normalizeMessages(value.messages);
  let finalizedFictionResponse: FictionResponseReceipt | null = null;
  try {
    finalizedFictionResponse = normalizeFinalizedResponse(
      value.finalizedFictionResponse ?? null,
      conversationId,
      messages
    );
  } catch {
    finalizedFictionResponse = null;
  }
  return { spec: STORED_WORKSPACE_SPEC, conversationId, messages, finalizedFictionResponse };
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
  conversationId: string,
  messages: readonly WorkspaceMessage[]
): string {
  if (!isSidecarConversationId(conversationId)) throw new Error('workspace conversationId must be a UUID');
  return `sha256:${sha256Hex(JSON.stringify([conversationId, normalizeMessages(messages)]))}`;
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
  conversationId: string,
  messages: readonly WorkspaceMessage[],
  finalizedFictionResponse: FictionResponseReceipt | null = null
): StoredWorkspace {
  return normalizeStoredWorkspace({
    spec: STORED_WORKSPACE_SPEC,
    conversationId,
    messages: messages.map((message) => ({ ...message })),
    finalizedFictionResponse
  });
}

export function saveStoredWorkspace(storage: WorkspaceStorage, workspace: StoredWorkspace): void {
  const normalized = normalizeStoredWorkspace(workspace);
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(normalized));
  storage.removeItem(LEGACY_WORKSPACE_V3_STORAGE_KEY);
}

export function loadStoredWorkspace(
  storage: WorkspaceStorage,
  newConversationId: string
): LoadedStoredWorkspace {
  if (!isSidecarConversationId(newConversationId)) throw new Error('new workspace conversationId must be a UUID');

  const current = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (current !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
      const workspace = normalizeStoredWorkspace(parsed);
      storage.removeItem(LEGACY_WORKSPACE_V3_STORAGE_KEY);
      return { workspace, disposition: 'current' };
    } catch {
      try {
        const workspace = normalizeStoredWorkspaceWithoutReceipt(parsed);
        saveStoredWorkspace(storage, workspace);
        return { workspace, disposition: 'repaired' };
      } catch {
        const workspace = createStoredWorkspace(newConversationId, []);
        saveStoredWorkspace(storage, workspace);
        return { workspace, disposition: 'reset' };
      }
    }
  }

  const legacyV3 = storage.getItem(LEGACY_WORKSPACE_V3_STORAGE_KEY);
  if (legacyV3 !== null) {
    try {
      const workspace = migrateFromV3(JSON.parse(legacyV3), newConversationId);
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'migrated' };
    } catch {
      const workspace = createStoredWorkspace(newConversationId, []);
      saveStoredWorkspace(storage, workspace);
      return { workspace, disposition: 'reset' };
    }
  }

  const workspace = createStoredWorkspace(newConversationId, []);
  saveStoredWorkspace(storage, workspace);
  return { workspace, disposition: 'current' };
}

export { transcriptSourcesMatch, normalizeTranscriptSource, type TranscriptSource };
