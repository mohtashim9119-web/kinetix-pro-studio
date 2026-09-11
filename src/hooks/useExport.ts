import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  exportProject,
  type ExportError,
  type ExportStage,
} from '../services/exportPipeline';
import {
  exportProjectWebCodecs,
  cancelExportWebCodecs,
  planWebCodecsExport,
  type WebCodecsFfmpeg,
} from '../services/webcodecsExport/exportPipelineWebCodecs';
import type { ForcedMp4SealOffer } from '../services/webcodecsExport/muxOnly';
import { findResumeOffer, type ResumeOffer, type ResumeRefusalNotice } from '../services/webcodecsExport/exportResumeSession';
import { recordExportSessionCreated, forgetExportSession } from '../services/webcodecsExport/exportSessionLedger';
import { readCleanupNotices, clearCleanupNotices, recordCleanupFailure, type CleanupNotice } from '../services/webcodecsExport/exportCleanupNotices';
import { normalizeSaveSessionFileResult } from '../services/tauriFfmpeg';
import { checkExportDestinationPathLength } from '../services/exportDestinationPath';
import { TauriFfmpeg, type OrphanSweepReport } from '../services/tauriFfmpeg';
import { type Project, type ResolutionTier } from '../types';
import { isTauri } from '../services/tauriFfmpeg';
import { createTauriBackend, type TauriBackend } from '../services/ffmpegBackend';
import { isWebGL2Supported } from '../services/gl/glContext';
import { readUiState, patchUiState } from '../services/uiStateStore';
import { resolveDimensions, DEFAULT_ASPECT_RATIO } from '../services/resolutionConfig';
import { playExportCompleteChime } from '../services/notificationSound';

/** Export quality tier — the same closed set as the project's own native
 *  resolutionTier (services/resolutionConfig.ts); dimensions are always
 *  derived from (project.aspectRatio, this tier), never stored directly.
 *  Kept as a distinct exported name (rather than importing ResolutionTier
 *  everywhere) so callers don't need to know the two concepts share a type. */
export type ExportResolution = ResolutionTier;
export type ExportFps = 24 | 30 | 60;
export type { ExportError } from '../services/exportPipeline';

// ---------------------------------------------------------------------------
// WebCodecs gate — capability probe + persisted user toggle
// (docs/webcodecs-export-plan.md §4.4/§6). The new path only runs when BOTH
// are true; either one being false is byte-identical to today (legacy path).
//
// WS2 T4.1 (D6, CORRECTED BY C4) — WHAT THIS TOGGLE ACTUALLY GOVERNS: the
// export encoder, and nothing else.
//
// D6 claimed a second consumer and was WRONG. Its reasoning was that
// `PreviewStage.tsx:399` computes `glPathActive = useWebCodecsPath &&
// webgl2Supported`, therefore the preview reads this value. It does not.
// `PreviewStage.tsx:380` binds its `useWebCodecsPath` from
// `isWebCodecsPreviewSupported()` (`services/webcodecsSupport.ts`), which is
// `'VideoDecoder' in window && 'EncodedVideoChunk' in window` — a capability
// probe that never touches `kinetix:ui:v1`. The two files share a LOCAL
// VARIABLE NAME. D6's rationale was written from a line number and a
// same-named identifier rather than from the value flowing through it, and
// three surfaces (this header, the toggle's doc comment, and the App Settings
// block title and body) were rewritten to match a relationship that did not
// exist. C4 corrected the copy on all three and DID NOT wire the preview to
// the toggle: the Canvas2D/CSS preview path was deleted at the WebGL2
// cutover rather than gated, so making the claim true would mean shipping a
// switch that disables the only preview renderer in the app.
//
// `webcodecsToggleConsumers.test.ts` now pins the consumer set, so the next
// version of this paragraph cannot outrun the wiring the way D6's did.
//
// THE STORAGE KEY IS DELIBERATELY NOT RENAMED. `webcodecsExportEnabled` is
// already written into every existing profile's `kinetix:ui:v1`; a migration
// that buys nothing but a tidier string is a destructive run against real
// user state for a cosmetic gain (owner ruling, this round — same trade
// `faGate.ts`'s LEGACY_GLOBAL_FA_TOGGLE_KEY declined for the same reason).
// The key is a storage address, not a description.
// ---------------------------------------------------------------------------

const WEBCODECS_TOGGLE_KEY = 'webcodecsExportEnabled';

