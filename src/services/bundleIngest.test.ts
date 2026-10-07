/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G5 — master bundle ingest. `zipIngest.test.ts`'s own "OLD BUG (pre-G5)"
// test documents the bug shape this module fixes (a full-bundle zip's
// script/scene text silently vanishing through plain `ingestZip`); these
// tests prove the new, clean behavior: detection, all-or-nothing validation,
// and the vault-door media write for a bundle that validates.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

/** Same fake JSZipObject shape as `zipIngest.test.ts`'s own fixture, extended
 *  with `async('string')` — this module reads text entries as text, not blob. */
function fakeEntry(
  name: string,
  content: Uint8Array | string,
  opts: { unsafeOriginalName?: string; sizeOverride?: number } = {},
): { name: string; dir: false; unsafeOriginalName?: string; async: (kind: string) => Promise<Blob | string> } {
  return {
    name,
    dir: false,
    unsafeOriginalName: opts.unsafeOriginalName ?? name,
    async: async (kind: string) => {
      if (kind === 'string') {
        return typeof content === 'string' ? content : new TextDecoder().decode(content);
      }
      if (kind !== 'blob') throw new Error(`fakeEntry only supports 'blob'/'string', got ${kind}`);
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      const blob = new Blob([bytes]);
      if (opts.sizeOverride !== undefined) {
        Object.defineProperty(blob, 'size', { value: opts.sizeOverride });
      }
      return blob;
    },
  };
}

let mockZipFiles: Record<string, ReturnType<typeof fakeEntry>> = {};
let mockLoadAsyncImpl: (() => Promise<{ files: Record<string, ReturnType<typeof fakeEntry>> }>) | null = null;
vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      loadAsync: vi.fn().mockImplementation(async () => {
        if (mockLoadAsyncImpl) return mockLoadAsyncImpl();
        return { files: mockZipFiles };
      }),
    };
  }),
}));

import { classifyAndIngestBundleZip } from './bundleIngest';

const PROJECT_ID = 'proj-1';
const SCENE_TEXT = '[shot_one] a ridge at dawn\n[shot_two] a valley\n[shot_three] a river';
const SCRIPT_TEXT = 'A lone figure crests the ridge. Below, the valley opens wide.';

function zipFile(name = 'bundle.zip'): File {
  return new File([new Uint8Array([0])], name);
}

beforeEach(() => {
  mockZipFiles = {};
  mockLoadAsyncImpl = null;
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockDeleteAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

describe('classifyAndIngestBundleZip — not a bundle', () => {
  it('a plain media-only zip (no text, no audio) is not a bundle — nothing is written', async () => {
    mockZipFiles = {
      'photo1.jpg': fakeEntry('photo1.jpg', new Uint8Array([1])),
      'photo2.jpg': fakeEntry('photo2.jpg', new Uint8Array([2])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('not-a-bundle');
    expect(mockPutAsset).not.toHaveBeenCalled();
    expect(mockMediaVaultImportBytes).not.toHaveBeenCalled();
  });
});

describe('classifyAndIngestBundleZip — a full bundle succeeds', () => {
  it('fills all four pieces in one go and writes media through the vault door', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([9, 9, 9])),
      'media/shot_one.jpg': fakeEntry('media/shot_one.jpg', new Uint8Array([1, 1])),
      'media/shot_two.jpg': fakeEntry('media/shot_two.jpg', new Uint8Array([2, 2])),
    };

    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());

    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(await outcome.scriptFile.text()).toBe(SCRIPT_TEXT);
    expect(await outcome.sceneFile.text()).toBe(SCENE_TEXT);
    expect(outcome.voiceoverFile.name).toBe('voice.mp3');
    // 1.5.3 — the bundle door types the voiceover like the manual door does.
    expect(outcome.voiceoverFile.type).toBe('audio/mpeg');
    expect(outcome.mediaAssets).toHaveLength(2);
    expect(outcome.counts).toEqual({ imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(2);
  });

  it('loose top-level media files (no media/ folder) count just as well', async () => {
    // Deliberately an image, not a video — `ingestOneMediaFile` probes video
    // duration via `document.createElement`, unavailable in this suite's
    // plain-node environment (jsdom is a separate opt-in elsewhere); the
    // "loose vs. media/ folder" question this test asks doesn't need video.
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.wav': fakeEntry('voice.wav', new Uint8Array([9])),
      'clip.jpg': fakeEntry('clip.jpg', new Uint8Array([3, 3])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('success');
  });

  it('a second audio file is not silently dropped — it becomes ordinary media, not a second voiceover', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
      'sfx.wav': fakeEntry('sfx.wav', new Uint8Array([2])),
      'shot.jpg': fakeEntry('shot.jpg', new Uint8Array([3])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.voiceoverFile.name).toBe('voice.mp3');
    expect(outcome.mediaAssets.map(a => a.name)).toContain('sfx.wav');
    expect(outcome.mediaAssets).toHaveLength(2);
  });
});

describe('classifyAndIngestBundleZip — a partial bundle fails cleanly, touching nothing', () => {
  it('missing voiceover: fails, names it, writes nothing', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'shot.jpg': fakeEntry('shot.jpg', new Uint8Array([1])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile('partial.zip'));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('partial.zip');
    expect(outcome.message).toContain('voiceover audio file');
    expect(mockPutAsset).not.toHaveBeenCalled();
    expect(mockMediaVaultImportBytes).not.toHaveBeenCalled();
  });

  it('missing scene-details text (only a script-shaped file): fails, names it', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
      'shot.jpg': fakeEntry('shot.jpg', new Uint8Array([2])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('scene-details text file');
  });

  it('missing media entirely (script + scene + voiceover, no media): fails, names it', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('at least one media file');
  });

  it('a corrupt archive fails cleanly without touching anything', async () => {
    mockLoadAsyncImpl = async () => { throw new Error('bad zip'); };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile('corrupt.zip'));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('expected failure');
    expect(outcome.message).toContain('corrupt.zip');
    expect(mockPutAsset).not.toHaveBeenCalled();
  });

  it('an oversized entry fails cleanly, writing nothing, even though earlier entries in the same archive were already classified', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
      'huge.jpg': fakeEntry('huge.jpg', new Uint8Array([1]), { sizeOverride: 5 * 1024 * 1024 * 1024 }),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('failure');
    expect(mockPutAsset).not.toHaveBeenCalled();
  });

  it('a traversal-unsafe entry is excluded from classification, same as ingestZip', async () => {
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
      '../../evil.jpg': fakeEntry('../../evil.jpg', new Uint8Array([1]), { unsafeOriginalName: '../../evil.jpg' }),
      'safe.jpg': fakeEntry('safe.jpg', new Uint8Array([2])),
    };
    // Simulate jszip's real resolve(): an unsafe entry's `name` is rewritten,
    // so `unsafeOriginalName !== name` — mirror that mismatch here directly.
    mockZipFiles['../../evil.jpg']!.unsafeOriginalName = '../../evil.jpg';
    (mockZipFiles['../../evil.jpg'] as { name: string }).name = 'evil.jpg';

    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.mediaAssets).toHaveLength(1);
    expect(outcome.mediaAssets[0]!.name).toBe('safe.jpg');
  });
});

