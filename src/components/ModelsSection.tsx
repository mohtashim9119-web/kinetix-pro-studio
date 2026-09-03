/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Models & Add-ons — the SECTION, extracted from `ManageModelsModal.tsx`'s body
 * by WS2 T4.1 Step 1 so the same UI can be rendered in three places without
 * three copies of the download engine.
 *
 * WHY AN EXTRACTION AND NOT A SECOND COMPONENT. Every consumer needs the same
 * install/progress/cancel/delete behaviour, and that behaviour is not a
 * rendering detail: it owns an `InstalledModelsReport` refresh cycle, a
 * per-row state machine, two cancellable download channels, and the
 * status-probe failure banner that WS2 Step 13 Phase 1 exists for. A parallel
 * implementation would have to reproduce all of it, and would drift on the
 * first bug fix applied to only one copy. The chrome — dialog role, focus
 * trap, Escape, Done — is what differs between consumers, so the chrome is
 * what stayed behind.
 *
 * The three consumers:
 *   • `AppSettingsModal` renders it INLINE as block 2 (no nested modal).
 *   • `ManageModelsModal` wraps it in dialog chrome, for the two REMEDIATION
 *     links (TranscriptionBar / SyncLogPanel "download the missing model")
 *     that must open it directly from inside a failing flow.
 *   • Project Settings' FA-pack detector renders it FILTERED to one language.
 *
 * FILTERING IS A PROP, NOT A FORK (`faLanguages` / `includeWhisper`). The
 * filtered surface must behave identically to the full one — same progress,
 * same completion refresh — and the only way to guarantee that is for it to be
 * the same code path with a shorter list.
 *
 * MODEL INSTALL AND DELETE ARE IMMEDIATE FILESYSTEM SIDE EFFECTS and are
 * deliberately exempt from the draft-then-commit discipline the settings
 * modals use elsewhere (owner ruling, WS2 T4.1): a download that "pends until
 * Save" would be a lie about a 1.2 GiB file already on disk. Nothing in this
 * component may render as pending-until-Save.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Download, FolderOpen, Trash2, AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../constants';
import {
  checkInstalledModels,
  importLocalModel,
  deleteInstalledModel,
  getAvailableDiskSpace,
  downloadFaModel,
  cancelFaModelDownload,
  faModelStatus,
  faModelId,
  FA_MODEL_LANGUAGES,
  type InstalledModelsReport,
} from '../services/models';
import {
  downloadWhisperModel,
  cancelWhisperModelDownload,
  getWhisperModelStatus,
  type RetryNotice,
} from '../services/modelDownload';

type RowState =
  | { phase: 'idle' }
  | {
      phase: 'downloading';
      downloadedBytes: number;
      totalBytes: number;
      /** Set while the Rust engine is between attempts of its bounded retry
       *  (WS2 T4.3, owner ruling A4/Q4). A silent backoff reads as a frozen
       *  bar and provokes premature cancels, so the row says
       *  "Reconnecting… (attempt 2 of 3)" instead of nothing. Cleared by the
       *  next Progress event, i.e. as soon as bytes move again. */
      retry?: RetryNotice;
    }
  | { phase: 'importing' }
  | { phase: 'deleting' }
  | { phase: 'error'; message: string };

const BUSY_PHASES = new Set(['downloading', 'importing', 'deleting']);
function isBusy(state: RowState): boolean {
  return BUSY_PHASES.has(state.phase);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes <= 0) return '—';
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

/** "Download" vs "Resume 1.02 GiB". A row only says Resume when the Rust side
 *  reported bytes it would actually accept as a resume point — see
 *  `model_download.rs::status_for_target`, which filters a `.part` with no
 *  validator sidecar (or a sidecar disagreeing on the expected size) down to
 *  zero. Before WS2 T4.3 the FA row had no status command at all and showed a
 *  bare Download over a 1.02 GiB resumable partial. */
