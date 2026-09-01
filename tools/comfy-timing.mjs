// Paired cold/warm timing against a ComfyUI lane.
//
// A default is chosen by measured click-to-visible, not by preference. This measures the
// generation half of that: submit -> queued -> executing -> output fetched. The browser
// check measures the rest.
//
// Shared-service rules: this submits jobs like any MULLET request and cancels ONLY the
// exact prompt ID it created. No queue-wide interrupt, no clearing, no model unloading.

const CLIENT_ID = 'mullet-timing-harness';

function now() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadImage(baseUrl, bytes, name, subfolder) {
  const form = new FormData();
  form.set('image', new Blob([bytes]), name);
  form.set('overwrite', 'false');
  if (subfolder) form.set('subfolder', subfolder);
  const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`upload failed ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function inputExists(baseUrl, filename, subfolder) {
  const query = new URLSearchParams({ filename, type: 'input' });
  if (subfolder) query.set('subfolder', subfolder);
  const response = await fetch(`${baseUrl}/view?${query}`, { method: 'GET' });
  return response.ok;
}

async function cancelOwnPrompt(baseUrl, promptId) {
  // Delete only this prompt from the pending queue. Never /interrupt, never clear.
  await fetch(`${baseUrl}/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] })
  }).catch(() => {});
}

export async function runGraph(baseUrl, graph, { timeoutMs = 600_000, label = 'graph' } = {}) {
  const submitted = now();
  const response = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID })
  });
  if (!response.ok) {
    throw new Error(`${label}: submit failed ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const { prompt_id: promptId } = await response.json();
  if (!promptId) throw new Error(`${label}: no prompt_id returned`);
  const queued = now();

  const deadline = queued + timeoutMs;
  let firstSeenRunning = null;
  try {
    for (;;) {
      const historyResponse = await fetch(`${baseUrl}/history/${promptId}`);
      if (historyResponse.ok) {
        const history = await historyResponse.json();
        const entry = history?.[promptId];
        if (entry) {
          const status = entry.status ?? {};
          if (status.completed === true || status.status_str === 'success') {
            const done = now();
            const outputs = [];
            for (const nodeOutput of Object.values(entry.outputs ?? {})) {
              for (const key of ['images', 'videos', 'gifs']) {
                for (const file of nodeOutput?.[key] ?? []) outputs.push(file);
              }
            }
            let fetched = done;
            let bytes = 0;
            if (outputs[0]) {
              const query = new URLSearchParams({
                filename: outputs[0].filename,
                subfolder: outputs[0].subfolder ?? '',
                type: outputs[0].type ?? 'output'
              });
              const fileResponse = await fetch(`${baseUrl}/view?${query}`);
              bytes = (await fileResponse.arrayBuffer()).byteLength;
              fetched = now();
            }
            return {
              promptId,
              outputs,
              bytes,
              submitMs: queued - submitted,
              executeMs: done - queued,
              transferMs: fetched - done,
              totalMs: fetched - submitted,
              waitedForRunningMs: firstSeenRunning === null ? null : firstSeenRunning - queued
            };
          }
          if (status.status_str === 'error') {
            const messages = (status.messages ?? [])
              .filter(([kind]) => kind === 'execution_error')
              .map(([, detail]) => detail?.exception_message ?? 'unknown');
            throw new Error(`${label}: execution error: ${messages.join('; ') || 'unknown'}`);
          }
        }
      }
      if (firstSeenRunning === null) {
        const queueResponse = await fetch(`${baseUrl}/queue`);
        if (queueResponse.ok) {
          const queue = await queueResponse.json();
          const running = (queue.queue_running ?? []).some((item) => item[1] === promptId);
          if (running) firstSeenRunning = now();
        }
      }
      if (now() > deadline) throw new Error(`${label}: timed out after ${timeoutMs}ms`);
      await delay(250);
    }
  } catch (error) {
    await cancelOwnPrompt(baseUrl, promptId);
    throw error;
  }
}

// ComfyUI caches execution: resubmitting an identical graph returns the previous result
// without running the sampler, which reads as a ~10ms "warm" time and is meaningless.
// Every repeat run must change the noise seed so the sampler genuinely re-executes.
function withSeed(graph, seed) {
  const copy = JSON.parse(JSON.stringify(graph));
  for (const node of Object.values(copy)) {
    const inputs = node?.inputs ?? {};
    if (typeof inputs.seed === 'number') inputs.seed = seed;
    if (typeof inputs.noise_seed === 'number') inputs.noise_seed = seed;
  }
  return copy;
}

// cold      = first run: model load plus inference.
// warm      = weights already resident, fresh seed, so this is real inference cost.
// The base seed is fixed per candidate so runs stay reproducible.
export async function pairedRun(baseUrl, graph, { label = 'candidate', warmRuns = 2, baseSeed = 19790213 } = {}) {
  const cold = await runGraph(baseUrl, withSeed(graph, baseSeed), { label: `${label} cold` });
  const warm = [];
  for (let index = 0; index < warmRuns; index += 1) {
    warm.push(
      await runGraph(baseUrl, withSeed(graph, baseSeed + 1 + index), { label: `${label} warm ${index + 1}` })
    );
  }
  const warmBest = warm.reduce((best, run) => (run.totalMs < best.totalMs ? run : best), warm[0]);
  const warmMedian = [...warm].sort((a, b) => a.totalMs - b.totalMs)[Math.floor(warm.length / 2)];
  return { label, cold, warm, warmBest, warmMedian };
}
