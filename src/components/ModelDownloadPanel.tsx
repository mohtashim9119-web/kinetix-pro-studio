/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-app whisper model acquisition panel (bug 4 fix, WS2 Step 3 A4). The
 * ~1.51 GiB whisper model is no longer bundled into the installer — it is
 * downloaded here, into app_local_data_dir, with progress/throughput,
 * cancel, resume, and checksum verification (model_download.rs). Reachable
 * both automatically (TranscriptionBar's "Download model" action when
 * whisper_transcribe fails with a model-not-found error) and manually from
 * Project Settings. Same blocking-modal shell as ExportSettingsModal.tsx.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, AlertCircle } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  getWhisperModelStatus,
  downloadWhisperModel,
  cancelWhisperModelDownload,
} from '../services/modelDownload';

interface Props {
  onClose: () => void;
}

type PanelState =
  | { phase: 'checking' }
  | { phase: 'ready' }
  | { phase: 'idle'; partialBytes: number; totalBytes: number }
  | { phase: 'downloading'; downloadedBytes: number; totalBytes: number; bytesPerSec: number }
  | { phase: 'error'; message: string; downloadedBytes: number; totalBytes: number };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

export function ModelDownloadPanel({ onClose }: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [state, setState] = useState<PanelState>({ phase: 'checking' });
  const lastTickRef = useRef<{ time: number; bytes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWhisperModelStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.present) {
          setState({ phase: 'ready' });
        } else {
          setState({ phase: 'idle', partialBytes: status.partialBytes, totalBytes: status.totalBytes });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
          downloadedBytes: 0,
          totalBytes: 0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const start = (): void => {
    lastTickRef.current = null;
    setState({ phase: 'downloading', downloadedBytes: 0, totalBytes: 0, bytesPerSec: 0 });
    downloadWhisperModel((downloadedBytes, totalBytes) => {
      const now = performance.now();
      let bytesPerSec = 0;
      if (lastTickRef.current) {
        const dt = (now - lastTickRef.current.time) / 1000;
        const db = downloadedBytes - lastTickRef.current.bytes;
        if (dt > 0) bytesPerSec = db / dt;
      }
      lastTickRef.current = { time: now, bytes: downloadedBytes };
      setState({ phase: 'downloading', downloadedBytes, totalBytes, bytesPerSec });
    })
      .then(() => setState({ phase: 'ready' }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          getWhisperModelStatus()
            .then((status) =>
              setState({ phase: 'idle', partialBytes: status.partialBytes, totalBytes: status.totalBytes }),
            )
            .catch(() => setState({ phase: 'idle', partialBytes: 0, totalBytes: 0 }));
          return;
        }
        setState((prev) => ({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
          downloadedBytes: prev.phase === 'downloading' ? prev.downloadedBytes : 0,
          totalBytes: prev.phase === 'downloading' ? prev.totalBytes : 0,
        }));
      });
  };

  const cancel = (): void => {
    cancelWhisperModelDownload();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Download Sync Model"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Sync Model</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 text-[11px]">
          <p className="text-gray-400 leading-relaxed">
            Script-to-voiceover syncing (Whisper transcription) needs a ~1.51 GiB
            speech model. It downloads once and is kept locally.
          </p>

          {state.phase === 'checking' && <p className="text-gray-500">Checking for an existing download…</p>}

          {state.phase === 'ready' && (
            <p className="text-emerald-400 font-bold uppercase tracking-widest">✓ Model ready</p>
          )}

          {state.phase === 'idle' && (
            <div className="space-y-3">
              {state.partialBytes > 0 && (
                <p className="text-amber-400">
                  A partial download exists ({formatBytes(state.partialBytes)} of{' '}
                  {formatBytes(state.totalBytes)}) — resuming will continue from there.
                </p>
              )}
              <button
                onClick={start}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#F27D26] hover:bg-[#e06f1a] text-black font-bold uppercase tracking-widest text-[10px] transition-colors"
              >
                <Download size={14} />
                {state.partialBytes > 0 ? 'Resume Download' : 'Download Model'}
              </button>
            </div>
          )}

          {state.phase === 'downloading' && (
            <div className="space-y-2">
              <div className="relative h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-[#F27D26] rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: state.totalBytes > 0 ? `${(state.downloadedBytes / state.totalBytes) * 100}%` : '0%',
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-gray-500 tabular-nums text-[10px]">
                <span>
                  {formatBytes(state.downloadedBytes)} / {formatBytes(state.totalBytes)}
                  {state.bytesPerSec > 0 ? ` · ${formatBytes(state.bytesPerSec)}/s` : ''}
                </span>
                <button
                  onClick={cancel}
                  className="px-2 py-0.5 rounded border border-[#282828] hover:bg-[#1A1A1A] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-red-400">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="select-text">{state.message}</span>
              </div>
              <button
                onClick={start}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#F27D26] hover:bg-[#e06f1a] text-black font-bold uppercase tracking-widest text-[10px] transition-colors"
              >
                <Download size={14} />
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