/**
 * What `kinetix:ui:v1`'s toggle key resolves to for a user who has never
 * touched the control: it defaults ON for users who have never touched it
 * (macOS Intel verified; macOS arm64/Windows unverified but accepted risk).
 *
 * That sentence is deliberately phrased to be MACHINE-CHECKABLE — it is the
 * canonical prose form `webcodecsDefaultDrift.test.ts` scans for, and that
 * file asserts at least one such statement exists in `src/`. Rewording it out
 * of the guard's reach fails the build rather than silently emptying the
 * scan (which is what a destructive probe caught this guard doing on its
 * first draft; see that file's header).
 *
 * WHY THIS IS A NAMED CONSTANT AND NOT THE BARE `true` IT REPLACES (WS2 T4.1,
 * D3). It is the same class of thing as `faGate.ts`'s `FA_PROJECT_DEFAULT_ON`:
 * a default for an ABSENT stored preference, restated in prose directly above
 * the code that applied it. That is the exact two-places shape
 * `faDefaultDrift.test.ts` was built to catch, and this default had neither a
 * name to scan for nor a guard — measured, the literal appeared twice in one
 * function (the `??` arm and the `catch` arm) with a third statement of it in
 * the doc comment. `webcodecsDefaultDrift.test.ts` now pins all three.
 *
 * As with FA, this is a READ-TIME fallback and must stay one: nothing writes
 * it back, so "never chosen" stays "never chosen" and a future flip still
 * reaches those users.
 */
export const WEBCODECS_TOGGLE_DEFAULT_ON = true;

let cachedWebCodecsExportCapability: boolean | null = null;

/**
 * Capability probe: WebCodecs encode+decode, WebGL2, and module-worker
 * support are all required by the new path's worker (exportWorker.ts).
 * Memoized — runtime capability can't change mid-session, matching the
 * isWebGL2Supported()/isWebCodecsPreviewSupported() memoization pattern
 * already used elsewhere (glContext.ts, webcodecsSupport.ts).
 */
