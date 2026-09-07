/**
 * In-app preview decode diagnostics panel — production builds, gated by App Settings.
 */

import { useCallback, useState } from 'react';
import { Clipboard, X } from 'lucide-react';
import {
  buildPreviewDiagnosticsSnapshot,
  copyPreviewDiagnosticsToClipboard,
  previewDiagnosticsActive,
  resetPreviewDiagnosticsState,
} from '../services/previewDiagnostics';

interface Props {
  onClose: () => void;
}

export function PreviewDiagnosticsPanel({ onClose }: Props) {
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [controlNote, setControlNote] = useState<'120fps' | '30fps' | ''>('');

  const handleCopy = useCallback(async () => {
    const notes: string[] = [];
    if (controlNote === '120fps') {
      notes.push('capture: 120fps asset attempt');
    } else if (controlNote === '30fps') {
      notes.push('capture: 30fps control asset on same machine');
    }
    notes.push(
      'Procedure: enable this panel, play/scrub the target clip, tag 120fps or 30fps control, then Copy JSON.',
    );
    const ok = await copyPreviewDiagnosticsToClipboard(notes);
    setCopyState(ok ? 'ok' : 'fail');
    setTimeout(() => setCopyState('idle'), 2500);
  }, [controlNote]);

  if (!previewDiagnosticsActive()) return null;

  const snap = buildPreviewDiagnosticsSnapshot();
  const primary = snap.sessions[snap.sessions.length - 1];

  return (
    <div className="absolute bottom-4 left-4 z-[1002] w-[min(420px,calc(100%-2rem))] rounded-xl border border-white/15 bg-black/85 backdrop-blur-md text-white shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#F27D26]">
          Preview diagnostics
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview diagnostics"
          className="p-1 rounded hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>
      <div className="px-3 py-2 space-y-2 text-[10px] font-mono leading-relaxed max-h-[220px] overflow-y-auto">
        <div>Sessions: {snap.sessions.length} · configure attempts: {snap.configureAttempts.length}</div>
        {primary && (
          <div>
            last session {primary.segmentId.slice(0, 8)}… @ {primary.sourceFps ?? '?'} fps — decoded{' '}
            {primary.chunksDecoded}, out {primary.decoderOutputCallbacks}, admitted {primary.framesAdmitted},
            dropped {primary.framesDropped}, presented {primary.framesPresented}
          </div>
        )}
        <div>
          rAF ~{snap.presentation.rafTicksPerSec?.toFixed(1) ?? '?'} /s · present ~
          {snap.presentation.achievedPresentFps?.toFixed(1) ?? '?'} /s
        </div>
        {snap.firstError && (
          <div className="text-red-400">
            first error: {snap.firstError.name}: {snap.firstError.message}
          </div>
        )}
        {snap.selectionEvents.length > 0 && (
          <div>
            selection: bound {snap.selectionEvents[snap.selectionEvents.length - 1]?.compositorBoundSegmentId?.slice(0, 8) ?? '—'}
            {snap.selectionEvents[snap.selectionEvents.length - 1]?.textureRebound ? ' (rebound)' : ' (no rebound)'}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-white/10">
        <label className="text-[9px] uppercase tracking-wider text-gray-500">Tag capture</label>
        <select
          value={controlNote}
          onChange={(e) => setControlNote(e.target.value as '120fps' | '30fps' | '')}
          className="bg-[#1A1A1A] border border-[#333] rounded px-2 py-1 text-[10px]"
        >
          <option value="">(untagged)</option>
          <option value="120fps">120fps repro</option>
          <option value="30fps">30fps control</option>
        </select>
        <button
          type="button"
          onClick={() => resetPreviewDiagnosticsState()}
          className="px-2 py-1 text-[10px] border border-gray-700 rounded hover:border-gray-500"
        >
          Reset counters
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="ml-auto flex items-center gap-1 px-3 py-1 text-[10px] font-bold bg-[#F27D26] text-black rounded-lg hover:bg-orange-400"
        >
          <Clipboard size={12} />
          {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy JSON'}
        </button>
      </div>
    </div>
  );
}
