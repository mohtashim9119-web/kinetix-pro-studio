const DB_NAME = 'kinetix-assets';
const DB_VERSION = 2;
const STORE_V2 = 'assets-v2'; // compound keyPath ['projectId', 'id'] + index 'byProject'
const STORE_V1 = 'assets';     // legacy — kept for one-time migration reads

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StoredAsset {
  projectId: string;
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
}

/** Legacy asset shape from the v1 store (no projectId). */
export interface LegacyStoredAsset {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// DB open helper
// ---------------------------------------------------------------------------

function openAssetDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      // v0 → v1: create the original unscoped store (needed even on a fresh v2
      // install so that getLegacyAssets() can open a read transaction without
      // throwing a "store not found" error).
      if (oldVersion < 1) {
        db.createObjectStore(STORE_V1, { keyPath: 'id' });
      }

      // v1 → v2: add the project-scoped store with a compound key and index.
      if (oldVersion < 2) {
        const store = db.createObjectStore(STORE_V2, {
          keyPath: ['projectId', 'id'],
        });
        store.createIndex('byProject', 'projectId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// v2 CRUD — all calls must supply projectId
// ---------------------------------------------------------------------------

export function putAsset(
  projectId: string,
  id: string,
  blob: Blob,
  meta: { name: string; mimeType: string },
): Promise<void> {
  const record: StoredAsset = { projectId, id, blob, name: meta.name, mimeType: meta.mimeType };
  return openAssetDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readwrite');
        const req = tx.objectStore(STORE_V2).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function getAsset(projectId: string, id: string): Promise<StoredAsset | null> {
  return openAssetDB().then(
    (db) =>
      new Promise<StoredAsset | null>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readonly');
        const req = tx.objectStore(STORE_V2).get([projectId, id]);
        req.onsuccess = () => resolve((req.result as StoredAsset | undefined) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function getAllAssetsForProject(projectId: string): Promise<StoredAsset[]> {
  return openAssetDB().then(
    (db) =>
      new Promise<StoredAsset[]>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readonly');
        const index = tx.objectStore(STORE_V2).index('byProject');
        const req = index.getAll(IDBKeyRange.only(projectId));
        req.onsuccess = () => resolve(req.result as StoredAsset[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function deleteAsset(projectId: string, id: string): Promise<void> {
  return openAssetDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readwrite');
        const req = tx.objectStore(STORE_V2).delete([projectId, id]);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/**
 * Deletes all assets belonging to a specific project.
 * Uses the `byProject` index with a cursor so only that project's records
 * are touched — other projects' assets remain intact.
 */
export function deleteAllAssets(projectId: string): Promise<void> {
  return openAssetDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readwrite');
        const store = tx.objectStore(STORE_V2);
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

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Reads all assets from the legacy v1 store.
 * Used once during migration; after migration, the v1 store data is no longer
 * used (the v2 store holds the migrated copies).
 */
export function getLegacyAssets(): Promise<LegacyStoredAsset[]> {
  return openAssetDB().then(
    (db) =>
      new Promise<LegacyStoredAsset[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(STORE_V1)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(STORE_V1, 'readonly');
        const req = tx.objectStore(STORE_V1).getAll();
        req.onsuccess = () => resolve(req.result as LegacyStoredAsset[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/** Full wipe of the v2 store — clears assets across ALL projects. */
export function clearAllAssets(): Promise<void> {
  return openAssetDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_V2, 'readwrite');
        const req = tx.objectStore(STORE_V2).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}