export function isWebCodecsExportCapable(): boolean {
  if (cachedWebCodecsExportCapability !== null) return cachedWebCodecsExportCapability;
  cachedWebCodecsExportCapability = (() => {
    if (typeof window === 'undefined') return false;
    if (!('VideoEncoder' in window) || !('VideoDecoder' in window) || !('EncodedVideoChunk' in window)) {
      return false;
    }
    if (!isWebGL2Supported()) return false;
    if (typeof Worker === 'undefined') return false;
    // Module-worker probe: constructing with { type: 'module' } throws
    // synchronously on a runtime that doesn't support it. An empty module
    // script is valid and never executes anything before terminate().
    try {
      const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      worker.terminate();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  })();
  return cachedWebCodecsExportCapability;
}

/** Test-only: clears the memoized capability result. */
export function __resetWebCodecsExportCapabilityForTests(): void {
  cachedWebCodecsExportCapability = null;
}

/**
 * The persisted user toggle. An explicit prior choice (stored `true` or
 * `false`) is always respected; anything else — absent, wrong-typed, or an
 * unreadable store — resolves to `WEBCODECS_TOGGLE_DEFAULT_ON`.
 *
 * Governs the export encoder ONLY. The editor preview selects its renderer
 * from a capability probe and never reads this value — see this section's
 * header for the measurement, and for why the copy was wrong for one round.
 */
export function isWebCodecsExportToggleOn(): boolean {
  try {
    const stored = readUiState()[WEBCODECS_TOGGLE_KEY];
    return typeof stored === 'boolean' ? stored : WEBCODECS_TOGGLE_DEFAULT_ON;
  } catch { return WEBCODECS_TOGGLE_DEFAULT_ON; }
}

export function setWebCodecsExportToggle(enabled: boolean): void {
  patchUiState({ [WEBCODECS_TOGGLE_KEY]: enabled });
}

/** The gate itself — capability AND user toggle both required. */
export function isWebCodecsExportGateOpen(): boolean {
  return isWebCodecsExportCapable() && isWebCodecsExportToggleOn();
}

export interface UseExportState {
  isExporting: boolean;
  stage: ExportStage | null;
  progress: number;
  stageLabel: string;
  error: ExportError | null;
  showExportSuccess?: boolean;
  lastExportPath?: string;
  /** Live elapsed export time in seconds — ticks once per second while
   *  isExporting, frozen (interval cleared) the instant export stops for
   *  any reason. Reset to 0 at the start of every new runExport call. */
  elapsedSec: number;
  /** The frozen elapsedSec value at the moment the MOST RECENT export
   *  completed successfully — captured separately from elapsedSec because
   *  the success transition also resets elapsedSec back to 0 via
   *  IDLE_STATE. This is what the completion toast's "completed in Xm Ys"
   *  text reads, so the toast and the live timer can never compute elapsed
   *  time from two different sources. */
  lastExportElapsedSec?: number;
  /**
   * WS3 Round 10 Blocker 2 — a SHORT deliverable is waiting on the operator.
   *
   * Non-null only between the post-concat picture-count guard failing with a
   * sealable prefix and the operator answering. The export is parked on that
   * answer (the pipeline is awaiting the promise this offer's resolver
   * settles), so the numbers here are the guard's own measured ones: pictures
   * kept, pictures lost, and the wall-duration of each. Answer with
   * `resolveSealConsent`.
   */
  pendingSealConsent: ForcedMp4SealOffer | null;
  /**
   * WS3 Round 10 Blocker 3 — a crash-surviving export for THIS EXACT timeline
   * was found, validated, and fenced, and is waiting on the operator.
   *
   * Non-null only between discovery finding one and the operator answering.
   * The export is parked on that answer. Answer with `resolveResumeChoice`;
   * `'clean'` is byte-identical to an export that never had a survivor.
   */
  pendingResumeOffer: ResumeOffer | null;
  /**
   * WS3 Round 12, STEP 1 — a resume was refused for a reason the operator
   * needs to hear (the bitstream was cut before the refusal, or the
   * recovery budget on this timeline is spent). Non-blocking: unlike
   * `pendingResumeOffer`, the export has already proceeded clean by the
   * time this is set. Set at most once per `startExport` call.
   */
  resumeRefusalNotice: ResumeRefusalNotice | null;
  /** The offer the operator ACCEPTED for the most recent export, so the
   *  success surface can say the file is deliberately shorter than asked for
   *  rather than silently handing over a short video. */
  lastExportSealedOffer?: ForcedMp4SealOffer;
  /**
   * WS3 STEP 8 (H10) — the result of the orphan sweep run once at the start
   * of this `startExport` call, before the fresh session is even created.
   * Non-null only when the sweep found at least one candidate (scanned-but-
   * clean runs leave this `null` rather than reporting nothing every time).
   * `pendingDelete` (Windows: `remove_dir_all` returned Ok but the directory
   * still exists behind an open handle) is reported SEPARATELY from
   * `bytesReclaimed` — a directory the sweep could not actually remove must
   * never be counted as reclaimed space.
   */
  orphanSweepNotice: OrphanSweepReport | null;
  /**
   * WS3 STEP 8 (C6) — cleanup failures (`TauriFfmpeg.destroy()`, the
   * premux-intermediate delete in `muxOnly.ts`) recorded by a PRIOR run and
   * read back at the start of this one, then cleared so the same notice
   * does not repeat on every subsequent export. Never blocks or delays
   * anything — purely informational, for an operator who wants to know why
   * disk usage crept up.
   */
  cleanupNotices: CleanupNotice[];
  /**
   * WS3 Round 20 — fsyncs the native side could not confirm within its
   * bounded retry during the most recent SUCCESSFUL export (delivery's own
   * result plus anything the session recorded earlier). The file is saved;
   * its durability against a crash/power loss was not proven. Shown on the
   * success toast so "saved but not confirmed durable" is said out loud
   * rather than silently reported as a clean save.
   */
  lastExportDurabilityWarnings?: string[];
}

export interface UseExportApi {
  state: UseExportState;
  startExport: () => void;
  cancelExport: () => void;
  retryExport: () => void;
  dismissSuccess: () => void;
  /** Answers a `state.pendingSealConsent` prompt. `false` (or a cancel that
   *  never answers) leaves the export on its unchanged typed failure. */
  resolveSealConsent: (accept: boolean) => void;
  /** Answers a `state.pendingResumeOffer` prompt. */
  resolveResumeChoice: (choice: 'resume' | 'clean') => void;
}

interface ExportSnapshot {
  project: Project;
  resolution: ExportResolution;
  fps: ExportFps;
  savedPath: string;
}

const IDLE_STATE: UseExportState = {
  isExporting: false,
  stage: null,
  progress: 0,
  stageLabel: '',
  error: null,
  elapsedSec: 0,
  pendingSealConsent: null,
  pendingResumeOffer: null,
  resumeRefusalNotice: null,
  orphanSweepNotice: null,
  cleanupNotices: [],
};

/**
 * Formats a duration for the LIVE timer display: "MM:SS", or "HH:MM:SS"
 * once the export runs an hour or longer. All segments zero-padded.
 */
export function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Formats a duration for the completion toast's prose form: "45s",
 * "5m 23s", or "1h 5m 23s" — whichever units are non-zero at the top,
 * omitting smaller-than-a-second precision entirely.
 */
export function formatElapsedLong(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * WS3 Round 20 — for a duration that stands NEXT TO a frame count (the
 * sealing dialog's "frames kept / frames lost" tiles and the success
 * toast's "shortened by"). `formatElapsedLong` floors, so 10 frames at
 * 30 fps (0.33 s) rendered as "0s" beside a non-zero frame count — which
 * reads as a display bug and undermines the number next to it. Sub-second
 * values show milliseconds; anything ≥ 1 s rounds UP to whole seconds so a
 * loss is never understated.
 */
export function formatFrameSpanDuration(totalSec: number): string {
  const sec = Math.max(0, totalSec);
  if (sec === 0) return '0s';
  if (sec < 1) return `${Math.max(1, Math.round(sec * 1000))} ms`;
  return formatElapsedLong(Math.ceil(sec - 1e-9));
}

/**
 * Returns the parent directory of a file path, or null if the path has no
 * directory component. Handles BOTH `/` (POSIX/macOS) and `\` (Windows)
 * separators — `pick_save_path` returns native paths, so on Windows the saved
 * path uses backslashes and a `/`-only split would return an empty string,
 * silently breaking the "remember last export directory" default. Mirrors the
 * dual-separator handling in App.tsx's export-filename display.
 */
export function parentDir(path: string): string | null {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return sep >= 0 ? path.substring(0, sep) : null;
}

export function stageLabelFor(stage: ExportStage): string {
  if (stage.type === 'loading_ffmpeg') return 'Loading ffmpeg…';
  if (stage.type === 'encoding_segment') {
    const base = `Encoding segment ${stage.index + 1} / ${stage.total}`;
    // WS3 — the piece count and the encoder-session count are DIFFERENT
    // numbers, and only the second one moves when the session bound engages.
    // Showing just the first is what made a working bound read as a dead one.
    return stage.encoderSessions !== undefined && stage.encoderSessions > 1
      ? `${base} · encoder session ${(stage.encoderSessionIndex ?? 0) + 1} / ${stage.encoderSessions}`
      : base;
  }
  if (stage.type === 'muxing') return 'Muxing & packaging…';
  if (stage.type === 'done') return 'Done!';
  if (stage.type === 'recovering') return `Recovering segment ${stage.index + 1} / ${stage.total}…`;
  return '';
}

function progressFor(stage: ExportStage): number {
  if (stage.type === 'loading_ffmpeg') return 0;
  if (stage.type === 'encoding_segment') {
    const segPct = stage.total > 0
      ? (stage.index + (stage.totalFrames > 0 ? stage.frame / stage.totalFrames : 0)) / stage.total
      : 0;
    return Math.round(segPct * 90);
  }
  if (stage.type === 'muxing') return 93;
  if (stage.type === 'done') return 100;
  // Holds at the piece's own start-of-segment percentage rather than
  // dropping to 0 — a real rewind is a recovery mid-piece, not a restart.
  if (stage.type === 'recovering') {
    return stage.total > 0 ? Math.round((stage.index / stage.total) * 90) : 0;
  }
  return 0;
}

export function useExport(
  project: Project,
  exportResolution: ExportResolution,
  exportFps: ExportFps,
  onSavePath: (path: string) => void,
): UseExportApi {
  const [state, setState] = useState<UseExportState>(IDLE_STATE);

  // Tauri native backend ref — lazy: created on first startExport.
  const tauriBackendRef = useRef<TauriBackend | null>(null);

  // Generation counter — incremented on every cancel so in-flight onProgress
  // callbacks from the dying export silently no-op and never overwrite new state.
  const generationRef = useRef(0);

  // Last snapshot — retryExport re-runs with the same inputs as the last startExport.
  const lastSnapshotRef = useRef<ExportSnapshot | null>(null);

  /** WS3 Round 10 Blocker 2 — the resolver of the promise the export pipeline
   *  is parked on while `state.pendingSealConsent` is showing. Held in a ref
   *  (not state) because `resolveSealConsent` must settle exactly the promise
   *  the CURRENT prompt created, and a stale closure would settle nothing.
   *  Cleared the instant it is called, so a second click cannot double-settle. */
  const sealConsentResolverRef = useRef<((accept: boolean) => void) | null>(null);

  /** Same parking mechanism as the seal consent, for the resume offer. */
  const resumeChoiceResolverRef = useRef<((choice: 'resume' | 'clean') => void) | null>(null);

  // Which orchestrator the CURRENT (or most recently started) export is using
  // — decided fresh at the top of every runExport call from the gate check.
  // cancelExport reads this to pick the matching cancel sequence (plan §9.1).
  const activePathRef = useRef<'legacy' | 'webcodecs'>('legacy');

  // Live elapsed-time timer — one shared interval per hook instance, ticking
  // state.elapsedSec once a second while an export is in flight. Guarding on
  // prev.isExporting inside the tick means a tick that fires in the same
  // macrotask as a stop (cancel/error/success) can't resurrect elapsedSec
  // after the state that turns off the display has already committed.
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopElapsedTimer = useCallback((): void => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback((): void => {
    stopElapsedTimer();
    elapsedTimerRef.current = setInterval(() => {
      setState(prev => (prev.isExporting ? { ...prev, elapsedSec: prev.elapsedSec + 1 } : prev));
    }, 1000);
  }, [stopElapsedTimer]);

  // Tear down the active backend and null the ref.
  // Async because session cleanup (dispose) awaits an IPC call.
  const teardown = useCallback(async (): Promise<void> => {
    if (tauriBackendRef.current) {
      await tauriBackendRef.current.dispose();
      tauriBackendRef.current = null;
    }
  }, []);

  // Clean up on unmount — fire-and-forget since useEffect cleanup must be sync.
  useEffect(() => {
    return () => {
      stopElapsedTimer();
      void teardown();
    };
  }, [teardown, stopElapsedTimer]);

  const runExport = useCallback(async (snapshot: ExportSnapshot): Promise<void> => {
    const gen = ++generationRef.current;

    setState({
      isExporting: true,
      stage: null,
      progress: 0,
      pendingSealConsent: null,
      pendingResumeOffer: null,
      resumeRefusalNotice: null,
      orphanSweepNotice: null,
      cleanupNotices: [],
      stageLabel: 'Loading ffmpeg…',
      error: null,
      elapsedSec: 0,
    });
    startElapsedTimer();

    // -------------------------------------------------------------------------
    // Backend acquisition — Tauri native path only (wasm removed in Phase 6.4).
    // -------------------------------------------------------------------------
    try {
      tauriBackendRef.current = await createTauriBackend();
    } catch (err) {
      if (generationRef.current !== gen) return;
      stopElapsedTimer();
      await teardown();
      setState(prev => ({
        isExporting: false,
        stage: null,
        progress: 0,
        stageLabel: '',
        pendingSealConsent: null,
        pendingResumeOffer: null,
        resumeRefusalNotice: null,
        orphanSweepNotice: null,
        cleanupNotices: [],
        error: {
          kind: 'ffmpeg_load',
          message: 'Failed to create a native ffmpeg session. Is ffmpeg installed and on PATH?',
          cause: err instanceof Error ? err.message : String(err),
        },
        // Frozen at the failure moment, same as a cancel — reset happens on
        // the next startExport, not here.
        elapsedSec: prev.elapsedSec,
      }));
      return;
    }

    if (generationRef.current !== gen) return;

    // ── WS3 STEP 8 (H10 + C6) — ORPHAN SWEEP + CLEANUP NOTICES ─────────────
    //
    // Runs before the fresh session exists, independent of WebCodecs vs.
    // legacy path — orphaned `kinetix-export-*` directories are a native,
    // path-agnostic artifact of any prior export. Best-effort in every
    // sense: a failure here is swallowed rather than surfaced as an export
    // error, and the sweep itself already refuses anything younger than
    // ORPHAN_SWEEP_MIN_AGE_SECS, manifest-bearing, or claimed by a live
    // holder (native `sweep_manifestless_orphans` — see session_claim.rs).
    // Left uncollected, one orphaned session directory holds a whole
    // Annex-B stream: ~1.7-2.3 GB at the measured reference/sizing cases
    // (exportResumeDiscovery.ts's cleanup-policy header).
    try {
      const report = await TauriFfmpeg.sweepOrphanSessions();
      if (generationRef.current === gen && report.candidates > 0) {
        setState(prev => ({ ...prev, orphanSweepNotice: report }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ws3-orphan-sweep] sweep failed — leaving orphans for next time', err instanceof Error ? err.message : String(err));
    }
    // Cleanup failures a PRIOR run recorded (TauriFfmpeg.destroy(),
    // muxOnly.ts's premux-intermediate delete) — read once, then cleared so
    // the same notice does not repeat on every subsequent export start.
    try {
      const notices = readCleanupNotices();
      if (notices.length > 0) {
        clearCleanupNotices();
        if (generationRef.current === gen) {
          setState(prev => ({ ...prev, cleanupNotices: notices }));
        }
      }
    } catch {
      // Best-effort, same posture as the sweep above.
    }

    const { resolution, fps, project: snap, savedPath } = snapshot;
    const { width: resWidth, height: resHeight } = resolveDimensions(
      snap.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      resolution,
    );

    // Gate branch (plan §4.4): decided fresh per run, capability + toggle
    // both required. When closed, this is byte-identical to the pre-Step-7
    // code — same exportProject call, same args, same onProgress shape.
    const useWebCodecsPath = isWebCodecsExportGateOpen();
    activePathRef.current = useWebCodecsPath ? 'webcodecs' : 'legacy';

    const onProgress = (stage: ExportStage): void => {
      if (generationRef.current !== gen) return;
      setState(prev => ({
        ...prev,
        stage,
        progress: progressFor(stage),
        stageLabel: stageLabelFor(stage),
      }));
    };

    /**
     * WS3 Round 10 Blocker 2 — surface the seal offer to a HUMAN.
     *
     * The pipeline awaits this promise, so the export is genuinely parked
     * here: nothing is muxed, saved, or reported until the operator answers.
     * A cancel (which bumps the generation) resolves it `false`, which is the
     * pipeline's status-quo failure — never an accidental yes.
     */
    const requestForcedSealConsent = (offer: ForcedMp4SealOffer): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (generationRef.current !== gen) { resolve(false); return; }
        sealConsentResolverRef.current = (accept: boolean) => {
          sealConsentResolverRef.current = null;
          setState(prev => ({
            ...prev,
            pendingSealConsent: null,
            ...(accept ? { lastExportSealedOffer: offer } : {}),
          }));
          resolve(accept);
        };
        setState(prev => ({ ...prev, pendingSealConsent: offer }));
      });

    // ── WS3 Round 10 Blocker 3 — RESUME DISCOVERY + CLEANUP ────────────────
    //
    // Runs only on the WebCodecs path (the legacy path has no checkpoints),
    // only once the operator has committed to an export, and only after the
    // fresh session exists so it is protected from collection. Discovery does
    // the whole handshake for real — validate the manifest against THIS
    // timeline's hash, run the native fence, step back to the rotation seam,
    // and verify every earlier piece by picture count — before anything is
    // offered. A failure anywhere returns no offer and the export starts
    // clean, which is always a correct outcome.
    let resumePlan: NonNullable<Parameters<typeof exportProjectWebCodecs>[2]>['resume'];
    let resumeFfmpeg: WebCodecsFfmpeg | null = null;
    let resumePlanSessionId: string | null = null;
    if (useWebCodecsPath) {
      const freshSessionId = (tauriBackendRef.current.ffmpeg as unknown as { sessionId?: string }).sessionId;
      if (freshSessionId) recordExportSessionCreated(freshSessionId);
      const routing = planWebCodecsExport(snap, fps);
      const pieceExpectedFrames = 'error' in routing ? [] : routing.pieces.map((p) => p.expectedFrames);
      const { offer, notice } = pieceExpectedFrames.length === 0
        ? { offer: null, notice: null }
        : await findResumeOffer({
            project: snap,
            fps,
            width: resWidth,
            height: resHeight,
            pieceExpectedFrames,
            inUseSessionId: freshSessionId,
          });
      if (generationRef.current !== gen) return;
      if (notice) setState(prev => ({ ...prev, resumeRefusalNotice: notice }));
      if (offer) {
        const choice = await new Promise<'resume' | 'clean'>((resolve) => {
          resumeChoiceResolverRef.current = (answer) => {
            resumeChoiceResolverRef.current = null;
            setState(prev => ({ ...prev, pendingResumeOffer: null }));
            resolve(answer);
          };
          setState(prev => ({ ...prev, pendingResumeOffer: offer }));
        });
        if (generationRef.current !== gen) return;
        if (choice === 'resume') {
          try {
            // The fenced, re-entered session — NOT the fresh one. Its bytes are
            // the whole point; a fresh session has none of them.
            resumeFfmpeg = (await TauriFfmpeg.reenter(offer.sessionId)) as unknown as WebCodecsFfmpeg;
            resumePlanSessionId = offer.sessionId;
            resumePlan = {
              pieceIndex: offer.resumable.checkpoint.pieceIndex,
              encoderSessionIndex: offer.resumable.checkpoint.encoderSessionIndex,
              byteOffset: offer.resumable.appendFromByteOffset,
              cumulativePictures: offer.resumable.checkpoint.cumulativePictures,
              manifest: offer.resumable.manifest,
            };
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[ws3-resume] could not re-enter the surviving session — starting clean', err instanceof Error ? err.message : String(err));
            resumeFfmpeg = null;
            resumePlan = undefined;
          }
        } else {
          // "Start clean" collects the survivor rather than leaving 2 GB
          // behind that the operator has just said they do not want.
          try {
            const stale = await TauriFfmpeg.reenter(offer.sessionId);
            await stale.destroy();
            forgetExportSession(offer.sessionId);
          } catch {
            // Best-effort; the TTL/count policy catches it on a later run.
          }
        }
      }
    }

    const result = useWebCodecsPath
      ? await exportProjectWebCodecs(
          snap,
          // TauriFfmpeg (the concrete runtime type behind TauriBackend.ffmpeg)
          // implements appendFileRaw/saveSessionFile/kill/destroy in addition
          // to the base FfmpegLike surface — it structurally satisfies
          // WebCodecsFfmpeg even though TauriBackend's own field type doesn't
          // declare those extra members.
          resumeFfmpeg ?? (tauriBackendRef.current.ffmpeg as WebCodecsFfmpeg),
          { fps, width: resWidth, height: resHeight, requestForcedSealConsent, ...(resumePlan ? { resume: resumePlan } : {}) },
          onProgress,
        )
      : await exportProject(
          snap,
          tauriBackendRef.current.ffmpeg,
          { fps, width: resWidth, height: resHeight },
          onProgress,
        );

    // Guard required: cancelExport increments the generation counter; without this
    // check its result would overwrite the 'cancelled' error state.
    if (generationRef.current !== gen) return;

    // Whichever session the export actually ran in must be released. `teardown`
    // only knows the fresh one, so a resumed session is destroyed here — and
    // its ledger row with it, so cleanup never counts a directory that is gone.
    const releaseResumedSession = async (): Promise<void> => {
      if (!resumeFfmpeg) return;
      try {
        await (resumeFfmpeg as unknown as { destroy(): Promise<void> }).destroy();
        forgetExportSession(resumePlanSessionId!);
      } catch {
        // Best-effort; the TTL/count policy catches it on a later run.
      }
    };

    // WS3 Round 20 — drain the session's degraded-fsync warnings BEFORE
    // teardown (destroy() would otherwise route them to the next run's
    // cleanup notices), so they ride on this run's error or success surface.
    const drainDurabilityWarnings = async (): Promise<string[]> => {
      try {
        return (await tauriBackendRef.current?.takeDurabilityWarnings()) ?? [];
      } catch {
        return [];
      }
    };

    if (!result.ok) {
      stopElapsedTimer();
      const durabilityWarnings = await drainDurabilityWarnings();
      await releaseResumedSession();
      await teardown();
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: durabilityWarnings.length > 0 ? { ...result.error, durabilityWarnings } : result.error,
      }));
      return;
    }

    // Copy the finished MP4 from the session temp dir straight to the path the
    // user chose before rendering started (no dialog here — it ran in startExport
    // before any render work). This runs BEFORE teardown (which deletes the
    // session dir) and never pulls the file's bytes into the renderer: the old
    // readFile → Blob → arrayBuffer → base64 → save_bytes_to_disk chain inflated
    // the whole file ~5–6× in the WebView heap and crashed WebView2's OOM guard
    // (STATUS_BREAKPOINT) on large exports.
    const backend = tauriBackendRef.current;
    const durabilityWarnings: string[] = [];
    const deliveryStartedAt = performance.now();
    try {
      if (!backend) throw new Error('export backend was torn down before save');
      // WS3 Round 10 Blocker 3 — a RESUMED export wrote its output into the
      // re-entered session, not the fresh one. Saving from the fresh session
      // would look for a file that was never written there.
      const saved = resumeFfmpeg
        ? normalizeSaveSessionFileResult(
            await (resumeFfmpeg as unknown as { saveSessionFile(f: string, d: string): Promise<unknown> })
              .saveSessionFile(result.outputFile, savedPath),
          )
        : await backend.saveOutputToDisk(result.outputFile, savedPath);
      // WS3 Round 20 — "saved but not confirmed durable" is a success with a
      // warning, never a failure: the bytes are at `savedPath`.
      if (!saved.durableConfirmed && saved.durabilityWarning) {
        durabilityWarnings.push(saved.durabilityWarning);
      }
    } catch (err) {
      stopElapsedTimer();
      const drained = await drainDurabilityWarnings();
      await teardown();
      if (generationRef.current !== gen) return;
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: {
          kind: 'unknown',
          message: 'Failed to save the exported file to disk.',
          cause: err instanceof Error ? err.message : String(err),
          // WS3 Round 20 — the pipeline's own terminal liveness view, with
          // the delivery step layered on as the failing phase. Before this,
          // a delivery failure shipped a blob with every liveness field null.
          liveness: {
            ...(result.liveness ?? { pieceIndex: null, framesEncoded: null }),
            lastPhase: 'deliver',
            msSinceLastPhaseChange: Math.round(performance.now() - deliveryStartedAt),
          },
          ...(drained.length > 0 ? { durabilityWarnings: drained } : {}),
        },
      }));
      return;
    }

    stopElapsedTimer();
    durabilityWarnings.push(...(await drainDurabilityWarnings()));
    await releaseResumedSession();
    await teardown();
    if (generationRef.current !== gen) return;

    setState(prev => ({
      ...IDLE_STATE,
      lastExportPath: savedPath,
      showExportSuccess: true,
      lastExportElapsedSec: prev.elapsedSec,
      ...(durabilityWarnings.length > 0 ? { lastExportDurabilityWarnings: durabilityWarnings } : {}),
    }));
    // Best-effort completion sound — never awaited, never allowed to affect
    // the export flow or the toast if it fails (see notificationSound.ts).
    void playExportCompleteChime();
  }, [teardown, startElapsedTimer, stopElapsedTimer]);

  const startExport = useCallback((): void => {
    if (!isTauri()) {
      throw new Error('Export is only available in the desktop app.');
    }
    void (async () => {
      // Step 1: prompt for destination BEFORE any rendering work begins.
      // If the user cancels nothing is wasted.
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const defaultName = `${project.name.replace(/\s+/g, '_')}_${ts}.mp4`;
      const defaultDir = project.lastExportPath
        ? parentDir(project.lastExportPath)
        : null;
      const savedPath = await invoke<string | null>('pick_save_path', {
        defaultName,
        defaultDir,
      });
      if (!savedPath) return; // user cancelled — nothing rendered, nothing wasted

      // WS3 STEP 10 (H9) — reject an impossible destination HERE, at second
      // zero, rather than after a 30+ minute render finds out the delivery
      // copy cannot land. Windows-only (see exportDestinationPath.ts) — a
      // macOS/Linux savedPath is never rejected by this check.
      const pathIssue = checkExportDestinationPathLength(savedPath);
      if (pathIssue) {
        setState(prev => ({
          ...IDLE_STATE,
          error: { kind: 'destination_path', message: pathIssue },
          elapsedSec: prev.elapsedSec,
        }));
        return;
      }

      // Step 2: remember path immediately so retryExport and the toast can use it.
      onSavePath(savedPath);

      // Step 3: render and write.
      const snapshot: ExportSnapshot = {
        project,
        resolution: exportResolution,
        fps: exportFps,
        savedPath,
      };
      lastSnapshotRef.current = snapshot;
      void runExport(snapshot);
    })();
  }, [project, exportResolution, exportFps, runExport, onSavePath]);

  const cancelExport = useCallback((): void => {
    if (tauriBackendRef.current === null) {
      // No active export — just dismiss the error/cancelled modal.
      stopElapsedTimer();
      setState(IDLE_STATE);
      return;
    }
    // Freeze the live timer at the cancel moment — reset happens on the next
    // startExport, not here (same "freeze, don't reset" behavior as an error).
    stopElapsedTimer();
    // Invalidate all in-flight onProgress callbacks from the current generation.
    generationRef.current++;
    // WS3 Round 10 — a cancel while a seal prompt is open is a DECLINE, so the
    // parked pipeline unwinds through its unchanged typed failure instead of
    // hanging on a promise nobody will ever settle.
    sealConsentResolverRef.current?.(false);
    resumeChoiceResolverRef.current?.('clean');
    // D13 fix — kill the in-flight ffmpeg subprocess before tearing down the
    // session dir it's writing into. Fire-and-forget: cancelExport is sync;
    // cancel() runs before teardown() so the sidecar isn't left running against
    // an already-deleted temp dir.
    const backend = tauriBackendRef.current;
    const wasWebCodecsPath = activePathRef.current === 'webcodecs';
    void (async () => {
      if (wasWebCodecsPath) {
        // Plan §9.1 cancel sequence: post 'cancel' to the worker + terminate
        // it FIRST, then kill+destroy the same ffmpeg session the pipeline
        // was using (cancelExportWebCodecs's own module-level activeFfmpeg is
        // the exact `backend.ffmpeg` instance passed into
        // exportProjectWebCodecs above — same session, no separate handle to
        // thread through this hook).
        await cancelExportWebCodecs();
      }
      // Always kill this session, even after the pipeline has returned and
      // `activeFfmpeg` is already null (the delivery copy). That sets the
      // native cancel flag `save_session_file` polls, so a cancel mid-save
      // stops writing the `.part` instead of racing `destroy` against a
      // direct write onto the operator's dest path.
      //
      // WS3 Round 18 (F4) — TauriFfmpeg.kill() now throws on failure instead
      // of swallowing it. Still best-effort here (a cancel must proceed to
      // teardown() regardless), but the failure is now recorded durably
      // rather than disappearing — same posture as destroy()'s own
      // recordCleanupFailure, STEP 8 (C6).
      try {
        await backend.cancel();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[ws3-cancel] kill failed:', detail);
        recordCleanupFailure('session-kill', backend.sessionId, detail);
      }
      // teardown() nulls tauriBackendRef regardless of path. For the
      // WebCodecs path this is a second, idempotent destroy() on top of the
      // one cancelExportWebCodecs() already did (TauriFfmpeg.destroy()'s own
      // doc comment: safe to call more than once) — never a second live kill.
      await teardown();
    })();
    setState(prev => ({
      isExporting: false,
      stage: null,
      progress: 0,
      stageLabel: '',
      pendingSealConsent: null,
      pendingResumeOffer: null,
      resumeRefusalNotice: null,
      orphanSweepNotice: null,
      cleanupNotices: [],
      error: { kind: 'cancelled', message: 'Export cancelled.' },
      elapsedSec: prev.elapsedSec,
    }));
  }, [teardown, stopElapsedTimer]);

  const retryExport = useCallback((): void => {
    const snapshot = lastSnapshotRef.current;
    if (!snapshot) return;
    // Tear down any lingering backend before re-spawning. Fire-and-forget:
    // retryExport is sync; runExport creates a fresh session regardless.
    void teardown();
    void runExport(snapshot);
  }, [runExport, teardown]);

  const dismissSuccess = useCallback((): void => {
    setState(prev => ({ ...prev, showExportSuccess: false }));
  }, []);

  const resolveSealConsent = useCallback((accept: boolean): void => {
    const resolver = sealConsentResolverRef.current;
    if (!resolver) return;
    resolver(accept);
  }, []);

  const resolveResumeChoice = useCallback((choice: 'resume' | 'clean'): void => {
    const resolver = resumeChoiceResolverRef.current;
    if (!resolver) return;
    resolver(choice);
  }, []);

  return { state, startExport, cancelExport, retryExport, dismissSuccess, resolveSealConsent, resolveResumeChoice };
}
