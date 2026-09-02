// Every ComfyUI prompt MULLET has submitted and not yet finished, so a server shutdown
// (a deploy restarts the launchd service) can cancel exactly those prompt IDs instead of
// leaving them running on the shared lanes while the operator's page waits on a request
// that will never return. Never anything queue-wide: only IDs this process created.

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const inflight = new Map<string, string>();

export function trackPrompt(baseUrl: string, id: string): void {
  if (id) inflight.set(id, baseUrl);
}

export function untrackPrompt(id: string): void {
  if (id) inflight.delete(id);
}

export function inflightPromptIds(): string[] {
  return [...inflight.keys()];
}

export async function cancelInflightPrompts(fetcher: Fetcher = fetch): Promise<string[]> {
  const cancelled: string[] = [];
  await Promise.all([...inflight.entries()].map(async ([id, baseUrl]) => {
    try {
      await fetcher(`${baseUrl.replace(/\/$/, '')}/api/jobs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(4_000)
      });
      cancelled.push(id);
    } catch {
      // best effort: the process is going away either way
    } finally {
      inflight.delete(id);
    }
  }));
  return cancelled;
}
