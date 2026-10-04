/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Background finish pipeline — the editor's Build Timeline stages, extracted
// so a bulk row can be finished without opening the editor, flipping the
// screen, or switching the live project.
//
// Stages (same order Apply Sync uses on a cached bulk row):
//   plan (parse) → transcript (gateway lookup) → align (FA cache) →
//   boundaries (snapCoveredBoundaries) → save → findings (provenance stamp).
//
// Callers (the editor's Apply Sync on a bulk project, and the batch
// finalizer) MUST call this function. Do not copy the stage sequence.
// ---------------------------------------------------------------------------

import type { Asset, Project, TranscriptToken, VideoSegment, SyncLogEntry } from '../types';
import type { StagedFiles } from '../components/DropZonePanel';
import type { ApplySyncResult } from './applySyncAbort';
import type { AlignFromCacheResult } from '../hooks/useWhisper';
import { alignSegmentsFromCachedTranscript } from '../hooks/useWhisper';
import type { SegmentAlignment } from './whisperService';
import { isStagedEmpty } from './stagedFilesPersist';
import { stripRtfIfNeeded } from './textUtils';
import { computeAudioHash, computeScriptHash } from './spine';
import { applyAnchorBasedTiming, headExtendFirstSegment } from './syncEngine';
import { snapCoveredBoundaries } from './snapBoundaries';
import { lookupBatchTranscript } from './bulkFinish';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import { resolveFaLanguage } from './faGate';
import { computeSyncEngineKey, resolveSyncEngine } from './faPreflight';
import { saveFaPause, type FaPauseRecord } from './faSyncPauseStore';
import { insertSkippedScenePlaceholders, stampEstimatedWordTimings } from './skippedScenePlaceholders';
import { applyFaRuleStage } from './buildTimelineFaRules';
import { matchEffectsAndLocks, buildLockNotRestoredLogEntries } from './buildTimelineFinalize';
import {
  stampCloudProvenance,
  stampFaProvenance,
  stampTimingFindings,
  type GatewayProvenance,
} from './timingProvenance';
import { appendSyncLogEntries, mintSyncLogId } from './syncLog';
import type { BulkCheckpoint } from './bulkBatch';
import { SYNC_PAUSED_MESSAGE, VOICEOVER_DURATION_ABORT_PREFIX } from './applySyncAbort';
import { classifyVoiceoverReadCause, voiceoverReadSkipReason } from './voiceoverReadCause';
import { withAudioMimeType } from './audioFormats';

export const STAGED_FOR_ANOTHER_PROJECT_MESSAGE =
  'The staged files belong to a different project, so nothing was built. Reopen this project and try again.';

export const NO_VOICEOVER_FOR_FINISH =
  'A voiceover track is required to build the timeline. Add a voiceover file and try again.';

export interface FinishStages {
  parseProjectData: (
    script: string,
    sceneDetails: string,
    assets: Asset[],
    voiceoverDuration: number,
    previousSegments?: readonly VideoSegment[],
    defaultTextOverlay?: boolean,
  ) => Promise<VideoSegment[]>;
  evaluateCoverageGate: (
    segments: VideoSegment[],
    coverage: SegmentAlignment[],
    totalTranscriptWords: number,
  ) => { aborted: false } | { aborted: true; message: string };
  filterToCoveredSegments: (
    segments: VideoSegment[],
    coverage: SegmentAlignment[],
  ) => { kept: VideoSegment[]; skipped: { segmentIndex: number }[]; keptAlignments: SegmentAlignment[] };
  retileCoveredSegments: (kept: VideoSegment[], audioDuration: number) => VideoSegment[];
  emptySceneDocAbortMessage: (parsedSegmentCount: number, sceneDocText?: string) => string | null;
  buildSyncInfoEntry: (
    syncRunId: string,
    totalSegments: number,
    matchedSegments: number,
    skippedSegments: number,
    timestamp: number,
  ) => SyncLogEntry;
  /**
   * The run's full sync log — the same report entries the editor's Build
   * Timeline writes (WPM, silence / malformed-token, skips, word coverage,
   * tail, numbers, scene density, the summary, no-asset, freeze frames).
   * Report-only: it reads the run, it never changes a timing. Absent: the
   * summary line alone.
   */
  buildRunLog?: (run: FinishRunLog) => { entries: SyncLogEntry[]; silenceErrorCount: number; noAssetCount?: number };
}

