export const DEFAULT_RESPONSE_TOKENS = 256;
export const TOKEN_LIMIT_OPTIONS = [64, 128, 256, 512, 1024, 2048] as const;

export function resolveTokenLimit(
  value: unknown,
  ceiling: number,
  fallback = DEFAULT_RESPONSE_TOKENS
): number {
  if (!Number.isInteger(ceiling) || ceiling < 16) throw new Error('token ceiling must be an integer of at least 16');
  if (!Number.isInteger(fallback) || fallback < 16 || fallback > ceiling) {
    throw new Error(`default token limit must be between 16 and ${ceiling}`);
  }
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 16 || (value as number) > ceiling) {
    throw new Error(`maxTokens must be an integer between 16 and ${ceiling}`);
  }
  return value as number;
}
