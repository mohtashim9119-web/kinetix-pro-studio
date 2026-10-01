/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7.5 — the rows of the Bulk Projects modal: one upload surface per
// DRAFT project. A row is only a draft: no project exists (nothing on the
// dashboard, nothing in the registry) until Build Timeline, which creates the
// complete rows and discards the empty ones.
//
// FILES STAGE EXACTLY WHERE THE EDITOR STAGES THEM. A row writes the same
// `kinetix-staged` rows the project's own DropZone restores on open
// (`stagedFilesPersist.ts`), through the same reconcile plan, so a project
// opened after the batch has its four slots filled and Build Timeline live —
// the button is disabled for a project with nothing staged. Nothing is
// committed to the project, nothing is transcribed, nothing touches the cloud
// GPU. Classification reuses the DropZone's own rules (text role by bracket
// count, audio by extension/MIME, macOS metadata dropped) and the existing
// bundle ingest for a bundle zip.
//
// EAGER, GPU-FREE PREP. A voiceover arriving in a row is hashed, probed and —
// on the cloud engine — Opus-encoded and PUT to the gateway's audio cache
// (`stageCloudAudioOnly`): no job, no meter line. Script and scene doc stay
// local and travel with the job payload; only audio is pre-positioned.
// ---------------------------------------------------------------------------

import type { Asset, Project } from '../types';
import type { StagedFile, StagedFiles } from '../components/DropZonePanel';
import { classifyAndIngestBundleZip } from './bundleIngest';
import { isAudioFile } from './audioFormats';
import { isMacOSMetadataPath } from './macosMetadata';
import { detectMediaType } from './mediaIngest';
import { stripRtfIfNeeded, detectTextFileRole } from './textUtils';
import {
  ALL_PERSISTED_SLOTS, loadStagedFromStore, planStagedReconcile, toStoredRow,
} from './stagedFilesPersist';
import { deleteStagedFile, putStagedFile } from './stagedFilesStore';
import { computeAudioHash } from './spine';
import { BUILD_TIMELINE_COPY, missingSpineSlots, type BuildTimelineSlots } from './buildTimelineGate';
import { rowIncompleteReason } from './bulkContext';

export type BulkAudioState = 'none' | 'preparing' | 'ready' | 'failed' | 'local';

export interface BulkRowFile {
  /** Address inside the row: 'script' | 'scene' | 'voiceover' | 'asset:<key>' | 'zip:<key>' | 'bundle:<assetId>'. */
  id: string;
  kind: 'script' | 'scene' | 'voiceover' | 'media';
  name: string;
}

export interface BulkRowState {
  /** The id the project will have when (if) it is created at Build Timeline. */
  projectId: string;
  /** What the person typed. Empty until they name it: required to build. */
  typedName: string;
  slots: BuildTimelineSlots;
  mediaCount: number;
  files: BulkRowFile[];
  audio: { state: BulkAudioState; detail?: string };
  /** What the last drop did, in plain words (skipped files, bundle problems). */
  notes: string[];
  busy: boolean;
  /** The project has been created and handed to the batch: the row is locked. */
  built: boolean;
}

export interface BulkRowDeps {
  loadStaged: (projectId: string) => Promise<StagedFiles | null>;
  writeStaged: (projectId: string, prev: StagedFiles, next: StagedFiles) => Promise<void>;
  /** Creates + registers the project (dashboard card) at Build Timeline. */
  createProject: (info: { id: string; name: string; assets: Asset[] }) => Promise<boolean>;
  /** Everything a draft left behind: staged rows, vaulted bundle media. */
  purge: (projectId: string, bundleAssets: Asset[]) => Promise<void>;
  removeBundleAsset: (projectId: string, asset: Asset) => Promise<void>;
  hashAudio: (file: File) => Promise<string>;
  probeDuration: (file: File, audioHash: string) => Promise<number>;
  /** Cloud engine selected and usable: only then is audio pre-positioned. */
  cloudActive: () => boolean;
  stageAudio: (file: File, audioHash: string, durationSec: number) => Promise<unknown>;
  ingestBundle: typeof classifyAndIngestBundleZip;
}

/** Duration is probed once per audio content (it crosses IPC as the whole
 *  file); the eager prep and the job share this memo. */
const durationMemo = new Map<string, Promise<number>>();
export function memoizedDuration(
  file: File, audioHash: string, probe: (f: File) => Promise<number>,
): Promise<number> {
  let hit = durationMemo.get(audioHash);
  if (!hit) {
    hit = probe(file);
    durationMemo.set(audioHash, hit);
    hit.catch(() => durationMemo.delete(audioHash));
  }
  return hit;
}
export function __resetDurationMemoForTests(): void { durationMemo.clear(); }

