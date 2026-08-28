import { Worker } from 'node:worker_threads';
import type { RegexTestResult } from '../lorebook.ts';

const WORKER_SOURCE = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', ({ id, source, flags, haystack }) => {
    try {
      parentPort.postMessage({ id, matched: new RegExp(source, flags).test(haystack) });
    } catch {
      parentPort.postMessage({ id, matched: false, invalid: true });
    }
  });
`;

type Pending = {
  resolve: (result: RegexTestResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RegexSandbox {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readonly timeoutMilliseconds: number;
  private readonly aggregateTimeoutMilliseconds: number;
  private startedAt = 0;

  constructor(timeoutMilliseconds = 100, aggregateTimeoutMilliseconds = 1000) {
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.aggregateTimeoutMilliseconds = aggregateTimeoutMilliseconds;
  }

  private createWorker(): Worker {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 }
    });
    worker.on('message', (value: unknown) => {
      const message = value as { id?: unknown; matched?: unknown; invalid?: unknown };
      if (!Number.isInteger(message.id)) return;
      const pending = this.pending.get(message.id as number);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id as number);
      pending.resolve({ matched: message.matched === true, invalid: message.invalid === true });
    });
    worker.on('error', () => this.failWorker(worker));
    worker.on('exit', () => this.failWorker(worker));
    this.worker = worker;
    return worker;
  }

  private failWorker(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ matched: false, timeout: true });
    }
  }

  async test(source: string, flags: string, haystack: string): Promise<RegexTestResult> {
    if (!source || source.length > 4096) return { matched: false, invalid: true };
    if (!this.startedAt) this.startedAt = Date.now();
    const remainingAggregate = this.aggregateTimeoutMilliseconds - (Date.now() - this.startedAt);
    if (remainingAggregate <= 0) return { matched: false, timeout: true };
    const worker = this.worker ?? this.createWorker();
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.worker === worker) this.worker = null;
        void worker.terminate().then(
          () => resolve({ matched: false, timeout: true }),
          () => resolve({ matched: false, timeout: true })
        );
      }, Math.min(this.timeoutMilliseconds, remainingAggregate));
      this.pending.set(id, { resolve, timer });
      worker.postMessage({ id, source, flags, haystack });
    });
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ matched: false, timeout: true });
    }
    if (worker) await worker.terminate();
  }
}
