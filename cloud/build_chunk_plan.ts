/**
 * Rebuild the production FA chunk plan from committed fixtures via the live
 * TypeScript planner. Does not modify src/; it only imports computeFaChunkPlan.
 *
 *   npx tsx cloud/build_chunk_plan.ts v6
 *   npx tsx cloud/build_chunk_plan.ts spanish
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = resolve(ROOT, 'scripts/fixtures');
const OUT = resolve(ROOT, 'cloud/results');

const SHAPE = {
  v6: { audioDuration: 1421.29 },
  spanish: { audioDuration: 92.04 },
  '173': { audioDuration: 709.01 },
} as const;

type Corpus = keyof typeof SHAPE;

function loadCsv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(FIX, name), 'utf-8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const headers = lines[0]!.split(',');
  return lines.slice(1).map(line => {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function loadInputs(key: Corpus): {
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

function digest(chunks: { startSec: number; endSec: number; text: string }[]): string {
  const body = chunks.map(c => `${c.startSec.toFixed(4)}|${c.endSec.toFixed(4)}|${c.text}`).join('\n');
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function main(): void {
  const key = (process.argv[2] ?? 'v6') as Corpus;
  if (!(key in SHAPE)) throw new Error(`unknown corpus ${key}`);
  mkdirSync(OUT, { recursive: true });
  const { tokens, silences, segments } = loadInputs(key);
  const chunks = computeFaChunkPlan(segments, tokens, silences, SHAPE[key].audioDuration);
  const payload = {
    audioDuration: SHAPE[key].audioDuration,
    language: key === 'spanish' ? 'es' : 'en',
    nChunks: chunks.length,
    digest: digest(chunks),
    chunks: chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
  };
  const dest = resolve(OUT, `chunk_plan_${key}.json`);
  writeFileSync(dest, JSON.stringify(payload, null, 2));
  console.log(`${key}: ${chunks.length} chunks digest=${payload.digest} -> ${dest}`);
}

main();
