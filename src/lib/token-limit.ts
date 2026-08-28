export const DEFAULT_RESPONSE_TOKENS = 8096;
export const MAX_RESPONSE_TOKENS = 128000;

export function resolveTokenLimit(
  value: unknown,
  ceiling: number,
  fallback = DEFAULT_RESPONSE_TOKENS
): number {
  if (!Number.isInteger(ceiling) || ceiling < 1) throw new Error('token ceiling must be a positive integer');
  if (!Number.isInteger(fallback) || fallback < 1 || fallback > ceiling) {
    throw new Error(`default token limit must be between 1 and ${ceiling}`);
  }
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > ceiling) {
    throw new Error(`maxTokens must be an integer between 1 and ${ceiling}`);
  }
  return value as number;
}