describe('classifyAndIngestBundleZip — dedup against the project', () => {
  it('a media file whose content hash already exists in the project dedupes, not double-imported', async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    mockZipFiles = {
      'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
      'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([1])),
      'dup.jpg': fakeEntry('dup.jpg', bytes),
    };
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const existingHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile(), [existingHash]);
    expect(outcome.kind).toBe('success');
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.counts.deduped).toBe(1);
    expect(outcome.mediaAssets).toHaveLength(0);
  });
});

describe('classifyAndIngestBundleZip — Layer 2 routing (filename keywords only)', () => {
  const BASE = () => ({
    'script.txt': fakeEntry('script.txt', SCRIPT_TEXT),
    'scene.txt': fakeEntry('scene.txt', SCENE_TEXT),
    'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([9])),
    'shot.jpg': fakeEntry('shot.jpg', new Uint8Array([1])),
  });
  const L2_TEXT = '[shot_one] avatar.mp4\n[shot_two]\n[shot_three]';

  it('avatar-scenes.txt routes to layer 2 — and does NOT displace the main scene doc (old trap: detectTextFileRole)', async () => {
    mockZipFiles = { ...BASE(), 'avatar-scenes.txt': fakeEntry('avatar-scenes.txt', L2_TEXT) };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.spotDocFile?.name).toBe('avatar-scenes.txt');
    expect(await outcome.spotDocFile!.text()).toBe(L2_TEXT);
    expect(outcome.sceneFile.name).toBe('scene.txt');
    expect(outcome.scriptFile.name).toBe('script.txt');
    expect(outcome.spotDocNotes ?? []).toEqual([]);
  });

  it('keywords are case-insensitive and filename-only (a folder name does not route)', async () => {
    mockZipFiles = { ...BASE(), 'Overlay/notes.txt': fakeEntry('Overlay/notes.txt', 'plain script words') };
    const a = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (a.kind !== 'success') throw new Error('expected success');
    expect(a.spotDocFile).toBeUndefined();

    mockZipFiles = { ...BASE(), 'LAYER2.TXT': fakeEntry('LAYER2.TXT', L2_TEXT) };
    const b = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (b.kind !== 'success') throw new Error('expected success');
    expect(b.spotDocFile?.name).toBe('LAYER2.TXT');
  });

  it('two keyword files are ambiguous: none routed, honest note naming both', async () => {
    mockZipFiles = {
      ...BASE(),
      'avatar-a.txt': fakeEntry('avatar-a.txt', L2_TEXT),
      'overlay-b.txt': fakeEntry('overlay-b.txt', L2_TEXT),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.spotDocFile).toBeUndefined();
    expect(outcome.spotDocNotes).toHaveLength(1);
    expect(outcome.spotDocNotes![0]).toContain('avatar-a.txt');
    expect(outcome.spotDocNotes![0]).toContain('overlay-b.txt');
  });

  it('a layer-2 doc is never required: validation unchanged, field simply absent', async () => {
    mockZipFiles = BASE();
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect('spotDocFile' in outcome).toBe(false);
  });

  it('macOS metadata twin of the layer-2 doc is filtered for free', async () => {
    mockZipFiles = {
      ...BASE(),
      'avatar-scenes.txt': fakeEntry('avatar-scenes.txt', L2_TEXT),
      '__MACOSX/._avatar-scenes.txt': fakeEntry('__MACOSX/._avatar-scenes.txt', 'junk'),
      '._avatar-scenes.txt': fakeEntry('._avatar-scenes.txt', 'junk'),
    };
    const outcome = await classifyAndIngestBundleZip(PROJECT_ID, zipFile());
    if (outcome.kind !== 'success') throw new Error('expected success');
    expect(outcome.spotDocFile?.name).toBe('avatar-scenes.txt');
    expect(outcome.spotDocNotes ?? []).toEqual([]);
  });
});