export const defaultBulkRowDeps = async (makeBlankProject: () => Project): Promise<BulkRowDeps> => {
  const [store, engine, tauri, host, assets, vault, staged, ctx] = await Promise.all([
    import('./projectStore'), import('./cloudSyncEngine'), import('./tauriFfmpeg'), import('./syncEngineHost'),
    import('./assetStore'), import('./mediaVaultClient'), import('./stagedFilesStore'), import('./bulkContext'),
  ]);
  const unreference = async (projectId: string, list: Asset[]): Promise<void> => {
    const hashes = new Set(list.map(a => a.contentHash).filter((h): h is string => !!h));
    await Promise.all([...hashes].map(h => vault.mediaVaultUnreference(h, projectId).catch(() => undefined)));
  };
  return {
    loadStaged: loadStagedFromStore,
    writeStaged: writeStagedDiff,
    createProject: info => ctx.createBulkProject(info, {
      makeBlankProject, save: p => store.saveProject(p), upsertMeta: store.upsertProjectMeta,
    }),
    purge: async (projectId, bundleAssets) => {
      await staged.deleteAllStagedForProject(projectId).catch(() => undefined);
      await assets.deleteAllAssets(projectId).catch(() => undefined);
      await unreference(projectId, bundleAssets);
    },
    removeBundleAsset: async (projectId, asset) => {
      await assets.deleteAsset(projectId, asset.id).catch(() => undefined);
      await unreference(projectId, [asset]);
    },
    hashAudio: computeAudioHash,
    probeDuration: (file, hash) => memoizedDuration(file, hash, tauri.probeAudioDuration),
    cloudActive: () => tauri.isTauri() && host.readSyncEngineHost() === 'cloud',
    stageAudio: (file, hash, durationSec) => engine.stageCloudAudioOnly(file, hash, { durationSec }),
    ingestBundle: classifyAndIngestBundleZip,
  };
};

/** Persists `next` over `prev` with the editor's own reconcile plan. */
export async function writeStagedDiff(projectId: string, prev: StagedFiles, next: StagedFiles): Promise<void> {
  const plan = planStagedReconcile(prev, next, ALL_PERSISTED_SLOTS);
  for (const entry of plan.write) await putStagedFile(await toStoredRow(projectId, entry));
  for (const key of plan.remove) await deleteStagedFile(projectId, key);
}

export interface DropOutcome {
  next: StagedFiles;
  /** Media a validated bundle zip carried (already vaulted; attach to the project). */
  bundleMedia: Asset[];
  notes: string[];
  /** The voiceover that arrived in this drop, if any. */
  voiceover?: File;
}

const EMPTY_STAGED: StagedFiles = { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] };

const staged = (file: File): StagedFile => ({ file, key: crypto.randomUUID() });

/** Classifies one drop over what a row already holds. Pure apart from a
 *  bundle zip's own ingest (`deps.ingestBundle`). */
