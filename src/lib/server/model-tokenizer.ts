type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedContext: { key: string; tokens: number; expiresAt: number } | null = null;

function modelServerRoot(modelBaseUrl: string): string {
  return modelBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

// Context size of the served model. llama-server exposes it as data[].meta.n_ctx; LM
// Studio and other OpenAI-compatible servers expose it under other names or not at all.
// The value only sizes the lore budget, so when nothing is exposed the caller's fallback
// is used and logged rather than refusing every chat message (observed 2026-09-02 after a
// model-server restart: "model metadata does not expose n_ctx" on every turn).
function contextFromEntry(entry: unknown): number | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const meta = typeof record.meta === 'object' && record.meta !== null ? record.meta as Record<string, unknown> : {};
  const candidates = [
    meta.n_ctx, meta.n_ctx_train, meta.context_length,
    record.n_ctx, record.context_length, record.max_context_length, record.context_window, record.max_model_len
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? Number(candidate) : candidate;
    if (Number.isInteger(value) && (value as number) >= 1) return value as number;
  }
  return null;
}

export async function getModelContextTokens(
  fetcher: Fetcher,
  modelBaseUrl: string,
  modelId: string,
  signal?: AbortSignal,
  fallbackTokens?: number
): Promise<number> {
  const key = `${modelBaseUrl}\n${modelId}`;
  if (cachedContext?.key === key && cachedContext.expiresAt > Date.now()) return cachedContext.tokens;
  const response = await fetcher(`${modelBaseUrl}/models`, { signal });
  if (!response.ok) throw new Error(`model metadata request failed (${response.status})`);
  const payload = await response.json() as { data?: unknown[]; models?: unknown[] };
  const entries = [...(Array.isArray(payload.data) ? payload.data : []), ...(Array.isArray(payload.models) ? payload.models : [])];
  const names = (candidate: unknown): string[] => {
    const record = candidate as Record<string, unknown>;
    return [record?.id, record?.name, record?.model].filter((value): value is string => typeof value === 'string');
  };
  const model = entries.find((candidate) => names(candidate).includes(modelId))
    ?? entries.find((candidate) => names(candidate).some((name) => name.startsWith(`${modelId}-`) || modelId.startsWith(`${name}-`)))
    ?? (entries.length === 1 ? entries[0] : undefined);
  let tokens = contextFromEntry(model);
  if (tokens === null) {
    if (!Number.isInteger(fallbackTokens) || (fallbackTokens as number) < 1) {
      throw new Error(`model metadata does not expose n_ctx for ${modelId}`);
    }
    console.warn(`model metadata does not expose a context size for ${modelId}; using the configured ${fallbackTokens} tokens`);
    tokens = fallbackTokens as number;
  }
  cachedContext = { key, tokens, expiresAt: Date.now() + 60_000 };
  return tokens;
}

export async function countModelTokens(
  fetcher: Fetcher,
  modelBaseUrl: string,
  content: string,
  signal?: AbortSignal
): Promise<number> {
  const response = await fetcher(`${modelServerRoot(modelBaseUrl)}/tokenize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, add_special: false, parse_special: true, with_pieces: false }),
    signal
  });
  if (!response.ok) throw new Error(`model tokenizer request failed (${response.status})`);
  const payload = await response.json() as { tokens?: unknown };
  if (!Array.isArray(payload.tokens)) throw new Error('model tokenizer returned no token array');
  return payload.tokens.length;
}
