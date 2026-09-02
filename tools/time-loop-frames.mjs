// Paired timing of the expression loop at different frame counts, on the real graph.
//
// Takes the newest MULLET portrait-loop graph from the expression lane's history (so the
// model, LoRA, steps, prompt and the already-uploaded input still are exactly what the
// served build submits), rewrites only the frame count, and runs each candidate twice in
// a row: the first run pays whatever reload the lane needs, the second is warm.
//
// Shared-service rules: submits like any MULLET request, cancels only its own prompt ID
// on timeout, never interrupts or clears the queue. Refuses to start unless the lane's
// queue is empty, so it never contends with the operator.
//
//   node tools/time-loop-frames.mjs --lane http://firestorm:8188 --frames 22,39,56 --out scratch/loop-frame-timings.json

import { writeFile } from 'node:fs/promises';
import { runGraph } from './comfy-timing.mjs';

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const lane = argValue('lane', process.env.EXPRESSION_COMFY_BASE_URL ?? 'http://firestorm:8188');
const frameCounts = argValue('frames', '22,39,56').split(',').map((value) => Number(value));
const out = argValue('out', 'scratch/loop-frame-timings.json');
const baseSeed = Number(argValue('seed', '20260901'));

async function queueIsEmpty() {
  const response = await fetch(`${lane}/queue`);
  const queue = await response.json();
  return (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0) === 0;
}

async function newestLoopGraph() {
  const response = await fetch(`${lane}/history?max_items=200`);
  const history = await response.json();
  const entries = Object.entries(history)
    .filter(([, entry]) => entry?.prompt?.[3]?.client_id === 'mullet-portrait-video')
    .map(([id, entry]) => {
      const start = (entry.status?.messages ?? []).find(([name]) => name === 'execution_start')?.[1]?.timestamp ?? 0;
      return { id, start, graph: entry.prompt[2] };
    })
    .sort((left, right) => right.start - left.start);
  if (!entries.length) throw new Error('no MULLET portrait-loop job in the lane history');
  return entries[0];
}

function nodeOfClass(graph, className) {
  const entry = Object.entries(graph).find(([, node]) => node.class_type === className);
  if (!entry) throw new Error(`graph has no ${className} node`);
  return entry;
}

function variant(baseGraph, frames, seed) {
  const graph = structuredClone(baseGraph);
  const [videoId, video] = nodeOfClass(graph, 'MiniMaxH3ImageToVideo');
  if ((frames - 5) % 17 !== 0) throw new Error(`${frames} is not on the H3 frame grid (5 + 17k)`);
  video.inputs.length = frames;
  const [, noise] = nodeOfClass(graph, 'RandomNoise');
  noise.inputs.noise_seed = seed;
  const [, save] = nodeOfClass(graph, 'SaveVideo');
  save.inputs.filename_prefix = `mullet/timing-loop-${frames}f`;
  return { graph, videoId, width: video.inputs.width, height: video.inputs.height };
}

async function main() {
  if (!(await queueIsEmpty())) {
    console.error(`lane ${lane} has jobs queued; refusing to contend with them`);
    process.exit(2);
  }
  const base = await newestLoopGraph();
  const [, baseVideo] = nodeOfClass(base.graph, 'MiniMaxH3ImageToVideo');
  const [, scheduler] = nodeOfClass(base.graph, 'BasicScheduler');
  const [, lora] = nodeOfClass(base.graph, 'LoraLoaderModelOnly');
  const record = {
    lane,
    basePromptId: base.id,
    base: { width: baseVideo.inputs.width, height: baseVideo.inputs.height, length: baseVideo.inputs.length, steps: scheduler.inputs.steps, lora: lora.inputs.lora_name },
    startedAt: new Date().toISOString(),
    runs: []
  };
  for (const frames of frameCounts) {
    for (const pass of ['first', 'warm']) {
      if (!(await queueIsEmpty())) throw new Error('queue became busy; stopping so the operator is not contended');
      const { graph } = variant(base.graph, frames, baseSeed + frames * 7 + (pass === 'warm' ? 1 : 0));
      const label = `${frames} frames (${pass})`;
      const result = await runGraph(lane, graph, { timeoutMs: 600_000, label });
      const run = { frames, pass, seconds: frames / 28, ...result };
      record.runs.push(run);
      console.log(JSON.stringify(run));
    }
  }
  await writeFile(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

await main();
