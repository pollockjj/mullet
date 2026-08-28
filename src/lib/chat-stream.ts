export type ChatStreamPayload = {
  done: boolean;
  terminal: boolean;
  hitTokenLimit: boolean;
  token: string;
  event: unknown;
};

export function parseChatStreamPayload(payload: string): ChatStreamPayload {
  const normalized = payload.trim();
  if (!normalized) return { done: false, terminal: false, hitTokenLimit: false, token: '', event: null };
  if (normalized === '[DONE]') return { done: true, terminal: true, hitTokenLimit: false, token: '', event: null };
  const event = JSON.parse(normalized);
  const choice = event?.choices?.[0];
  return {
    done: false,
    terminal: typeof choice?.finish_reason === 'string',
    hitTokenLimit: choice?.finish_reason === 'length',
    token: typeof choice?.delta?.content === 'string' ? choice.delta.content : '',
    event
  };
}

export function assertFinalizedChatStream(terminalEventSeen: boolean, assistantContent: string): void {
  if (!terminalEventSeen) throw new Error('The local model stream ended without a terminal event.');
  if (!assistantContent.trim()) throw new Error('The local model returned an empty response.');
}