/** Everything one finished run's log is built from. */
export interface FinishRunLog {
  syncRunId: string;
  at: number;
  parsed: readonly VideoSegment[];
  audioDuration: number;
  aligned: AlignFromCacheResult;
  kept: VideoSegment[];
  keptAlignments: SegmentAlignment[];
  skipped: { segmentIndex: number }[];
  finalSegments: VideoSegment[];
  assets: Asset[];
}

export interface FinishPipelineInput {
  project: Project;
  staged: StagedFiles;
  /** Extra entries for this run's log (the bulk batch's cloud billing line). */
  extraLogEntries?: (syncRunId: string, at: number) => SyncLogEntry[];
  /** Owner stamped on the staged set. Null means "not stamped" (empty or first load). */
  stagedOwnerId: string | null;
  stages: FinishStages;
  persistVoiceover: (projectId: string, file: File) => Promise<Asset | null>;
  /**
   * The editor's own media step (`persistStagedMedia` in App.tsx): commits the
   * staged media files and zips into the project. Gets the list accumulated
   * so far (dedup is against it) and returns the full list; a zip carrying the
   * audio names the voiceover. Required: a build without it drops the media.
   */
  persistMedia: (projectId: string, staged: StagedFiles, assets: Asset[]) => Promise<{ assets: Asset[]; voiceoverId?: string }>;
  probeDuration: (asset: Asset) => Promise<number>;
  checkpoint?: BulkCheckpoint;
  onCheckpoint?: (checkpoint: BulkCheckpoint) => void;
  save?: (project: Project) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  lookupTranscript?: typeof lookupBatchTranscript;
  runFa?: typeof runForcedAlignmentForSync;
  alignFromCache?: typeof alignSegmentsFromCachedTranscript;
  hashScript?: typeof computeScriptHash;
  hashAudio?: typeof computeAudioHash;
  /** After a successful save: drop the outgoing voiceover's bytes (Item A). */
  releaseSupersededVoiceover?: (asset: Asset) => void;
}

export const BULK_PAUSED_MESSAGE = 'Paused — open the project to answer';

export type BuildTimelinePause = {
  kind: 'fa-dialog' | 'cloud-stage' | 'staging-wait';
  record?: FaPauseRecord;
};

/** Editor-only post-commit checker: alignments/tokens/silences from this run. */
export interface FinishBoundaryCheck {
  alignments: SegmentAlignment[];
  tokens: TranscriptToken[];
  silences: AlignFromCacheResult['silences'];
  syncRunId: string;
  at: number;
}

export type FinishPipelineResult =
  | {
    ok: true;
    project: Project;
    boundaryCheck: FinishBoundaryCheck;
    supersededVoiceover?: Asset;
  }
  | { ok: false; message: string; holdStaged?: boolean; pause?: BuildTimelinePause };

export function asApplySyncResult(result: FinishPipelineResult): ApplySyncResult {
  return result.ok ? { ok: true } : { ok: false, message: result.message, holdStaged: result.holdStaged };
}

/**
 * Refuse a set staged for another project before anything is read or written
 * (v1.2.2 owner-id guard).
 */
export function stagedOwnerMismatch(projectId: string, stagedOwnerId: string | null, staged: StagedFiles): boolean {
  return stagedOwnerId !== null && stagedOwnerId !== projectId && !isStagedEmpty(staged);
}