/** Percent complete, floored — never rounded.
 *
 *  Rounding displayed "100%" for anything at or past 99.5 %, i.e. while up to
 *  ~6.3 MiB of a 1.18 GiB pack was still missing, so a failure in that last
 *  half-percent read as a failure AFTER completion. `totalBytes` here is
 *  always the committed manifest size (the Rust engine sends `expected_size`,
 *  never a `Content-Length` from the response), and the engine emits an exact
 *  `downloaded == total` Progress just before `Done` — so flooring reaches
 *  100% exactly when the transfer is actually complete, and not one byte
 *  earlier.
 *
 *  This is NOT an explanation of the WS2 T4.3 operator report: that partial
 *  was 84.87 % (1_071_567_076 of 1_262_619_311), far outside the band this
 *  affects. It is a real "reads complete while short" path found while looking
 *  for that one, and closed on its own merits. */
function percentComplete(downloadedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.floor((downloadedBytes / totalBytes) * 100);
}

function downloadLabel(resumable: number | undefined): string {
  return resumable && resumable > 0 ? `Resume ${formatBytes(resumable)}` : 'Download';
}

/** The between-attempts line (owner ruling A4/Q4). Silent backoff reads as a
 *  frozen bar; this says what is happening without turning a recoverable blip
 *  into an error state. */
function RetryNoticeLine({ retry }: { retry: RetryNotice }): React.ReactElement {
  return (
    <p className="text-[9px] text-amber-400 pl-1.5" data-testid="retry-notice">
      Reconnecting… (attempt {retry.attempt} of {retry.maxAttempts}) — {retry.reason}
    </p>
  );
}

const SURFACE = '#121214';
const ROW = '#1A1A1E';
const BORDER = '#26262A';
const ACCENT = '#FF7300';
const INSTALLED = '#00E676';

export interface ModelsSectionProps {
  /** The current project's language, if any — highlighted as "needed by this
   *  project" per Phase 2.5. Undefined outside a project context. */
  projectLanguage?: string;
  /** Which forced-alignment packs to list. Defaults to all of
   *  `FA_MODEL_LANGUAGES`; Project Settings' detector passes exactly one. */
  faLanguages?: readonly string[];
  /** Whether to render the Whisper transcription-engine row. False on the
   *  one-language detector surface, where it is not what the user came for. */
  includeWhisper?: boolean;
  /** Rendered above the disk-free line when present — the detector uses it to
   *  say which language it filtered to. */
  intro?: React.ReactNode;
}

