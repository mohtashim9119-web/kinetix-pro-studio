/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// v1.2.2 — standing guard for the v1.2.1 bulk cross-write.
//
// Bulk finish built rows 2..n from row 1's staged files, so their records hold
// row 1's script, scene doc, voiceover, segments and spine. A bulk row's OWN
// inputs are still on disk: finish never clears the staged store, so each
// project's staged script / scene doc / voiceover rows are its own. This
// module proves a record against them and repairs it from them — never from
// another record:
//
//  1. VERIFY: the record's `lastSyncSpine` must equal the spine of its own
//     staged files (the same hashes Apply Sync stamps). No staged inputs, or
//     no spine yet, is "unverifiable" and is left alone.
//  2. RESET a mismatch to the state Build Timeline started from: every
//     timeline/transcript field cleared, and the assets that build added (the
//     foreign voiceover and anything persisted with or after it) dropped from
//     the record and from the project's asset stores and vault refs. The
//     row's own bundle media (added at drop time, before the build) stays.
//  3. REBUILD: the caller re-queues the row; finish runs Build Timeline from
//     its own staged files. The transcript and alignment are gateway cache
//     hits keyed by its own audio, so the rebuild costs ~$0.
//
// The foreign content itself is not lost: it is the source row's own record.
// ---------------------------------------------------------------------------

import type { Asset, Project } from '../types';
import type { StagedFiles } from '../components/DropZonePanel';

export type BulkRecordStatus = 'ok' | 'unverifiable' | 'repaired' | 'repair-failed';

export interface BulkRecordVerdict {
  id: string;
  name: string;
  status: BulkRecordStatus;
  detail: string;
}

export interface BulkRepairDeps {
  load: (id: string) => Promise<Project | null>;
  loadStaged: (id: string) => Promise<StagedFiles | null>;
  /** Text as Apply Sync reads it (RTF stripped). */
  readText: (file: File) => Promise<string>;
  hashAudio: (file: File) => Promise<string>;
  hashScript: (script: string, scene: string) => Promise<string>;
  /** Writes the reset record (an emptying write, deliberately). */
  save: (project: Project) => Promise<{ ok: boolean }>;
  /** Removes one asset's bytes from this project's stores and drops this
   *  project's vault reference to its content hash. */
  dropAsset: (projectId: string, asset: Asset, keepHashes: ReadonlySet<string>) => Promise<void>;
}

/**
 * The record with everything one Build Timeline wrote taken out. `dropped`
 * are the assets that build added: the voiceover asset and every asset
 * persisted with or after it (`addedAt`), which is how Apply Sync orders its
 * writes. Assets without `addedAt`, or added before the voiceover, predate
 * the build (the row's own bundle media) and stay.
 */
export function resetBuiltRecord(project: Project): { project: Project; dropped: Asset[] } {
  const voiceover = project.assets.find(a => a.id === project.voiceoverId);
  const builtAt = voiceover?.addedAt;
  const dropped = project.assets.filter(a =>
    a.id === project.voiceoverId || (builtAt !== undefined && a.addedAt !== undefined && a.addedAt >= builtAt));
  const droppedIds = new Set(dropped.map(a => a.id));
  const reset: Project = {
    ...project,
    script: '',
    sceneDetails: '',
    segments: [],
    headings: [],
    assets: project.assets.filter(a => !droppedIds.has(a.id)),
  };
  for (const key of [
    'scriptFileName', 'sceneDetailsFileName', 'scriptUpdatedAt', 'sceneDetailsUpdatedAt',
    'voiceoverId', 'lastTranscribedAssetId', 'lastTranscribedFileIdentity', 'lastTranscribedAudioHash',
    'transcriptTokens', 'detectedLanguage', 'syncRunSummaries', 'faWordTimings', 'clientFaCache',
    'timingProvenance', 'lastSyncSpine', 'unappliedTranscript',
  ] as const) delete (reset as Partial<Project>)[key];
  return { project: reset, dropped };
}

/** Verifies one bulk record against its own staged inputs; repairs a mismatch. */
export async function verifyAndRepairBulkRecord(id: string, deps: BulkRepairDeps): Promise<BulkRecordVerdict> {
  const project = await deps.load(id);
  if (!project) return { id, name: id, status: 'unverifiable', detail: 'the project could not be loaded' };
  const name = project.name;
  if (!project.bulkContext) return { id, name, status: 'unverifiable', detail: 'not a bulk project' };
  const spine = project.lastSyncSpine;
  if (!spine) return { id, name, status: 'unverifiable', detail: 'not built yet' };
  const staged = await deps.loadStaged(id);
  if (!staged?.voiceoverFile || !staged.scriptFile || !staged.sceneFile) {
    return { id, name, status: 'unverifiable', detail: 'its own staged files are no longer on disk' };
  }
  const [audioHash, script, scene] = await Promise.all([
    deps.hashAudio(staged.voiceoverFile.file),
    deps.readText(staged.scriptFile.file),
    deps.readText(staged.sceneFile.file),
  ]);
  const scriptHash = await deps.hashScript(script, scene);
  if (spine.audioHash === audioHash && spine.scriptHash === scriptHash) {
    return { id, name, status: 'ok', detail: 'built from its own files' };
  }
  const { project: reset, dropped } = resetBuiltRecord(project);
  const saved = await deps.save(reset);
  if (!saved.ok) return { id, name, status: 'repair-failed', detail: 'the reset record could not be saved' };
  const keep = new Set(reset.assets.map(a => a.contentHash).filter((h): h is string => !!h));
  for (const asset of dropped) await deps.dropAsset(id, asset, keep).catch(() => undefined);
  return {
    id, name, status: 'repaired',
    detail: `its timeline was built from another project's files; reset (${dropped.length} foreign asset${dropped.length === 1 ? '' : 's'} removed) and queued to rebuild from its own files`,
  };
}

/** Runs the guard over every candidate, one at a time. */
export async function verifyBulkRecords(ids: readonly string[], deps: BulkRepairDeps): Promise<BulkRecordVerdict[]> {
  const out: BulkRecordVerdict[] = [];
  for (const id of ids) {
    try { out.push(await verifyAndRepairBulkRecord(id, deps)); }
    catch (err) { out.push({ id, name: id, status: 'repair-failed', detail: err instanceof Error ? err.message : String(err) }); }
  }
  return out;
}
