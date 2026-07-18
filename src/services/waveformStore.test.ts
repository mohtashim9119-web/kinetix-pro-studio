import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { putWaveform, getWaveform, deleteWaveform, deleteAllWaveforms } from './waveformStore';
import type { WaveformSource } from './waveformPeaks';

// This suite polyfills `indexedDB` via fake-indexeddb/auto (no jsdom needed —
// matches the repo's plain-node vitest environment). Each test opens the same
// underlying fake DB; IDBFactory has no "delete all databases" primitive, so
// every test uses its own project/asset id namespace to avoid cross-test
// interference instead of resetting the DB between tests.

function makeSource(peaks: number[], peaksPerSecond = 10, totalDuration = peaks.length / 10): WaveformSource {
  return { peaks: new Float32Array(peaks), peaksPerSecond, totalDuration };
}

let counter = 0;
function freshIds(): { projectId: string; assetId: string } {
  counter += 1;
  return { projectId: `project-${counter}`, assetId: `asset-${counter}` };
}

describe('waveformStore — persist/reload roundtrip', () => {
  it('put-then-get returns identical peaks, peaksPerSecond, and totalDuration', async () => {
    const { projectId, assetId } = freshIds();
    const source = makeSource([0, 0.25, 0.5, 0.75, 1, 0.9, 0.1]);
    const blobSize = 123456;

    await putWaveform(projectId, assetId, source, blobSize);
    const loaded = await getWaveform(projectId, assetId, blobSize);

    expect(loaded).not.toBeNull();
    expect(loaded!.peaksPerSecond).toBe(source.peaksPerSecond);
    expect(loaded!.totalDuration).toBe(source.totalDuration);
    expect(loaded!.peaks.length).toBe(source.peaks.length);
    for (let i = 0; i < source.peaks.length; i++) {
      expect(loaded!.peaks[i]).toBe(source.peaks[i]);
    }
    expect(loaded!.peaks).toBeInstanceOf(Float32Array);
  });

  it('overwriting an existing key with a new build replaces the stored peaks', async () => {
    const { projectId, assetId } = freshIds();
    const first = makeSource([0.1, 0.2]);
    const second = makeSource([0.9, 0.8, 0.7]);

    await putWaveform(projectId, assetId, first, 100);
    await putWaveform(projectId, assetId, second, 200);
    const loaded = await getWaveform(projectId, assetId, 200);

    expect(loaded).not.toBeNull();
    expect(loaded!.peaks.length).toBe(3);
    // Float32 storage, not exact decimal — compare against the same
    // precision loss a literal 0.9 incurs when boxed into a Float32Array.
    expect(loaded!.peaks[0]).toBe(new Float32Array([0.9])[0]);
  });
});

describe('waveformStore — cache miss falls back gracefully', () => {
  it('returns null for a key that was never written', async () => {
    const { projectId, assetId } = freshIds();
    const loaded = await getWaveform(projectId, assetId, 999);
    expect(loaded).toBeNull();
  });

  it('returns null (not a throw) for a malformed/corrupt stored record', async () => {
    const { projectId, assetId } = freshIds();

    // Bypass putWaveform to write a record missing required fields directly,
    // simulating schema drift / a corrupted entry.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('kinetix-waveforms', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('waveforms', 'readwrite');
      tx.objectStore('waveforms').put({
        projectId,
        assetId,
        // peaks intentionally a plain array, not a Float32Array — corrupt shape.
        peaks: [1, 2, 3],
        peaksPerSecond: 10,
        // totalDuration intentionally missing.
        blobSize: 42,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });

    await expect(getWaveform(projectId, assetId, 42)).resolves.toBeNull();
  });
});

describe('waveformStore — invalidation', () => {
  it('a different assetId under the same projectId is a cache miss', async () => {
    const { projectId, assetId } = freshIds();
    const source = makeSource([0.5, 0.5]);
    await putWaveform(projectId, assetId, source, 500);

    const loaded = await getWaveform(projectId, 'some-other-asset-id', 500);
    expect(loaded).toBeNull();
  });

  it('a blobSize mismatch invalidates a same-id record (guards against a re-upload reusing the id)', async () => {
    const { projectId, assetId } = freshIds();
    const source = makeSource([0.3, 0.6, 0.9]);
    await putWaveform(projectId, assetId, source, 1000);

    // Same project/asset id, but the caller now reports a different blob size —
    // must be treated as stale, not served.
    const loaded = await getWaveform(projectId, assetId, 1001);
    expect(loaded).toBeNull();

    // The correct size still resolves — confirms the mismatch above wasn't a
    // false negative from a broken key lookup.
    const loadedCorrect = await getWaveform(projectId, assetId, 1000);
    expect(loadedCorrect).not.toBeNull();
  });

  it('deleteWaveform removes only the targeted (projectId, assetId) pair', async () => {
    const { projectId, assetId } = freshIds();
    const otherAssetId = `${assetId}-sibling`;
    const source = makeSource([0.2, 0.4]);
    await putWaveform(projectId, assetId, source, 10);
    await putWaveform(projectId, otherAssetId, source, 10);

    await deleteWaveform(projectId, assetId);

    expect(await getWaveform(projectId, assetId, 10)).toBeNull();
    expect(await getWaveform(projectId, otherAssetId, 10)).not.toBeNull();
  });

  it('deleteAllWaveforms clears every record for a project but leaves other projects intact', async () => {
    const { projectId, assetId } = freshIds();
    const otherProjectId = `${projectId}-other`;
    const source = makeSource([0.1, 0.2, 0.3]);
    await putWaveform(projectId, assetId, source, 10);
    await putWaveform(projectId, `${assetId}-2`, source, 10);
    await putWaveform(otherProjectId, assetId, source, 10);

    await deleteAllWaveforms(projectId);

    expect(await getWaveform(projectId, assetId, 10)).toBeNull();
    expect(await getWaveform(projectId, `${assetId}-2`, 10)).toBeNull();
    expect(await getWaveform(otherProjectId, assetId, 10)).not.toBeNull();
  });
});
