/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7 — one stored project as a bulk-queue job on the CLOUD engine.
//
// The job does what the open-project path does in the background (staging
// transcription, then the cloud sync intent), for a project that is NOT open:
// it loads the stored project and its voiceover bytes headlessly, and leaves
// its results in the gateway cache. It never writes to the project — opening
// it later and pressing Build Timeline is then two free cache hits, exactly
// the U4.5 reveal.
//
// ONE COLD START. A project with another behind it keeps its GPU container
// after its alignment (`requestHoldAfterAlign`); the queue's `carry` slot
// hands that container to the next project's transcription
// (`holdJobId`). The next project's inputs are loaded by `prepare` while the
// previous one runs, so the container waits only for the client's planning
// seconds. A job that cannot use the carried container (cache hit, closed
// hold) lets it go, never leaving it idle.
//
// A project that pauses (offline, auth, a script/audio mismatch) saves the
// SAME restart-safe pause record the open-project path saves and returns
// 'paused': it stops itself, never the queue.
// ---------------------------------------------------------------------------

import type { Asset, Project, VideoSegment } from '../types';
import type { StagedFiles } from '../components/DropZonePanel';
import { getAsset } from './assetStore';
import { readAssetNative } from './nativeAssetStore';
import { loadProject } from './projectStore';
import { computeAudioHash, computeScriptHash, spineEquals } from './spine';
import { resolveSyncEngine } from './faPreflight';
import { resolveFaLanguage } from './faGate';
import { runCloudSyncIntent } from './cloudSyncIntent';
import {
  CloudStageError,
  adoptHeldContainer,
  cloudPauseReason,
  cloudWorkerSecTotal,
  onCloudPhase,
  requestHoldAfterAlign,
  takeHeldAlign,
  transcribeForHost,
} from './cloudSyncEngine';
import { releaseCloudJob } from './cloudGateway';
import { describeCloudCancel, settleCloudCancels, takeCancelReceiptsSince } from './cloudCancelReceipts';
import { saveFaPause, type FaPauseRecord } from './faSyncPauseStore';
import { loadStagedFromStore } from './stagedFilesPersist';
import { stripRtfIfNeeded } from './textUtils';
import { memoizedDuration } from './bulkRows';
import { mintSyncLogId } from './syncLog';
import { BUILD_TIMELINE_COPY, missingSpineSlots, type BuildTimelineSlots } from './buildTimelineGate';
import { stagesToRun, type BulkCheckpoint } from './bulkBatch';
import { lookupBatchTranscript } from './bulkFinish';
import type { QueueEngine, QueueJob, QueueJobOutcome } from './syncQueue';

/** Mirrors `cloud/sync_core.py`'s USD_PER_WORKER_SEC (T4 + 2 cores + 8 GiB);
 *  equality pinned by `syncQueue.test.ts`. A rate-card estimate — Modal's
 *  invoice is the truth. */
export const CLOUD_USD_PER_WORKER_SEC = (0.59 + 0.0473 * 2 + 0.008 * 8) / 3600;

export const cloudQueueEngine: QueueEngine = {
  workerSec: cloudWorkerSecTotal,
  usdPerSec: CLOUD_USD_PER_WORKER_SEC,
  cancelReceipt(item, started) {
    if (!started) return 'It hadn’t started, so nothing was charged.';
    return describeCloudCancel(takeCancelReceiptsSince(item.startedAt ?? 0), { cloud: true });
  },
  settleCancel: () => settleCloudCancels(),
  onDrain(carry) {
    if (typeof carry === 'string' && carry) void releaseCloudJob(carry).catch(() => undefined);
  },
};

/** The slot facts the Build Timeline gate reads, for a stored project (the gate itself is spine-only).
 *  A slot is filled when persisted OR staged (Bulk Projects stages files the
 *  way the editor's own drop zone does — the batch reads them from there). */
export function projectSlots(project: Project, staged?: StagedFiles | null): BuildTimelineSlots {
  return {
    script: project.script.trim().length > 0 || !!staged?.scriptFile,
    scene: project.sceneDetails.trim().length > 0 || !!staged?.sceneFile,
    voiceover: (!!project.voiceoverId && project.assets.some(a => a.id === project.voiceoverId)) || !!staged?.voiceoverFile,
    media: project.assets.some(a => a.type !== 'audio')
      || (staged?.assetFiles.length ?? 0) > 0 || (staged?.zipFiles.length ?? 0) > 0,
  };
}