export function ModelsSection({
  projectLanguage,
  faLanguages = FA_MODEL_LANGUAGES,
  includeWhisper = true,
  intro,
}: ModelsSectionProps): React.ReactElement {
  const [report, setReport] = useState<InstalledModelsReport | null>(null);
  // Distinct from "report is null because we haven't fetched yet" — a
  // non-null message here means the LAST fetch attempt failed and `report`
  // (if set at all) may be stale. Rendered as a visible, dismissible-by-retry
  // banner rather than only a console.error (WS2 Step 13 Phase 1 fix).
  const [statusError, setStatusError] = useState<string | null>(null);
  const [diskFreeBytes, setDiskFreeBytes] = useState<number | null | 'unavailable'>(null);
  const [whisperState, setWhisperState] = useState<RowState>({ phase: 'idle' });
  const [faRowState, setFaRowState] = useState<Record<string, RowState>>({});
  /** Resumable `.part` bytes per model id, from `fa_model_status` /
   *  `whisper_model_status`. Already filtered by the Rust side to what the
   *  download engine would actually accept as a resume point, so a non-zero
   *  value here is a promise the engine can keep — it is never a raw file
   *  size. Absent/failed lookups simply render as a plain Download. */
  const [resumableBytes, setResumableBytes] = useState<Record<string, number>>({});
  const lastTickRef = useRef<{ time: number; bytes: number } | null>(null);

  const refresh = useCallback(() => {
    checkInstalledModels()
      .then((r) => {
        setReport(r);
        setStatusError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('checkInstalledModels failed', err);
        setStatusError(message);
      });
  }, []);

  /** Refreshes the resume affordance for every listed row. Failures are
   *  swallowed per-row on purpose: not knowing whether a partial exists must
   *  degrade to "offer Download", never to an error banner — the download
   *  itself resumes correctly either way. */
  const refreshResumable = useCallback(() => {
    const rows: Array<[string, Promise<{ partialBytes: number }>]> = faLanguages.map((lang) => [
      faModelId(lang),
      faModelStatus(lang),
    ]);
    if (includeWhisper) rows.push(['whisper', getWhisperModelStatus()]);
    rows.forEach(([id, pending]) => {
      pending
        .then((st) => setResumableBytes((prev) => ({ ...prev, [id]: st.partialBytes })))
        .catch(() => setResumableBytes((prev) => ({ ...prev, [id]: 0 })));
    });
  }, [faLanguages, includeWhisper]);

  useEffect(() => {
    refresh();
    refreshResumable();
    getAvailableDiskSpace()
      .then(setDiskFreeBytes)
      .catch(() => setDiskFreeBytes('unavailable'));
  }, [refresh, refreshResumable]);

  // NOTE: the Escape-to-close listener that used to sit here stayed with the
  // CHROME (`ManageModelsModal`). Inline in App Settings there is nothing for
  // Escape to close at this level, and a stray window listener here would have
  // closed the host modal from inside a section that does not own it.

  const startWhisperDownload = (): void => {
    lastTickRef.current = null;
    setWhisperState({ phase: 'downloading', downloadedBytes: resumableBytes.whisper ?? 0, totalBytes: 0 });
    downloadWhisperModel(
      (downloadedBytes, totalBytes) => {
        // A Progress event means bytes moved, so any "reconnecting" notice is
        // stale by definition and is dropped here rather than timed out.
        setWhisperState({ phase: 'downloading', downloadedBytes, totalBytes });
      },
      (retry) => {
        setWhisperState((prev) =>
          prev.phase === 'downloading' ? { ...prev, retry } : prev,
        );
      },
    )
      .then(() => {
        setWhisperState({ phase: 'idle' });
        refresh();
        refreshResumable();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setWhisperState({ phase: 'idle' });
          refresh();
          refreshResumable();
          return;
        }
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        refresh();
        // The engine may have kept a resumable partial (retries exhausted) or
        // deleted it (verification failed); re-reading is the only way the row
        // can offer the right affordance, and the two cases are not
        // distinguishable from the message alone.
        refreshResumable();
      });
  };

  const importWhisper = (): void => {
    setWhisperState({ phase: 'importing' });
    importLocalModel('whisper')
      .then((r) => {
        setWhisperState({ phase: 'idle' });
        if (!r.cancelled) refresh();
      })
      .catch((err: unknown) => {
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        refresh();
      });
  };

  const deleteWhisper = (): void => {
    setWhisperState({ phase: 'deleting' });
    deleteInstalledModel('whisper')
      .then(() => {
        setWhisperState({ phase: 'idle' });
        refresh();
        refreshResumable();
      })
      .catch((err: unknown) => {
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        refresh();
      });
  };

  const startFaDownload = (lang: string): void => {
    setFaRowState((prev) => ({
      ...prev,
      [lang]: {
        phase: 'downloading',
        downloadedBytes: resumableBytes[faModelId(lang)] ?? 0,
        totalBytes: 0,
      },
    }));
    downloadFaModel(
      lang,
      (downloadedBytes, totalBytes) => {
        setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'downloading', downloadedBytes, totalBytes } }));
      },
      (retry) => {
        setFaRowState((prev) => {
          const row = prev[lang];
          return row?.phase === 'downloading' ? { ...prev, [lang]: { ...row, retry } } : prev;
        });
      },
    )
      .then(() => {
        setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
        refresh();
        refreshResumable();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
          refresh();
          refreshResumable();
          return;
        }
        setFaRowState((prev) => ({
          ...prev,
          [lang]: { phase: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
        refresh();
        refreshResumable();
      });
  };

  const importFa = (lang: string): void => {
    setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'importing' } }));
    importLocalModel(faModelId(lang))
      .then((r) => {
        setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
        if (!r.cancelled) refresh();
      })
      .catch((err: unknown) => {
        setFaRowState((prev) => ({
          ...prev,
          [lang]: { phase: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
        refresh();
      });
  };

  const deleteFa = (lang: string): void => {
    setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'deleting' } }));
    deleteInstalledModel(faModelId(lang))
      .then(() => {
        setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
        refresh();
        refreshResumable();
      })
      .catch((err: unknown) => {
        setFaRowState((prev) => ({
          ...prev,
          [lang]: { phase: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
        refresh();
      });
  };

  const whisperInstalled = report?.whisper?.installed ?? false;
  const whisperBytes = report?.whisper?.bytes ?? 0;
  const whisperBusy = isBusy(whisperState);

  return (
    <div data-testid="models-section">
      {intro}
      <p className="text-[10px] text-gray-500 mb-2">
        {diskFreeBytes === 'unavailable' || diskFreeBytes === null
          ? null
          : `${formatBytes(diskFreeBytes)} free on disk`}
      </p>

      {statusError && (
        <div
          className="flex items-start gap-2 text-[10px] text-red-400 mb-4 p-2 rounded border"
          style={{ borderColor: '#7f1d1d' }}
        >
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span className="select-text flex-1">
            Could not check installed models: {statusError}. Rows below may not reflect what is
            actually on disk.
          </span>
          <button
            onClick={refresh}
            aria-label="Retry status check"
            className="p-0.5 text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Section: Transcription Engine — omitted on the one-language detector
          surface, where it is not what the user came for. */}
      {includeWhisper && (
        <section className="mb-6">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: ACCENT }}>
            Transcription Engine
          </p>
          <div style={{ background: ROW, borderColor: BORDER }} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px]">
                {whisperInstalled ? (
                  <CheckCircle2 size={13} style={{ color: INSTALLED }} aria-label="READY" />
                ) : (
                  <span className="w-[13px]" />
                )}
                <span className="font-bold">Whisper (ggml-large-v3-turbo)</span>
                {whisperInstalled && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-widest font-bold" style={{ color: INSTALLED }}>
                    Ready
                  </span>
                )}
                <span className="text-gray-500">{formatBytes(whisperBytes || 1_624_555_275)}</span>
              </div>
              {whisperState.phase !== 'downloading' && (
                <div className="flex items-center gap-2">
                  {whisperInstalled ? (
                    <button
                      onClick={deleteWhisper}
                      disabled={whisperBusy}
                      aria-label="Delete whisper model"
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {whisperState.phase === 'deleting' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={importWhisper}
                        disabled={whisperBusy}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50"
                        style={{ borderColor: BORDER }}
                      >
                        {whisperState.phase === 'importing' ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <FolderOpen size={11} />
                        )}
                        {whisperState.phase === 'importing' ? 'Importing…' : 'Import'}
                      </button>
                      <button
                        onClick={startWhisperDownload}
                        disabled={whisperBusy}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest text-black transition-colors disabled:opacity-50"
                        style={{ background: ACCENT }}
                      >
                        <Download size={11} />
                        {downloadLabel(resumableBytes.whisper)}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {whisperState.phase === 'importing' && (
              <p className="text-[9px] text-gray-500 pl-1.5">
                Copying a ~1.51 GiB file — this can take a while for a large source; the dialog stays
                open until it's done.
              </p>
            )}
            {whisperState.phase === 'downloading' && (
              <div className="space-y-1">
                <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: '#0A0A0C' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out"
                    style={{
                      background: ACCENT,
                      width:
                        whisperState.totalBytes > 0
                          ? `${(whisperState.downloadedBytes / whisperState.totalBytes) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500 tabular-nums">
                  <span>
                    {formatBytes(whisperState.downloadedBytes)} / {formatBytes(whisperState.totalBytes)}
                    {whisperState.totalBytes > 0
                      ? ` (${percentComplete(whisperState.downloadedBytes, whisperState.totalBytes)}%)`
                      : ''}
                  </span>
                  <button
                    onClick={() => cancelWhisperModelDownload()}
                    className="px-2 py-0.5 rounded border transition-colors"
                    style={{ borderColor: BORDER }}
                  >
                    Cancel
                  </button>
                </div>
                {whisperState.retry && <RetryNoticeLine retry={whisperState.retry} />}
              </div>
            )}
            {whisperState.phase === 'error' && (
              <div className="flex items-start gap-2 text-[10px] text-red-400">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span className="select-text">{whisperState.message}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Section: Forced Alignment Packs */}
      <section>
        <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: ACCENT }}>
          Forced Alignment Packs
        </p>
        <div className="space-y-2">
          {faLanguages.map((lang) => {
            const label = SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label ?? lang;
            const status = report?.fa[lang];
            const installed = status?.installed ?? false;
            const rowState = faRowState[lang] ?? { phase: 'idle' as const };
            const busy = isBusy(rowState);
            const isNeeded = projectLanguage === lang;
            return (
              <div
                key={lang}
                style={{ background: ROW, borderColor: isNeeded ? ACCENT : BORDER }}
                className="border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px]">
                    {installed ? (
                      <CheckCircle2 size={13} style={{ color: INSTALLED }} aria-label="INSTALLED" />
                    ) : (
                      <span className="w-[13px]" />
                    )}
                    <span className="font-bold">{label}</span>
                    {installed && (
                      <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-widest font-bold" style={{ color: INSTALLED }}>
                        Installed
                      </span>
                    )}
                    {isNeeded && (
                      <span
                        className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-widest font-bold"
                        style={{ color: ACCENT, border: `1px solid ${ACCENT}` }}
                      >
                        Needed by this project
                      </span>
                    )}
                    <span className="text-gray-500">{formatBytes(status?.bytes ?? 0)}</span>
                  </div>
                  {rowState.phase !== 'downloading' && (
                    <div className="flex items-center gap-2">
                      {installed ? (
                        <button
                          onClick={() => deleteFa(lang)}
                          disabled={busy}
                          aria-label={`Delete ${label} forced-alignment pack`}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {rowState.phase === 'deleting' ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => importFa(lang)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50"
                            style={{ borderColor: BORDER }}
                          >
                            {rowState.phase === 'importing' ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <FolderOpen size={11} />
                            )}
                            {rowState.phase === 'importing' ? 'Importing…' : 'Import'}
                          </button>
                          <button
                            onClick={() => startFaDownload(lang)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest text-black transition-colors disabled:opacity-50"
                            style={{ background: ACCENT }}
                          >
                            <Download size={11} />
                            {downloadLabel(resumableBytes[faModelId(lang)])}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {rowState.phase === 'importing' && (
                  <p className="text-[9px] text-gray-500 pl-1.5">
                    Copying a ~1.26 GiB file — this can take a while; the dialog stays open until
                    it's done.
                  </p>
                )}
                {rowState.phase === 'downloading' && (
                  <div className="space-y-1">
                    <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: '#0A0A0C' }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out"
                        style={{
                          background: ACCENT,
                          width:
                            rowState.totalBytes > 0
                              ? `${(rowState.downloadedBytes / rowState.totalBytes) * 100}%`
                              : '0%',
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-500 tabular-nums">
                      <span>
                        {formatBytes(rowState.downloadedBytes)} / {formatBytes(rowState.totalBytes)}
                        {rowState.totalBytes > 0
                          ? ` (${percentComplete(rowState.downloadedBytes, rowState.totalBytes)}%)`
                          : ''}
                      </span>
                      <button
                        onClick={() => cancelFaModelDownload(lang)}
                        className="px-2 py-0.5 rounded border transition-colors"
                        style={{ borderColor: BORDER }}
                      >
                        Cancel
                      </button>
                    </div>
                    {rowState.retry && <RetryNoticeLine retry={rowState.retry} />}
                  </div>
                )}
                {rowState.phase === 'error' && (
                  <div className="flex items-start gap-2 text-[10px] text-red-400">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span className="select-text">{rowState.message}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
