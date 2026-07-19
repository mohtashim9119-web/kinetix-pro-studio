// waveformImageCache.ts — persistence for RENDERED per-segment waveform
// thumbnail PNGs (docs/waveform-image-cache-plan.md, Phase A). Sibling to
// waveformStore.ts, which caches the numeric peaks array — but caching peaks
// alone does not avoid the per-segment canvas draw + PNG encode that
// SegmentWaveform.tsx runs on every remount (a project switch or an app
// restart both fully remount the segment list), which is what still produces
// a visible redraw even when the peaks are a cache hit. This store exists to
// skip that too, by caching the final rendered image itself.
//
// The rendered image is fully determined by a small, stable set of inputs
// (confirmed in waveformPeaks.ts: the backing canvas is always sized at a
// fixed max-zoom pixel density — timeline zoom is never a redraw trigger):
// which asset+content (assetId + blobSize), and which segment window
// (segmentId + startTime + duration). Device pixel ratio is capped at 2x and
// effectively constant per device, so it is deliberately NOT part of the key.
//
// Own IndexedDB database (kinetix-waveform-images), deliberately separate
// from waveformStore.ts's kinetix-waveforms DB — keeps this an additive,
// isolated change that doesn't touch that DB's version/schema/tests.
//
// Two tiers, mirroring waveformStore.ts's existing pattern for peaks:
//   Tier 1 — in-memory LRU Map of cache key -> blob: URL. Survives a
//     project-switch remount within the same app session (module-level
//     state). Holds actual revocable blob: URLs, unlike the peaks mirror's
//     Float32Arrays, so eviction MUST revoke the outgoing URL.
//   Tier 2 — IndexedDB, keyed [projectId, assetId, segmentId]. Survives an
//     app restart. Stores the PNG as a Blob directly (IndexedDB supports
//     Blobs natively, same as assetStore.ts already does for uploads).
//
// Ownership note (see SegmentWaveform.tsx, Phase B): once an image is
// cache-owned, a component unmounting must NOT revoke its blob: URL — only
// this module's own LRU eviction or the explicit delete* functions below may
// revoke. Revoking on every remount was the source of the previously-flagged
// WebKitBlobResource revoke-race; moving ownership here resolves it as a
// side effect of this cache, not a separate fix.
//
// Tier 1 is deliberately asset-scoped only (no projectId in its key), same
// design rationale as waveformStore.ts's peaks mirror: a given asset's
// rendered image is identical regardless of which project references it.
// One consequence: deleteAllImagesForProject only clears Tier 2 — any Tier 1
// entries for that project's asset(s) are left to age out under normal LRU
// pressure. This is a minor, bounded staleness (not a correctness bug), not
// a project-scoped sweep.

const DB_NAME = 'kinetix-waveform-images';
const DB_VERSION = 1;
const STORE = 'images'; // compound keyPath ['projectId','assetId','segmentId']

interface StoredImage {
  projectId: string;
  assetId: string;
  segmentId: string;
  startTime: number;
  duration: number;
  /** Byte size of the source blob at render time — invalidation guard (see header). */
  blobSize: number;
  image: Blob;
  savedAt: number;
}

function isStoredImage(value: unknown): value is StoredImage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredImage>;
  return (
    typeof v.projectId === 'string' &&
    typeof v.assetId === 'string' &&
    typeof v.segmentId === 'string' &&
    typeof v.startTime === 'number' &&
    typeof v.duration === 'number' &&
    typeof v.blobSize === 'number' &&
    v.image instanceof Blob
  );
}

// --- Tier 1: in-memory LRU mirror of rendered images -------------------------
// Cap is much larger than waveformStore.ts's 32-entry peaks mirror (32 assets
// is plenty; this is per-SEGMENT, so a single project can hold hundreds of
// entries on its own) — sized to comfortably hold several full projects'
// worth of thumbnails resident in one session.
export const IMAGE_MIRROR_MAX_ENTRIES = 2000;
const mirror = new Map<string, string>(); // cacheKey -> blob: URL

function cacheKey(
  assetId: string,
  blobSize: number,
  segmentId: string,
  startTime: number,
  duration: number,
): string {
  return `${assetId}:${blobSize}:${segmentId}:${startTime.toFixed(3)}:${duration.toFixed(3)}`;
}

/** Revokes a mirror entry's blob: URL if it looks like one (defensive — only
 *  ever populated with URL.createObjectURL output today, but cheap to guard). */
function revokeIfBlobUrl(url: string | undefined): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* noop — best-effort */
    }
  }
}

/** Inserts/refreshes a mirror entry as most-recently-used, evicting (and
 *  revoking) the least-recently-used entry once over IMAGE_MIRROR_MAX_ENTRIES.
 *  Revokes any URL previously held under the same key before replacing it. */
