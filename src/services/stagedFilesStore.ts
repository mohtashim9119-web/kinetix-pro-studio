/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS2-50 — byte-level persistence for the four DropZonePanel staging slots.
 *
 * WHY A STORE AND NOT A FIELD ON `Project`. Three reasons, in descending order
 * of force:
 *
 *  1. UNDO WOULD RESURRECT IT. `history.ts` snapshots the whole `Project` and
 *     `historyPersist.ts` keeps 20 of those. A staged slot living on `Project`
 *     becomes undoable, so an undo past a file swap silently re-stages a file
 *     the user already replaced — and the next Apply Sync consumes it. Staged
 *     state has no meaningful undo semantics: it answers "what is pending",
 *     not "what was applied". This argument stands on its own, independent of
 *     any payload measurement.
 *  2. A `File` CANNOT ROUND-TRIP A PROJECT SNAPSHOT. `projectStore.ts` and
 *     `historyPersist.ts` both deliberately strip `blob:` URLs and `File`
 *     handles before writing, because a blob URL dies with the page. A staged
 *     slot's value *is* a `File`. Putting it on `Project` would mean either
 *     stuffing media bytes into the localStorage project JSON — the store that
 *     has already thrown `QuotaExceededError` on this repo's own corpus
 *     (`projectStore.ts:71`) — or persisting a reference that is dead on
 *     arrival.
 *  3. Payload multiplication. Script + scene text rides into up to 20 history
 *     snapshots. Real, and the least of the three.
 *
 * INTERACTION WITH `historyPersist`: NONE, BY CONSTRUCTION. This is a separate
 * IndexedDB database that `history.ts` and `historyPersist.ts` neither read nor
 * write, and no `Project` field changes, so snapshot payloads are byte-
 * identical to before this store existed and no undo/redo traversal can move a
 * staged slot. `stagedFilesHistoryIsolation.test.ts` asserts both halves.
 *
 * A SEPARATE DATABASE FROM `kinetix-assets`, DELIBERATELY. Staged rows are
 * pending, not committed, and the orphan accounting that WS2-49 established
 * over `kinetix-assets` is "rows == `project.assets` references". Staged rows
 * are by definition referenced by no `project.assets` entry, so writing them
 * into that store would make every staged file read as an orphan and destroy
 * the only measurement this repo has for a real leak there. In its own DB the
 * count stays exactly 1:1 by construction.
 */

const DB_NAME = 'kinetix-staged';
const DB_VERSION = 1;
const STORE = 'staged-v1';

/** One staged slot's bytes plus everything needed to rebuild an identical
 *  `File` — see `lastModified` below, which is load-bearing, not metadata. */
export interface StoredStagedFile {
  projectId: string;
  /** Stable per-slot address. Singleton slots use their own name so a replace
   *  overwrites in place and can leave nothing behind; multi-file slots are
   *  addressed by the panel's React key. See `stagedFilesPersist.ts`. */
  slotKey: string;
  /** The panel's `StagedFile.key`, preserved so a restored row keeps its React
   *  identity across the reload. */
  key: string;
  name: string;
  mimeType: string;
  /** MUST be preserved. `getFileIdentity` (`syncEngine.ts:383`) is
   *  `${name}|${size}|${lastModified}` and is the transcription cache key. A
   *  `File` rebuilt without it gets `Date.now()`, which changes the identity,
   *  invalidates the cached transcript, and forces a re-transcription of audio
   *  that was already transcribed. */
  lastModified: number;
  size: number;
  blob: Blob;
  stagedAt: number;
}

function openStagedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['projectId', 'slotKey'] });
        store.createIndex('byProject', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Writes (or replaces) one slot. A replace overwrites the same compound key,
 *  so a singleton slot structurally cannot leave a previous row behind. */
export async function putStagedFile(row: StoredStagedFile): Promise<void> {
  const db = await openStagedDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getStagedFilesForProject(projectId: string): Promise<StoredStagedFile[]> {
  const db = await openStagedDB();
  try {
    return await new Promise<StoredStagedFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).index('byProject').getAll(projectId);
      req.onsuccess = () => resolve((req.result as StoredStagedFile[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteStagedFile(projectId: string, slotKey: string): Promise<void> {
  const db = await openStagedDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete([projectId, slotKey]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Every staged row for one project. The Apply / Discard / project-teardown
 *  end of the delete contract. */
export async function deleteAllStagedForProject(projectId: string): Promise<void> {
  const db = await openStagedDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.index('byProject').getAllKeys(projectId);
      req.onsuccess = () => {
        for (const key of req.result) store.delete(key);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Row count for a project — the measurement half of the delete contract, so a
 *  test can assert "no orphan left behind" rather than infer it. */
export async function countStagedFiles(projectId: string): Promise<number> {
  return (await getStagedFilesForProject(projectId)).length;
}
