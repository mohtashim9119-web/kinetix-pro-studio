/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manage Models & Add-ons (WS2 Step 12, A3) — the ONE model-acquisition UI,
 * replacing `ProjectSettingsModal`'s old "Manage sync model" link straight
 * into `ModelDownloadPanel`. Two sections: the whisper transcription engine
 * (download, via `modelDownload.ts` / bug 4's existing resumable
 * downloader — untouched) and per-language forced-alignment packs (import
 * only in this build — see the FA download note below).
 *
 * FA DOWNLOAD: per the owner's Q1/Q2 answers, FA packs are meant to be
 * hosted in a private HuggingFace model repo, but this session has neither
 * the repo id nor a bearer token to reach it (Q2: private repos need auth).
 * Rather than fabricate a URL or silently stub a button that always fails,
 * the Download control here stays enabled (per Q3) but the only acquisition
 * path that actually works today is Import — see
 * docs/ws2-fa-models/manage-models.md for the real per-language export
 * command an operator can run to produce an importable file today, and what
 * still needs configuring before Download can work.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Download, FolderOpen, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { SUPPORTED_LANGUAGES } from '../constants';
import {
  checkInstalledModels,
  importLocalModel,
  deleteInstalledModel,
  getAvailableDiskSpace,
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
  | { phase: 'error'; message: string };

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
  const [diskFreeBytes, setDiskFreeBytes] = useState<number | null | 'unavailable'>(null);
  const [whisperState, setWhisperState] = useState<RowState>({ phase: 'idle' });
  const [faRowState, setFaRowState] = useState<Record<string, RowState>>({});
  const lastTickRef = useRef<{ time: number; bytes: number } | null>(null);

  const refresh = useCallback(() => {
    checkInstalledModels()
      .then(setReport)
      .catch((err: unknown) => {
        // A failed status check is not fatal to the modal — rows just show
        // "unknown" rather than blocking the whole dialog.
        console.error('checkInstalledModels failed', err);
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
          return;
        }
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
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
      });
  };

  const deleteWhisper = (): void => {
    deleteInstalledModel('whisper')
      .then(refresh)
      .catch((err: unknown) => {
        setWhisperState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
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
      });
  };

  const deleteFa = (lang: string): void => {
    deleteInstalledModel(faModelId(lang))
      .then(refresh)
      .catch((err: unknown) => {
        setFaRowState((prev) => ({
          ...prev,
          [lang]: { phase: 'error', message: err instanceof Error ? err.message : String(err) },
        }));
      });
  };

  const whisperInstalled = report?.whisper?.installed ?? false;
  const whisperBytes = report?.whisper?.bytes ?? 0;

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
        <p className="text-[10px] text-gray-500 mb-6">
          {diskFreeBytes === 'unavailable' || diskFreeBytes === null
            ? null
            : `${formatBytes(diskFreeBytes)} free on disk`}
        </p>

        {/* Section: Transcription Engine */}
        <section className="mb-6">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: ACCENT }}>
            Transcription Engine
          </p>
          <div style={{ background: ROW, borderColor: BORDER }} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px]">
                {whisperInstalled ? (
                  <CheckCircle2 size={13} style={{ color: INSTALLED }} />
                ) : (
                  <span className="w-[13px]" />
                )}
                <span className="font-bold">Whisper (ggml-large-v3-turbo)</span>
                <span className="text-gray-500">{formatBytes(whisperBytes || 1_624_555_275)}</span>
              </div>
              {whisperState.phase !== 'downloading' && (
                <div className="flex items-center gap-2">
                  {whisperInstalled ? (
                    <button
                      onClick={deleteWhisper}
                      aria-label="Delete whisper model"
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={importWhisper}
                        disabled={whisperState.phase === 'importing'}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50"
                        style={{ borderColor: BORDER }}
                      >
                        <FolderOpen size={11} />
                        Import
                      </button>
                      <button
                        onClick={startWhisperDownload}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest text-black transition-colors"
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
                        <CheckCircle2 size={13} style={{ color: INSTALLED }} />
                      ) : (
                        <span className="w-[13px]" />
                      )}
                      <span className="font-bold">{label}</span>
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
                    <div className="flex items-center gap-2">
                      {installed ? (
                        <button
                          onClick={() => deleteFa(lang)}
                          aria-label={`Delete ${label} forced-alignment pack`}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => importFa(lang)}
                            disabled={rowState.phase === 'importing'}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50"
                            style={{ borderColor: BORDER }}
                          >
                            <FolderOpen size={11} />
                            Import
                          </button>
                          {/* Always enabled per Q3 ("if no host, always-enabled") —
                              this build has no configured private-repo
                              credentials to actually stream bytes from, so
                              Download is present but not yet wired to a real
                              transfer. Import (above) is the working path
                              today; see docs/ws2-fa-models/manage-models.md. */}
                          <button
                            onClick={() =>
                              setFaRowState((prev) => ({
                                ...prev,
                                [lang]: {
                                  phase: 'error',
                                  message:
                                    'Download is not yet configured with private-repo access in this build. ' +
                                    'Use Import instead — see docs/ws2-fa-models/manage-models.md for how to ' +
                                    'obtain the file.',
                                },
                              }))
                            }
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest text-black transition-colors"
                            style={{ background: ACCENT }}
                          >
                            <Download size={11} />
                            Download
                          </button>
                        </>
                      )}
                    </div>
                  </div>
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
