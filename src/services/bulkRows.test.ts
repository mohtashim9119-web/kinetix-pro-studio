// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — row ingest (real jszip, the real bundle classifier) and the
// eager, GPU-free audio staging.
//
// OLD BUG 2: before this unit the only way to get audio onto the gateway was
// as step one of a job attempt (attemptStageCacheFirst: lookup miss -> upload
// -> submit). `prepareCloudAudio` existed as a primitive but nothing in the
// app could call it without a job following. The IPC-level test below drives
// the new stage-audio-only path over a fake gateway and asserts the wire:
// the audio is PUT and the gateway then confirms it present, with no job
// ever submitted and no cache lookup — across a three-project staging window.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import JSZip from 'jszip';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
const mockPutAsset = vi.fn();
vi.mock('./assetStore', () => ({ putAsset: (...a: unknown[]) => mockPutAsset(...a), deleteAsset: vi.fn() }));
vi.mock('./mediaVaultClient', () => ({ mediaVaultImportBytes: vi.fn().mockResolvedValue(null) }));
vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn(), probeAudioDuration: vi.fn(), isTauri: () => true }));

import { invoke } from '@tauri-apps/api/core';
import { BulkRowStore, classifyRowDrop, type BulkRowDeps } from './bulkRows';
import { classifyAndIngestBundleZip } from './bundleIngest';
import { __resetCloudAudioInFlightForTests, stageCloudAudioOnly } from './cloudSyncEngine';
import { computeAudioHash } from './spine';
import type { StagedFiles } from '../components/DropZonePanel';

const mockInvoke = invoke as unknown as Mock;
const EMPTY: StagedFiles = { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] };
const SCENE = '[shot_one] a ridge\n[shot_two] a valley\n[shot_three] a river';
const SCRIPT = 'A lone figure crests the ridge.';
const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02]);

async function bundleZip(extra: [string, Uint8Array | string][] = []): Promise<File> {
  const zip = new JSZip();
  zip.file('1. Script.txt', SCRIPT);
  zip.file('2. Scene.txt', SCENE);
  zip.file('3. voiceover.mp3', new Uint8Array([1, 2, 3]));
  zip.file('media/a.jpg', new Uint8Array([9, 9, 1]));
  zip.file('media/b.png', new Uint8Array([9, 9, 2]));
  for (const [p, c] of extra) zip.file(p, c);
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'bundle.zip');
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  __resetCloudAudioInFlightForTests();
});

describe('row ingest — the DropZone rules, applied per row', () => {
  it('ONE bundle zip fills all four slots of a row (script, scene, voiceover, media), macOS twins excluded', async () => {
    const zip = await bundleZip([['._1. Script.txt', APPLE_DOUBLE], ['.DS_Store', APPLE_DOUBLE], ['__MACOSX/x.txt', APPLE_DOUBLE]]);
    const drop = await classifyRowDrop('p1', EMPTY, [zip], { ingestBundle: classifyAndIngestBundleZip });
    expect(drop.next.scriptFile?.file.name).toBe('1. Script.txt');
    expect(drop.next.sceneFile?.file.name).toBe('2. Scene.txt');
    expect(drop.next.voiceoverFile?.file.name).toBe('3. voiceover.mp3');
    expect(drop.bundleMedia.map(a => a.name).sort()).toEqual(['a.jpg', 'b.png']);
    expect(drop.voiceover?.name).toBe('3. voiceover.mp3');
    expect(await drop.next.scriptFile!.file.text()).toBe(SCRIPT);
  });

  it('loose files and a folder route by role: text by bracket count, audio to voiceover, images/videos to media; metadata and junk are dropped', async () => {
    const f = (name: string, body: BlobPart = 'x', rel?: string): File => {
      const file = new File([body], name);
      if (rel) Object.defineProperty(file, 'webkitRelativePath', { value: rel });
      return file;
    };
    const drop = await classifyRowDrop('p1', EMPTY, [
      f('script.txt', SCRIPT), f('scenes.txt', SCENE), f('vo.wav'),
      f('a.png', 'x', 'shots/a.png'), f('b.mp4', 'x', 'shots/b.mp4'),
      f('._a.png', 'x', 'shots/._a.png'), f('.DS_Store', 'x', 'shots/.DS_Store'), f('notes.docx'),
    ], { ingestBundle: classifyAndIngestBundleZip });
    expect(drop.next.scriptFile?.file.name).toBe('script.txt');
    expect(drop.next.sceneFile?.file.name).toBe('scenes.txt');
    expect(drop.next.voiceoverFile?.file.name).toBe('vo.wav');
    expect(drop.next.assetFiles.map(a => a.file.name)).toEqual(['a.png', 'b.mp4']);
    expect(drop.notes.join(' ')).toContain('1 file was skipped');
  });

  it('a plain media zip is staged as a zip (Apply Sync unpacks it), not a bundle; a broken bundle writes nothing and says why', async () => {
    const media = new JSZip();
    media.file('a.jpg', new Uint8Array([1]));
    const plain = new File([await media.generateAsync({ type: 'uint8array' })], 'media.zip');
    const half = new JSZip();
    half.file('script.txt', SCRIPT);
    const broken = new File([await half.generateAsync({ type: 'uint8array' })], 'half.zip');
    const drop = await classifyRowDrop('p1', EMPTY, [plain, broken], { ingestBundle: classifyAndIngestBundleZip });
    expect(drop.next.zipFiles.map(z => z.file.name)).toEqual(['media.zip']);
    expect(drop.next.scriptFile).toBeNull();
    expect(drop.notes.join(' ')).toContain('missing');
  });

  it('a second drop adds to what the row already holds (media accumulates, a new voiceover replaces)', async () => {
    const first = await classifyRowDrop('p1', EMPTY, [new File(['x'], 'a.png'), new File(['1'], 'v1.wav')], { ingestBundle: classifyAndIngestBundleZip });
    const second = await classifyRowDrop('p1', first.next, [new File(['x'], 'b.png'), new File(['2'], 'v2.wav')], { ingestBundle: classifyAndIngestBundleZip });
    expect(second.next.assetFiles.map(a => a.file.name)).toEqual(['a.png', 'b.png']);
    expect(second.next.voiceoverFile?.file.name).toBe('v2.wav');
  });
});

