/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7.5 — the rows of the Bulk Projects modal: one upload surface per
// bulk-created project.
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
import { missingSlots, type BuildTimelineSlots } from './buildTimelineGate';

export type BulkAudioState = 'none' | 'preparing' | 'ready' | 'failed' | 'local';

export interface BulkRowState {
  projectId: string;
  name: string;
  /** What the person typed. Empty until they name it: required to build. */
  typedName: string;
  slots: BuildTimelineSlots;
  mediaCount: number;
  audio: { state: BulkAudioState; detail?: string };
  /** What the last drop did, in plain words (skipped files, bundle problems). */
  notes: string[];
  busy: boolean;
}

export interface BulkRowDeps {
  loadStaged: (projectId: string) => Promise<StagedFiles | null>;
  writeStaged: (projectId: string, prev: StagedFiles, next: StagedFiles) => Promise<void>;
  loadProject: (projectId: string) => Promise<{ project: Project } | null>;
  saveProject: (project: Project) => Promise<{ ok: boolean }>;
  /** Registry entry (dashboard card name) for a renamed project. */
  upsertMeta?: (meta: { id: string; name: string; savedAt: number; segmentCount: number }) => void;
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

export const defaultBulkRowDeps = async (): Promise<BulkRowDeps> => {
  const [{ loadProject, saveProject, upsertProjectMeta }, engine, tauri, host] = await Promise.all([
    import('./projectStore'), import('./cloudSyncEngine'), import('./tauriFfmpeg'), import('./syncEngineHost'),
  ]);
  return {
    loadStaged: loadStagedFromStore,
    writeStaged: writeStagedDiff,
    loadProject,
    saveProject: p => saveProject(p),
    upsertMeta: upsertProjectMeta,
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

export class BulkRowStore {
  private rows = new Map<string, BulkRowState>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private view: readonly BulkRowState[] = [];
  private audioToken = new Map<string, number>();

  constructor(private readonly deps: BulkRowDeps) {}

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

  init(projects: readonly { id: string; name: string }[]): void {
    this.rows.clear();
    this.order = projects.map(p => p.id);
    for (const p of projects) {
      this.rows.set(p.id, {
        projectId: p.id, name: p.name, typedName: '', mediaCount: 0, notes: [], busy: false,
        slots: { script: false, scene: false, voiceover: false, media: false },
        audio: { state: 'none' },
      });
    }
    this.emit();
  }

  /** Rows with a name AND all four slots — what the batch will take. */
  completeIds(): string[] {
    return this.order.filter(id => {
      const r = this.rows.get(id)!;
      return r.typedName.trim().length > 0 && missingSlots(r.slots).length === 0;
    });
  }

  /** Typing only updates the row; `commitName` writes it to the project. */
  setTypedName(projectId: string, typed: string): void {
    this.patch(projectId, { typedName: typed });
  }

  /** Writes the typed name to the stored project and the dashboard registry. */
  async commitName(projectId: string): Promise<void> {
    const row = this.rows.get(projectId);
    const name = row?.typedName.trim();
    if (!row || !name || name === row.name) return;
    const stored = await this.deps.loadProject(projectId);
    if (!stored) return;
    const saved = await this.deps.saveProject({ ...stored.project, name });
    if (!saved.ok) { this.patch(projectId, { notes: ['The project name could not be saved.'] }); return; }
    this.deps.upsertMeta?.({ id: projectId, name, savedAt: Date.now(), segmentCount: stored.project.segments.length });
    this.patch(projectId, { name });
  }

  async commitAllNames(): Promise<void> {
    for (const id of this.order) await this.commitName(id);
  }

  async addFiles(projectId: string, files: readonly File[]): Promise<void> {
    if (!this.rows.has(projectId) || files.length === 0) return;
    this.patch(projectId, { busy: true, notes: [] });
    try {
      const prev = (await this.deps.loadStaged(projectId)) ?? EMPTY_STAGED;
      const stored = await this.deps.loadProject(projectId);
      const existing = (stored?.project.assets ?? []).map(a => a.contentHash).filter((h): h is string => !!h);
      const drop = await classifyRowDrop(projectId, prev, files, this.deps, existing);
      let persistedMedia = (stored?.project.assets ?? []).filter(a => a.type !== 'audio').length;
      if (drop.bundleMedia.length > 0 && stored) {
        // A bundle's media is already in the vault; the project owns it from here.
        const project = { ...stored.project, assets: [...stored.project.assets, ...drop.bundleMedia] };
        const saved = await this.deps.saveProject(project);
        if (saved.ok) persistedMedia += drop.bundleMedia.length;
        else drop.notes.push('The bundle’s media could not be saved to the project.');
      }
      await this.deps.writeStaged(projectId, prev, drop.next);
      const row = this.rows.get(projectId)!;
      this.patch(projectId, {
        slots: slotsOf(drop.next, persistedMedia),
        mediaCount: drop.next.assetFiles.length + drop.next.zipFiles.length + persistedMedia,
        notes: drop.notes,
        busy: false,
        audio: drop.voiceover ? { state: this.deps.cloudActive() ? 'preparing' : 'local' } : row.audio,
      });
      if (drop.voiceover && this.deps.cloudActive()) void this.prepareAudio(projectId, drop.voiceover);
    } catch (err) {
      this.patch(projectId, { busy: false, notes: [`Couldn’t add those files: ${err instanceof Error ? err.message : String(err)}`] });
    }
  }

  /** Eager, GPU-free: hash, probe, Opus-encode, PUT. Never submits a job. */
  private async prepareAudio(projectId: string, file: File): Promise<void> {
    const token = (this.audioToken.get(projectId) ?? 0) + 1;
    this.audioToken.set(projectId, token);
    const current = (): boolean => this.audioToken.get(projectId) === token;
    try {
      const hash = await this.deps.hashAudio(file);
      const duration = await this.deps.probeDuration(file, hash);
      await this.deps.stageAudio(file, hash, duration);
      if (current()) this.patch(projectId, { audio: { state: 'ready' } });
    } catch (err) {
      const detail = err instanceof Error ? err.message
        : typeof err === 'object' && err !== null && 'detail' in err ? String((err as { detail: unknown }).detail)
        : typeof err === 'object' && err !== null && 'kind' in err ? String((err as { kind: unknown }).kind) : String(err);
      // Not fatal: the job encodes and uploads it itself if this did not land.
      if (current()) this.patch(projectId, { audio: { state: 'failed', detail } });
    }
  }
}
