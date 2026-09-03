import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { mergeExtractedZipAssets } from './zipAssetMerge';
import { putAsset, getAllAssetsForProject } from './assetStore';
import type { Asset } from '../types';

// Exercises the REAL IndexedDB path (fake-indexeddb/auto, no jsdom — matches
// waveformStore.test.ts's convention), because the defect under test is a row
// that survives in the store, not a call that was or wasn't made. Counting
// mock invocations would pass against a `deleteAsset` that silently no-ops.
//
// IDBFactory has no "delete every database" primitive, so each test owns its
// own projectId namespace rather than sharing one and cleaning up.
//
// Driven at the service seam rather than through <App />: mounting the real
// component in jsdom was costed and rejected (docs/history.md — WebGL2 +
// AudioContext + Tauri IPC against a 6k-line component, "estimated multiple
// days, high ongoing fragility"), which is why the dedup/cleanup loop was
// extracted here in the first place.

beforeAll(() => {
  // Node's URL has no object-URL registry. The service revokes the dropped
  // duplicate's blob URL, which is correct in the browser and a no-op here.
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  }
});

/** Mints an asset and writes its row, mirroring what `extractZipToAssets`
 *  has already done by the time the merge sees it. */
async function staged(projectId: string, name: string, type: Asset['type'] = 'image'): Promise<Asset> {
  const id = `id-${name}-${Math.random().toString(16).slice(2)}`;
  await putAsset(projectId, id, new Blob([name]), { name, mimeType: 'application/octet-stream' });
  return { id, name, url: `blob:${id}`, type } as Asset;
}

/** Row ids for `projectId`, sorted — the store's own view of what exists. */
async function rowIds(projectId: string): Promise<string[]> {
  return (await getAllAssetsForProject(projectId)).map(r => r.id).sort();
}

/** Row names for `projectId`, sorted. */
async function rowNames(projectId: string): Promise<string[]> {
  return (await getAllAssetsForProject(projectId)).map(r => r.name).sort();
}

describe('mergeExtractedZipAssets — a deduplicated import leaves no orphaned row', () => {
  it('drops the duplicate AND its row: rows equal unique assets, not double', async () => {
    const projectId = 'proj-dedup';
    // Already committed to the project, row included.
    const committed = await staged(projectId, 'photo.jpg');
    // The archive re-supplies photo.jpg (duplicate) plus one genuinely new file.
    const dupe = await staged(projectId, 'photo.jpg');
    const fresh = await staged(projectId, 'clip.mp4', 'video');
    expect(await rowIds(projectId)).toHaveLength(3); // pre-merge: the leak's raw material

    const { kept } = await mergeExtractedZipAssets(projectId, [committed], [dupe, fresh]);

    expect(kept.map(a => a.name)).toEqual(['clip.mp4']);
    const uniqueNames = new Set([committed, ...kept].map(a => a.name));
    expect(await rowIds(projectId)).toHaveLength(uniqueNames.size); // 2, not 3
    expect(await rowNames(projectId)).toEqual(['clip.mp4', 'photo.jpg']);
    // The surviving photo.jpg row is the ORIGINAL; the archive's copy is gone.
    expect(await rowIds(projectId)).toEqual([committed.id, fresh.id].sort());
  });

  it('leaves a non-duplicate import completely untouched', async () => {
    const projectId = 'proj-no-dedup';
    const committed = await staged(projectId, 'photo.jpg');
    const a = await staged(projectId, 'a.png');
    const b = await staged(projectId, 'b.png');
    const before = await rowIds(projectId);

    const { kept } = await mergeExtractedZipAssets(projectId, [committed], [a, b]);

    expect(kept.map(x => x.name)).toEqual(['a.png', 'b.png']);
    expect(await rowIds(projectId)).toEqual(before); // nothing added, nothing deleted
    expect(before).toHaveLength(3);
  });

  it('collapses two archive entries sharing a basename, reclaiming the loser', async () => {
    // `a/logo.png` and `b/logo.png` both pass extraction; only one may survive,
    // and the other's row must not linger.
    const projectId = 'proj-intra-zip';
    const first = await staged(projectId, 'logo.png');
    const second = await staged(projectId, 'logo.png');

    const { kept } = await mergeExtractedZipAssets(projectId, [], [first, second]);

    expect(kept.map(a => a.id)).toEqual([first.id]);
    expect(await rowIds(projectId)).toEqual([first.id]);
    expect(second.id).not.toBe(first.id); // the dropped row was a distinct row
  });
});

describe('mergeExtractedZipAssets — voiceoverId never names a dropped row', () => {
  it('reports the surviving audio asset', async () => {
    const projectId = 'proj-audio-kept';
    const vo = await staged(projectId, 'vo.mp3', 'audio');

    const { kept, audioAssetId } = await mergeExtractedZipAssets(projectId, [], [vo]);

    expect(audioAssetId).toBe(vo.id);
    expect(kept.map(a => a.id)).toEqual([vo.id]);
  });

  it('reports NO audio id when the archive audio was itself the duplicate', async () => {
    // The hazard this guards: an id that names no row in project.assets must
    // not be handed back as the project's voiceoverId, and its row must still
    // be reclaimed.
    const projectId = 'proj-audio-dropped';
    const committed = await staged(projectId, 'vo.mp3', 'audio');
    const dupe = await staged(projectId, 'vo.mp3', 'audio');

    const { kept, audioAssetId } = await mergeExtractedZipAssets(projectId, [committed], [dupe]);

    expect(kept).toHaveLength(0);
    expect(audioAssetId).toBeUndefined();
    expect(await rowIds(projectId)).toEqual([committed.id]);
  });

  it('reports the LAST surviving audio asset, matching the pre-extraction loop', async () => {
    const projectId = 'proj-audio-last';
    const one = await staged(projectId, 'one.mp3', 'audio');
    const two = await staged(projectId, 'two.mp3', 'audio');

    const { audioAssetId } = await mergeExtractedZipAssets(projectId, [], [one, two]);

    expect(audioAssetId).toBe(two.id);
  });
});
