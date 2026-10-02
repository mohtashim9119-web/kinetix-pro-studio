/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom
//
// Real jszip's zip.loadAsync(File) reads via FileReader, which the default
// `node` test environment doesn't provide — the real app runs in a WebView
// (browser-like), so jsdom here matches production, not a workaround.

// ---------------------------------------------------------------------------
// G6 fix round, Bug 1 — `zipIngest.test.ts` mocks jszip with a `fakeEntry()`
// helper whose `unsafeOriginalName` defaults to `undefined` unless a test
// opts in. Real jszip (3.10.1) does not behave that way: `unsafeOriginalName`
// is set on EVERY non-directory entry, unconditionally (see
// `node_modules/jszip/lib/load.js`) — it equals `name` for a safe entry and
// differs from it only when `utils.resolve()` actually rewrote the path
// (a genuine traversal/zip-slip attempt). The old `unsafeOriginalName !==
// undefined` check was therefore true for every real entry, rejecting 100%
// of any real zip — exactly the operator's "0 imported, 27 failed" report.
//
// This file exercises `ingestZip` against the REAL jszip dependency (no
// `vi.mock('jszip', ...)`) so this class of bug can never again be masked by
// a mock that doesn't match the real library's contract.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

const mockPutAsset = vi.fn();
const mockDeleteAsset = vi.fn();
vi.mock('./assetStore', () => ({
  putAsset: (...args: unknown[]) => mockPutAsset(...args),
  deleteAsset: (...args: unknown[]) => mockDeleteAsset(...args),
}));

const mockMediaVaultImportBytes = vi.fn();
vi.mock('./mediaVaultClient', () => ({
  mediaVaultImportBytes: (...args: unknown[]) => mockMediaVaultImportBytes(...args),
  mediaVaultFsyncDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn() }));

import { ingestZip } from './zipIngest';

const PROJECT_ID = 'proj-1';

beforeEach(() => {
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockDeleteAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

async function buildZip(entries: Record<string, Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [path, bytes] of Object.entries(entries)) {
    zip.file(path, bytes);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes], 'archive.zip');
}

describe('ingestZip against real jszip — the four representative shapes all import', () => {
  it('(a) top-level folder — MyPack/clip1.mp4', async () => {
    const zip = await buildZip({ 'MyPack/clip1.jpg': new Uint8Array([1, 2, 3]) });
    const result = await ingestZip(PROJECT_ID, zip);
    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('(b) flat — no folder prefix', async () => {
    const zip = await buildZip({ 'flat.jpg': new Uint8Array([1, 2, 3]) });
    const result = await ingestZip(PROJECT_ID, zip);
    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('(c) unicode entry name', async () => {
    const zip = await buildZip({ 'üñïçødé-clip.jpg': new Uint8Array([1, 2, 3]) });
    const result = await ingestZip(PROJECT_ID, zip);
    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('(d) nested folders — Nested/Sub/clip2.mp4', async () => {
    const zip = await buildZip({ 'Nested/Sub/clip2.jpg': new Uint8Array([1, 2, 3]) });
    const result = await ingestZip(PROJECT_ID, zip);
    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('a full 27-file, foldered zip (the operator\'s reported shape) imports all 27', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 27; i++) {
      entries[`MyPack/clip${i}.jpg`] = new Uint8Array([i, i + 1, i + 2]);
    }
    const zip = await buildZip(entries);
    const result = await ingestZip(PROJECT_ID, zip);
    expect(result.counts).toEqual({ imported: 27, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('a genuine traversal entry alongside safe entries is still rejected, never extracted', async () => {
    const zip = new JSZip();
    zip.file('../../etc/passwd', new Uint8Array([1]));
    zip.file('safe.jpg', new Uint8Array([2, 2]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes], 'archive.zip');

    const result = await ingestZip(PROJECT_ID, file);

    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 1 });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.name).toBe('safe.jpg');
  });
});
