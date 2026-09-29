/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared, read-only helpers for the M4 chunk-plan discipline: build the
// PRODUCTION-SHAPED forced-alignment chunk plan (computeFaChunkPlan with the
// language's vocab + cardinal data, exactly as `forcedAlignmentRun.ts` calls it)
// for the three committed corpora from their committed fixtures, and digest it.
// Used by `src/services/chunkPlanM4.test.ts` (plan-shape + restart-stability checks).

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import { loadFaLanguageData } from '../src/services/faLanguageData';
import type { FaLanguageCode } from '../src/services/faTextNormalize';
import type { SilenceInterval } from '../src/services/silenceDetector';
import type { TranscriptToken, VideoSegment } from '../src/types';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const CORPORA = {
  v6: { audioDuration: 1421.29, language: 'en' },
  '173': { audioDuration: 709.01, language: 'en' },
  spanish: { audioDuration: 92.04, language: 'es' },
} as const satisfies Record<string, { audioDuration: number; language: FaLanguageCode }>;
export type CorpusKey = keyof typeof CORPORA;

function loadCsv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(FIX, name), 'utf-8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const headers = lines[0]!.split(',');
  return lines.slice(1).map(line => {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
      } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; } else cur += ch;
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

export function loadCorpusInputs(key: CorpusKey): {
  tokens: TranscriptToken[]; silences: SilenceInterval[]; segments: VideoSegment[];
} {
  const tokens: TranscriptToken[] = loadCsv(`phase4-baseline-${key}-words.csv`)
    .map(r => ({ text: r.text!, startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const silences: SilenceInterval[] = loadCsv(`phase4-baseline-${key}-silences.csv`)
    .map(r => ({ startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const parse = (r: Record<string, string>, text: string, order: number): VideoSegment => ({
    id: r.segmentTag ?? r.tag!, text, startTime: Number(r.startTime), duration: Number(r.duration),
    transition: 'none', animation: 'none', order,
  }) as unknown as VideoSegment;
  const committed = loadCsv(`phase4-fa-second-baseline-${key}-segments.csv`);
  const skippedRows = loadCsv(`phase4-fa-second-baseline-${key}-skipped.csv`);
  const skippedByIndex = new Map(skippedRows.map(r => [Number(r.segmentIndex), r]));
  const total = committed.length + skippedRows.length;
  const segments: VideoSegment[] = [];
  let next = 0;
  for (let i = 0; i < total; i++) {
    const sk = skippedByIndex.get(i);
    if (sk) { segments.push(parse(sk, sk.segmentText!, i)); continue; }
    const c = committed[next++]!;
    segments.push(parse(c, c.text!, i));
  }
  return { tokens, silences, segments };
}

export interface PlanChunk { startSec: number; endSec: number; text: string }

/** The two plan shapes: `prod` (language data supplied — what production
 *  sends) and `raw` (no language data, the historical measurement shape). */
export function buildCorpusPlan(key: CorpusKey, shape: 'prod' | 'raw'): PlanChunk[] {
  const { tokens, silences, segments } = loadCorpusInputs(key);
  const { audioDuration, language } = CORPORA[key];
  if (shape === 'raw') return computeFaChunkPlan(segments, tokens, silences, audioDuration);
  const data = loadFaLanguageData(language)!;
  return computeFaChunkPlan(segments, tokens, silences, audioDuration, undefined, language, data.vocabChars, data.cardinalData);
}

/** Canonical JSON of a plan — sorted keys, compact — the exact string
 *  `cloud/sync_core.py::chunk_plan_hash` hashes. */
export function canonicalPlanJson(chunks: readonly PlanChunk[]): string {
  return JSON.stringify(chunks.map(c => ({ endSec: c.endSec, startSec: c.startSec, text: c.text })));
}

/** Full sha256 of the plan — identical to the gateway's `chunk_plan_hash`. */
export function planHash(chunks: readonly PlanChunk[]): string {
  return createHash('sha256').update(canonicalPlanJson(chunks)).digest('hex');
}

/** First 16 hex of `planHash` — the M4 digest. */
export const planDigest = (chunks: readonly PlanChunk[]): string => planHash(chunks).slice(0, 16);
