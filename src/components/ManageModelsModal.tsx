/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manage Models & Add-ons (WS2 Step 12, A3; download engine + status-bug
 * fixes WS2 Step 13) — the ONE model-acquisition UI, replacing
 * `ProjectSettingsModal`'s old "Manage sync model" link straight into
 * `ModelDownloadPanel`. Two sections: the whisper transcription engine and
 * per-language forced-alignment packs, both with working Import AND
 * Download (`services/models.ts::downloadFaModel`, wired WS2 Step 13 Phase
 * 3 — the "not yet configured" placeholder button from Step 12 is gone).
 *
 * STATUS-BUG FIX (WS2 Step 13 Phase 1): a live probe
 * (`src-tauri/tests/models_status_live.rs`) proved `check_installed_models`
 * itself correctly reports every real model on this machine as installed —
 * the backend was never the defect. What WAS a real defect: `refresh()`
 * silently swallowed a failed status check into `console.error`, leaving
 * `report` at `null` forever with no visible signal — indistinguishable in
 * the UI from "confirmed not installed" (the correct rendering for the
 * genuine first-ever-launch case). `statusError` below makes that failure
 * visible instead of silently defaulting every row to "missing".
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Download, FolderOpen, Trash2, AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { SUPPORTED_LANGUAGES } from '../constants';
import {
  checkInstalledModels,
  importLocalModel,
  deleteInstalledModel,
  getAvailableDiskSpace,
  downloadFaModel,
  cancelFaModelDownload,
  faModelId,
  FA_MODEL_LANGUAGES,
  type InstalledModelsReport,
} from '../services/models';
import {
  getWhisperModelStatus,
  downloadWhisperModel,
  cancelWhisperModelDownload,
} from '../services/modelDownload';

interface Props {
  onClose: () => void;
  /** The current project's language, if any — highlighted as "needed by
   *  this project" per Phase 2.5. Undefined outside a project context. */
  projectLanguage?: string;
}

type RowState =
  | { phase: 'idle' }
  | { phase: 'downloading'; downloadedBytes: number; totalBytes: number }
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

const SURFACE = '#121214';
const ROW = '#1A1A1E';
const BORDER = '#26262A';
const ACCENT = '#FF7300';
const INSTALLED = '#00E676';

export function ManageModelsModal({ onClose, projectLanguage }: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [report, setReport] = useState<InstalledModelsReport | null>(null);
  // Distinct from "report is null because we haven't fetched yet" — a
  // non-null message here means the LAST fetch attempt failed and `report`
  // (if set at all) may be stale. Rendered as a visible, dismissible-by-retry
  // banner rather than only a console.error (WS2 Step 13 Phase 1 fix).
  const [statusError, setStatusError] = useState<string | null>(null);
  const [diskFreeBytes, setDiskFreeBytes] = useState<number | null | 'unavailable'>(null);
  const [whisperState, setWhisperState] = useState<RowState>({ phase: 'idle' });
  const [faRowState, setFaRowState] = useState<Record<string, RowState>>({});
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

  useEffect(() => {
    refresh();
    getAvailableDiskSpace()
      .then(setDiskFreeBytes)
      .catch(() => setDiskFreeBytes('unavailable'));
  }, [refresh]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const startWhisperDownload = (): void => {
    lastTickRef.current = null;
    setWhisperState({ phase: 'downloading', downloadedBytes: 0, totalBytes: 0 });
    downloadWhisperModel((downloadedBytes, totalBytes) => {
      setWhisperState({ phase: 'downloading', downloadedBytes, totalBytes });
    })
      .then(() => {
        setWhisperState({ phase: 'idle' });
        refresh();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setWhisperState({ phase: 'idle' });
          refresh();
          return;
        }
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        refresh();
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
      })
      .catch((err: unknown) => {
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        refresh();
      });
  };

  const startFaDownload = (lang: string): void => {
    setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'downloading', downloadedBytes: 0, totalBytes: 0 } }));
    downloadFaModel(lang, (downloadedBytes, totalBytes) => {
      setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'downloading', downloadedBytes, totalBytes } }));
    })
      .then(() => {
        setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
        refresh();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setFaRowState((prev) => ({ ...prev, [lang]: { phase: 'idle' } }));
          refresh();
          return;
        }
        setFaRowState((prev) => ({
          ...prev,
          [lang]: { phase: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
        refresh();
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Models & Add-ons"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        style={{ background: SURFACE, borderColor: BORDER }}
        className="border rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Manage Models &amp; Add-ons</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none rounded"
            style={{ outlineColor: ACCENT }}
          >
            <X size={18} />
          </button>
        </div>
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

        {/* Section: Transcription Engine */}
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
                        Download
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
                      ? ` (${Math.round((whisperState.downloadedBytes / whisperState.totalBytes) * 100)}%)`
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

        {/* Section: Forced Alignment Packs */}
        <section>
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: ACCENT }}>
            Forced Alignment Packs
          </p>
          <div className="space-y-2">
            {FA_MODEL_LANGUAGES.map((lang) => {
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
                              Download
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
                            ? ` (${Math.round((rowState.downloadedBytes / rowState.totalBytes) * 100)}%)`
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

        <div className="mt-6 pt-4 border-t" style={{ borderColor: BORDER }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-black font-bold uppercase tracking-widest text-[10px] transition-colors"
            style={{ background: ACCENT }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
