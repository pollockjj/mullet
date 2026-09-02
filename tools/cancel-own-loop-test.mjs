// Does ComfyUI's jobs API cancel stop a MULLET loop that is already executing?
//
// MULLET cancels only its own prompt IDs, via POST /api/jobs/<id>/cancel, when a request
// is abandoned (a newer still supersedes the loop, or the client disconnects). Whether that
// interrupts a running job, or only removes a pending one, decides whether the lane FIFO
// wait behind a superseded loop can be cut. Submits one real loop graph (the newest served
// one, unchanged), cancels it after --after ms, and reports the terminal history message.
//
//   node tools/cancel-own-loop-test.mjs --lane http://firestorm:8188 --after 12000

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const lane = argValue('lane', 'http://firestorm:8188');
const afterMs = Number(argValue('after', '12000'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queueIsEmpty() {
  const queue = await (await fetch(`${lane}/queue`)).json();
  return (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0) === 0;
}

async function newestLoopGraph() {
  const history = await (await fetch(`${lane}/history?max_items=200`)).json();
  const entries = Object.entries(history)
    .filter(([, entry]) => entry?.prompt?.[3]?.client_id === 'mullet-portrait-video')
    .map(([id, entry]) => ({ id, start: (entry.status?.messages ?? []).find(([name]) => name === 'execution_start')?.[1]?.timestamp ?? 0, graph: entry.prompt[2] }))
    .sort((left, right) => right.start - left.start);
  if (!entries.length) throw new Error('no MULLET portrait-loop job in the lane history');
  return entries[0].graph;
}

async function main() {
  if (!(await queueIsEmpty())) { console.error('lane busy; refusing'); process.exit(2); }
  const graph = structuredClone(await newestLoopGraph());
  const [, save] = Object.entries(graph).find(([, node]) => node.class_type === 'SaveVideo');
  save.inputs.filename_prefix = 'mullet/cancel-test';
  const submitted = Date.now();
  const response = await fetch(`${lane}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'mullet-cancel-test' })
  });
  const { prompt_id: promptId } = await response.json();
  console.log('submitted', promptId);
  await delay(afterMs);
  const before = await (await fetch(`${lane}/queue`)).json();
  const wasRunning = (before.queue_running ?? []).some((item) => item[1] === promptId);
  const cancel = await fetch(`${lane}/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' });
  const cancelledAt = Date.now();
  console.log('cancel status', cancel.status, 'was running at cancel:', wasRunning);
  for (let i = 0; i < 120; i += 1) {
    await delay(1000);
    const history = await (await fetch(`${lane}/history/${promptId}`)).json();
    const entry = history?.[promptId];
    const terminal = (entry?.status?.messages ?? []).find(([name]) => ['execution_interrupted', 'execution_error', 'execution_success'].includes(name));
    if (terminal) {
      console.log(JSON.stringify({
        promptId, wasRunning, cancelStatus: cancel.status, terminal: terminal[0],
        secondsFromCancelToTerminal: (terminal[1].timestamp - cancelledAt) / 1000,
        secondsRunning: (terminal[1].timestamp - submitted) / 1000,
        statusStr: entry.status?.status_str
      }));
      return;
    }
  }
  console.log('no terminal message within 120 s');
}

await main();