export async function classifyRowDrop(
  projectId: string,
  prev: StagedFiles,
  files: readonly File[],
  deps: Pick<BulkRowDeps, 'ingestBundle'>,
  existingHashes: string[] = [],
): Promise<DropOutcome> {
  const notes: string[] = [];
  const bundleMedia: Asset[] = [];
  const texts: { file: File; role: 'script' | 'sceneDetails' }[] = [];
  let voiceover: File | undefined;
  const assets: File[] = [];
  const zips: File[] = [];
  let script: File | undefined;
  let scene: File | undefined;
  let bundleVoiceover: File | undefined;
  let skipped = 0;

  for (const file of files) {
    if (isMacOSMetadataPath(file.webkitRelativePath || file.name)) continue;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'zip') {
      const outcome = await deps.ingestBundle(projectId, file, existingHashes);
      if (outcome.kind === 'not-a-bundle') zips.push(file);
      else if (outcome.kind === 'failure') notes.push(outcome.message);
      else {
        script = outcome.scriptFile;
        scene = outcome.sceneFile;
        bundleVoiceover = outcome.voiceoverFile;
        bundleMedia.push(...outcome.mediaAssets);
        notes.push(`Bundle “${file.name}”: script, scene doc, voiceover and ${outcome.mediaAssets.length} media file${outcome.mediaAssets.length === 1 ? '' : 's'}.`);
      }
    } else if (ext === 'txt' || ext === 'rtf') {
      texts.push({ file, role: detectTextFileRole(stripRtfIfNeeded(await file.text())) });
    } else if (isAudioFile(file)) {
      voiceover = file;
    } else if (detectMediaType(file.name) !== undefined) {
      assets.push(file);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) notes.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped (not a script, scene doc, audio, image or video).`);

  // Same claim order as DropZonePanel: the first scene-shaped text is the
  // scene doc, the first other is the script.
  let pendingScript: File | undefined;
  let pendingScene: File | undefined;
  for (const t of texts) {
    if (t.role === 'sceneDetails') { if (!pendingScene) pendingScene = t.file; else if (!pendingScript) pendingScript = t.file; }
    else if (!pendingScript) pendingScript = t.file; else if (!pendingScene) pendingScene = t.file;
  }

  const next: StagedFiles = {
    scriptFile: script ? staged(script) : pendingScript ? staged(pendingScript) : prev.scriptFile,
    sceneFile: scene ? staged(scene) : pendingScene ? staged(pendingScene) : prev.sceneFile,
    voiceoverFile: bundleVoiceover ? staged(bundleVoiceover) : voiceover ? staged(voiceover) : prev.voiceoverFile,
    assetFiles: [...prev.assetFiles, ...assets.map(staged)],
    zipFiles: [...prev.zipFiles, ...zips.map(staged)],
  };
  return { next, bundleMedia, notes, voiceover: bundleVoiceover ?? voiceover };
}

export function slotsOf(st: StagedFiles, persistedMedia: number): BuildTimelineSlots {
  return {
    script: !!st.scriptFile,
    scene: !!st.sceneFile,
    voiceover: !!st.voiceoverFile,
    media: st.assetFiles.length > 0 || st.zipFiles.length > 0 || persistedMedia > 0,
  };
}

function filesOf(st: StagedFiles, bundle: readonly Asset[]): BulkRowFile[] {
  const out: BulkRowFile[] = [];
  if (st.scriptFile) out.push({ id: 'script', kind: 'script', name: st.scriptFile.file.name });
  if (st.sceneFile) out.push({ id: 'scene', kind: 'scene', name: st.sceneFile.file.name });
  if (st.voiceoverFile) out.push({ id: 'voiceover', kind: 'voiceover', name: st.voiceoverFile.file.name });
  for (const f of st.assetFiles) out.push({ id: `asset:${f.key}`, kind: 'media', name: f.file.name });
  for (const f of st.zipFiles) out.push({ id: `zip:${f.key}`, kind: 'media', name: f.file.name });
  for (const a of bundle) out.push({ id: `bundle:${a.id}`, kind: 'media', name: a.name });
  return out;
}

export class BulkRowStore {
  private rows = new Map<string, BulkRowState>();
  private order: string[] = [];
  private bundle = new Map<string, Asset[]>();
  private listeners = new Set<() => void>();
  private view: readonly BulkRowState[] = [];
  private audioToken = new Map<string, number>();

  constructor(private readonly deps: BulkRowDeps, private readonly max = Infinity) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  snapshot(): readonly BulkRowState[] { return this.view; }
  private emit(): void {
    this.view = this.order.map(id => ({ ...this.rows.get(id)! }));
    for (const l of this.listeners) l();
  }
  private patch(id: string, change: Partial<BulkRowState>): void {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, ...change });
    this.emit();
  }

  private blankRow(id: string): BulkRowState {
    return {
      projectId: id, typedName: '', mediaCount: 0, files: [], notes: [], busy: false, built: false,
      slots: { script: false, scene: false, voiceover: false, media: false },
      audio: { state: 'none' },
    };
  }

  /** N empty draft rows. Nothing is created anywhere. */
  init(count: number): void {
    this.rows.clear();
    this.order = [];
    this.bundle.clear();
    for (let i = 0; i < count; i++) this.pushRow();
    this.emit();
  }

  private pushRow(): string {
    const id = crypto.randomUUID();
    this.rows.set(id, this.blankRow(id));
    this.order.push(id);
    return id;
  }

  canAddRow(): boolean { return this.order.length < this.max; }

  /** Rows for projects the persistent batch already created (a reopened
   *  window): shown locked, in step with the batch record. Also drops built
   *  rows the operator cleared. */
  syncBuilt(records: readonly { id: string; name: string }[]): void {
    let changed = false;
    const ids = new Set(records.map(r => r.id));
    for (const rec of records) {
      if (this.rows.has(rec.id)) continue;
      this.rows.set(rec.id, { ...this.blankRow(rec.id), typedName: rec.name, built: true });
      this.order.push(rec.id);
      changed = true;
    }
    for (const id of [...this.order]) {
      if (this.rows.get(id)!.built && !ids.has(id)) {
        this.rows.delete(id); this.bundle.delete(id);
        this.order = this.order.filter(x => x !== id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** "Create Projects": n empty draft rows (one new group). */
  createDrafts(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n && this.canAddRow(); i += 1) ids.push(this.pushRow());
    if (ids.length > 0) this.emit();
    return ids;
  }

  /** "Add project": one more empty draft row. */
  addRow(): string | undefined {
    if (!this.canAddRow()) return undefined;
    const id = this.pushRow();
    this.emit();
    return id;
  }

  /** Rows with a name AND the three spine slots (script, scene doc, voiceover) that
   *  have not been built yet — media is optional (Wave 3 U9 B5). */
  completeIds(): string[] {
    return this.order.filter(id => {
      const r = this.rows.get(id)!;
      return !r.built && r.typedName.trim().length > 0 && missingSpineSlots(r.slots).length === 0;
    });
  }

  setTypedName(id: string, typed: string): void {
    this.patch(id, { typedName: typed });
  }

  private refresh(id: string, st: StagedFiles, extra: Partial<BulkRowState> = {}): void {
    const bundle = this.bundle.get(id) ?? [];
    const persistedMedia = bundle.filter(a => a.type !== 'audio').length;
    this.patch(id, {
      slots: slotsOf(st, persistedMedia),
      mediaCount: st.assetFiles.length + st.zipFiles.length + persistedMedia,
      files: filesOf(st, bundle),
      ...extra,
    });
  }

  async addFiles(id: string, files: readonly File[]): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.built || files.length === 0) return;
    this.patch(id, { busy: true, notes: [] });
    try {
      const prev = (await this.deps.loadStaged(id)) ?? EMPTY_STAGED;
      const have = this.bundle.get(id) ?? [];
      const drop = await classifyRowDrop(id, prev, files, this.deps, have.map(a => a.contentHash).filter((h): h is string => !!h));
      // A bundle's media is already in the vault; it is attached to the
      // project when (if) the project is created.
      if (drop.bundleMedia.length > 0) this.bundle.set(id, [...have, ...drop.bundleMedia]);
      await this.deps.writeStaged(id, prev, drop.next);
      this.refresh(id, drop.next, {
        notes: drop.notes,
        busy: false,
        audio: drop.voiceover ? { state: this.deps.cloudActive() ? 'preparing' : 'local' } : this.rows.get(id)!.audio,
      });
      if (drop.voiceover && this.deps.cloudActive()) void this.prepareAudio(id, drop.voiceover);
    } catch (err) {
      this.patch(id, { busy: false, notes: [`Couldn’t add those files: ${err instanceof Error ? err.message : String(err)}`] });
    }
  }

  /** Removes one file from a row (a wrong drop). */
  async removeFile(id: string, fileId: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.built) return;
    const prev = (await this.deps.loadStaged(id)) ?? EMPTY_STAGED;
    let next = prev;
    if (fileId.startsWith('bundle:')) {
      const assetId = fileId.slice('bundle:'.length);
      const list = this.bundle.get(id) ?? [];
      const gone = list.find(a => a.id === assetId);
      if (gone) await this.deps.removeBundleAsset(id, gone);
      this.bundle.set(id, list.filter(a => a.id !== assetId));
    } else {
      next = {
        scriptFile: fileId === 'script' ? null : prev.scriptFile,
        sceneFile: fileId === 'scene' ? null : prev.sceneFile,
        voiceoverFile: fileId === 'voiceover' ? null : prev.voiceoverFile,
        assetFiles: prev.assetFiles.filter(f => `asset:${f.key}` !== fileId),
        zipFiles: prev.zipFiles.filter(f => `zip:${f.key}` !== fileId),
      };
      await this.deps.writeStaged(id, prev, next);
    }
    const extra: Partial<BulkRowState> = { notes: [] };
    if (fileId === 'voiceover') {
      this.audioToken.set(id, (this.audioToken.get(id) ?? 0) + 1); // a late prep must not resurrect the state
      extra.audio = { state: 'none' };
    }
    this.refresh(id, next, extra);
  }

  /** Replaces one file. A slot file (script / scene doc / voiceover) stays in
   *  ITS slot whatever the new file looks like; a media file is swapped. */
  async replaceFile(id: string, fileId: string, file: File): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.built) return;
    const slot = fileId === 'script' ? 'scriptFile' : fileId === 'scene' ? 'sceneFile' : fileId === 'voiceover' ? 'voiceoverFile' : null;
    if (!slot) {
      await this.removeFile(id, fileId);
      await this.addFiles(id, [file]);
      return;
    }
    const prev = (await this.deps.loadStaged(id)) ?? EMPTY_STAGED;
    const next: StagedFiles = { ...prev, [slot]: staged(file) };
    await this.deps.writeStaged(id, prev, next);
    const extra: Partial<BulkRowState> = { notes: [] };
    if (slot === 'voiceoverFile') {
      this.audioToken.set(id, (this.audioToken.get(id) ?? 0) + 1);
      extra.audio = { state: this.deps.cloudActive() ? 'preparing' : 'local' };
    }
    this.refresh(id, next, extra);
    if (slot === 'voiceoverFile' && this.deps.cloudActive()) void this.prepareAudio(id, file);
  }

  /** Replace all: the row's files become exactly this new set. */
  async replaceAll(id: string, files: readonly File[]): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.built || files.length === 0) return;
    await this.clearFiles(id);
    await this.addFiles(id, files);
  }

  /** Clears every file of a row, keeping the row and its name. */
  async clearFiles(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.built) return;
    await this.deps.purge(id, this.bundle.get(id) ?? []);
    this.bundle.delete(id);
    this.audioToken.set(id, (this.audioToken.get(id) ?? 0) + 1);
    this.refresh(id, EMPTY_STAGED, { notes: [], audio: { state: 'none' } });
  }

  /** Drops a draft row and everything it staged. */
  async discardRow(id: string): Promise<void> {
    if (!this.rows.has(id)) return;
    await this.deps.purge(id, this.bundle.get(id) ?? []);
    this.rows.delete(id);
    this.bundle.delete(id);
    this.order = this.order.filter(x => x !== id);
    this.emit();
  }

  /** Closing the modal: drafts that never became projects leave nothing behind. */
  async discardUnbuilt(): Promise<void> {
    for (const id of [...this.order]) if (!this.rows.get(id)!.built) await this.discardRow(id);
  }

  /**
   * Build Timeline: create the projects that are real (named, spine slots) and
   * discard the empty drafts. A half-filled row is neither: it stays a draft,
   * with the reason it was left out.
   */
  async buildReady(): Promise<{ created: { id: string; name: string }[]; skips: Record<string, string> }> {
    const created: { id: string; name: string }[] = [];
    const skips: Record<string, string> = {};
    for (const id of [...this.order]) {
      const r = this.rows.get(id)!;
      if (r.built) continue;
      const empty = r.files.length === 0 && r.typedName.trim() === '';
      if (empty) { await this.discardRow(id); continue; }
      const missing = missingSpineSlots(r.slots).map(slot => BUILD_TIMELINE_COPY.slotNames[slot]);
      const why = rowIncompleteReason(r.typedName, missing);
      if (why) { skips[id] = why; continue; }
      const name = r.typedName.trim();
      const ok = await this.deps.createProject({ id, name, assets: this.bundle.get(id) ?? [] });
      if (!ok) { skips[id] = 'the project could not be saved'; continue; }
      this.patch(id, { built: true });
      created.push({ id, name });
    }
    return { created, skips };
  }

  /** Eager, GPU-free: hash, probe, Opus-encode, PUT. Never submits a job. */
  private async prepareAudio(id: string, file: File): Promise<void> {
    const token = (this.audioToken.get(id) ?? 0) + 1;
    this.audioToken.set(id, token);
    const current = (): boolean => this.audioToken.get(id) === token;
    try {
      const hash = await this.deps.hashAudio(file);
      const duration = await this.deps.probeDuration(file, hash);
      await this.deps.stageAudio(file, hash, duration);
      if (current()) this.patch(id, { audio: { state: 'ready' } });
    } catch (err) {
      const detail = err instanceof Error ? err.message
        : typeof err === 'object' && err !== null && 'detail' in err ? String((err as { detail: unknown }).detail)
        : typeof err === 'object' && err !== null && 'kind' in err ? String((err as { kind: unknown }).kind) : String(err);
      // Not fatal: the job encodes and uploads it itself if this did not land.
      if (current()) this.patch(id, { audio: { state: 'failed', detail } });
    }
  }
}
