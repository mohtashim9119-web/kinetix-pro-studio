/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified export modal — file name, output location, resolution, fps,
 * bitrate, live size estimate, live free-space readout. Replaces the
 * previous resolution/fps-only dialog plus the separate OS save picker:
 * Browse is the folder picker (injected `ExportTargetFs`), Export commits
 * the draft and proceeds. Cancel/Escape discard the draft.
 *
 * Native calls cannot run in cloud. Every native dependency (free-space
 * query, file dialog, path validation) goes through the injected
 * `ExportTargetFs`. This file never imports `@tauri-apps`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { AspectRatio } from '../types';
import type { ExportFps, ExportResolution } from '../hooks/useExport';
import { resolveDimensions } from '../services/resolutionConfig';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  DEFAULT_EXPORT_BITRATE_KBPS,
  estimateExportOutputBytes,
  exportBitrateKbpsOptions,
} from '../services/exportOutputEstimate';
import {
  defaultExportFileName,
  parentDirOf,
  sanitizeExportFileName,
  validateExportOutputPath,
  type ExportTargetFs,
  type VolumeFreeSpaceReading,
} from '../services/exportTargetFs';
import { formatBytes } from '../services/webcodecsExport/diskFull';

const RESOLUTION_OPTIONS: ExportResolution[] = ['720p', '1080p'];
const FPS_OPTIONS: ExportFps[] = [24, 30, 60];

export interface ExportModalChoice {
  resolution: ExportResolution;
  fps: ExportFps;
  bitrateKbps: number;
  outputDirectory: string;
  fileName: string;
  outputPath: string;
}

interface Props {
  aspectRatio: AspectRatio;
  exportResolution: ExportResolution;
  exportFps: ExportFps;
  /** Last-committed bitrate; omitted → today's 1080p encoder default. */
  exportBitrateKbps?: number;
  mixedNativeFpsWarning: boolean;
  projectName: string;
  /** Σ content-segment duration (= voiceoverDuration under Model P). */
  durationSeconds: number;
  hasAudio: boolean;
  /** Last delivered file, if any — seeds the folder field. */
  lastExportPath?: string | null;
  targetFs: ExportTargetFs;
  onExport: (choice: ExportModalChoice) => void;
  onCancel: () => void;
}

