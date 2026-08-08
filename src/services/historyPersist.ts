/**
 * Undo/redo history persistence — survives a PAGE RELOAD, not an app restart
 * (owner ruling 2026-08-08; `docs/decisions/2026-08-08-undo-redo-design.md` §6.0).
 *
 * WHY THIS EXISTS AT ALL. The design's revision 1 recommended against
 * persistence, on the premise that a page reload was not user-reachable in the
 * shipped Tauri app. **That premise was wrong** — the app has a right-click
 * reload — so history that dies on reload dies during ordinary use. The owner
 * ruled to build it and accepted the ~6 MB cost.
 *
 * THE HARD PART IS NOT STORAGE, IT IS TELLING THE TWO CASES APART. A page reload
 * and an app restart both hand the frontend a brand-new webview with an empty JS
 * heap; nothing in the renderer can distinguish them. So the discriminator has
 * to come from outside the renderer: `app_session_token` (`src-tauri/src/lib.rs`)
 * mints a UUID once per Rust PROCESS. A reload reads back the same token; a
 * restart mints a new one. History is tagged with the token that was live when
 * it was written, and discarded on load if the token has changed. That is the
 * whole mechanism, and it is exact rather than heuristic — unlike
 * `PerformanceNavigationTiming.type === 'reload'` (which describes how THIS
 * document was loaded, not whether the app is the same one) or `sessionStorage`
 * (whose lifetime across a WKWebView app restart is not something this project
 * has verified, and guessing would defeat the point).
 *
 * OUTSIDE TAURI (`npm run dev` in a browser) there is no process token. The
 * fallback is a `sessionStorage`-held token, which is the closest browser
 * equivalent: it survives a reload and dies with the browsing session. Dev
 * convenience only — the shipped app always takes the Tauri path.
 *
 * WHAT IS STORED. `blob:` URLs and `File` handles are stripped from every
 * entry's `assets`, exactly as `projectStore.ts` already does for the project
 * itself, because a `blob:` URL is dead the moment the page unloads.
 *
 * WHAT IS **NOT** DONE, DELIBERATELY: entries are not rehydrated from IndexedDB
 * one by one. The design doc's costing assumed 20 asset-rehydration passes per
 * load; that turns out to be unnecessary. By the time history is restored, the
 * LIVE project has already rehydrated every asset it has, so each entry's assets
 * can be re-pointed at those live objects by id — one pass over a Map, no I/O.
 * An id the live project no longer has is dropped and its references nulled, the
 * same repair `handleSwitchProject` performs. See `rehydrateEntryAssets`.
 */

import type { Asset, Project } from '../types';
import type { History, HistoryEntry } from './history';

const DB_NAME = 'kinetix-history';
const DB_VERSION = 1;
const STORE = 'history';

