const DB_NAME = 'kinetix-assets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export interface StoredAsset {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
}

function openAssetDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openAssetDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const req = fn(tx.objectStore(STORE_NAME));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function putAsset(
  id: string,
  blob: Blob,
  meta: { name: string; mimeType: string },
): Promise<void> {
  const record: StoredAsset = { id, blob, name: meta.name, mimeType: meta.mimeType };
  return withStore('readwrite', (store) => store.put(record)).then(() => undefined);
}

export function getAsset(id: string): Promise<StoredAsset | null> {
  return withStore<StoredAsset | undefined>('readonly', (store) => store.get(id)).then(
    (v) => v ?? null,
  );
}

export function getAllAssets(): Promise<StoredAsset[]> {
  return openAssetDB().then(
    (db) =>
      new Promise<StoredAsset[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result as StoredAsset[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function deleteAsset(id: string): Promise<void> {
  return withStore('readwrite', (store) => store.delete(id)).then(() => undefined);
}

export function clearAllAssets(): Promise<void> {
  return withStore('readwrite', (store) => store.clear()).then(() => undefined);
}