/** Why this project cannot enter the queue yet, or undefined if it can. */
export function queueIneligibleReason(project: Project, staged?: StagedFiles | null): string | undefined {
  // Spine-only (Wave 3 U9 B5): media is optional, exactly like the editor's button.
  const slots = projectSlots(project, staged);
  const missing = missingSpineSlots(slots).map(slot => BUILD_TIMELINE_COPY.slotNames[slot]);
  if (missing.length === 0) return undefined;
  const list = missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Add ${list} to build the timeline`;
}

export interface CloudQueueDeps {
  loadProject: (id: string) => Promise<{ project: Project } | null>;
  loadVoiceover: (project: Project, asset: Asset) => Promise<File | null>;
  /** Bulk Projects — the project's staged files (script, scene doc, voiceover,
   *  media), which take the place of an unset persisted slot. */
  loadStaged?: (projectId: string) => Promise<StagedFiles | null>;
  /** Audio length for a STAGED voiceover (a committed one carries its own). */
  probeDuration?: (file: File, audioHash: string) => Promise<number>;
  /** App.tsx's `parseProjectData` — injected so this module never imports
   *  the app (same discipline as `SyncIntentInputs.prepareSegments`). */
  parseProjectData: (
    script: string, sceneDetails: string, assets: Asset[], voiceoverDuration: number,
    previousSegments: Project['segments'], defaultTextOverlay: boolean,
  ) => Promise<VideoSegment[]>;
}

/** Headless voiceover bytes: the IndexedDB copy, else the native store's. */
export async function loadStoredVoiceover(project: Project, asset: Asset): Promise<File | null> {
  const stored = await getAsset(project.id, asset.id).catch(() => null);
  if (stored?.blob) return new File([stored.blob], stored.name || asset.name, { type: stored.mimeType });
  try {
    const bytes = await readAssetNative(project.id, asset.id);
    return new File([bytes as BlobPart], asset.name);
  } catch {
    return null;
  }
}

export function defaultCloudQueueDeps(
  parseProjectData: CloudQueueDeps['parseProjectData'],
): CloudQueueDeps {
  return {
    loadProject, loadVoiceover: loadStoredVoiceover, parseProjectData,
    loadStaged: loadStagedFromStore,
    probeDuration: async (file, hash) => {
      const { probeAudioDuration } = await import('./tauriFfmpeg');
      return memoizedDuration(file, hash, probeAudioDuration);
    },
  };
}

interface Loaded {
  /** The stored project with any staged script/scene text laid over it. */
  project: Project;
  asset: Asset;
  file: File;
  audioHash: string;
  durationSec: number;
}

const PHASE_TEXT = {
  /** Before the gateway has said anything: the cache-first check may end it. */
  checking: 'Checking the cloud…',
  planning: 'Checking the script against the audio…',
  'waiting-gpu': 'Waiting for a cloud GPU…',
  transcribing: 'Transcribing on the cloud…',
  aligning: 'Aligning on the cloud…',
} as const;

export function createCloudProjectJob(
  meta: { id: string; name: string; checkpoint?: BulkCheckpoint; contentKey?: string },
  deps: CloudQueueDeps,
): QueueJob {
  let loading: Promise<Loaded | string> | undefined;
  /** Memoized so `prepare` (while the previous job runs) and `run` share one load. */
  const load = (): Promise<Loaded | string> => {
    loading ??= (async (): Promise<Loaded | string> => {
      const stored = await deps.loadProject(meta.id);
      if (!stored) return 'the project could not be opened';
      const staged = deps.loadStaged ? await deps.loadStaged(meta.id).catch(() => null) : null;
      const why = queueIneligibleReason(stored.project, staged);
      if (why) return why;
      // Staged text wins over persisted text, as it does at Apply Sync.
      const project: Project = {
        ...stored.project,
        script: staged?.scriptFile ? stripRtfIfNeeded(await staged.scriptFile.file.text()) : stored.project.script,
        sceneDetails: staged?.sceneFile ? stripRtfIfNeeded(await staged.sceneFile.file.text()) : stored.project.sceneDetails,
      };
      let asset: Asset;
      let file: File | null;
      let durationSec: number;
      if (staged?.voiceoverFile) {
        file = staged.voiceoverFile.file;
        asset = { id: `staged-${meta.id}`, name: file.name, url: '', type: 'audio', addedAt: Date.now() };
        const hash = await computeAudioHash(file);
        durationSec = deps.probeDuration ? await deps.probeDuration(file, hash).catch(() => 0) : 0;
      } else {
        asset = project.assets.find(a => a.id === project.voiceoverId)!;
        file = await deps.loadVoiceover(project, asset);
        durationSec = asset.duration ?? 0;
      }
      if (!file) return 'the voiceover file could not be found';
      if (!(durationSec > 0)) return 'the voiceover’s length is unknown — open the project once';
      return { project, asset, file, audioHash: await computeAudioHash(file), durationSec };
    })();
    return loading;
  };

  return {
    id: meta.id,
    label: meta.name,
    prepare: async () => { await load(); },
    async run(ctx): Promise<QueueJobOutcome> {
      const chained = ctx.carry.get();
      ctx.carry.set(undefined);
      const token = typeof chained === 'string' && chained ? chained : undefined;
      const letGo = (): void => { if (token) void releaseCloudJob(token).catch(() => undefined); };

      ctx.setPhase('Opening the project…');
      const loaded = await load();
      if (typeof loaded === 'string') {
        letGo();
        // Not enough to sync is the project's own state, not a queue error.
        return { status: 'skipped', detail: `Can’t sync yet: ${loaded}.` };
      }
      const { project, asset, file, audioHash, durationSec } = loaded;
      const voiceover: Asset = { ...asset, file };

      const resolution = await resolveSyncEngine(project, 'cloud');
      const scriptHash = await computeScriptHash(project.script, project.sceneDetails);
      const spine = { audioHash, scriptHash, engineKey: resolution.key };
      const contentKey = `${audioHash}|${scriptHash}|${resolution.key}`;
      const plan = stagesToRun(meta.checkpoint, meta.contentKey !== undefined && meta.contentKey !== contentKey);
      if (!plan.includes('transcribe') && !plan.includes('align')) {
        letGo();
        return { status: 'done', detail: 'Ready — press Build Timeline to reveal it.' };
      }
      if (project.lastSyncSpine && spineEquals(project.lastSyncSpine, spine)) {
        letGo();
        return { status: 'skipped', detail: 'Already built on the cloud engine.' };
      }

      const pause = (record: Omit<FaPauseRecord, 'projectId' | 'syncRunId' | 'timestamp' | 'host' | 'audioHash'>): QueueJobOutcome => {
        saveFaPause({
          ...record, projectId: project.id, syncRunId: mintSyncLogId(), timestamp: Date.now(), host: 'cloud', audioHash,
        });
        return { status: 'paused', reason: record.reason, detail: record.detail };
      };

      ctx.setPhase(PHASE_TEXT.checking);
      // Live phase from the gateway's own job states (queued = waiting for a GPU).
      const offPhase = onCloudPhase(audioHash, phase => ctx.setPhase(PHASE_TEXT[phase]));
      try {
        let tokens;
        try {
          if (!plan.includes('transcribe')) {
            const cached = await lookupBatchTranscript(audioHash, project.language);
            if (!cached) throw new Error('checkpoint said the transcript was cached, but the lookup missed');
            tokens = cached.tokens;
            if (token) letGo();
          } else {
          const tr = await transcribeForHost({
            host: 'cloud', asset: voiceover, durationSecs: durationSec, language: project.language,
            onProgress: () => {}, signal: ctx.signal, audioHash,
            hold: resolution.gateOpen, holdJobId: token,
          });
          tokens = tr.tokens;
          if (token && !tr.handedOff) {
            // The kept container was not used (cache hit or the hold closed).
            // A cache hit hands it straight on to the alignment; otherwise let go.
            if (tr.cached && resolution.gateOpen) adoptHeldContainer(audioHash, token);
            else letGo();
          }
          }
        } catch (err) {
          letGo();
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          if (err instanceof CloudStageError) {
            return pause({ reason: cloudPauseReason(err.cloud), detail: err.message, stage: 'transcribe' });
          }
          return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
        }

        if (!resolution.gateOpen) return { status: 'done', detail: 'Transcript ready (High-Precision off).' };

        if (ctx.hasNext) requestHoldAfterAlign(audioHash);
        ctx.setPhase(PHASE_TEXT.planning);
        const outcome = await runCloudSyncIntent({
          spineKey: `${audioHash}|${scriptHash}|${resolution.key}`,
          voiceover, audioHash, audioDurationSec: durationSec, tokens,
          language: resolveFaLanguage(project),
          prepareSegments: () => deps.parseProjectData(
            project.script, project.sceneDetails, project.assets, durationSec, project.segments, project.defaultTextOverlay ?? false,
          ),
        }, ctx.signal);

        const kept = takeHeldAlign(audioHash);
        if (outcome.status === 'ready') {
          ctx.carry.set(kept);
          return { status: 'done', detail: 'Ready — press Build Timeline to reveal it.' };
        }
        if (kept) void releaseCloudJob(kept).catch(() => undefined);
        if (outcome.status === 'cancelled') throw new DOMException('Aborted', 'AbortError');
        if (outcome.status === 'paused') return pause({ reason: outcome.faRun.reason, detail: outcome.faRun.detail });
        return { status: 'skipped', detail: outcome.reason };
      } finally {
        offPhase();
      }
    },
  };
}
