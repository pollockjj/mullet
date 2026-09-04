// This project deliberately carries no @types/node; each Node builtin the server uses is
// declared here with exactly the surface it uses, the same way node:worker_threads is.
declare const process: { cwd(): string; env: Record<string, string | undefined> };

declare class Buffer extends Uint8Array {
  static from(input: string, encoding?: string): Buffer;
  static byteLength(input: string, encoding?: string): number;
  toString(encoding?: string): string;
}

declare module 'node:crypto' {
  export function randomUUID(): string;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
  export function resolve(...segments: string[]): string;
  export const sep: string;
}

declare module 'node:fs/promises' {
  export type Dirent = { name: string; isFile(): boolean; isDirectory(): boolean };
  export type Stats = { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean };
  export type FileHandle = {
    write(data: string | Uint8Array): Promise<{ bytesWritten: number }>;
    writeFile(data: string | Uint8Array, encoding?: string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  };
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] & Dirent[]>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(path: string, data: string | Uint8Array, encoding?: string): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function stat(path: string): Promise<Stats>;
  export function open(path: string, flags: string): Promise<FileHandle>;
  export function rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
}
