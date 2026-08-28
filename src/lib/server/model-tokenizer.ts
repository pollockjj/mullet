type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedContext: { key: string; tokens: number; expiresAt: number } | null = null;

function modelServerRoot(modelBaseUrl: string): string {
  return modelBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export async function getModelContextTokens(
  fetcher: Fetcher,
  modelBaseUrl: string,
  modelId: string,
  signal?: AbortSignal
): Promise<number> {
  const key = `${modelBaseUrl}\n${modelId}`;
  if (cachedContext?.key === key && cachedContext.expiresAt > Date.now()) return cachedContext.tokens;

  const response = await fetcher(`${modelBaseUrl}/models`, { signal });
  if (!response.ok) throw new Error(`model metadata request failed (${response.status})`);
  const payload = await response.json() as {
    data?: Array<{ id?: unknown; meta?: { n_ctx?: unknown } }>;
  };
  const model = payload.data?.find((candidate) => candidate.id === modelId);
  const tokens = model?.meta?.n_ctx;
  if (!Number.isInteger(tokens) || (tokens as number) < 1) {
    throw new Error(`model metadata does not expose n_ctx for ${modelId}`);
  }
  cachedContext = { key, tokens: tokens as number, expiresAt: Date.now() + 60_000 };
  return tokens as number;
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
