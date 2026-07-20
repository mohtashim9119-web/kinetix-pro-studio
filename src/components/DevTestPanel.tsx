/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 dev-only test panel — lets a non-developer run the WebGL2 effects
 * engine's verification checks and load a 500-segment stress-test project
 * with button clicks, no terminal/config needed beyond `npm run tauri:dev`.
 * Opened via Ctrl/Cmd+Shift+D (App.tsx's window keydown effect); mounted
 * only when `import.meta.env.DEV` — this component also early-returns null
 * in that case as a belt-and-suspenders guard against ending up in a
 * production bundle path.
 */

import { useEffect, useState } from 'react';
import { X, CheckCircle2, XCircle, Loader2, Clipboard, ClipboardCheck } from 'lucide-react';
import type { Project } from '../types';
import { runPhase6Spike, formatResultsAsText, type Phase6SpikeResults, type TestResult } from '../dev/phase6Spike/runPhase6Spike';
import { generateScaleFixture } from '../dev/phase6Spike/generateScaleFixture';

interface DevTestPanelProps {
  onClose: () => void;
  setProject: (project: Project) => void;
}

type FixtureState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; segmentCount: number; assetCount: number; totalDurationSec: number }
  | { phase: 'error'; message: string };

function ResultRow({ label, result, extra }: { label: string; result: TestResult; extra?: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-zinc-800 last:border-b-0">
      {result.pass ? (
        <CheckCircle2 size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        <div className="text-xs text-zinc-400 mt-0.5">{result.details}</div>
        {extra && <div className="text-xs text-zinc-400 mt-0.5">{extra}</div>}
        {result.error && <div className="text-xs text-red-400 mt-0.5 break-all">Error: {result.error}</div>}
      </div>
    </div>
  );
}

export function DevTestPanel({ onClose, setProject }: DevTestPanelProps): React.JSX.Element | null {
  const [spikeRunning, setSpikeRunning] = useState(false);
  const [spikeResults, setSpikeResults] = useState<Phase6SpikeResults | null>(null);
  const [copied, setCopied] = useState(false);
  const [fixtureState, setFixtureState] = useState<FixtureState>({ phase: 'idle' });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRunSpike = async (): Promise<void> => {
    setSpikeRunning(true);
    setCopied(false);
    try {
      const results = await runPhase6Spike();
      setSpikeResults(results);
    } finally {
      setSpikeRunning(false);
    }
  };

  const handleCopyResults = async (): Promise<void> => {
    if (!spikeResults) return;
    try {
      await navigator.clipboard.writeText(formatResultsAsText(spikeResults));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied or unavailable — non-fatal, button just stays unconfirmed
    }
  };

  const handleLoadFixture = async (): Promise<void> => {
    setFixtureState({ phase: 'loading' });
    try {
      const { project, segmentCount, assetCount, totalDurationSec } = await generateScaleFixture();
      setProject(project);
      setFixtureState({ phase: 'done', segmentCount, assetCount, totalDurationSec });
    } catch (e) {
      setFixtureState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Belt-and-suspenders guard (App.tsx already gates mounting on DEV) — kept
  // AFTER every hook above so this never violates the rules of hooks.
  if (!import.meta.env.DEV) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-zinc-100">Phase 6 Dev Test Panel</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 flex flex-col gap-6">
          {/* --- Spike test section --- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleRunSpike()}
                disabled={spikeRunning}
                className="flex items-center gap-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                           disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-colors"
              >
                {spikeRunning && <Loader2 size={16} className="animate-spin" />}
                {spikeRunning ? 'Running…' : 'Run Phase 6 Spike'}
              </button>
              {spikeResults && (
                <button
                  onClick={() => void handleCopyResults()}
                  className="flex items-center gap-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700
                             text-zinc-200 rounded-lg px-3 py-2 transition-colors"
                >
                  {copied ? <ClipboardCheck size={14} className="text-green-400" /> : <Clipboard size={14} />}
                  {copied ? 'Copied' : 'Copy Results'}
                </button>
              )}
            </div>

            {spikeResults && (
              <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-4">
                <ResultRow label="WebGL2 support" result={spikeResults.webgl2Support} />
                <ResultRow
                  label={`Shader compile (${spikeResults.shaderCompile.programs.join(', ')})`}
                  result={spikeResults.shaderCompile}
                />
                <ResultRow label="VideoFrame → GPU texture upload" result={spikeResults.videoFrameUpload} />
                <ResultRow
                  label="Canvas → VideoFrame pixel proof"
                  result={spikeResults.pixelProof}
                  extra={
                    spikeResults.pixelProof.matchPercent !== null
                      ? `Match: ${spikeResults.pixelProof.matchPercent.toFixed(1)}% · Max diff: ${spikeResults.pixelProof.maxDiff}`
                      : undefined
                  }
                />
                <ResultRow
                  label="Throughput"
                  result={spikeResults.throughput}
                  extra={spikeResults.throughput.fps !== null ? `${spikeResults.throughput.fps.toFixed(1)} fps` : undefined}
                />
              </div>
            )}
          </section>

          <div className="border-t border-zinc-800" />

          {/* --- Scale fixture section --- */}
          <section className="flex flex-col gap-3">
            <button
              onClick={() => void handleLoadFixture()}
              disabled={fixtureState.phase === 'loading'}
              className="flex items-center gap-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500
                         disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-colors w-fit"
            >
              {fixtureState.phase === 'loading' && <Loader2 size={16} className="animate-spin" />}
              {fixtureState.phase === 'loading' ? 'Generating…' : 'Load 500-Segment Fixture'}
            </button>

            {fixtureState.phase === 'done' && (
              <div className="text-sm text-green-400 bg-green-950/30 border border-green-900 rounded-lg px-4 py-3">
                Fixture loaded — {fixtureState.segmentCount} segments, {fixtureState.assetCount} assets,{' '}
                {(fixtureState.totalDurationSec / 60).toFixed(1)} min timeline. Close this panel and test playback.
              </div>
            )}
            {fixtureState.phase === 'error' && (
              <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-4 py-3 break-all">
                Failed to generate fixture: {fixtureState.message}
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex-shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-4 py-2 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
