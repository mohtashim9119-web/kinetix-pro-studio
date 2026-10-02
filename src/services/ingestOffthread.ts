/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Off-main-thread SHA-256 and zip load/extract. Falls back in-process when
 *  `Worker` is missing (vitest). */

let testWorker: Worker | null = null;

export function hasIngestWorker(): boolean {
  return typeof Worker !== 'undefined' || testWorker !== null;
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexOffthread(bytes: Uint8Array): Promise<string> {
  if (!hasIngestWorker()) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return toHex(digest);
  }
  const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const hex = await callWorker<string>({ kind: 'hash', bytes: copy } as Omit<WorkerIn, 'id'>, [copy]);
  return hex;
}

export interface ZipWalkMedia {
  name: string;
  bytes: Uint8Array;
  type: 'video' | 'audio' | 'image';
}

export interface ZipWalkMeta {
  unsupportedSkipped: number;
  unsafeRejected: number;
  nestedZipNames: string[];
}

export async function walkZipInWorker(
  zipSource: Blob,
  onMedia: (name: string, blob: Blob, type: ZipWalkMedia['type']) => Promise<void>,
): Promise<ZipWalkMeta> {
  if (!hasIngestWorker()) {
    throw new Error('walkZipInWorker: no Worker');
  }
  const result = await callWorker<{ entries: ZipWalkMedia[]; meta: ZipWalkMeta }>(
    { kind: 'zipWalk', zip: zipSource } as Omit<WorkerIn, 'id'>,
  );
  for (const e of result.entries) {
    const copy = e.bytes.byteOffset === 0 ? e.bytes : e.bytes.slice();
    await onMedia(e.name, new Blob([copy]), e.type);
  }
  return result.meta;
}

type WorkerIn =
  | { id: number; kind: 'hash'; bytes: ArrayBuffer }
  | { id: number; kind: 'zipWalk'; zip: Blob };

type WorkerOut =
  | { id: number; kind: 'hash'; hex: string }
  | { id: number; kind: 'zipWalk'; entries: ZipWalkMedia[]; meta: ZipWalkMeta }
  | { id: number; kind: 'error'; message: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (testWorker) return testWorker;
  if (worker) return worker;
  const w = new Worker(new URL('./ingestWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.kind === 'error') p.reject(new Error(msg.message));
    else if (msg.kind === 'hash') p.resolve(msg.hex);
    else p.resolve({ entries: msg.entries, meta: msg.meta });
  };
  w.onerror = (e) => {
    const err = new Error(`ingestWorker crashed: ${e.message || 'unknown'}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

function callWorker<T>(body: Omit<WorkerIn, 'id'>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    w.postMessage({ ...body, id }, transfer);
  });
}

/** Test-only: inject a Worker so ping-gap tests can prove the main thread yields. */
export function __setIngestWorkerForTests(w: Worker | null): void {
  worker?.terminate();
  worker = null;
  testWorker = w;
  pending.clear();
  if (w) {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.kind === 'error') p.reject(new Error(msg.message));
      else if (msg.kind === 'hash') p.resolve(msg.hex);
      else p.resolve({ entries: msg.entries, meta: msg.meta });
    };
  }
}