function mirrorSet(key: string, url: string): void {
  revokeIfBlobUrl(mirror.get(key));
  mirror.delete(key);
  mirror.set(key, url);
  if (mirror.size > IMAGE_MIRROR_MAX_ENTRIES) {
    const oldestKey = mirror.keys().next().value;
    if (oldestKey !== undefined) {
      revokeIfBlobUrl(mirror.get(oldestKey));
      mirror.delete(oldestKey);
    }
  }
}

/**
 * Synchronous same-session lookup — returns a mirrored blob: URL if this
 * exact asset+blobSize+segment window was rendered earlier this session (via
 * putImage or a getPersistedImage hit), or undefined on a miss. A hit refreshes
 * the entry's LRU position. NOT authoritative: a miss does not mean no
 * persisted record exists, only that Tier 1 doesn't have it right now.
 */
export function peekImage(
  assetId: string,
  blobSize: number,
  segmentId: string,
  startTime: number,
  duration: number,
): string | undefined {
  const key = cacheKey(assetId, blobSize, segmentId, startTime, duration);
  const hit = mirror.get(key);
  if (hit) {
    mirror.delete(key);
    mirror.set(key, hit);
  }
  return hit;
}

/** Test-only: reset the in-memory mirror between unit tests. Revokes every
 *  held URL first so tests don't leak blob: URLs into the next test. */
export function _resetWaveformImageMirrorForTests(): void {
  for (const url of mirror.values()) revokeIfBlobUrl(url);
  mirror.clear();
}
// -----------------------------------------------------------------------------

// Shared, long-lived connection (not re-opened per call). SegmentWaveform
// fires getPersistedImage for every mounting segment concurrently (up to
// ~294 at once on a big project) — opening (and, worse, closing) a FRESH
// IndexedDB connection per call turned out to be a real, highly variable
// cost in practice (a live trace showed the exact same operation taking
// 1-2s on one restart and ~5s on the next, with nothing else different) —
// far more likely to be connection-churn overhead than the actual key
// lookups. One connection, opened lazily on first use and reused by every
// function below, removes that variable entirely.
let dbPromise: Promise<IDBDatabase> | null = null;

// --- TEMP diagnostic instrumentation (Phase C timing audit) ------------------
// Gated on the same globalThis.__WF_INSTRUMENT__ flag used throughout the
// waveform pipeline. Distinguishes two very different possible bottlenecks
// behind the same symptom (loading overlay stuck at 0/N for several seconds,
// then all segments ready at once): (a) the ONE shared indexedDB.open() call
// itself being slow (e.g. contention with the assets/peaks DBs also opening
// around the same time on a reload), vs (b) the per-segment get() lookups
// themselves being slow once the connection is open. Remove after the audit.
function __wfImgInstrOn(): boolean {
  return (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ === true;
}
function __wfImgLog(rec: Record<string, unknown>): void {
  if (!__wfImgInstrOn()) return;
  // eslint-disable-next-line no-console
  console.log('[wf-imgcache]', JSON.stringify(rec));
}
// -----------------------------------------------------------------------------

function openWaveformImageDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  // Always a real timestamp, NOT gated on __wfImgInstrOn() — this call can
  // fire (via the eager warm-up below) before main.tsx has read the
  // __WF_INSTRUMENT__ flag from localStorage (ES module imports fully
  // evaluate before the importing file's own top-level code runs), which
  // previously made this a bogus 0 and silently corrupted every timing
  // log derived from it. Only the actual console output is gated below.
  const t0 = performance.now();
  __wfImgLog({ event: 'db-open-start', t0 });
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['projectId', 'assetId', 'segmentId'] });
        store.createIndex('byProjectAsset', ['projectId', 'assetId']);
        store.createIndex('byProject', 'projectId');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      __wfImgLog({ event: 'db-open-done', ms: performance.now() - t0 });
      // Release this long-lived connection if a future schema bump ever
      // opens a newer DB_VERSION elsewhere — otherwise that upgrade would
      // block forever behind a connection nothing else ever closes.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      __wfImgLog({ event: 'db-open-error', ms: performance.now() - t0 });
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

// Eagerly kick off the connection open the moment this module loads (App's
// static import chain reaches it well before any project is opened), instead
// of waiting for the first getPersistedImage call. A live trace showed
// db-open-done itself taking ~4.2s specifically on a project reload — every
// individual get() once the connection was ready took only 50-150ms, so the
// entire visible delay was this one connection negotiation, which currently
// only starts once the first SegmentWaveform mounts: late in the boot
// sequence, after ~294 real media assets have already been rehydrated and
// are likely contending for the same main thread / storage subsystem.
// Starting it here lets it run during the otherwise-idle moment of initial
// module evaluation instead of queued behind that later work. Guarded on
// `typeof indexedDB` so importing this module in the plain-node vitest
// environment (no browser/IndexedDB global — e.g. sceneTagParsing.test.ts's
// transitive import via App.tsx) doesn't throw; waveformImageCache.test.ts
// itself loads the fake-indexeddb polyfill before this module is imported,
// so it's covered there too.
if (typeof indexedDB !== 'undefined') {
  void openWaveformImageDB();
}

