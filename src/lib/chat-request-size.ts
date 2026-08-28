export const MAX_CHAT_REQUEST_BYTES = 31 * 1024 * 1024;

export function chatRequestByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertChatRequestTextSize(value: string, maximumBytes = MAX_CHAT_REQUEST_BYTES): void {
  const bytes = chatRequestByteLength(value);
  if (bytes > maximumBytes) {
    const actualMiB = (bytes / 1024 / 1024).toFixed(1);
    const maximumMiB = (maximumBytes / 1024 / 1024).toFixed(0);
    throw new Error(`Chat request is ${actualMiB} MiB; the ${maximumMiB} MiB limit requires fewer messages or active lorebooks.`);
  }
}

export function serializeChatRequest(value: unknown, maximumBytes = MAX_CHAT_REQUEST_BYTES): string {
  const serialized = JSON.stringify(value);
  assertChatRequestTextSize(serialized, maximumBytes);
  return serialized;
}
