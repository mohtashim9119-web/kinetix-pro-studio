// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * S1 MEASURE FIRST — wall times for the bulk add path and zip ingest on this
 * machine. Prints a ranked step table. Does not assert a speed budget (S3
 * does, after the fix). Main-thread blockage is the max gap between 16ms
 * pings while the work runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import 'fake-indexeddb/auto';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock('./assetStore', () => ({
  putAsset: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./mediaVaultClient', () => ({ mediaVaultImportBytes: vi.fn().mockResolvedValue(null), mediaVaultFsyncDir: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn(), probeAudioDuration: vi.fn(), isTauri: () => false }));

import { ingestZip } from './zipIngest';
import { ingestLooseFiles, sha256Hex } from './mediaIngest';
import { BulkRowStore, writeStagedDiff, type BulkRowDeps } from './bulkRows';
import { classifyAndIngestBundleZip } from './bundleIngest';
import { beginIngestTrace, endIngestTrace, summarizeIngest, type IngestStep } from './ingestTiming';
import { computeAudioHash } from './spine';
import type { StagedFiles } from '../components/DropZonePanel';

const FILE_BYTES = 10 * 1024 * 1024;
const FILE_COUNT = 10;
const TOTAL = FILE_BYTES * FILE_COUNT;

function incompressible(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

async function mediaZip(): Promise<File> {
  const zip = new JSZip();
  for (let i = 0; i < FILE_COUNT; i++) {
    zip.file(`clip-${i}.jpg`, incompressible(FILE_BYTES, 1000 + i), { compression: 'STORE' });
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return new File([bytes], 'media.zip', { type: 'application/zip' });
}

function pingLoop(): { stop: () => { maxGapMs: number; samples: number } } {
  const gaps: number[] = [];
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
  }, 16);
  return {
    stop: () => {
      clearInterval(id);
      return { maxGapMs: gaps.length ? Math.max(...gaps) : 0, samples: gaps.length };
    },
  };
}

function rollup(steps: readonly IngestStep[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of steps) out[s.name] = (out[s.name] ?? 0) + s.ms;
  return out;
}

beforeEach(() => {
  endIngestTrace();
});

describe('S1 ingest wall times (this machine)', () => {
  it('hashes, extracts, bulk-adds, and ingestZips a 100MiB 10-file zip; prints offenders', async () => {
    const payload = incompressible(FILE_BYTES, 7);
    const hashT0 = performance.now();
    await sha256Hex(payload);
    const hashOneMs = performance.now() - hashT0;

    const zip = await mediaZip();
    const zipBytes = zip.size;

    beginIngestTrace();
    const zipPing = pingLoop();
    const zipT0 = performance.now();
    const ingested = await ingestZip('measure-proj', zip);
    const zipWallMs = performance.now() - zipT0;
    const zipBlock = zipPing.stop();
    const zipSteps = endIngestTrace();
    expect(ingested.counts.imported).toBe(FILE_COUNT);

    const staged: StagedFiles = {
      scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [],
    };
    const deps: BulkRowDeps = {
      loadStaged: async () => staged,
      writeStaged: writeStagedDiff,
      createProject: async () => true,
      purge: async () => undefined,
      removeBundleAsset: async () => undefined,
      hashAudio: computeAudioHash,
      probeDuration: async () => 1,
      cloudActive: () => false,
      stageAudio: async () => ({}),
      ingestBundle: classifyAndIngestBundleZip,
    };
    const store = new BulkRowStore(deps);
    const id = store.addRow()!;

    beginIngestTrace();
    const addPing = pingLoop();
    const addT0 = performance.now();
    await store.addFiles(id, [zip]);
    const addWallMs = performance.now() - addT0;
    const addBlock = addPing.stop();
    const addSteps = endIngestTrace();
    const row = store.snapshot().find(r => r.projectId === id)!;
    expect(row.busy).toBe(false);
    expect(row.files.some(f => f.name === 'media.zip')).toBe(true);

    const vo = new File([new Uint8Array([1, 2, 3])], 'vo.wav', { type: 'audio/wav' });
    const voPing = pingLoop();
    const voT0 = performance.now();
    let encodeStarted = false;
    let encodeDone = false;
    const voDeps: BulkRowDeps = {
      ...deps,
      cloudActive: () => true,
      hashAudio: async () => 'h',
      probeDuration: async () => 1,
      stageAudio: async () => {
        encodeStarted = true;
        await new Promise(r => setTimeout(r, 250));
        encodeDone = true;
        return {};
      },
      writeStaged: async () => undefined,
      loadStaged: async () => ({ scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] }),
    };
    const voStore = new BulkRowStore(voDeps);
    const voId = voStore.addRow()!;
    await voStore.addFiles(voId, [vo]);
    const voAddMs = performance.now() - voT0;
    const voBlock = voPing.stop();
    const voRow = voStore.snapshot().find(r => r.projectId === voId)!;
    const encodeStillRunning = encodeStarted && !encodeDone;

    const loose = Array.from({ length: FILE_COUNT }, (_, i) =>
      new File([incompressible(FILE_BYTES, 200 + i)], `loose-${i}.jpg`, { type: 'image/jpeg' }),
    );
    beginIngestTrace();
    const loosePing = pingLoop();
    const looseT0 = performance.now();
    await ingestLooseFiles('measure-proj', loose);
    const looseWallMs = performance.now() - looseT0;
    const looseBlock = loosePing.stop();
    const looseSteps = endIngestTrace();

    const zipRoll = rollup(zipSteps);
    const addRoll = rollup(addSteps);
    const report = [
      `S1 MACHINE MEASURE  total payload ${TOTAL / (1024 * 1024)}MiB across ${FILE_COUNT} files; zip on disk ${ (zipBytes / (1024 * 1024)).toFixed(1)}MiB`,
      `  sha256 one 10MiB file: ${hashOneMs.toFixed(1)}ms  (×${FILE_COUNT} serial ≈ ${(hashOneMs * FILE_COUNT).toFixed(0)}ms)`,
      `  ingestZip wall: ${zipWallMs.toFixed(1)}ms  max ping gap ${zipBlock.maxGapMs.toFixed(1)}ms (${zipBlock.samples} samples)`,
      summarizeIngest(zipSteps),
      `  bulk addFiles(media zip) wall: ${addWallMs.toFixed(1)}ms  max ping gap ${addBlock.maxGapMs.toFixed(1)}ms`,
      summarizeIngest(addSteps),
      `  voiceover addFiles wall: ${voAddMs.toFixed(1)}ms  busy=${voRow.busy} encodeStarted=${encodeStarted} encodeStillRunning=${encodeStillRunning} max ping gap ${voBlock.maxGapMs.toFixed(1)}ms`,
      `  ingestLooseFiles 10×10MiB wall: ${looseWallMs.toFixed(1)}ms  max ping gap ${looseBlock.maxGapMs.toFixed(1)}ms`,
      summarizeIngest(looseSteps),
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(report);

    expect(zipWallMs).toBeLessThan(15_000);
    expect(addWallMs).toBeLessThan(15_000);
    expect(voAddMs).toBeLessThan(80);
    expect(encodeDone).toBe(false);
    expect(voRow.busy).toBe(false);
    expect(Object.keys({ ...zipRoll, ...addRoll }).length).toBeGreaterThan(0);
  }, 180_000);
});
