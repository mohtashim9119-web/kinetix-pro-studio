/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Client-side forced-alignment cache. Written onto the project at reveal.
// A later Build Timeline whose audio, script, engine and plan hashes all
// match serves these word timings locally: no cloud call, no encode.
// Any one of those hashes changing is a miss — the run goes to the gateway.

import type { FaWordSpan } from './faBoundaryTypes';
import type { TimingProvenance } from '../types';

export interface ClientFaCache {
  audioHash: string;
  scriptHash: string;
  engineKey: string;
  planHash: string;
  /** Stable id of this alignment: the four hashes, in that order. */
  alignmentKey: string;
  words: FaWordSpan[];
  provenanceLine: string;
  provenance?: TimingProvenance;
}

export interface ClientFaKey {
  audioHash: string;
  scriptHash: string;
  engineKey: string;
  planHash: string;
}

export function alignmentKey(key: ClientFaKey): string {
  return `${key.audioHash}|${key.scriptHash}|${key.engineKey}|${key.planHash}`;
}

/** A stable hash of the chunk plan the cloud aligner was given. Not the planner. */
export function planHashOf(chunks: readonly { startSec: number; endSec: number; text: string }[]): string {
  const canonical = chunks.map(c => `${c.startSec.toFixed(3)}|${c.endSec.toFixed(3)}|${c.text}`).join('\n');
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeClientFaCache(key: ClientFaKey, words: readonly FaWordSpan[], provenanceLine: string, provenance?: TimingProvenance): ClientFaCache {
  return {
    ...key,
    alignmentKey: alignmentKey(key),
    words: words.map(w => ({ ...w })),
    provenanceLine,
    provenance,
  };
}

export interface ClientFaQuery {
  cache?: ClientFaCache;
  scriptHash: string;
  engineKey: string;
}

let boundQuery: ClientFaQuery | undefined;
let pendingStamp: ClientFaCache | undefined;

/** Wrap one cloud alignment so a project-record hit is served inside it. */
export async function withClientFaCache<T>(query: ClientFaQuery | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = boundQuery;
  boundQuery = query;
  try { return await fn(); } finally { boundQuery = prev; }
}

export function currentClientFaQuery(): ClientFaQuery | undefined {
  return boundQuery;
}

export function noteClientFaStamp(cache: ClientFaCache): void {
  pendingStamp = cache;
}

/** The stamp the reveal should write onto the project, if this run produced one. */
export function takeClientFaStamp(): ClientFaCache | undefined {
  const stamp = pendingStamp;
  pendingStamp = undefined;
  return stamp;
}

/** Byte-identical words when every hash matches. Null on any re-key. */
export function readClientFaCache(cache: ClientFaCache | undefined, key: ClientFaKey): FaWordSpan[] | null {
  if (!cache) return null;
  if (cache.alignmentKey !== alignmentKey(key)) return null;
  if (cache.audioHash !== key.audioHash || cache.scriptHash !== key.scriptHash
    || cache.engineKey !== key.engineKey || cache.planHash !== key.planHash) return null;
  return cache.words.map(w => ({ ...w }));
}
