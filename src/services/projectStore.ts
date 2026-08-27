import type { Asset, Project, ProjectMeta, VideoSegment } from '../types';
import { writeMirroredProject, deleteMirroredProject, readMirror } from './projectMirror';
import { osStoreRead, osStoreWrite, osStoreDelete } from './projectStoreClient';
import { isTauri } from './tauriFfmpeg';
import { backfillSegmentIds } from './segmentId';

/** Registry key — stores ProjectMeta[] (newest-first sorted on write). */
const REGISTRY_KEY = 'kinetix:projects:v1';

/**
 * Per-project localStorage key prefix/suffix — `kinetix:project:<id>:v1`.
 * Two roles as of WS2 T1.3: (a) the plain-browser-dev (`!isTauri()`) fallback
 * store, since there is no Tauri IPC bridge there; (b) the source format the
 * one-time boot migration scans to move an already-installed build's data
 * into the primary OS file store.
 */
const PROJECT_KEY_PREFIX = 'kinetix:project:';
const PROJECT_KEY_SUFFIX = ':v1';

function projectKey(id: string): string {
  return `${PROJECT_KEY_PREFIX}${id}${PROJECT_KEY_SUFFIX}`;
}

/** Legacy single-project key (pre-multi-project format) — read-once for migration then removed. */
const LEGACY_KEY = 'kinetix:project:v1';

// ---------------------------------------------------------------------------
// Internal serialisation helpers
// ---------------------------------------------------------------------------

interface StoredAsset extends Omit<Asset, 'url' | 'file'> {
  url: '';
}

interface StoredProjectData {
  version: 2 | 3;
  savedAt: number;
  project: Omit<Project, 'assets'> & { assets: StoredAsset[] };
}

function stripAsset(asset: Asset): StoredAsset {
  const { url: _url, file: _file, ...rest } = asset;
  return { ...rest, url: '' };
}

// ---------------------------------------------------------------------------
// WS1 Session O — the data-loss guard
// ---------------------------------------------------------------------------
//
// WHAT SESSION O ACTUALLY FOUND. The reported "project reopened with 0
// segments" was NOT a destroyed project: forensics on the preserved bytes
// showed every project in both origin stores hydrating cleanly through this
// module's own `loadProject`, registry `segmentCount` matching hydrated
// `segments.length` for all 12. The empty project was a genuinely new one whose
// Apply Sync had never committed. Nothing here is a fix for a measured
// corruption — it is the guard that makes the corruption this file could not
// previously have survived unreachable, and makes the two silent failure modes
// it DID have (a swallowed quota error, a swallowed parse error) loud.
//
// The three defects this section closes, all of them real and all of them
// previously silent:
//
//   1. `saveProject` swallowed EVERY exception, quota included, so a full
//      localStorage meant edits vanished with no signal whatsoever.
//   2. `loadProject` swallowed every parse error and returned null, which the
//      caller could not distinguish from "no such project".
//   3. Nothing stopped a zero-segment project overwriting a stored non-empty
//      one — so any future bug that produced an empty in-memory project would
//      have been persisted over good data at the next 500 ms autosave tick.
//
// 2026-08-25 — a real desktop run (V8 project, ~21 min audio) hit a FOURTH,
// previously-unseen failure mode of the same shape: `QuotaExceededError`
// itself, repeatedly, once the serialized project reached ~915,000 chars.
// Guard 3 already reported it as `quota-exceeded` instead of swallowing it —
// but nothing read that return value (`usePersistProject.ts` discarded it and
// stamped "Saved" regardless), so the report was as silent in practice as no
// report at all. That UI gap is fixed alongside this change. The deeper cause
// is structural, not a threshold bug: `localStorage` is a single ~5-10 MB
// budget SHARED across every project's JSON + the registry + thumbnails on
// this origin, so any one project can be the write that tips an origin
// already holding several others over the edge.
//
// WS2 T1.3 (later) — a project's JSON now lives on an OS-backed file store
// (`app_local_data_dir()/projects/<id>/project.json`, atomic writes via
// `project_mirror.rs`'s `project_store_*` commands) whenever `isTauri()` is
// true, which structurally removes the shared-origin-quota ceiling — a real
// filesystem has no ~5-10 MB shared budget. `localStorage` is kept ONLY as
// the fallback store for plain `npm run dev` (no Tauri IPC bridge exists
// there), and still holds the registry + last-opened-id in every mode, both
// of which are cheap and were never the problem.