/** One persisted record per project id. */
interface PersistedHistory {
  /** keyPath. */
  projectId: string;
  /** The app-process token live when this was written. The reload gate. */
  sessionToken: string;
  past: HistoryEntry<Project>[];
  future: HistoryEntry<Project>[];
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'kinetix:history:sessionToken';
let cachedToken: string | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * The current app-process token. Memoised — it cannot change within a page's
 * lifetime, and a reload gets a fresh module instance anyway.
 */
export async function getAppSessionToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      cachedToken = await invoke<string>('app_session_token');
      return cachedToken;
    } catch {
      // Fall through to the browser path rather than failing the load: a
      // missing token must degrade to "history does not survive this reload",
      // never to "the project will not open".
    }
  }
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) { cachedToken = existing; return existing; }
    const minted = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, minted);
    cachedToken = minted;
    return minted;
  } catch {
    // No sessionStorage either (private mode, or a non-browser runtime). A
    // freshly-minted token every call means the gate never matches, so history
    // simply never restores — the correct degradation.
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Asset stripping / rehydration
// ---------------------------------------------------------------------------

/**
 * Drops the two fields that cannot survive a page unload. Same contract as
 * `projectStore.ts`'s own strip, and for the same reason: a `blob:` URL is
 * revoked (or simply orphaned) when the document goes away, and a `File` handle
 * is not structured-cloneable in a way that outlives it usefully.
 */
export function stripEntryAssets(project: Project): Project {
  return {
    ...project,
    assets: project.assets.map(({ url: _url, file: _file, ...rest }) => rest as Asset),
  };
}

/**
 * Re-points a restored entry's assets at the LIVE project's already-rehydrated
 * ones, by id. No I/O: the live project did the IndexedDB work already.
 *
 * An asset id the live project no longer has is DROPPED, and every reference to
 * it nulled — `segment.assetId` and `voiceoverId` — which is exactly the repair
 * `handleSwitchProject` performs on load. Without it a restored entry could
 * carry a segment pointing at an asset that no longer exists, and the failure
 * would surface later, as a blank preview, rather than here.
 */
export function rehydrateEntryAssets(
  entry: Project,
  liveAssets: readonly Asset[],
): Project {
  const live = new Map(liveAssets.map(a => [a.id, a]));
  const assets: Asset[] = [];
  for (const stored of entry.assets) {
    const hydrated = live.get(stored.id);
    if (!hydrated) continue; // blob is gone — drop it
    // Keep the ENTRY's metadata (name/type/addedAt as they were at that point in
    // history) but take the live url/file, which are the only session-bound bits.
    assets.push({ ...stored, url: hydrated.url, file: hydrated.file });
  }
  const keptIds = new Set(assets.map(a => a.id));
  return {
    ...entry,
    assets,
    segments: entry.segments.map(s =>
      s.assetId && !keptIds.has(s.assetId) ? { ...s, assetId: undefined } : s,
    ),
    voiceoverId: entry.voiceoverId && keptIds.has(entry.voiceoverId)
      ? entry.voiceoverId
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

/**
 * Writes history for `projectId`, tagged with the current process token.
 *
 * NEVER THROWS. History is a convenience; a storage failure must not break an
 * edit the user just made. Failures are warned and swallowed — the same policy
 * `waveformStore.ts` applies to its own cache writes.
 */
export async function saveHistory(
  projectId: string,
  history: History<Project>,
): Promise<void> {
  try {
    const sessionToken = await getAppSessionToken();
    const record: PersistedHistory = {
      projectId,
      sessionToken,
      past: history.past.map(e => ({ ...e, state: stripEntryAssets(e.state) })),
      future: history.future.map(e => ({ ...e, state: stripEntryAssets(e.state) })),
      savedAt: Date.now(),
    };
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('history put failed'));
    });
    db.close();
  } catch (err) {
    console.warn('[history] persist failed (non-fatal):', err);
  }
}

/**
 * Reads back history for `projectId`, but ONLY if it was written by this same
 * app process. Returns `null` otherwise — a different process means an app
 * restart, which the owner ruled starts fresh.
 *
 * `liveAssets` are the already-rehydrated assets of the project being restored;
 * see `rehydrateEntryAssets`.
 */
export async function loadHistory(
  projectId: string,
  liveAssets: readonly Asset[],
): Promise<History<Project> | null> {
  try {
    const sessionToken = await getAppSessionToken();
    const db = await openDb();
    const record = await new Promise<PersistedHistory | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => resolve(req.result as PersistedHistory | undefined);
      req.onerror = () => reject(req.error ?? new Error('history get failed'));
    });
    db.close();
    if (!record) return null;
    // THE GATE. A restart, or history written for a different project, restores
    // nothing.
    if (record.sessionToken !== sessionToken) return null;
    return {
      past: record.past.map(e => ({ ...e, state: rehydrateEntryAssets(e.state, liveAssets) })),
      future: record.future.map(e => ({ ...e, state: rehydrateEntryAssets(e.state, liveAssets) })),
    };
  } catch (err) {
    console.warn('[history] restore failed (non-fatal):', err);
    return null;
  }
}

/** Drops a project's persisted history. Called wherever history is cleared. */
export async function clearPersistedHistory(projectId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('history delete failed'));
    });
    db.close();
  } catch (err) {
    console.warn('[history] clear failed (non-fatal):', err);
  }
}
