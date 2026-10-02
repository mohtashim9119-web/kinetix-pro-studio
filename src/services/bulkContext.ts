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
import { cloudTranscribeLanguage } from './cloudSyncEngine';

/** One "Create Group" makes one group of 2–30 rows (bulkBatch.ts). */
export const BULK_MAX_PROJECTS = 30;
export const BULK_MIN_PROJECTS = 2;

export const BULK_COPY = {
  button: 'Bulk Projects',
  quantityInvalid: (max: number, min = BULK_MIN_PROJECTS): string => `Enter a whole number from ${min} to ${max}.`,
  modalTitle: 'Bulk Projects',
  rowDrop: 'Drop files, a folder or a zip here',
  /** Bulk UI rebuild U4 — one Upload button with a small menu. */
  upload: 'Upload',
  uploadFiles: 'Files & zips…',
  uploadFolder: 'Folder…',
  slot: { script: 'Script', scene: 'Scenes', voiceover: 'Audio', media: 'Media' },
  audio: {
    none: '',
    preparing: 'Preparing voiceover for the cloud…',
    ready: 'Voiceover ready on the cloud (no GPU used)',
    failed: 'Voiceover not prepared',
    local: 'Local engine: nothing is uploaded',
  },
  namePlaceholder: 'Project name',
  nameLabel: 'Project name',
  nameMissing: 'a project name',
  building: 'Building the timeline…',
  finishFailed: (why: string): string => `Built on the cloud, but the timeline could not be finished — open the project and press Build Timeline. ${why}`.trim(),
  build: 'Build Timeline',
  buildNeeds: 'Fill every slot of at least one project to build',
  cancelRow: 'Cancel',
  cancelAll: 'Cancel all',
  stopAll: 'Stop all',
  open: 'Open project',
  openShort: 'Open',
  openWhenReady: 'Opens once the timeline is built',
  close: 'Hide',
  retry: 'Retry',
  addProject: 'Add project',
  clearFinished: 'Clear finished',
  batchButton: (n: number): string => `Bulk builds (${n})`,
  /** 1.3.1 — a group is created inline: a 2–30 field and one button, no popup. */
  newGroup: 'New group',
  groupCountLabel: 'Number of projects',
  groupCountPlaceholder: '2–30',
  createGroup: 'Create Group',
  groupsFull: (max: number): string => `Up to ${max} groups at a time. Clear a finished group to make room.`,
  renameGroup: (name: string): string => `Rename ${name}`,
  groupNameLabel: 'Group name',
  footerNote: 'Builds keep running while this panel is hidden.',
  emptyDrawer: 'No groups yet. Create one above.',
  removeProject: 'Delete project',
  deleteRowTitle: 'Delete this project?',
  deleteRowBody: (name: string, created: boolean): string =>
    `${name ? `“${name}”` : 'This row'} and all of its files will be deleted${created ? ', and the project with them' : ''}. This cannot be undone.`,
  deleteRowConfirm: 'Delete',
  clearFiles: 'Delete all',
  replaceAll: 'Replace all',
  removeFile: (name: string): string => `Delete ${name}`,
  replaceFile: (name: string): string => `Replace ${name}`,
  notAdded: 'Not added',
  addSlot: (slot: string): string => `Add ${slot.toLowerCase()}`,
  mediaCount: (n: number): string => `${n} file${n === 1 ? '' : 's'}`,
  /** A bundle zip carries every slot, so picking one here replaces them all — said up front. */
  replaceMedia: 'Replace all media (a bundle zip replaces every slot)',
  deleteMedia: 'Delete all media',
  deleteMediaTitle: 'Delete all media?',
  deleteMediaBody: (n: number): string => `All ${n} media file${n === 1 ? '' : 's'} in this project will be deleted. The script, scene doc and voiceover stay.`,
  prevMessage: 'Previous message',
  nextMessage: 'Next message',
  filesToggle: (n: number): string => `${n} file${n === 1 ? '' : 's'}`,
  skipped: (why: string): string => `Skipped — ${why}`,
  notCloud: 'Bulk build runs on the Cloud engine (App Settings → Sync Engine).',
  /** Bulk UI rebuild — group headers and the dashboard signal. */
  doneCount: (done: number, total: number): string => `${done}/${total} done`,
  ringLabel: (done: number, total: number): string => `${done} of ${total} done`,
  failedCount: (n: number): string => `${n} failed`,
  /** U6 — the one toast a finished row raises. It never opens anything. */
  ready: (name: string): string => `${name} ready`,
  /** The project's sync log entry for its bulk cloud work. */
  billingLog: (cost: string): string => `Cloud billing (bulk build): ${cost}.`,
  rebuild: 'Rebuild',
  collapseGroup: (name: string): string => `Collapse ${name}`,
  expandGroup: (name: string): string => `Expand ${name}`,
} as const;

/** Why a row cannot be built yet (name + the three spine slots), or undefined. */
export function rowIncompleteReason(
  name: string,
  slotNames: readonly string[],
): string | undefined {
  const parts = [...(name.trim() ? [] : [BULK_COPY.nameMissing]), ...slotNames];
  if (parts.length === 0) return undefined;
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Add ${list} to build the timeline`;
}

/** A whole number in min..max, else null. */
export function parseBulkCount(raw: string, max: number = BULK_MAX_PROJECTS, min: number = BULK_MIN_PROJECTS): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
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
    const found = await lookupCloudCache({ stage: 'transcribe', audioHash, language: cloudTranscribeLanguage(language) });
    return found.cached;
  } catch {
    return false;
  }
}

/** A blank project shaped like the New Project modal's defaults would make it. */
export function makeBulkProject(base: Project, info: { id: string; name: string; assets: Project['assets'] }): Project {
  const defaults = readNewProjectDefaults();
  const fresh: Project = {
    ...base,
    id: info.id,
    name: info.name,
    // A bulk project starts with no placeholder text: the blank project's
    // script and scene doc would otherwise read as two filled slots.
    script: '',
    sceneDetails: '',
    assets: info.assets,
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

/** Creates and registers ONE project (its dashboard card included) — called at
 *  Build Timeline for each real row. False when it could not be saved. */
export async function createBulkProject(
  info: { id: string; name: string; assets: Project['assets'] },
  deps: CreateBulkDeps,
): Promise<boolean> {
  const project = makeBulkProject(deps.makeBlankProject(), info);
  const outcome = await deps.save(project);
  if (!outcome.ok) return false;
  deps.upsertMeta({ id: project.id, name: project.name, savedAt: Date.now(), segmentCount: 0 });
  return true;
}
