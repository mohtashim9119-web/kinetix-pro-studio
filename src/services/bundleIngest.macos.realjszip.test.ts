/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom
//
// Operator click-pass bugs, against REAL jszip (no mock — a mock would not
// reproduce Finder's archive shape):
//  BUG 1 — a Finder-made bundle's AppleDouble `._` twins claimed the Script
//    and Voiceover slots, the real script landed in Scene, the real scene was
//    dropped, the real voiceover became ordinary media. Measured on the
//    pre-fix code with the exact bundle below: script='._1. Script.txt',
//    scene='1. Script.txt', voiceover='._3. voiceover.mp3',
//    media=['3. voiceover.mp3'], counts {imported:1, unsupportedSkipped:4}.
//  BUG 2 — a media.zip inside the bundle was an unsupported entry; it is now
//    media, opened one level deep through `zipIngest.ts`'s walk.

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

import { classifyAndIngestBundleZip } from './bundleIngest';
import { ingestZip, ZIP_MAX_ENTRIES } from './zipIngest';
import { isMacOSMetadataPath } from './macosMetadata';
import { buildMediaImportEntry } from './syncLog';

const SCENE_TEXT = '[shot_one] a ridge at dawn\n[shot_two] a valley\n[shot_three] a river';
const SCRIPT_TEXT = 'A lone figure crests the ridge. Below, the valley opens wide.';
// AppleDouble magic (0x00051607) + version — what a real `._` twin starts with.
const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00, 0x4d, 0x61, 0x63, 0x20]);

async function zipBytes(entries: [string, Uint8Array | string][]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of entries) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