describe('BulkRowStore — draft rows, files, and creation only at Build Timeline', () => {
  function fakeDeps(over: Partial<BulkRowDeps> = {}): {
    deps: BulkRowDeps; staged: Map<string, StagedFiles>; stageAudio: Mock; created: { id: string; name: string; assets: unknown[] }[]; purged: string[]; removedAssets: string[];
  } {
    const staged = new Map<string, StagedFiles>();
    const stageAudio = vi.fn().mockResolvedValue({ uploaded: true });
    const created: { id: string; name: string; assets: unknown[] }[] = [];
    const purged: string[] = [];
    const removedAssets: string[] = [];
    const deps: BulkRowDeps = {
      loadStaged: async id => staged.get(id) ?? null,
      writeStaged: async (id, _prev, next) => { staged.set(id, next); },
      createProject: async info => { created.push(info); return true; },
      purge: async id => { purged.push(id); staged.delete(id); },
      removeBundleAsset: async (_id, asset) => { removedAssets.push(asset.id); },
      hashAudio: computeAudioHash,
      probeDuration: async () => 42,
      cloudActive: () => true,
      stageAudio,
      ingestBundle: classifyAndIngestBundleZip,
      ...over,
    };
    return { deps, staged, stageAudio, created, purged, removedAssets };
  }
  const four = (): File[] => [
    new File(['line'], 'script.txt'), new File(['[a] x\n[b] y\n[c] z'], 'scene.txt'),
    new File(['a'], 'vo.wav'), new File(['i'], 'a.png'),
  ];

  it('init makes N EMPTY drafts: nothing is created or registered anywhere', async () => {
    const { deps, created } = fakeDeps();
    const store = new BulkRowStore(deps);
    store.init(5);
    expect(store.snapshot()).toHaveLength(5);
    expect(new Set(store.snapshot().map(r => r.projectId)).size).toBe(5);
    expect(created).toEqual([]);
  });

  it('a bundle zip fills the four slots, the voiceover is hashed, probed and staged to the gateway (once); a row needs a NAME too before it is buildable', async () => {
    const { deps, stageAudio } = fakeDeps();
    const store = new BulkRowStore(deps);
    store.init(2);
    const [r1, r2] = store.snapshot().map(r => r.projectId);
    await store.addFiles(r1!, [await bundleZip()]);
    await vi.waitFor(() => expect(store.snapshot()[0]!.audio.state).toBe('ready'));
    expect(store.snapshot()[0]!.slots).toEqual({ script: true, scene: true, voiceover: true, media: true });
    expect(store.snapshot()[1]!.slots).toEqual({ script: false, scene: false, voiceover: false, media: false });
    expect(store.completeIds()).toEqual([]);
    store.setTypedName(r1!, 'Alpine');
    expect(store.completeIds()).toEqual([r1]);
    expect(r2).toBeDefined();
    expect(stageAudio).toHaveBeenCalledTimes(1);
    expect(stageAudio.mock.calls[0]![2]).toBe(42);
  });

  it('Build Timeline creates ONLY the real rows; empty drafts are discarded (and purged); a half-filled row stays a draft with its reason', async () => {
    const { deps, created, purged } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(5);
    const ids = store.snapshot().map(r => r.projectId);
    await store.addFiles(ids[0]!, four()); store.setTypedName(ids[0]!, 'Alpine');
    await store.addFiles(ids[1]!, four()); store.setTypedName(ids[1]!, 'Valley');
    await store.addFiles(ids[2]!, [new File(['just a script'], 'script.txt')]); store.setTypedName(ids[2]!, 'Half');
    // ids[3], ids[4]: untouched.
    const out = await store.buildReady();
    expect(created.map(c => c.name)).toEqual(['Alpine', 'Valley']);
    expect(created.map(c => c.id)).toEqual([ids[0], ids[1]]);
    expect(out.created.map(c => c.name)).toEqual(['Alpine', 'Valley']);
    expect(purged.sort()).toEqual([ids[3], ids[4]].sort());
    expect(store.snapshot().map(r => r.projectId)).toEqual([ids[0], ids[1], ids[2]]);
    expect(out.skips[ids[2]!]).toBe('Add a scene doc, a voiceover and media to build the timeline');
    expect(store.snapshot()[0]!.built).toBe(true);
    expect(store.snapshot()[2]!.built).toBe(false);
  });

  it('a row with all four slots but no name is a draft, not a project', async () => {
    const { deps, created } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(1);
    const id = store.snapshot()[0]!.projectId;
    await store.addFiles(id, four());
    const out = await store.buildReady();
    expect(created).toEqual([]);
    expect(out.skips[id]).toBe('Add a project name to build the timeline');
  });

  it('a bundle\'s vaulted media rides into the created project', async () => {
    const { deps, created } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(1);
    const id = store.snapshot()[0]!.projectId;
    await store.addFiles(id, [await bundleZip()]);
    store.setTypedName(id, 'Bundle');
    await store.buildReady();
    expect(created[0]!.assets).toHaveLength(2);
  });

  it('Add project appends one more empty draft, up to the cap', async () => {
    const { deps } = fakeDeps();
    const store = new BulkRowStore(deps, 3);
    store.init(2);
    expect(store.canAddRow()).toBe(true);
    expect(store.addRow()).toBeDefined();
    expect(store.snapshot()).toHaveLength(3);
    expect(store.canAddRow()).toBe(false);
    expect(store.addRow()).toBeUndefined();
  });

  it('removing ONE wrong file leaves the rest, recomputes the slots, and lists what is in the row', async () => {
    const { deps, staged } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(1);
    const id = store.snapshot()[0]!.projectId;
    await store.addFiles(id, [...four(), new File(['j'], 'b.png')]);
    expect(store.snapshot()[0]!.files.map(f => f.name)).toEqual(['script.txt', 'scene.txt', 'vo.wav', 'a.png', 'b.png']);
    const b = store.snapshot()[0]!.files.find(f => f.name === 'b.png')!;
    await store.removeFile(id, b.id);
    expect(store.snapshot()[0]!.files.map(f => f.name)).toEqual(['script.txt', 'scene.txt', 'vo.wav', 'a.png']);
    expect(store.snapshot()[0]!.mediaCount).toBe(1);
    await store.removeFile(id, 'voiceover');
    expect(store.snapshot()[0]!.slots.voiceover).toBe(false);
    expect(staged.get(id)!.voiceoverFile).toBeNull();
    expect(staged.get(id)!.scriptFile).not.toBeNull();
  });

  it('removing a bundle\'s media deletes that vaulted asset; clearing a row purges everything but keeps the row and its name', async () => {
    const { deps, purged, removedAssets } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(1);
    const id = store.snapshot()[0]!.projectId;
    store.setTypedName(id, 'Keep me');
    await store.addFiles(id, [await bundleZip()]);
    const first = store.snapshot()[0]!.files.find(f => f.id.startsWith('bundle:'))!;
    await store.removeFile(id, first.id);
    expect(removedAssets).toHaveLength(1);
    expect(store.snapshot()[0]!.mediaCount).toBe(1);
    await store.clearFiles(id);
    expect(purged).toContain(id);
    const row = store.snapshot()[0]!;
    expect(row.files).toEqual([]);
    expect(row.slots).toEqual({ script: false, scene: false, voiceover: false, media: false });
    expect(row.typedName).toBe('Keep me');
  });

  it('closing the modal discards every unbuilt draft and keeps built ones', async () => {
    const { deps, purged } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(3);
    const ids = store.snapshot().map(r => r.projectId);
    await store.addFiles(ids[0]!, four()); store.setTypedName(ids[0]!, 'Real');
    await store.buildReady(); // creates ids[0]; discards the two empty ones
    store.addRow();
    await store.discardUnbuilt();
    expect(store.snapshot().map(r => r.projectId)).toEqual([ids[0]]);
    expect(purged.length).toBe(3);
  });

  it('local engine: the voiceover is staged in the row but nothing is encoded or uploaded', async () => {
    const { deps, stageAudio } = fakeDeps({ cloudActive: () => false });
    const store = new BulkRowStore(deps);
    store.init(1);
    await store.addFiles(store.snapshot()[0]!.projectId, [new File(['a'], 'v.wav')]);
    expect(store.snapshot()[0]!.audio.state).toBe('local');
    expect(stageAudio).not.toHaveBeenCalled();
  });

  it('a failed audio prep is shown on the row and is not fatal (the job uploads it itself)', async () => {
    const { deps } = fakeDeps({ stageAudio: async () => { throw { kind: 'unreachable', detail: 'offline' }; } });
    const store = new BulkRowStore(deps);
    store.init(1);
    await store.addFiles(store.snapshot()[0]!.projectId, [new File(['a'], 'v.wav')]);
    await vi.waitFor(() => expect(store.snapshot()[0]!.audio.state).toBe('failed'));
    expect(store.snapshot()[0]!.audio.detail).toBe('offline');
  });

  it('replacing the voiceover: the older prep finishing late cannot overwrite the newer row state', async () => {
    let releaseFirst!: () => void;
    let n = 0;
    const { deps } = fakeDeps({
      stageAudio: async () => { if (++n === 1) await new Promise<void>(r => { releaseFirst = r; }); },
    });
    const store = new BulkRowStore(deps);
    store.init(1);
    const id = store.snapshot()[0]!.projectId;
    await store.addFiles(id, [new File(['1'], 'v1.wav')]);
    await store.addFiles(id, [new File(['2'], 'v2.wav')]);
    await vi.waitFor(() => expect(store.snapshot()[0]!.audio.state).toBe('ready'));
    releaseFirst();
    await new Promise(r => setTimeout(r, 10));
    expect(store.snapshot()[0]!.audio.state).toBe('ready');
  });
});

