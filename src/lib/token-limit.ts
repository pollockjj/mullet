// SillyTavern values the operator runs against gemma-4-ortenzya: response length 65536,
// context 262144 (the model's n_ctx). Read from ~/SillyTavern/data/default-user/settings.json.
export const DEFAULT_RESPONSE_TOKENS = 65536;
export const MAX_RESPONSE_TOKENS = 262144;

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
