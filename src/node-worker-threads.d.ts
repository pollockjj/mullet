declare module 'node:worker_threads' {
  export class Worker {
    constructor(filename: string | URL, options?: {
      eval?: boolean;
      resourceLimits?: {
        maxOldGenerationSizeMb?: number;
        maxYoungGenerationSizeMb?: number;
        stackSizeMb?: number;
      };
    });
    on(event: 'message', listener: (value: unknown) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (exitCode: number) => void): this;
    postMessage(value: unknown): void;
    terminate(): Promise<number>;
  }
}
