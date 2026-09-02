import { building } from '$app/environment';
import { cancelInflightPrompts, inflightPromptIds } from '$lib/server/inflight';

// A deploy restarts this process. adapter-node stops accepting connections and force-
// closes in-flight requests after SHUTDOWN_TIMEOUT, which is shorter than a loop takes,
// so the ComfyUI prompts behind those requests were left running on the shared lanes.
// Cancel MULLET's own prompt IDs first; the page's automatic retry picks the turn up on
// the new build.
type SignalTarget = { once(event: string, listener: (...args: unknown[]) => void): unknown };
const proc = (globalThis as { process?: SignalTarget }).process;

if (!building && proc) {
  let draining = false;
  const drain = (reason: string) => {
    if (draining) return;
    draining = true;
    const ids = inflightPromptIds();
    if (ids.length === 0) return;
    console.info('draining', ids.length, 'in-flight ComfyUI prompt(s) on', reason);
    void cancelInflightPrompts().then((cancelled) => {
      console.info('cancelled', cancelled.length, 'of', ids.length, 'in-flight prompt(s)');
    });
  };
  proc.once('SIGTERM', () => drain('SIGTERM'));
  proc.once('SIGINT', () => drain('SIGINT'));
  proc.once('sveltekit:shutdown', (reason) => drain(String(reason)));
}