/** Why a save was refused, or why a load failed. */
export type StoreFailureReason =
  | 'empty-over-nonempty'
  | 'quota-exceeded'
  | 'verify-failed'
  | 'blocked-by-load-failure'
  | 'parse-error'
  | 'shape-invalid'
  | 'storage-unavailable';

export type SaveOutcome =
  | { ok: true }
  | { ok: false; reason: StoreFailureReason; message: string };

export type LoadOutcome =
  | { ok: true; project: Project; savedAt: number }
  | { ok: false; reason: StoreFailureReason; message: string; rawLength: number };

export interface LoadFailure {
  id: string;
  reason: StoreFailureReason;
  message: string;
  /** Approximate serialized size of the value that failed, which is left UNTOUCHED in storage. */
  rawLength: number;
  at: number;
}

/**
 * Ids whose last load attempt failed. A project in here is POISONED for
 * writing: `saveProject` refuses every write to it until `clearLoadFailure`
 * is called. That is Step 5 item 2's "block autosave until the user acts" —
 * the raw bytes stay exactly as they are so the user (or a later, fixed build)
 * can still recover them, instead of a half-hydrated in-memory project being
 * autosaved over the evidence 500 ms later.
 */
const loadFailures = new Map<string, LoadFailure>();

/** The load failures recorded so far this session, for UI surfacing. */
export function getLoadFailures(): LoadFailure[] {
  return [...loadFailures.values()];
}

export function getLoadFailure(id: string): LoadFailure | undefined {
  return loadFailures.get(id);
}

/** Clears the poison flag for `id` — the "user acted" escape hatch. */
export function clearLoadFailure(id: string): void {
  loadFailures.delete(id);
}

/** Test-only reset so one spec's poisoned id cannot leak into the next. */
export function __resetStoreGuardsForTests(): void {
  loadFailures.clear();
}

