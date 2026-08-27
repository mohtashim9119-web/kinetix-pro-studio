/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IndexedDB-backed store for a project's full serialized JSON — the payload
 * `projectStore.ts` used to write into `localStorage` under
 * `kinetix:project:<id>:v1`.
 *
 * WHY THIS EXISTS. A real 21-minute-audio project's serialized JSON reached
 * ~915,000 characters and started failing `localStorage.setItem` with
 * `QuotaExceededError` on every autosave — silently, repeatedly, with every
 * edit since the last successful save unpersisted. `localStorage` is a single
 * ~5-10 MB budget SHARED by every project's JSON, the project registry, and
 * per-project thumbnail data URLs on this origin (measured elsewhere in this
 * codebase: 20 history snapshots of the largest known corpus project alone is
 * 6.02 MB). One large project does not need to be anywhere near that ceiling
 * on its own to be the write that tips a origin already carrying several
 * projects over the edge. IndexedDB has no such shared low ceiling — origins
 * are typically granted a quota on the order of the available disk (browsers)
 * or effectively unbounded for a native WKWebView origin (Tauri) — and it is
 * exactly the store `assetStore.ts` and `waveformStore.ts` already use for
 * this project's other bulky, per-project data.
 *
 * The project registry (`ProjectMeta[]`, small — no segment/heading bodies)
 * and `kinetix:lastOpenedProjectId` stay in `localStorage`: both are read
 * synchronously in places (`ProjectDashboard`'s initial render, boot routing)
 * and are cheap enough that the shared budget was never their problem.
 */

const DB_NAME = 'kinetix-projects';
const DB_VERSION = 1;
const STORE = 'projects-v1';

/** What this store persists for one project — the id doubles as the IDB key. */
export interface ProjectRecord {
  id: string;
  version: 2;
  savedAt: number;
  /** `Omit<Project, 'assets'> & { assets: StoredAsset[] }` — kept as `unknown` here so this module has no dependency on `Project`/`types.ts`; `projectStore.ts` owns the real shape. */
  project: unknown;
}

function openProjectDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Writes a project record. Rejects on failure (quota exceeded included) —
 * callers are expected to catch and translate, mirroring `assetStore.ts`'s
 * contract rather than swallowing anything here.
 */
export function putProjectRecord(record: ProjectRecord): Promise<void> {
  return openProjectDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(record);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('project save transaction aborted'));
      }),
  );
}

export function getProjectRecord(id: string): Promise<ProjectRecord | null> {
  return openProjectDB().then(
    (db) =>
      new Promise<ProjectRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve((req.result as ProjectRecord | undefined) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function deleteProjectRecord(id: string): Promise<void> {
  return openProjectDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(id);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Every stored project id — used by the one-time localStorage migration to skip ids already adopted. */
export function getAllProjectIds(): Promise<string[]> {
  return openProjectDB().then(
    (db) =>
      new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}
