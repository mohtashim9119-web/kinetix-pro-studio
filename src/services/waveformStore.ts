// waveformStore.ts — IndexedDB persistence for built WaveformSource peaks
// (docs/history.md ("Waveform Rewrite — Implementation Record", archived) §"Persistence of peaks", added post-launch —
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
// asset.file.size, no async probe needed). peaksPerSecond is checked the same
// way (getWaveform's expectedPeaksPerSecond, defaulting to the live
// PEAKS_PER_SECOND constant) so retuning that density in waveformPeaks.ts
// self-invalidates every previously-cached record instead of silently
// serving coarser peaks built under the old density forever.
//
// A separate DB (not assetStore's kinetix-assets) so the two stores can be
// wiped/versioned independently — peaks are a derived cache, not source data.

import { PEAKS_PER_SECOND, type WaveformSource } from './waveformPeaks';

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

// --- In-memory mirror (gen-6 gate audit, Option B) -----------------------------
// A small, global (NOT project-scoped — peaks are content-addressed by
// assetId+blobSize alone; the same voiceover asset produces identical peaks
// regardless of which project happens to reference it) LRU mirror of recently
// resolved WaveformSource records. Exists purely so App.tsx's pre-generation-
// bump gate can answer "have we already seen this exact asset+blobSize THIS
// SESSION" synchronously, without an IndexedDB round-trip — putWaveform/
// getWaveform below remain the sole source of truth and never consult this
// mirror themselves; it is a same-session fast path read by callers via
// peekWaveform only. Populated on every successful putWaveform and every
// resolved getWaveform HIT — never on a miss/invalid/mismatch, since mirroring
// a negative result would need a second key dimension to avoid serving a
// stale "not found" after a later put.
const MIRROR_MAX_ENTRIES = 32;
const mirror = new Map<string, WaveformSource>();

function mirrorKey(assetId: string, blobSize: number): string {
  return `${assetId}:${blobSize}`;
}

/** Inserts/refreshes a mirror entry as most-recently-used, evicting the
 *  least-recently-used entry once the map exceeds MIRROR_MAX_ENTRIES. Map
 *  iteration order is insertion order, so delete+set is enough to bump an
 *  existing key to the "most recent" end without a separate LRU structure. */
function mirrorSet(assetId: string, blobSize: number, source: WaveformSource): void {
  const key = mirrorKey(assetId, blobSize);
  mirror.delete(key);
  mirror.set(key, source);
  if (mirror.size > MIRROR_MAX_ENTRIES) {
    const oldestKey = mirror.keys().next().value;
    if (oldestKey !== undefined) mirror.delete(oldestKey);
  }
}

/**
 * Synchronous same-session lookup — returns a mirrored WaveformSource if
 * assetId+blobSize was seen earlier this session (via putWaveform or a
 * getWaveform hit), or undefined on a mirror miss. NOT authoritative: a
 * mirror miss does not mean "no persisted record exists," only "not seen by
 * this in-memory mirror yet" (cold app start, or evicted under LRU pressure)
 * — callers must still fall back to the async getWaveform path. A hit
 * refreshes the entry's LRU position.
 */
export function peekWaveform(assetId: string, blobSize: number): WaveformSource | undefined {
  const key = mirrorKey(assetId, blobSize);
  const hit = mirror.get(key);
  if (hit) {
    mirror.delete(key);
    mirror.set(key, hit);
  }
  return hit;
}

/** Test-only: reset the in-memory mirror between unit tests. */
export function _resetWaveformMirrorForTests(): void {
  mirror.clear();
}
// ---------------------------------------------------------------------------

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
        req.onsuccess = () => {
          mirrorSet(assetId, blobSize, source);
          resolve();
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/**
 * Returns persisted peaks for (projectId, assetId), or null on any cache
 * miss: no record, a malformed/corrupt record (defensive — schema drift),
 * a blobSize mismatch against expectedBlobSize (the underlying audio
 * changed under this id, which today's upload flow never does, but this
 * guard makes that safe rather than assumed), or a peaksPerSecond mismatch
 * against expectedPeaksPerSecond (defaults to the LIVE PEAKS_PER_SECOND
 * constant). The peaksPerSecond guard is what makes retuning that constant
 * (waveformPeaks.ts) self-invalidating: a record built under an old density
 * fails this check and falls back to rebuild, rather than silently serving
 * stale, coarser peaks forever — same defense-in-depth idiom as the
 * blobSize check, not a compound-key change (avoids an IndexedDB schema
 * migration for what is purely a derived cache). Never throws — callers
 * treat a null return as "fall back to rebuild."
 */
export function getWaveform(
  projectId: string,
  assetId: string,
  expectedBlobSize: number,
  expectedPeaksPerSecond: number = PEAKS_PER_SECOND,
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
          if (record.peaksPerSecond !== expectedPeaksPerSecond) {
            resolve(null);
            return;
          }
          const result: WaveformSource = {
            peaks: record.peaks,
            peaksPerSecond: record.peaksPerSecond,
            totalDuration: record.totalDuration,
          };
          mirrorSet(assetId, expectedBlobSize, result);
          resolve(result);
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