beforeEach(() => {
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockDeleteAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

async function sha(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The operator's bundle shape: 1 Script.txt + 1 Scene.txt + 1 voiceover.mp3
 *  + 1 media.zip, as a Mac zips it — `._` twins placed BEFORE their real
 *  file (worst case for first-wins slot claiming), `.DS_Store`, `__MACOSX/`. */
async function macosBundle(mediaZip: Uint8Array): Promise<File> {
  const bundle = await zipBytes([
    ['._1. Script.txt', APPLE_DOUBLE],
    ['1. Script.txt', SCRIPT_TEXT],
    ['._2. Scene.txt', APPLE_DOUBLE],
    ['2. Scene.txt', SCENE_TEXT],
    ['._3. voiceover.mp3', APPLE_DOUBLE],
    ['3. voiceover.mp3', new Uint8Array([9, 9, 9])],
    ['media.zip', mediaZip],
    ['.DS_Store', new Uint8Array([0, 0, 0, 1])],
    ['__MACOSX/manifest', new Uint8Array([7])],
    ['__MACOSX/._media.zip', APPLE_DOUBLE],
    ['__MACOSX/._1. Script.txt', APPLE_DOUBLE],
  ]);
  return new File([bundle], 'bundle.zip');
}

async function finderMediaZip(): Promise<Uint8Array> {
  return zipBytes([
    ['media/._shot_one.jpg', APPLE_DOUBLE],
    ['media/shot_one.jpg', new Uint8Array([1, 1])],
    ['media/shot_two.jpg', new Uint8Array([2, 2])],
    ['media/.DS_Store', new Uint8Array([0, 0, 1])],
    ['__MACOSX/media/._shot_two.jpg', APPLE_DOUBLE],
  ]);
}

describe('BUG 1 — macOS metadata never claims a slot or reaches the vault', () => {
  it('macOS-shaped bundle: Script->script, Scene->scene, voiceover->slot 3, media.zip contents->vault; zero `._`/.DS_Store anywhere', async () => {
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(await finderMediaZip()));
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.scriptFile.name).toBe('1. Script.txt');
    expect(await outcome.scriptFile.text()).toBe(SCRIPT_TEXT);
    expect(outcome.sceneFile.name).toBe('2. Scene.txt');
    expect(await outcome.sceneFile.text()).toBe(SCENE_TEXT);
    expect(outcome.voiceoverFile.name).toBe('3. voiceover.mp3');
    expect(outcome.mediaAssets.map(a => a.name)).toEqual(['shot_one.jpg', 'shot_two.jpg']);
    // Metadata is noise, not a finding: nothing unsupported, nothing failed.
    expect(outcome.counts).toEqual({ imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(outcome.nestedZipsSkipped).toEqual([]);
    const vaultNames = mockMediaVaultImportBytes.mock.calls.map(c => c[2] as string);
    expect(vaultNames).toEqual(['shot_one.jpg', 'shot_two.jpg']);
    expect(vaultNames.some(n => n.startsWith('._') || n === '.DS_Store')).toBe(false);
  });

  it('a Finder-style plain media zip ingests with zero `._`-named assets and no unsupported count', async () => {
    const zip = new File([await finderMediaZip()], 'photos.zip');
    const result = await ingestZip('proj-1', zip);
    expect(result.assets.map(a => a.name)).toEqual(['shot_one.jpg', 'shot_two.jpg']);
    expect(result.counts).toEqual({ imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 });
  });

  it('same-name-different-bytes still both import, same bytes still dedupe, with the filter in place', async () => {
    const zip = new File([await zipBytes([
      ['a/._clip.jpg', APPLE_DOUBLE],
      ['a/clip.jpg', new Uint8Array([1, 2, 3])],
      ['b/._clip.jpg', APPLE_DOUBLE],
      ['b/clip.jpg', new Uint8Array([4, 5, 6])],
      ['c/clip.jpg', new Uint8Array([1, 2, 3])],
      ['__MACOSX/a/._clip.jpg', APPLE_DOUBLE],
    ])], 'clips.zip');
    const result = await ingestZip('proj-1', zip);
    expect(result.counts).toEqual({ imported: 2, deduped: 1, unsupportedSkipped: 0, failed: 0 });
    expect(result.assets.map(a => a.contentHash)).toEqual([
      await sha(new Uint8Array([1, 2, 3])),
      await sha(new Uint8Array([4, 5, 6])),
    ]);
    expect(result.duplicateNames).toEqual(['clip.jpg']);
  });
});

describe('BUG 2 — a zip inside the bundle is media, one level only', () => {
  it('inner media.zip files land in the vault, content-hash deduped (within the inner zip and against the project)', async () => {
    const inProject = new Uint8Array([5, 5, 5]);
    const inner = await zipBytes([
      ['a.jpg', new Uint8Array([1, 1])],
      ['again/a.jpg', new Uint8Array([1, 1])], // same bytes inside the inner zip
      ['already.jpg', inProject],               // same bytes as an existing project asset
      ['b.png', new Uint8Array([2, 2])],
    ]);
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(inner), [await sha(inProject)]);
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.mediaAssets.map(a => a.name)).toEqual(['a.jpg', 'b.png']);
    expect(outcome.counts).toEqual({ imported: 2, deduped: 2, unsupportedSkipped: 0, failed: 0 });
    expect(outcome.duplicateNames).toEqual(['a.jpg', 'already.jpg']);
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(2);
  });

  it('a doubly-nested zip is never opened: one clear finding, nothing ingested from it', async () => {
    const deepest = await zipBytes([['deep_secret.jpg', new Uint8Array([8, 8])]]);
    const inner = await zipBytes([
      ['shot.jpg', new Uint8Array([1])],
      ['more/deeper.zip', deepest],
    ]);
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(inner));
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.nestedZipsSkipped).toEqual(['media.zip/more/deeper.zip']);
    expect(outcome.mediaAssets.map(a => a.name)).toEqual(['shot.jpg']);
    expect(mockMediaVaultImportBytes.mock.calls.map(c => c[2])).not.toContain('deep_secret.jpg');
    // …and the grouped Sync Log finding names it.
    const entry = buildMediaImportEntry('run', 'bundle', outcome.counts, 0, outcome.duplicateNames, outcome.nestedZipsSkipped);
    expect(entry.message).toContain('media.zip/more/deeper.zip');
    expect(entry.severity).toBe('warning');
  });

  it('an inner zip holding no media leaves the bundle without media — fails whole, writes nothing', async () => {
    const inner = await zipBytes([['readme.pdf', new Uint8Array([1])]]);
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(inner));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('at least one media file');
    expect(mockPutAsset).not.toHaveBeenCalled();
  });

  it("the existing entry-count cap fires on the inner zip as-is — whole bundle fails, nothing written", async () => {
    const many: [string, Uint8Array][] = [];
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) many.push([`f${i}.jpg`, new Uint8Array([i & 0xff])]);
    // Metadata twins never count toward the cap — only real entries do.
    const inner = await zipBytes(many);
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(inner));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('media.zip');
    expect(outcome.message).toContain(`${ZIP_MAX_ENTRIES}-file limit`);
    expect(mockPutAsset).not.toHaveBeenCalled();
    expect(mockMediaVaultImportBytes).not.toHaveBeenCalled();
  }, 60_000);

  it('a corrupt inner zip fails the bundle cleanly, writing nothing', async () => {
    const outcome = await classifyAndIngestBundleZip('proj-1', await macosBundle(new Uint8Array([0x50, 0x4b, 1, 2, 3])));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('media.zip');
    expect(mockPutAsset).not.toHaveBeenCalled();
  });
});

describe('isMacOSMetadataPath', () => {
  it.each([
    ['._1. Script.txt', true], ['media/._a.jpg', true], ['.DS_Store', true], ['sub/.DS_Store', true],
    ['__MACOSX', true], ['__MACOSX/manifest', true], ['__MACOSX/media/._a.jpg', true],
    ['1. Script.txt', false], ['media/a.jpg', false], ['.hidden.jpg', false], ['x._y.jpg', false], ['my__MACOSX.jpg', false],
  ])('%s -> %s', (path, expected) => {
    expect(isMacOSMetadataPath(path)).toBe(expected);
  });
});