describe('old bug 2 — upload with NO job: stage-audio-only over the wire', () => {
  it('three projects staged: every blob is PUT, the gateway confirms it present, and no job or lookup is ever sent', async () => {
    const onGateway = new Set<string>();
    const wire: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string, args: { audioHash?: string }, opts?: { headers?: Record<string, string> }) => {
      wire.push(cmd);
      switch (cmd) {
        case 'cloud_opus_cached': return null;
        case 'cloud_stage_audio_raw': return 'staged';
        case 'cloud_encode_opus': return 1000;
        case 'cloud_upload_audio':
          onGateway.add(args.audioHash!);
          return { uploaded: true, durationSec: 30, opusBytes: 1000 };
        default: throw new Error(`unexpected ${cmd}${opts ? '' : ''}`);
      }
    });
    const hashes: string[] = [];
    for (const tag of ['A', 'B', 'C']) {
      const file = new File([tag.repeat(64)], `${tag}.wav`);
      const hash = await computeAudioHash(file);
      hashes.push(hash);
      const up = await stageCloudAudioOnly(file, hash, { durationSec: 30 });
      expect(up).toMatchObject({ uploaded: true, encoded: true });
    }
    expect(hashes.every(h => onGateway.has(h))).toBe(true);
    expect(wire.filter(c => c === 'cloud_upload_audio')).toHaveLength(3);
    // The zero-meter guarantee: nothing that could create a job or a meter line.
    expect(wire).not.toContain('cloud_run_job');
    expect(wire).not.toContain('cloud_cache_lookup');
    expect(new Set(wire)).toEqual(new Set(['cloud_opus_cached', 'cloud_stage_audio_raw', 'cloud_encode_opus', 'cloud_upload_audio']));
  });

  it('the one-hour cap refuses before anything crosses the wire', async () => {
    await expect(stageCloudAudioOnly(new File(['x'], 'long.wav'), 'h', { durationSec: 4000 })).rejects.toMatchObject({ kind: 'tooLong' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
