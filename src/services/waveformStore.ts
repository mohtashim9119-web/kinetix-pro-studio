// waveformStore.ts — IndexedDB persistence for built WaveformSource peaks
// (docs/waveform-rewrite-plan.md §"Persistence of peaks", added post-launch —
// reverses the original "no persistence" decision for peaks ONLY, not canvas
// bitmaps/images). Mirrors assetStore.ts's project-scoped compound-key pattern.
//
// Keyed by [projectId, assetId] — assetId, not the asset's blob URL, since
// object URLs are re-minted every session (App.tsx's reload path) and are
// never a meaningful cache key. Every voiceover upload/replace mints a fresh
// crypto.randomUUID() id (App.tsx handleVoiceoverStaged/processMediaFile) —
// there is no code path that swaps a blob under an existing asset id — so an
// id match alone is a safe cache key. blobSize is still stored and checked on
// read as a defense-in-depth guard against future code that might violate
// that invariant; it costs nothing (the size is already on hand via
// asset.file.size, no async probe needed).
//
// A separate DB (not assetStore's kinetix-assets) so the two stores can be
// wiped/versioned independently — peaks are a derived cache, not source data.

import type { WaveformSource } from './waveformPeaks';

const DB_NAME = 'kinetix-waveforms';
const DB_VERSION = 1;
const STORE = 'waveforms'; // compound keyPath ['projectId', 'assetId'] + index 'byProject'

interface StoredWaveform {
  projectId: string;
  assetId: string;
  peaks: Float32Array;
  peaksPerSecond: number;
  totalDuration: number;
  /** Byte size of the source blob at build time — invalidation guard (see header). */
  blobSize: number;
  savedAt: number;
}

function isStoredWaveform(value: unknown): value is StoredWaveform {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredWaveform>;
  return (
    typeof v.projectId === 'string' &&
    typeof v.assetId === 'string' &&
    v.peaks instanceof Float32Array &&
    typeof v.peaksPerSecond === 'number' &&
    typeof v.totalDuration === 'number' &&
    typeof v.blobSize === 'number'
  );
}

function openWaveformDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['projectId', 'assetId'] });
        store.createIndex('byProject', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Persists a built WaveformSource, best-effort — callers should not let a
 *  rejection block the UI (the peaks already live in React state either way). */
export function putWaveform(
  projectId: string,
  assetId: string,
  source: WaveformSource,
  blobSize: number,
): Promise<void> {
  const record: StoredWaveform = {
    projectId,
    assetId,
    peaks: source.peaks,
    peaksPerSecond: source.peaksPerSecond,
    totalDuration: source.totalDuration,
    blobSize,
    savedAt: Date.now(),
  };
  return openWaveformDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/**
 * Returns persisted peaks for (projectId, assetId), or null on any cache
 * miss: no record, a malformed/corrupt record (defensive — schema drift),
 * or a blobSize mismatch against expectedBlobSize (the underlying audio
 * changed under this id, which today's upload flow never does, but this
 * guard makes that safe rather than assumed). Never throws — callers treat
 * a null return as "fall back to rebuild."
 */
export function getWaveform(
  projectId: string,
  assetId: string,
  expectedBlobSize: number,
): Promise<WaveformSource | null> {
  return openWaveformDB().then(
    (db) =>
      new Promise<WaveformSource | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get([projectId, assetId]);
        req.onsuccess = () => {
          const record = req.result as unknown;
          if (!isStoredWaveform(record)) {
            resolve(null);
            return;
          }
          if (record.blobSize !== expectedBlobSize) {
            resolve(null);
            return;
          }
          resolve({
            peaks: record.peaks,
            peaksPerSecond: record.peaksPerSecond,
            totalDuration: record.totalDuration,
          });
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function deleteWaveform(projectId: string, assetId: string): Promise<void> {
  return openWaveformDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete([projectId, assetId]);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Deletes all persisted waveforms for a project — called alongside
 *  deleteAllAssets when a project is removed (ProjectDashboard.tsx). */
export function deleteAllWaveforms(projectId: string): Promise<void> {
  return openWaveformDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const index = store.index('byProject');
        const cursorReq = index.openCursor(IDBKeyRange.only(projectId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      }),
  );
}
