type SidecarFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SidecarCompletionOptions = {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  input: string;
  maxTokens: number;
  signal?: AbortSignal;
};

function responseContent(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('choices' in value) || !Array.isArray(value.choices)) {
    throw new Error('sidecar model returned an invalid completion');
  }
  const first = value.choices[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) {
    throw new Error('sidecar model returned an invalid completion');
  }
  const message = first.message;
  if (typeof message !== 'object' || message === null || !('content' in message) || typeof message.content !== 'string' || message.content.trim().length === 0) {
    throw new Error('sidecar model returned no completion text');
  }
  return message.content;
}

export async function runSidecarCompletion(
  fetcher: SidecarFetch,
  options: SidecarCompletionOptions
): Promise<string> {
  const response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.input }
      ],
      stream: false,
      max_tokens: options.maxTokens,
      temperature: 0
    }),
    signal: options.signal
  });
  if (!response.ok) throw new Error(`sidecar model rejected the request (${response.status})`);
  return responseContent(await response.json());
}

// Vision variant: the same isolated branch, but the user turn carries the generated
// still so the model captions the pixels instead of restating the prompt.
export async function runSidecarVisionCompletion(
  fetcher: SidecarFetch,
  options: SidecarCompletionOptions & { imageBase64: string; imageMediaType: string }
): Promise<string> {
  const response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${options.systemPrompt}\n\n${options.input}`.trim() },
            {
              type: 'image_url',
              image_url: { url: `data:${options.imageMediaType};base64,${options.imageBase64}` }
            }
          ]
        }
      ],
      stream: false,
      max_tokens: options.maxTokens,
      temperature: 0
    }),
    signal: options.signal
  });
  if (!response.ok) throw new Error(`sidecar vision model rejected the request (${response.status})`);
  return responseContent(await response.json());
}
