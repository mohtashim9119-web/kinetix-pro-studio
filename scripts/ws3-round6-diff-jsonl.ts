#!/usr/bin/env npx tsx
/**
 * Compare Round 6 chunk-hash tags from public/_spike/ws3-result.jsonl.
 *
 * Usage:
 *   npx tsx scripts/ws3-round6-diff-jsonl.ts post-fix pre-fix
 * Looks for tags round6-equiv-40s-4assets-chunk-hashes with matching labels
 * in nearby round6-autorun-start payloads, or the two most recent hash tags.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { firstChunkMismatch, type ChunkFingerprint } from '../src/services/webcodecsExport/annexbChunkCompare';

interface JsonlRow {
  tag: string;
  payload: unknown;
  ts: number;
}

function loadJsonl(path: string): JsonlRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonlRow);
}

function hashesToFingerprints(hashes: string[]): ChunkFingerprint[] {
  return hashes.map((sha256, index) => ({
    index,
    sha256,
    byteLength: 0,
    timestamp: null,
  }));
}

const CHUNK_FPS = 30;

function findPieceSha(rows: JsonlRow[], label?: string): string | null {
  const pick = (r: JsonlRow): string | null => {
    const d = (r.payload as { digest?: { pieceSha256?: string } } | null)?.digest;
    return typeof d?.pieceSha256 === 'string' ? d.pieceSha256 : null;
  };
  if (label) {
    const starts = rows.filter((r) => r.tag === 'round6-autorun-start');
    for (let i = starts.length - 1; i >= 0; i--) {
      const start = starts[i]!;
      if ((start.payload as { label?: string }).label !== label) continue;
      const row = rows.find((r) => r.tag === 'round6-equiv-40s-4assets' && r.ts >= start.ts);
      if (row) return pick(row);
    }
    return null;
  }
  const all = rows.filter((r) => r.tag === 'round6-equiv-40s-4assets');
  const last = all[all.length - 1];
  return last ? pick(last) : null;
}

function findHashes(rows: JsonlRow[], label?: string): string[] | null {
  if (label) {
    const starts = rows.filter((r) => r.tag === 'round6-autorun-start');
    for (let i = starts.length - 1; i >= 0; i--) {
      const start = starts[i]!;
      const pl = start.payload as { label?: string };
      if (pl.label !== label) continue;
      const hashRow = rows.find(
        (r) => r.tag === 'round6-equiv-40s-4assets-chunk-hashes' && r.ts >= start.ts,
      );
      if (hashRow && Array.isArray(hashRow.payload)) return hashRow.payload as string[];
    }
    return null;
  }
  const tags = rows.filter((r) => r.tag === 'round6-equiv-40s-4assets-chunk-hashes');
  const last = tags[tags.length - 1];
  return last && Array.isArray(last.payload) ? (last.payload as string[]) : null;
}

function main(): void {
  const jsonlPath = resolve(process.cwd(), 'public/_spike/ws3-result.jsonl');
  const [aLabel, bLabel] = process.argv.slice(2);
  const rows = loadJsonl(jsonlPath);

  const a = findHashes(rows, aLabel);
  const b = findHashes(rows, bLabel);
  if (!a || !b) {
    console.error('Could not find chunk-hash tags.', { aLabel, bLabel, aLen: a?.length, bLen: b?.length });
    process.exit(1);
  }

  console.log(`A (${aLabel ?? 'latest'}): ${a.length} chunks  pieceSha256=${findPieceSha(rows, aLabel) ?? 'n/a'}`);
  console.log(`B (${bLabel ?? 'prior'}): ${b.length} chunks  pieceSha256=${findPieceSha(rows, bLabel) ?? 'n/a'}`);

  const mismatch = firstChunkMismatch(hashesToFingerprints(a), hashesToFingerprints(b));
  if (!mismatch) {
    console.log('MATCH — byte-for-byte equivalent annexb chunk sequence');
    process.exit(0);
  }
  // Chunks are 1:1 with encoded frames on this fixture, so the timeline instant
  // is derived from the index; appendFileRaw carries no per-chunk timestamp.
  const derivedSec = mismatch.index / CHUNK_FPS;
  console.log('MISMATCH at chunk', mismatch.index, 'timestamp', mismatch.timestamp);
  console.log(`  derived timeline instant: ${derivedSec.toFixed(4)}s (index / ${CHUNK_FPS}fps)`);
  console.log(`  A[${mismatch.index}] = ${a[mismatch.index] ?? '(absent)'}`);
  console.log(`  B[${mismatch.index}] = ${b[mismatch.index] ?? '(absent)'}`);
  process.exit(2);
}

main();