export async function runBuildTimeline(input: FinishPipelineInput): Promise<FinishPipelineResult> {
  const { project: start, staged, stages } = input;
  const onCheckpoint = input.onCheckpoint ?? (() => undefined);
  const now = input.now ?? Date.now;
  const lookup = input.lookupTranscript ?? lookupBatchTranscript;
  const runFa = input.runFa ?? runForcedAlignmentForSync;
  const alignFromCache = input.alignFromCache ?? alignSegmentsFromCachedTranscript;
  const hashScript = input.hashScript ?? computeScriptHash;
  const hashAudio = input.hashAudio ?? computeAudioHash;

  const emptyCheck: FinishBoundaryCheck = {
    alignments: [], tokens: [], silences: [], syncRunId: '', at: 0,
  };

  if (input.checkpoint === 'ready' && start.lastSyncSpine && start.segments.length > 0) {
    return { ok: true, project: start, boundaryCheck: emptyCheck };
  }
  if (input.checkpoint === 'built' && start.lastSyncSpine && start.segments.length > 0) {
    onCheckpoint('ready');
    if (input.save) await input.save(start);
    return { ok: true, project: start, boundaryCheck: emptyCheck };
  }

  if (stagedOwnerMismatch(start.id, input.stagedOwnerId, staged)) {
    return { ok: false, message: STAGED_FOR_ANOTHER_PROJECT_MESSAGE };
  }
  const progress = input.onProgress ?? (() => undefined);
  progress('Reading files…');
  onCheckpoint('staged');

  const scriptText = staged.scriptFile
    ? stripRtfIfNeeded(await staged.scriptFile.file.text())
    : start.script;
  const sceneText = staged.sceneFile
    ? stripRtfIfNeeded(await staged.sceneFile.file.text())
    : start.sceneDetails;
  const scriptHash = await hashScript(scriptText, sceneText);

  let allAssets: Asset[] = [...start.assets];
  let voiceoverId = start.voiceoverId;
  let audioHash = start.lastTranscribedAudioHash;

  if (staged.voiceoverFile) {
    // 1.5.3 — persist a typed voiceover whichever door staged it: an untyped
    // one is stored as `mimeType: ""` and the preview cannot play it.
    const voiceoverFile = withAudioMimeType(staged.voiceoverFile.file);
    const asset = await input.persistVoiceover(start.id, voiceoverFile);
    if (!asset) return { ok: false, message: NO_VOICEOVER_FOR_FINISH };
    const oldIdx = allAssets.findIndex(a => a.id === start.voiceoverId);
    if (oldIdx >= 0) allAssets.splice(oldIdx, 1);
    allAssets.push(asset);
    voiceoverId = asset.id;
    audioHash = await hashAudio(voiceoverFile);
  }

  // Media (files and zips), exactly as the editor's Build Timeline commits them.
  const media = await input.persistMedia(start.id, staged, allAssets);
  allAssets = media.assets;
  if (media.voiceoverId !== undefined && media.voiceoverId !== voiceoverId) {
    voiceoverId = media.voiceoverId;
    const zipVoiceover = allAssets.find(a => a.id === voiceoverId);
    audioHash = zipVoiceover?.file ? await hashAudio(zipVoiceover.file) : undefined;
  }

  const voiceover = allAssets.find(a => a.id === voiceoverId);
  if (!voiceover) return { ok: false, message: NO_VOICEOVER_FOR_FINISH };

  let audioDuration = voiceover.duration && voiceover.duration > 0 ? voiceover.duration : 0;
  if (!(audioDuration > 0)) {
    try {
      audioDuration = await input.probeDuration(voiceover);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const kind = classifyVoiceoverReadCause(detail);
      return {
        ok: false,
        message: `${VOICEOVER_DURATION_ABORT_PREFIX} (${kind}) — ${voiceoverReadSkipReason(kind, detail)}`,
      };
    }
  }

  progress('Planning scenes…');
  const parsed = await stages.parseProjectData(
    scriptText, sceneText, allAssets, audioDuration, start.segments, start.defaultTextOverlay ?? false,
  );
  const sceneAbort = stages.emptySceneDocAbortMessage(parsed.length, sceneText);
  if (sceneAbort) return { ok: false, message: sceneAbort };

  let tokens: TranscriptToken[] = start.transcriptTokens ?? [];
  let transcriptLanguage = start.language;
  if (tokens.length === 0 && audioHash) {
    const found = await lookup(audioHash, start.language);
    if (found) {
      tokens = found.tokens;
      transcriptLanguage = found.language;
    }
  }
  onCheckpoint('transcript-cached');
  if (tokens.length === 0) {
    return { ok: false, message: 'No speech was found in the audio. No timeline will be created.' };
  }
  progress('Aligning…');

  const engineHost = 'cloud' as const;
  const engineResolution = await resolveSyncEngine({ ...start, language: transcriptLanguage }, engineHost);
  const stampAt = now();
  const syncRunId = mintSyncLogId();
  const anchorTimed = applyAnchorBasedTiming(parsed, audioDuration);
  const faLanguage = resolveFaLanguage({ ...start, language: transcriptLanguage });
  const faRun = await runFa(
    voiceover,
    anchorTimed,
    tokens,
    audioDuration,
    faLanguage,
    input.signal,
    audioHash,
    false,
    engineResolution.host,
  );
  if (faRun.status === 'cancelled') return { ok: false, message: 'Sync cancelled.' };
  if (faRun.status === 'paused') {
    const pauseRecord: FaPauseRecord = {
      projectId: start.id,
      syncRunId,
      reason: faRun.reason,
      detail: faRun.detail,
      timestamp: stampAt,
      host: engineResolution.host,
      audioHash,
    };
    saveFaPause(pauseRecord);
    void import('./cloudJobReattach').then(m => m.postLivePause(pauseRecord)).catch(() => undefined);
    return {
      ok: false,
      message: SYNC_PAUSED_MESSAGE,
      holdStaged: true,
      pause: { kind: 'fa-dialog', record: pauseRecord },
    };
  }

  const faCompleted = faRun.status === 'ok'
    || (faRun.status === 'degraded' && faRun.reason === 'ctc-infeasible-chunk');
  const faTokens = faRun.tokens;
  onCheckpoint('aligned');

  const aligned: AlignFromCacheResult = await alignFromCache(
    voiceover,
    anchorTimed,
    faCompleted ? faTokens : tokens,
    audioDuration,
    faCompleted ? 'forced-alignment' : 'whisper',
    undefined,
    input.signal,
    audioHash,
  );

  const gate = stages.evaluateCoverageGate(aligned.segments, aligned.coverage, tokens.length);
  if (gate.aborted) return { ok: false, message: gate.message };

  progress('Placing boundaries…');
  const { kept, keptAlignments, skipped } = stages.filterToCoveredSegments(aligned.segments, aligned.coverage);
  const snapTokens = aligned.tokens;
  let finalTimed = snapTokens.length > 0
    ? snapCoveredBoundaries(kept, keptAlignments, snapTokens, aligned.silences, audioDuration)
    : stages.retileCoveredSegments(kept, audioDuration);
  finalTimed = headExtendFirstSegment(finalTimed);

  const skippedIndices = new Set(skipped.map(s => s.segmentIndex));
  let ruleLog: SyncLogEntry[] = [];
  let faWordTimings = faCompleted ? faTokens : undefined;
  if (faCompleted && faTokens) {
    const rules = applyFaRuleStage({
      anchorTimed,
      finalTimed,
      keptAlignments,
      preFilterSegments: aligned.segments,
      skippedIndices,
      coverage: aligned.coverage,
      rawTranscriptTokens: tokens,
      faTokens,
      snapTokens,
      silences: aligned.silences,
      audioDuration,
      language: start.language,
      syncRunId,
      at: stampAt,
    });
    finalTimed = rules.segments;
    ruleLog = rules.logEntries;
    if (faWordTimings) {
      // Placeholders already inserted inside the FA rule stage.
    }
  } else {
    const insertion = insertSkippedScenePlaceholders(
      finalTimed, keptAlignments, aligned.segments, skippedIndices, aligned.coverage, snapTokens, audioDuration,
    );
    finalTimed = insertion.segments;
    if (faWordTimings && insertion.placeholders.length > 0) {
      faWordTimings = stampEstimatedWordTimings(faWordTimings, insertion.placeholders, aligned.coverage, snapTokens);
    }
  }
  const locked = matchEffectsAndLocks(finalTimed, allAssets, start.segments, audioDuration);
  finalTimed = locked.segments;

  const stampLang = faLanguage ?? transcriptLanguage;
  const cachedTranscription = start.timingProvenance?.transcription;
  const transcription = cachedTranscription?.engine === 'whisper-cloud'
    ? stampCloudProvenance(cachedTranscription as GatewayProvenance & typeof cachedTranscription, {
      language: stampLang, completedAt: stampAt,
    })
    : stampCloudProvenance(
      { engine: 'whisper-cloud', model: 'whisper-cloud', modelVersion: 'gateway-cache' },
      { language: stampLang, completedAt: stampAt },
    );
  let alignment;
  if (faCompleted) {
    const cloudProvenance = faRun.status === 'ok' || faRun.status === 'degraded' ? faRun.cloudProvenance : undefined;
    alignment = cloudProvenance
      ? stampCloudProvenance(cloudProvenance, { language: stampLang, completedAt: stampAt })
      : stampFaProvenance({ language: stampLang, completedAt: stampAt });
  }
  const timingProvenance = stampTimingFindings({ transcription, alignment }, []);
  const engineKey = await computeSyncEngineKey({ ...start, language: transcriptLanguage }, engineHost);

  let next: Project = {
    ...start,
    script: scriptText,
    sceneDetails: sceneText,
    assets: allAssets,
    voiceoverId,
    segments: finalTimed,
    transcriptTokens: tokens,
    lastTranscribedAudioHash: audioHash,
    lastTranscribedAssetId: voiceoverId,
    faWordTimings,
    timingProvenance,
    lastSyncSpine: audioHash !== undefined ? { audioHash, scriptHash, engineKey } : start.lastSyncSpine,
    unappliedTranscript: undefined,
  };
  const runLog = stages.buildRunLog
    ? stages.buildRunLog({
      syncRunId, at: stampAt, parsed, audioDuration, aligned, kept, keptAlignments, skipped,
      finalSegments: finalTimed, assets: allAssets,
    })
    : {
      entries: [stages.buildSyncInfoEntry(syncRunId, aligned.segments.length, kept.length, skipped.length, stampAt)],
      silenceErrorCount: 0,
    };
  next = appendSyncLogEntries(
    next,
    [...ruleLog, ...runLog.entries, ...buildLockNotRestoredLogEntries(syncRunId, locked.droppedLocks, stampAt), ...(input.extraLogEntries?.(syncRunId, stampAt) ?? [])],
    {
      syncRunId,
      timestamp: stampAt,
      totalSegments: aligned.segments.length,
      coveredSegments: kept.length,
      skippedSegments: skipped.length,
      aborted: false,
      silenceErrorCount: runLog.silenceErrorCount,
      ...(runLog.noAssetCount !== undefined ? { noAssetCount: runLog.noAssetCount } : {}),
    },
  );

  progress('Saving…');
  if (input.save) await input.save(next);
  const supersededVoiceover = staged.voiceoverFile && start.voiceoverId && start.voiceoverId !== voiceoverId
    ? start.assets.find(a => a.id === start.voiceoverId)
    : undefined;
  if (supersededVoiceover) input.releaseSupersededVoiceover?.(supersededVoiceover);
  onCheckpoint('built');
  onCheckpoint('ready');
  return {
    ok: true,
    project: next,
    boundaryCheck: {
      alignments: keptAlignments,
      tokens: snapTokens,
      silences: aligned.silences,
      syncRunId,
      at: stampAt,
    },
    ...(supersededVoiceover ? { supersededVoiceover } : {}),
  };
}
