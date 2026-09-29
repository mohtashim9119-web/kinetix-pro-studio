/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7.5 — Bulk Projects: what a bulk-created project is, how it is
// created, and the ONE rule that keeps it from spending cloud GPU on its own.
//
// AUTO-FIRE SUPPRESSION. A project made by Bulk Projects carries
// `bulkContext` from birth. Until its first successful build (a stamped
// `lastSyncSpine`) nothing may start cloud work for it unprompted — not the
// staging transcription a voiceover drop kicks off, not the U4.5 background
// alignment intent. The only triggers are the batch button and the project's
// own explicit click. Before this unit nothing distinguished such a project:
// its spine completing fired the intent the moment a voiceover landed
// (`decideStagingStart` with no flag = 'start', pinned by the tests).
//
// Everything a person reads lives in BULK_COPY, for operator sign-off.
// ---------------------------------------------------------------------------

import type { Project } from '../types';
import { AUTO_DETECT, readNewProjectDefaults, NEW_PROJECT_TEXT_OVERLAY_DEFAULT_ON } from './appDefaults';
import { FA_PROJECT_DEFAULT_ON, shouldPersistFaChoice } from './faGate';
import { lookupCloudCache } from './cloudGateway';

/** Sane ceiling on one bulk creation. Operator-swappable. */
export const BULK_MAX_PROJECTS = 25;

export const BULK_COPY = {
  button: 'Bulk Projects',
  dialogTitle: 'Bulk Projects',
  quantityLabel: 'How many projects?',
  quantityHint: (max: number): string => `1 to ${max}. Each gets its own row to fill.`,
  quantityInvalid: (max: number): string => `Enter a whole number from 1 to ${max}.`,
  create: 'Create projects',
  cancel: 'Cancel',
  /** "Bulk Project 1" … "Bulk Project N". Rename later in the project. */
  namePrefix: 'Bulk Project',
  modalTitle: 'Bulk Projects',
  modalIntro: 'Drop files onto a row: loose files, a folder, a zip, or one bundle zip that carries the script, scene doc, voiceover and media. Nothing uses the cloud GPU until you press Build Timeline.',
  rowDrop: 'Drop files or a zip here, or',
  rowBrowseFiles: 'Add files',
  rowBrowseFolder: 'Add folder',
  slot: { script: 'Script', scene: 'Scene doc', voiceover: 'Voiceover', media: 'Media' },
  audio: {
    none: '',
    preparing: 'Preparing voiceover for the cloud…',
    ready: 'Voiceover ready on the cloud (no GPU used)',
    failed: 'Voiceover not prepared',
    local: 'Local engine: nothing is uploaded',
  },
  build: 'Build Timeline',
  buildNeeds: 'Fill every slot of at least one project to build',
  cancelRow: 'Cancel',
  cancelAll: 'Cancel all',
  open: 'Open project',
  close: 'Close',
  closeNote: 'Closing this window does not stop projects that are already building — they finish into the cloud cache, and opening the project then is free.',
  skipped: (why: string): string => `Skipped — ${why}`,
  notCloud: 'Bulk build runs on the Cloud engine (App Settings → Sync Engine).',
} as const;

export function bulkProjectName(index1: number): string {
  return `${BULK_COPY.namePrefix} ${index1}`;
}

/** A whole number in 1..max, else null. */
export function parseBulkCount(raw: string, max: number = BULK_MAX_PROJECTS): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

/** Nothing may start cloud work for this project unprompted. */
export function isBulkAutoFireSuppressed(project: Pick<Project, 'bulkContext' | 'lastSyncSpine'>): boolean {
  return project.bulkContext === true && !project.lastSyncSpine;
}

export type StagingStartDecision = 'start' | 'hold-for-click' | 'lookup-first';

/**
 * What a voiceover reaching the staging path (a drop, or a restore on open)
 * does on the CLOUD engine. `explicit` is a click on the project's own
 * Transcribe action, `rerun` a pause dialog's answer: both are asked for.
 * A bulk project that has not built yet only PEEKS at the gateway's cache
 * (`lookup-first`, free: no upload, no job, no meter line) and starts only on
 * a hit; a miss waits for the click.
 */
export function decideStagingStart(input: {
  project: Pick<Project, 'bulkContext' | 'lastSyncSpine'>;
  host: 'cloud' | 'local';
  explicit: boolean;
  rerun: boolean;
}): StagingStartDecision {
  if (input.host !== 'cloud' || input.explicit || input.rerun) return 'start';
  return isBulkAutoFireSuppressed(input.project) ? 'lookup-first' : 'start';
}

/** Free peek: does the gateway already hold this audio's transcript? One read —
 *  no upload, no job, no meter line. Any failure is a miss (never a start). */
export async function peekCloudTranscript(audioHash: string, language: string | undefined): Promise<boolean> {
  try {
    const found = await lookupCloudCache({ stage: 'transcribe', audioHash, language: language ?? 'auto' });
    return found.cached;
  } catch {
    return false;
  }
}

/** A blank project shaped like the New Project modal's defaults would make it. */
export function makeBulkProject(base: Project, index1: number): Project {
  const defaults = readNewProjectDefaults();
  const fresh: Project = {
    ...base,
    name: bulkProjectName(index1),
    // A bulk project starts EMPTY: the blank project's placeholder script and
    // scene doc would otherwise read as two filled slots.
    script: '',
    sceneDetails: '',
    aspectRatio: defaults.aspectRatio,
    resolutionTier: defaults.resolutionTier,
    confirmed: true,
    bulkContext: true,
  };
  if (defaults.language !== AUTO_DETECT) fresh.language = defaults.language;
  if (shouldPersistFaChoice(defaults.faHighPrecisionSync, FA_PROJECT_DEFAULT_ON)) {
    fresh.faHighPrecisionSync = defaults.faHighPrecisionSync;
  }
  if (defaults.textOverlay !== NEW_PROJECT_TEXT_OVERLAY_DEFAULT_ON) fresh.defaultTextOverlay = defaults.textOverlay;
  return fresh;
}

export interface CreateBulkDeps {
  makeBlankProject: () => Project;
  save: (project: Project) => Promise<{ ok: boolean }>;
  upsertMeta: (meta: { id: string; name: string; savedAt: number; segmentCount: number }) => void;
}

/** Creates and persists all N projects at once (registry entries included),
 *  so the dashboard shows every one immediately. */
export async function createBulkProjects(count: number, deps: CreateBulkDeps): Promise<Project[]> {
  const made: Project[] = [];
  for (let i = 1; i <= count; i++) {
    const project = makeBulkProject(deps.makeBlankProject(), i);
    const outcome = await deps.save(project);
    if (!outcome.ok) throw new Error(`Couldn’t save ${project.name}. Check available storage and try again.`);
    deps.upsertMeta({ id: project.id, name: project.name, savedAt: Date.now(), segmentCount: 0 });
    made.push(project);
  }
  return made;
}
