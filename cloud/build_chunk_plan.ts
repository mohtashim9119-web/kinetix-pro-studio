/**
 * Build the PRODUCTION-shaped forced-alignment chunk plan for one committed
 * corpus, through the same `buildCorpusPlan` the M4 tests use (one source of
 * truth for how fixtures become a plan — no second CSV loader to drift).
 *
 *   npx --yes tsx cloud/build_chunk_plan.ts <v6|173|spanish> [--out <file>] [--shape prod|raw]
 *
 * Output (JSON): { audioDuration, language, nChunks, digest, planHash, chunks[] }.
 * Default output: $U8_OUT_DIR/<corpus>/u8_plan.json, where U8_OUT_DIR defaults
 * to <repo>/.work-phase4/u8-gate (git-ignored) — nothing tracked is rewritten.
 * Paths resolve from this file's location, so it runs from any cwd / checkout.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CORPORA, buildCorpusPlan, planDigest, planHash, type CorpusKey } from '../scripts/chunkPlanCorpora';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const key = process.argv[2] as CorpusKey | undefined;
  if (!key || !(key in CORPORA)) {
    throw new Error(`usage: build_chunk_plan.ts <${Object.keys(CORPORA).join('|')}> [--out file] [--shape prod|raw]`);
  }
  const shape = (arg('--shape') ?? 'prod') as 'prod' | 'raw';
  if (shape !== 'prod' && shape !== 'raw') throw new Error(`unknown shape ${shape}`);
  const outDir = process.env.U8_OUT_DIR ?? resolve(ROOT, '.work-phase4/u8-gate');
  const dest = resolve(arg('--out') ?? resolve(outDir, key, 'u8_plan.json'));
  const chunks = buildCorpusPlan(key, shape);
  const { audioDuration, language } = CORPORA[key];
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify({
    audioDuration, language, nChunks: chunks.length,
    digest: planDigest(chunks), planHash: planHash(chunks),
    chunks: chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
  }, null, 2));
  console.log(`${key} (${shape}): ${chunks.length} chunks digest=${planDigest(chunks)} -> ${dest}`);
}

main();