/** Reads the CURRENTLY stored segment count for `id`, or null if unknown. */
async function storedSegmentCount(id: string): Promise<number | null> {
  try {
    const raw = isTauri() ? await osStoreRead(id) : localStorage.getItem(projectKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProjectData;
    const segs = parsed?.project?.segments;
    return Array.isArray(segs) ? segs.length : null;
  } catch {
    // Unreadable stored value — the empty-over-nonempty guard cannot make a
    // judgement, so it declines to (the poison flag from loadProject is what
    // protects this case instead).
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SaveOptions {
  /**
   * Permits a zero-segment write over a stored non-empty project. Reserved for
   * a DELIBERATE user action that genuinely empties a project; the debounced
   * autosave never sets it.
   */
  allowEmptying?: boolean;
}

/**
 * Persists a project — to the OS-backed file store when `isTauri()` (see the
 * WS2 T1.3 note above), else to `localStorage` as a plain-browser-dev
 * fallback — and upserts its registry entry (`localStorage`, unaffected by
 * either path).
 *
 * Returns a `SaveOutcome` rather than `void`: a refusal or a write failure is
 * reported instead of swallowed. Callers MUST check it — nothing here retries
 * or queues a failed write, and no UI updates that imply success (a "Saved"
 * label, a cleared dirty flag) may be driven off anything but this return
 * value.
 */
export async function saveProject(project: Project, opts: SaveOptions = {}): Promise<SaveOutcome> {
  // Guard 2 — a project whose load failed is poisoned for writing.
  const poisoned = loadFailures.get(project.id);
  if (poisoned) {
    const message =
      `[kinetix] REFUSING to save project ${project.id} ("${project.name}"): its last load failed ` +
      `(${poisoned.reason}: ${poisoned.message}). The ${poisoned.rawLength}-char stored value is ` +
      `left untouched so it stays recoverable. Autosave stays blocked for this project until the ` +
      `failure is acknowledged.`;
    console.error(message);
    return { ok: false, reason: 'blocked-by-load-failure', message };
  }

  // Guard 1 — never let an empty project overwrite a stored non-empty one.
  if (!opts.allowEmptying && project.segments.length === 0) {
    const existing = await storedSegmentCount(project.id);
    if (existing !== null && existing > 0) {
      const message =
        `[kinetix] REFUSING to overwrite project ${project.id} ("${project.name}") — the in-memory ` +
        `project has 0 segments but the stored one has ${existing}. This is the data-loss shape ` +
        `WS1 Session O's guard exists to stop. The stored project is unchanged. If this emptying ` +
        `was deliberate, call saveProject(p, { allowEmptying: true }).`;
      console.error(message);
      return { ok: false, reason: 'empty-over-nonempty', message };
    }
  }

  const savedAt = Date.now();
  const storedData: StoredProjectData = {
    // WS2 T1.2 — bumped from 2 to 3: segments now carry a stable
    // content-derived id (segmentId.ts) instead of a per-save random UUID.
    // No structural migration needed on load — see backfillSegmentIds below.
    version: 3,
    savedAt,
    project: { ...project, assets: project.assets.map(stripAsset) },
  };
  const payload = JSON.stringify(storedData);
  const tauri = isTauri();

  try {
    if (tauri) {
      await osStoreWrite(project.id, payload);
    } else {
      localStorage.setItem(projectKey(project.id), payload);
    }
  } catch (err) {
    const name = err instanceof DOMException ? err.name : (err instanceof Error ? err.name : '');
    const quota = /quota/i.test(name) || /quota|exceeded/i.test(String(err));
    const message =
      `[kinetix] FAILED to save project ${project.id} ("${project.name}", ${payload.length} chars): ` +
      `${String(err)}. The previously stored value is unchanged.`;
    console.error(message);
    return { ok: false, reason: quota ? 'quota-exceeded' : 'storage-unavailable', message };
  }

  // Verified, not trusted — a successful write to a real filesystem or to
  // `localStorage` is normally durability itself, but this is the same "read
  // it back rather than assume it landed" posture Guard 3 has always applied.
  const readBack = tauri
    ? await osStoreRead(project.id).catch(() => null)
    : localStorage.getItem(projectKey(project.id));
  if (readBack === null || readBack.length !== payload.length) {
    const message =
      `[kinetix] Save verification FAILED for project ${project.id} ("${project.name}"): wrote ` +
      `${payload.length} chars, read back ${readBack === null ? 'nothing' : `${readBack.length} chars`}.`;
    console.error(message);
    return { ok: false, reason: 'verify-failed', message };
  }

  // Upsert registry entry.
  let registryJson: string | undefined;
  try {
    const metas = loadAllMetas();
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      savedAt,
      segmentCount: project.segments.length,
    };
    const idx = metas.findIndex(m => m.id === project.id);
    if (idx >= 0) {
      metas[idx] = meta;
    } else {
      metas.push(meta);
    }
    // Sort newest first before writing
    metas.sort((a, b) => b.savedAt - a.savedAt);
    registryJson = JSON.stringify(metas);
    localStorage.setItem(REGISTRY_KEY, registryJson);
  } catch (err) {
    // The project itself is already safely written and verified above; a
    // registry write failure is worth reporting but does not lose the project.
    console.error(`[kinetix] Registry update failed after saving ${project.id}:`, err);
  }

  // Durable mirror — bundle-id-keyed, so dev and release converge on one copy.
  // Deliberately not awaited: a mirror write must never delay a local save.
  void writeMirroredProject(project.id, payload, registryJson);

  return { ok: true };
}

/**
 * Loads a single project by id, reporting WHY it failed.
 *
 * A failure records a poison flag for `id` (see `loadFailures`) so no
 * subsequent autosave can overwrite the raw bytes that failed to parse. The
 * stored value is never modified, deleted, or rewritten by this function.
 */
export async function loadProjectDetailed(id: string): Promise<LoadOutcome | null> {
  let raw: string | null;
  try {
    raw = isTauri() ? await osStoreRead(id) : localStorage.getItem(projectKey(id));
  } catch (err) {
    const message = `Project store unavailable while reading project ${id}: ${String(err)}`;
    console.error(`[kinetix] ${message}`);
    const failure: LoadFailure = { id, reason: 'storage-unavailable', message, rawLength: 0, at: Date.now() };
    loadFailures.set(id, failure);
    return { ok: false, reason: 'storage-unavailable', message, rawLength: 0 };
  }

  // Genuinely absent is NOT a failure — it is the "no such project" answer, and
  // must stay distinguishable from "present but broken".
  if (!raw) return null;

  let stored: StoredProjectData;
  try {
    stored = JSON.parse(raw) as StoredProjectData;
  } catch (err) {
    const message =
      `Project ${id} is present in storage (${raw.length} chars) but is not valid JSON: ${String(err)}. ` +
      `The raw bytes have been left untouched; autosave is blocked for this project.`;
    console.error(`[kinetix] ${message}`);
    const failure: LoadFailure = { id, reason: 'parse-error', message, rawLength: raw.length, at: Date.now() };
    loadFailures.set(id, failure);
    return { ok: false, reason: 'parse-error', message, rawLength: raw.length };
  }

  const rawLength = raw.length;

  if (!stored || typeof stored !== 'object' || !stored.project || !Array.isArray(stored.project.segments)) {
    const message =
      `Project ${id} parsed as JSON but does not have the expected shape (missing ` +
      `\`project\` or \`project.segments\`). The raw ${rawLength} bytes have been left untouched; ` +
      `autosave is blocked for this project.`;
    console.error(`[kinetix] ${message}`);
    const failure: LoadFailure = { id, reason: 'shape-invalid', message, rawLength, at: Date.now() };
    loadFailures.set(id, failure);
    return { ok: false, reason: 'shape-invalid', message, rawLength };
  }

  const storedProject = stored.project;

  // Path B heading layer (Decision 5): no migration — just default to [] when
  // absent, for projects saved before the `headings` field existed.
  const project = { headings: [], ...storedProject } as unknown as Project;
  // WS3 Batch B, Piece 2 back-compat — `playbackSpeed` was removed as a
  // concept (a video clip always plays at its native rate). A project
  // saved before this change may still carry a per-segment value; strip it
  // on load rather than migrate it into anything, and leave the segment's
  // duration untouched — an old sped-up segment keeps its current length
  // and now freezes or trims per Piece 2's Case A/B instead.
  //
  // `sourceDuration` is stripped for a sharper reason: it was a per-segment
  // CACHE of the clip length, and nothing refreshed it when a segment was
  // pointed at a different asset, so a stored value is not merely redundant
  // — it can be wrong. The clip length now lives on `Asset.duration` and is
  // resolved through the segment's current `assetId` at every read. Keeping
  // a stale copy alive would be the exact defect this replaced.
  project.segments = project.segments.map(s => {
    const {
      playbackSpeed: _legacyPlaybackSpeed,
      sourceDuration: _legacySourceDuration,
      ...rest
    } = s as VideoSegment & { playbackSpeed?: number; sourceDuration?: number };
    return rest;
  });

  // WS2 T1.2 — backfill stable content-derived ids for any segment loaded
  // with a missing or pre-T1.2 (random-UUID) id. Idempotent: a segment
  // already carrying a current-version id is left untouched, so re-loading
  // an already-backfilled project is a no-op here.
  project.segments = backfillSegmentIds(project.segments);

  // A previously-poisoned id that now loads cleanly is un-poisoned.
  loadFailures.delete(id);
  return { ok: true, project, savedAt: stored.savedAt };
}

/**
 * Loads a single project by id. Returns null if not found OR if the load
 * failed — preserved as-is so existing callers keep compiling. Callers that
 * need to tell those two apart, and to surface the failure, use
 * `loadProjectDetailed`.
 */
export async function loadProject(id: string): Promise<{ project: Project; savedAt: number } | null> {
  const outcome = await loadProjectDetailed(id);
  if (!outcome || !outcome.ok) return null;
  return { project: outcome.project, savedAt: outcome.savedAt };
}

/**
 * Returns all project metas from the registry, newest first.
 * Returns empty array on any error.
 *
 * Stays synchronous and `localStorage`-backed on purpose — the registry is
 * small (no segment/heading bodies) and several call sites (dashboard's
 * initial render, boot routing) read it without an await.
 */
export function loadAllMetas(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Upserts a single ProjectMeta entry in the registry without touching the
 * per-project JSON blob.  Use this to update lightweight meta (name, thumbnail,
 * segmentCount) independently of a full saveProject() call.
 */
export function upsertProjectMeta(meta: ProjectMeta): void {
  try {
    const metas = loadAllMetas();
    const idx = metas.findIndex(m => m.id === meta.id);
    if (idx >= 0) {
      metas[idx] = meta;
    } else {
      metas.push(meta);
    }
    metas.sort((a, b) => b.savedAt - a.savedAt);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(metas));
  } catch {
    // quota exceeded or private browsing — silently skip
  }
}

/** Removes a project's stored record and its registry entry. */
export async function deleteProjectData(id: string): Promise<void> {
  const remove = isTauri() ? osStoreDelete(id) : Promise.resolve(localStorage.removeItem(projectKey(id)));
  await remove.catch(err => console.error(`[kinetix] Failed to delete stored project ${id}:`, err));
  clearLoadFailure(id);
  const metas = loadAllMetas().filter(m => m.id !== id);
  let registryJson: string | undefined;
  if (metas.length > 0) {
    registryJson = JSON.stringify(metas);
    localStorage.setItem(REGISTRY_KEY, registryJson);
  } else {
    localStorage.removeItem(REGISTRY_KEY);
    registryJson = '[]';
  }
  void deleteMirroredProject(id, registryJson);
}

// ---------------------------------------------------------------------------
// WS1 Session O — mirror adoption
// ---------------------------------------------------------------------------

export interface AdoptionReport {
  /** True when a mirror was actually readable (false outside Tauri). */
  mirrorAvailable: boolean;
  /** Ids copied from the mirror into this origin's storage. */
  adopted: string[];
  /** Ids present in the mirror but already present locally — left alone. */
  skippedAlreadyLocal: string[];
  /** Ids present in the mirror that could not be adopted, with the reason. */
  failed: { id: string; message: string }[];
}

/**
 * Copies into THIS origin's storage any project the durable mirror holds
 * that this origin does not.
 *
 * STRICTLY ADDITIVE, and that is the whole safety argument: a project id that
 * already exists locally is never touched, never compared, never overwritten —
 * not even when the mirror's copy looks newer. Adoption can therefore only ever
 * increase what an origin can see. That matters because the mirror is shared by
 * `tauri dev`, `tauri dev -f fa-inference` and the bundled build, and a
 * "newest wins" rule across those would let opening an old build silently roll
 * a project backwards.
 *
 * Call once at boot, before `loadAllMetas()`, and after
 * `migrateLocalStorageProjectsToOsStore()` so "already present locally"
 * checks the primary OS store rather than a `localStorage` key this
 * migration may have already drained.
 *
 * WS2 T1.3: "this origin's storage" is now the OS-backed primary store when
 * `isTauri()` (the common case — the mirror itself only exists inside
 * Tauri, so `readMirror()` returns null and this whole function is a no-op
 * otherwise). It stays largely a steady-state no-op post-migration: nothing
 * is left in the mirror that isn't already in the primary store once
 * `migrateLocalStorageProjectsToOsStore()` and a prior boot's adoption have
 * run, but it remains the safety net for the case a project's mirror write
 * succeeded while its primary-store write did not.
 */
export async function adoptMirroredProjects(): Promise<AdoptionReport> {
  const report: AdoptionReport = {
    mirrorAvailable: false,
    adopted: [],
    skippedAlreadyLocal: [],
    failed: [],
  };

  const snapshot = await readMirror();
  if (!snapshot) return report;
  report.mirrorAvailable = true;

  const mirroredMetas = new Map<string, ProjectMeta>();
  if (snapshot.registry) {
    try {
      const parsed = JSON.parse(snapshot.registry) as ProjectMeta[];
      if (Array.isArray(parsed)) for (const m of parsed) if (m?.id) mirroredMetas.set(m.id, m);
    } catch (err) {
      console.warn('[kinetix] Mirror registry is unparseable; adopting projects without it:', err);
    }
  }

  for (const [id, contents] of snapshot.projects) {
    try {
      if ((await osStoreRead(id)) !== null) {
        report.skippedAlreadyLocal.push(id);
        continue;
      }
      // Validate before writing — the mirror must never be able to inject a
      // value this origin's own loader would then choke on.
      const parsed = JSON.parse(contents) as StoredProjectData;
      if (!parsed?.project || !Array.isArray(parsed.project.segments)) {
        report.failed.push({ id, message: 'mirrored value has the wrong shape' });
        continue;
      }
      await osStoreWrite(id, contents);

      const metas = loadAllMetas();
      if (!metas.some(m => m.id === id)) {
        metas.push(
          mirroredMetas.get(id) ?? {
            id,
            name: parsed.project.name ?? 'Recovered Project',
            savedAt: parsed.savedAt ?? Date.now(),
            segmentCount: parsed.project.segments.length,
          },
        );
        metas.sort((a, b) => b.savedAt - a.savedAt);
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(metas));
      }
      report.adopted.push(id);
    } catch (err) {
      report.failed.push({ id, message: String(err) });
    }
  }

  if (report.adopted.length > 0) {
    console.info(
      `[kinetix] Adopted ${report.adopted.length} project(s) from the durable mirror into this ` +
        `origin: ${report.adopted.join(', ')}`,
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// WS2 T1.3 — localStorage → OS file store migration for existing per-project data
// ---------------------------------------------------------------------------

export interface StorageMigrationReport {
  /** Ids successfully copied into the OS store and removed from localStorage. */
  migrated: string[];
  /** Ids whose localStorage value could not be migrated — LEFT IN localStorage untouched. */
  failed: { id: string; message: string }[];
}

/**
 * One-time migration for a build that has already saved projects under the
 * old `kinetix:project:<id>:v1` localStorage keys. Copies each into the
 * primary OS file store, then removes the localStorage key — freeing exactly
 * the budget that was going stale and shared across every other project on
 * this origin.
 *
 * A no-op outside Tauri: plain `npm run dev` keeps `localStorage` as its
 * primary store (see `isTauri()` throughout this module), so there is
 * nothing to migrate away from there.
 *
 * Idempotent and safe to call on every boot: an id already present in the OS
 * store is skipped without inspecting its localStorage copy, so a second run
 * after a successful first one is a no-op scan. A per-id failure (bad JSON,
 * wrong shape) leaves that id's localStorage key exactly as it was —
 * mirroring the rest of this module's "never destroy unreadable evidence"
 * posture — so it is retried on the next boot rather than silently dropped.
 *
 * Known limitation (not fixed by retrying — inherent to `localStorage` being
 * origin-scoped): this only scans the CURRENT origin's `localStorage`. A
 * project saved only under the other origin (`tauri dev` vs. a release
 * build) whose mirror write never ran needs that origin launched at least
 * once post-migration to be picked up here.
 */
export async function migrateLocalStorageProjectsToOsStore(): Promise<StorageMigrationReport> {
  const report: StorageMigrationReport = { migrated: [], failed: [] };
  if (!isTauri()) return report;

  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter(
      k => k.startsWith(PROJECT_KEY_PREFIX) && k.endsWith(PROJECT_KEY_SUFFIX) && k !== LEGACY_KEY,
    );
  } catch (err) {
    console.warn('[kinetix] localStorage unavailable during project migration scan:', err);
    return report;
  }

  for (const key of keys) {
    // `kinetix:project:<id>:v1` — id is a crypto.randomUUID(), never contains ':'.
    const id = key.slice(PROJECT_KEY_PREFIX.length, key.length - PROJECT_KEY_SUFFIX.length);
    if (!id) continue;

    try {
      if ((await osStoreRead(id)) !== null) {
        // Already migrated (or adopted from the mirror this boot) — just
        // drop the now-redundant localStorage copy.
        localStorage.removeItem(key);
        continue;
      }

      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredProjectData;
      if (!parsed?.project || !Array.isArray(parsed.project.segments)) {
        report.failed.push({ id, message: 'stored value has the wrong shape' });
        continue;
      }

      await osStoreWrite(id, raw);
      localStorage.removeItem(key);
      report.migrated.push(id);
    } catch (err) {
      report.failed.push({ id, message: String(err) });
    }
  }

  if (report.migrated.length > 0) {
    console.info(
      `[kinetix] Migrated ${report.migrated.length} project(s) from localStorage to the OS file store: ` +
        `${report.migrated.join(', ')}`,
    );
  }
  if (report.failed.length > 0) {
    console.error(
      `[kinetix] ${report.failed.length} project(s) could NOT be migrated from localStorage — left ` +
        `untouched there for a retry: ${report.failed.map(f => `${f.id} (${f.message})`).join(', ')}`,
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// Last-opened project tracking
// ---------------------------------------------------------------------------

const LAST_OPENED_KEY = 'kinetix:lastOpenedProjectId';

/**
 * WS1 Session O. This used to write to `sessionStorage`, which does NOT survive
 * an app restart — only a page reload. The observed consequence: every relaunch
 * of the app dropped the user at the dashboard with no project open, which is
 * precisely the state that gets mistaken for "my project is gone" and makes it
 * easy to start a NEW empty project instead of reopening the real one. That is
 * the actual mechanism behind Session O's reported symptom.
 *
 * `localStorage` is the correct store: the id is a durable preference, not
 * per-tab session state.
 */
export function setLastOpenedProjectId(id: string): void {
  try {
    localStorage.setItem(LAST_OPENED_KEY, id);
  } catch {
    // quota exceeded or private browsing — silently skip
  }
}

/** Returns the id stored by the last setLastOpenedProjectId call, or null. */
export function getLastOpenedProjectId(): string | null {
  try {
    const durable = localStorage.getItem(LAST_OPENED_KEY);
    if (durable) return durable;
    // One-way migration for a session that still has the pre-Session-O value.
    const legacy = sessionStorage.getItem(LAST_OPENED_KEY);
    if (legacy) {
      try {
        localStorage.setItem(LAST_OPENED_KEY, legacy);
      } catch {
        // best-effort promotion only
      }
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/** Clears the last-opened project id.  Call when the user intentionally
 *  navigates to the dashboard so the next reload shows the dashboard too. */
export function clearLastOpenedProjectId(): void {
  try {
    localStorage.removeItem(LAST_OPENED_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(LAST_OPENED_KEY);
  } catch {
    // ignore
  }
}

/**
 * Detects the legacy single-project key (`kinetix:project:v1`) and migrates it
 * to the new multi-project format.  Call once at app boot before reading the
 * registry.  Removes the legacy key on success.
 *
 * Returns the migrated `{ project, savedAt }` if migration was performed, or
 * null if no legacy data was present.
 */
export async function migrateLegacyIfNeeded(): Promise<{ project: Project; savedAt: number } | null> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    // Legacy format had version: 1 and a single project object
    const stored = JSON.parse(raw) as {
      version?: number;
      savedAt: number;
      project: Project;
    };
    if (!stored.project) {
      localStorage.removeItem(LEGACY_KEY);
      return null;
    }

    // Re-save under the new per-project key and update registry
    await saveProject(stored.project);

    // Remove legacy key so migration only runs once
    localStorage.removeItem(LEGACY_KEY);
    return { project: stored.project, savedAt: stored.savedAt };
  } catch {
    // If the legacy data is corrupt, just discard it
    localStorage.removeItem(LEGACY_KEY);
    return null;
  }
}