/**
 * Persists a rendered segment image (Tier 2), best-effort, then refreshes
 * Tier 1 with a fresh blob: URL for immediate reuse this session. Callers
 * should not let a rejection block the UI — the image is already on screen
 * from the just-completed draw either way.
 */
export function putImage(
  projectId: string,
  assetId: string,
  blobSize: number,
  segmentId: string,
  startTime: number,
  duration: number,
  image: Blob,
): Promise<void> {
  const record: StoredImage = {
    projectId, assetId, segmentId, startTime, duration, blobSize, image,
    savedAt: Date.now(),
  };
  return openWaveformImageDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(record);
        req.onsuccess = () => {
          mirrorSet(cacheKey(assetId, blobSize, segmentId, startTime, duration), URL.createObjectURL(image));
          resolve();
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/**
 * Single-key Tier-2 lookup for one segment (Phase C, revised). Originally
 * Phase C did one BULK cursor read (a since-removed `warmImagesFromStore`)
 * to pre-warm every segment's image before the segment list even mounted —
 * but a real-device trace showed that single cursor walk (294 sequential
 * cursor.continue() round-trips) taking the same ~5 seconds the old
 * redraw-from-scratch path took, just moved the delay rather than removing
 * it, and blocked the loading screen for that whole span since the caller
 * awaited it before committing the waveform source at all. This function
 * replaces that approach: SegmentWaveform calls it lazily, per segment, on
 * its own Tier-1 miss (see SegmentWaveform.tsx). Many of these firing
 * concurrently (one per mounting segment) are direct primary-key gets, not
 * a cursor scan, and don't block anything upstream — each segment resolves
 * independently instead of the whole batch waiting on one serialized walk.
 * Returns undefined on any miss (no record, blobSize mismatch — the
 * underlying asset content changed under this id — or an IndexedDB failure,
 * never thrown to the caller: this is a pure optimization, and the caller's
 * fallback is to draw fresh, exactly as if this cache didn't exist).
 */
export async function getPersistedImage(
  projectId: string,
  assetId: string,
  segmentId: string,
  blobSize: number,
  startTime: number,
  duration: number,
): Promise<string | undefined> {
  const t0 = performance.now(); // always real — see openWaveformImageDB's comment on why
  try {
    const db = await openWaveformImageDB();
    const tGotDb = performance.now();
    const record = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get([projectId, assetId, segmentId]);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    __wfImgLog({
      event: 'get-done',
      segmentId,
      waitForDbMs: tGotDb - t0,
      getMs: performance.now() - tGotDb,
      totalMs: performance.now() - t0,
      hit: isStoredImage(record) && record.blobSize === blobSize,
    });
    if (!isStoredImage(record) || record.blobSize !== blobSize) return undefined;
    const url = URL.createObjectURL(record.image);
    mirrorSet(cacheKey(assetId, blobSize, segmentId, startTime, duration), url);
    return url;
  } catch (err) {
    __wfImgLog({ event: 'get-error', segmentId, totalMs: performance.now() - t0, error: String(err) });
    return undefined;
  }
}

/** Deletes every persisted image for (projectId, assetId) — Tier 2 — and
 *  sweeps + revokes any matching Tier 1 entries (matched by assetId prefix,
 *  since Tier 1 keys are asset-scoped, not project-scoped — see header).
 *  Mirrors waveformStore.ts's deleteWaveform; call alongside it wherever a
 *  voiceover asset is replaced or removed. */
export function deleteImagesForAsset(projectId: string, assetId: string): Promise<void> {
  const assetPrefix = `${assetId}:`;
  for (const key of [...mirror.keys()]) {
    if (key.startsWith(assetPrefix)) {
      revokeIfBlobUrl(mirror.get(key));
      mirror.delete(key);
    }
  }
  return openWaveformImageDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const index = store.index('byProjectAsset');
        const cursorReq = index.openCursor(IDBKeyRange.only([projectId, assetId]));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Deletes every persisted image for a whole project (Tier 2 only — see the
 *  Tier-1-is-asset-scoped note in the header for why Tier 1 isn't swept
 *  here). Mirrors waveformStore.ts's deleteAllWaveforms; call alongside it
 *  wherever a project is deleted (ProjectDashboard.tsx). */
export function deleteAllImagesForProject(projectId: string): Promise<void> {
  return openWaveformImageDB().then(
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
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}