export function ExportSettingsModal({
  aspectRatio,
  exportResolution,
  exportFps,
  exportBitrateKbps = DEFAULT_EXPORT_BITRATE_KBPS,
  mixedNativeFpsWarning,
  projectName,
  durationSeconds,
  hasAudio,
  lastExportPath,
  targetFs,
  onExport,
  onCancel,
}: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  const [draftResolution, setDraftResolution] = useState<ExportResolution>(exportResolution);
  const [draftFps, setDraftFps] = useState<ExportFps>(exportFps);
  const [draftBitrateKbps, setDraftBitrateKbps] = useState<number>(exportBitrateKbps);
  const [draftFileName, setDraftFileName] = useState<string>(() => defaultExportFileName(projectName));
  const [draftDirectory, setDraftDirectory] = useState<string>(() => parentDirOf(lastExportPath ?? '') ?? '');
  const [freeSpace, setFreeSpace] = useState<VolumeFreeSpaceReading | null>(null);
  const [nativeValidationReason, setNativeValidationReason] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const bitrateOptions = useMemo(() => exportBitrateKbpsOptions(), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const dims = resolveDimensions(aspectRatio, draftResolution);

  const estimate = useMemo(
    () => estimateExportOutputBytes({
      bitrateKbps: draftBitrateKbps,
      fps: draftFps,
      resolution: draftResolution,
      aspectRatio,
      durationSeconds,
      hasAudio,
    }),
    [draftBitrateKbps, draftFps, draftResolution, aspectRatio, durationSeconds, hasAudio],
  );

  const pureValidation = useMemo(
    () => validateExportOutputPath(draftDirectory, draftFileName),
    [draftDirectory, draftFileName],
  );

  useEffect(() => {
    if (!draftDirectory) {
      setFreeSpace(null);
      return;
    }
    let cancelled = false;
    void targetFs.queryVolumeFreeSpace(draftDirectory).then((reading) => {
      if (!cancelled) setFreeSpace(reading);
    }).catch(() => {
      if (!cancelled) setFreeSpace(null);
    });
    return () => { cancelled = true; };
  }, [draftDirectory, targetFs]);

  useEffect(() => {
    if (!pureValidation.ok) {
      setNativeValidationReason(null);
      return;
    }
    let cancelled = false;
    void targetFs.validateOutputPath(draftDirectory, sanitizeExportFileName(draftFileName)).then((result) => {
      if (cancelled) return;
      setNativeValidationReason(result.ok ? null : result.reason);
    }).catch(() => {
      if (!cancelled) setNativeValidationReason(null);
    });
    return () => { cancelled = true; };
  }, [draftDirectory, draftFileName, pureValidation.ok, targetFs]);

  const spaceShortfall = freeSpace !== null && freeSpace.availableBytes < estimate.destinationRequiredBytes;
  const canExport = pureValidation.ok && nativeValidationReason === null && !spaceShortfall && !browseBusy;

  const handleBrowse = useCallback(async (): Promise<void> => {
    setBrowseBusy(true);
    try {
      const picked = await targetFs.pickOutputDirectory(draftDirectory || null);
      if (picked) setDraftDirectory(picked);
    } catch {
      // Native picker unavailable — leave the current directory in place.
    } finally {
      setBrowseBusy(false);
    }
  }, [draftDirectory, targetFs]);

  const handleExport = useCallback((): void => {
    if (!canExport || !pureValidation.ok) return;
    onExport({
      resolution: draftResolution,
      fps: draftFps,
      bitrateKbps: estimate.bitrateKbps,
      outputDirectory: draftDirectory,
      fileName: sanitizeExportFileName(draftFileName),
      outputPath: pureValidation.fullPath,
    });
  }, [
    canExport,
    pureValidation,
    onExport,
    draftResolution,
    draftFps,
    estimate.bitrateKbps,
    draftDirectory,
    draftFileName,
  ]);

  const locationDisplay = draftDirectory || 'Choose a folder…';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Export</h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="export-file-name" className="text-[8px] uppercase tracking-widest text-gray-600">File name</label>
            <input
              id="export-file-name"
              data-testid="export-file-name"
              type="text"
              value={draftFileName}
              onChange={(e) => setDraftFileName(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold tracking-wide outline-none focus:border-[#F27D26] transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[8px] uppercase tracking-widest text-gray-600">Save to</label>
            <div className="flex gap-2">
              <div
                data-testid="export-output-directory"
                title={locationDisplay}
                className="flex-1 bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold tracking-wide text-gray-300 truncate"
              >
                {locationDisplay}
              </div>
              <button
                type="button"
                data-testid="export-browse"
                onClick={() => { void handleBrowse(); }}
                disabled={browseBusy}
                className="flex items-center gap-1.5 px-3 bg-[#1A1A1A] border border-[#282828] rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-300 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-[#F27D26] disabled:opacity-50"
              >
                <FolderOpen size={14} />
                Browse
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label htmlFor="export-resolution" className="text-[8px] uppercase tracking-widest text-gray-600">Resolution</label>
                <select
                  id="export-resolution"
                  data-testid="export-resolution"
                  value={draftResolution}
                  onChange={(e) => setDraftResolution(e.target.value as ExportResolution)}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
                >
                  {RESOLUTION_OPTIONS.map((tier) => (
                    <option key={tier} value={tier}>{tier}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label htmlFor="export-fps" className="text-[8px] uppercase tracking-widest text-gray-600">Frame Rate</label>
                <select
                  id="export-fps"
                  data-testid="export-fps"
                  value={draftFps}
                  onChange={(e) => setDraftFps(Number(e.target.value) as ExportFps)}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
                >
                  {FPS_OPTIONS.map((fps) => (
                    <option key={fps} value={fps}>{fps} fps</option>
                  ))}
                </select>
              </div>
            </div>
            {mixedNativeFpsWarning && (
              <p className="text-[8px] leading-snug text-amber-500/90">
                Staged videos have different native frame rates — pick the Frame Rate
                that best matches your footage; it won&apos;t be auto-set for you.
              </p>
            )}
            <p className="text-[9px] text-gray-600">{dims.width} × {dims.height}</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="export-bitrate" className="text-[8px] uppercase tracking-widest text-gray-600">Bitrate</label>
            <select
              id="export-bitrate"
              data-testid="export-bitrate"
              value={draftBitrateKbps}
              onChange={(e) => setDraftBitrateKbps(Number(e.target.value))}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
            >
              {bitrateOptions.map((kbps) => (
                <option key={kbps} value={kbps}>{kbps} kbps</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2">
            <span
              data-testid="export-size-badge"
              className="text-[10px] font-black uppercase tracking-widest text-gray-300"
            >
              Est. {formatBytes(estimate.estimatedFileBytes)}
            </span>
            <span
              data-testid="export-free-space"
              className={`text-[10px] font-bold tracking-wide ${spaceShortfall ? 'text-red-400' : 'text-gray-500'}`}
            >
              {freeSpace === null
                ? (draftDirectory ? 'Free space unavailable' : 'No folder selected')
                : spaceShortfall
                  ? `${formatBytes(freeSpace.availableBytes)} free — need ${formatBytes(estimate.destinationRequiredBytes)}`
                  : `${formatBytes(freeSpace.availableBytes)} free`}
            </span>
          </div>

          {!pureValidation.ok && (
            <p data-testid="export-path-error" className="text-[9px] text-red-400">{pureValidation.reason}</p>
          )}
          {pureValidation.ok && nativeValidationReason && (
            <p data-testid="export-path-error" className="text-[9px] text-red-400">{nativeValidationReason}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            data-testid="export-confirm"
            onClick={handleExport}
            disabled={!canExport}
            className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40 disabled:hover:bg-[#F27D26] disabled:cursor-not-allowed"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
