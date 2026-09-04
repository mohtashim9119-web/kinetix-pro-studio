/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS2-50 — the staged-slot DELETE CONTRACT, as a pure set diff.
 *
 * THE CONTRACT: after any staged-state change, the persisted rows for a project
 * are exactly the slots currently staged. Not a superset, not a subset. Every
 * way staged content stops being current is therefore covered without
 * enumerating those ways:
 *
 *   - replacing a file in a slot   — old slotKey absent from `next` → deleted
 *   - clearing a slot              — same
 *   - removing one staged asset    — same
 *   - Apply Sync                   — `updateStaged(() => EMPTY_STAGED)` → all deleted
 *   - Discard / clear all          — same
 *   - switching or deleting a project — `deleteAllStagedForProject`
 *
 * WHY A DIFF AND NOT PER-CALL-SITE DELETES. Every staged mutation in
 * `DropZonePanel.tsx` already funnels through one `updateStaged` — measured, no
 * exceptions. Reconciling there means the contract cannot be forgotten at a
 * call site added later, which is precisely the failure mode `processZipFile`
 * demonstrates: it drops a deduplicated asset without `deleteAsset` and without
 * `URL.revokeObjectURL`, leaking a row and a blob URL
 * (`docs/work-in-progress.md` §5).
 *
 * AND WHY THIS SHAPE AVOIDS THAT DEFECT'S SHAPE. `processZipFile` writes first
 * and decides membership afterwards. Here `next` IS the decided membership:
 * the reconciler is handed the final staged state and writes only keys present
 * in it, so no blob is written before its membership is decided.
 *
 * Pure and DOM-free on purpose — the contract is the part worth testing
 * exhaustively, and a set diff can be probed without a store or a component.
 */

import type { StagedFile, StagedFiles } from '../components/DropZonePanel';
import type { StoredStagedFile } from './stagedFilesStore';

/** Which slots this build persists. Widened as the cost of each slot is paid
 *  for: the text slots carry no blob risk, the media slots do. */
export type StagedSlotKind = 'script' | 'scene' | 'voiceover' | 'asset' | 'zip';

/** Text-only. `voiceover`/`asset`/`zip` are deliberately absent — see the
 *  WS2-50 design report and the voiceover hazard it records. */
export const TEXT_SLOTS: readonly StagedSlotKind[] = ['script', 'scene'] as const;

/** The singleton slots address by kind, so replacing one overwrites its row in
 *  place and cannot leave a predecessor behind. The multi-file slots address by
 *  the panel's React key, which is unique per staged file. */
export function slotKeyFor(kind: StagedSlotKind, file: StagedFile): string {
  switch (kind) {
    case 'script':
    case 'scene':
    case 'voiceover':
      return kind;
    default:
      return `${kind}:${file.key}`;
  }
}

export interface StagedSlotEntry {
  kind: StagedSlotKind;
  slotKey: string;
  file: StagedFile;
}

/** Flattens a `StagedFiles` into addressable slots, restricted to `enabled`. */
export function enumerateStagedSlots(
  staged: StagedFiles,
  enabled: readonly StagedSlotKind[],
): StagedSlotEntry[] {
  const on = new Set(enabled);
  const out: StagedSlotEntry[] = [];
  const singleton: [StagedSlotKind, StagedFile | null][] = [
    ['script', staged.scriptFile],
    ['scene', staged.sceneFile],
    ['voiceover', staged.voiceoverFile],
  ];
  for (const [kind, file] of singleton) {
    if (file && on.has(kind)) out.push({ kind, slotKey: slotKeyFor(kind, file), file });
  }
  if (on.has('asset')) {
    for (const f of staged.assetFiles) out.push({ kind: 'asset', slotKey: slotKeyFor('asset', f), file: f });
  }
  if (on.has('zip')) {
    for (const f of staged.zipFiles) out.push({ kind: 'zip', slotKey: slotKeyFor('zip', f), file: f });
  }
  return out;
}

export interface StagedReconcilePlan {
  /** Slots to write. Membership is already decided — these are exactly the
   *  slots present in `next`. */
  write: StagedSlotEntry[];
  /** slotKeys to delete: present in `prev`, absent from `next`. */
  remove: string[];
}

/**
 * The plan that makes persisted rows equal current staged slots.
 *
 * A slot present in both is rewritten only when its `File` actually changed —
 * compared by the panel's React key, which is minted per staging event, so a
 * re-drop of the same path is a genuinely new key and a genuinely new write.
 * An unchanged slot writes nothing, which is what keeps a drag onto the assets
 * list from rewriting the script blob on every keystroke-sized update.
 */
export function planStagedReconcile(
  prev: StagedFiles,
  next: StagedFiles,
  enabled: readonly StagedSlotKind[],
): StagedReconcilePlan {
  const before = new Map(enumerateStagedSlots(prev, enabled).map(e => [e.slotKey, e]));
  const after = enumerateStagedSlots(next, enabled);
  const afterKeys = new Set(after.map(e => e.slotKey));

  const write = after.filter(e => {
    const was = before.get(e.slotKey);
    return was === undefined || was.file.key !== e.file.key;
  });
  const remove = [...before.keys()].filter(k => !afterKeys.has(k));
  return { write, remove };
}

/** A slot entry as the row that will be stored. Reads the bytes exactly once. */
export async function toStoredRow(
  projectId: string,
  entry: StagedSlotEntry,
): Promise<StoredStagedFile> {
  const { file } = entry;
  return {
    projectId,
    slotKey: entry.slotKey,
    key: file.key,
    name: file.file.name,
    mimeType: file.file.type,
    lastModified: file.file.lastModified,
    size: file.file.size,
    blob: file.file.slice(0, file.file.size, file.file.type),
    stagedAt: Date.now(),
  };
}

/**
 * Rebuilds a `StagedFiles` from stored rows.
 *
 * `lastModified` IS RESTORED, and that is not cosmetic: `getFileIdentity`
 * (`syncEngine.ts:383`) is `${name}|${size}|${lastModified}`, so a `File` built
 * without it takes `Date.now()`, changes identity, and invalidates the cached
 * transcript for audio that was already transcribed.
 */
export function restoreStagedFiles(rows: readonly StoredStagedFile[]): StagedFiles {
  const out: StagedFiles = {
    scriptFile: null,
    sceneFile: null,
    voiceoverFile: null,
    assetFiles: [],
    zipFiles: [],
  };
  // Stable order for the multi-file slots — the panel renders them in array
  // order and IndexedDB's index scan order is not the user's staging order.
  const sorted = [...rows].sort((a, b) => a.stagedAt - b.stagedAt || a.slotKey.localeCompare(b.slotKey));
  for (const row of sorted) {
    const file: StagedFile = {
      file: new File([row.blob], row.name, {
        type: row.mimeType,
        lastModified: row.lastModified,
      }),
      key: row.key,
    };
    if (row.slotKey === 'script') out.scriptFile = file;
    else if (row.slotKey === 'scene') out.sceneFile = file;
    else if (row.slotKey === 'voiceover') out.voiceoverFile = file;
    else if (row.slotKey.startsWith('asset:')) out.assetFiles.push(file);
    else if (row.slotKey.startsWith('zip:')) out.zipFiles.push(file);
  }
  return out;
}

/** True when nothing at all is staged — used to skip a pointless restore. */
export function isStagedEmpty(staged: StagedFiles): boolean {
  return !staged.scriptFile && !staged.sceneFile && !staged.voiceoverFile
    && staged.assetFiles.length === 0 && staged.zipFiles.length === 0;
}
