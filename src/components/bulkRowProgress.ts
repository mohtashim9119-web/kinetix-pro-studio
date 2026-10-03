/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Drawer-only progress: one continuous eased fill per stage. Live job percents
// never become discrete bar jumps — they may retarget the same glide.
// Marks: transcribe 0→50, align 50→75, build 75→100. Retry resumes.

import { useEffect, useRef, useState } from 'react';
import type { BatchPhase, BulkCheckpoint } from '../services/bulkBatch';

export type BulkBarKind = 'idle' | 'glide' | 'indeterminate' | 'hold';

export interface BulkBarPlan {
  kind: BulkBarKind;
  band: 'idle' | 'waiting' | 'transcribe' | 'align' | 'build' | 'paused' | 'failed' | 'cancelled' | 'ready';
  start: number;
  /** Where this glide is heading. Incomplete stages stop 1pt shy until done. */
  target: number;
  durationMs: number | null;
  percentVisible: boolean;
  label: string;
  glowing: boolean;
}

export interface BulkBarInput {
  rowId: string;
  contentKey?: string;
  phase?: BatchPhase;
  checkpoint?: BulkCheckpoint;
  queuePhase?: string;
  /** Live queue item status — queued rows must not look like the GPU row. */
  queueStatus?: 'queued' | 'running' | 'done' | 'skipped' | 'paused' | 'failed' | 'cancelled';
  /** Audio length from the row's existing preflight / probe, when known. */
  durationSec?: number;
}

/** Same measured transcribe throughput the cloud ETA uses (~33× realtime + 30s cold start). */
const MEASURED_TRANSCRIBE_RTF = 33;
const COLD_START_MS = 30_000;
const ALIGN_RTF = 80;
const BUILD_MS = 6_000;
export const SETTLE_MS = 480;

export const STAGE_END = { transcribe: 50, align: 75, build: 100 } as const;

const glides = new Map<string, { band: string; from: number; to: number; t0: number; durationMs: number }>();
const peaks = new Map<string, number>();

export function resetBulkBarPeaksForTests(): void {
  peaks.clear();
  glides.clear();
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function audioSecFromPreflight(summary: string | undefined): number | undefined {
  if (!summary) return undefined;
  const m = summary.match(/(\d+)\s*min audio/i);
  if (!m) return undefined;
  const mins = Number(m[1]);
  return Number.isFinite(mins) && mins > 0 ? mins * 60 : undefined;
}

export function transcribeDurationMs(audioSec: number | undefined): number | null {
  if (!audioSec || audioSec <= 0) return null;
  return Math.round(audioSec / MEASURED_TRANSCRIBE_RTF * 1000 + COLD_START_MS);
}

export function alignDurationMs(audioSec: number | undefined): number {
  if (!audioSec || audioSec <= 0) return 12_000;
  return Math.round(Math.max(4_000, audioSec / ALIGN_RTF * 1000 + 4_000));
}

export function buildDurationMs(): number {
  return BUILD_MS;
}

function liveBand(
  phase: BatchPhase | undefined,
  queuePhase: string | undefined,
  checkpoint: BulkCheckpoint | undefined,
  queueStatus: BulkBarInput['queueStatus'],
): BulkBarPlan['band'] {
  if (phase === 'done') return 'ready';
  if (phase === 'paused') return 'paused';
  if (phase === 'failed' || phase === 'finish-failed') return 'failed';
  if (phase === 'cancelled') return 'cancelled';
  if (phase === 'skipped' || phase === undefined) return 'idle';
  if (phase === 'finishing' || phase === 'cloud-done') return 'build';
  const gpuLive = queueStatus === 'running'
    || (queueStatus === undefined && /transcrib|aligning/i.test(queuePhase ?? ''));
  if (!gpuLive && (phase === 'queued' || queueStatus === 'queued')) return 'waiting';
  if (/aligning/i.test(queuePhase ?? '')) return 'align';
  if (/transcrib/i.test(queuePhase ?? '')) return 'transcribe';
  if (checkpoint === 'aligned' || checkpoint === 'built' || checkpoint === 'ready') return 'build';
  if (checkpoint === 'transcript-cached') return 'align';
  if (phase === 'queued') return 'waiting';
  if (phase === 'cloud') return gpuLive ? 'transcribe' : 'waiting';
  return 'idle';
}

function floorFor(checkpoint: BulkCheckpoint | undefined): number {
  switch (checkpoint) {
    case 'ready':
    case 'built': return 100;
    case 'aligned': return STAGE_END.align;
    case 'transcript-cached': return STAGE_END.transcribe;
    default: return 0;
  }
}

export function shouldAnimateBulkBar(plan: BulkBarPlan, drawerHidden: boolean): boolean {
  if (drawerHidden) return false;
  return plan.kind === 'glide' || plan.kind === 'indeterminate';
}

export function bulkRowBar(input: BulkBarInput): BulkBarPlan {
  const band = liveBand(input.phase, input.queuePhase, input.checkpoint, input.queueStatus);
  const floor = floorFor(input.checkpoint);

  if (band === 'waiting') {
    return {
      kind: 'hold', band, start: floor, target: floor, durationMs: null,
      percentVisible: floor > 0, label: 'Waiting', glowing: false,
    };
  }

  if (band === 'idle') {
    return {
      kind: 'idle', band, start: 0, target: 0, durationMs: null,
      percentVisible: true, label: 'Staged', glowing: false,
    };
  }

  if (band === 'ready') {
    return {
      kind: 'hold', band, start: 100, target: 100, durationMs: null,
      percentVisible: true, label: 'Ready', glowing: false,
    };
  }

  if (band === 'paused' || band === 'failed' || band === 'cancelled') {
    return {
      kind: 'hold', band, start: floor, target: floor, durationMs: null,
      percentVisible: floor > 0, label:
        band === 'paused' ? 'Paused — open project to answer'
        : band === 'failed' ? 'Failed — Retry'
        : 'Cancelled',
      glowing: false,
    };
  }

  if (band === 'transcribe') {
    const durationMs = transcribeDurationMs(input.durationSec);
    if (durationMs === null) {
      return {
        kind: 'indeterminate', band, start: 0, target: 0,
        durationMs: null, percentVisible: false, label: 'Transcribing', glowing: true,
      };
    }
    return {
      kind: 'glide', band, start: 0, target: STAGE_END.transcribe - 1,
      durationMs, percentVisible: true, label: 'Transcribing', glowing: true,
    };
  }

  if (band === 'align') {
    return {
      kind: 'glide', band, start: STAGE_END.transcribe, target: STAGE_END.align - 1,
      durationMs: alignDurationMs(input.durationSec), percentVisible: true, label: 'Aligning', glowing: true,
    };
  }

  return {
    kind: 'glide', band, start: STAGE_END.align, target: STAGE_END.build - 1,
    durationMs: buildDurationMs(), percentVisible: true, label: 'Building timeline', glowing: true,
  };
}

/** Advance (or retarget) one eased glide. Same stage + many job ticks → one motion. */
export function tickBarFill(rowKey: string, plan: BulkBarPlan, now: number, displayed: number): number {
  if (plan.kind === 'idle') {
    glides.delete(rowKey);
    peaks.delete(rowKey);
    return 0;
  }
  if (plan.kind === 'indeterminate') {
    return displayed;
  }
  if (plan.kind === 'hold') {
    const held = Math.max(displayed, plan.start);
    peaks.set(rowKey, held);
    return held;
  }

  const durationMs = Math.max(1, plan.durationMs ?? SETTLE_MS);
  let g = glides.get(rowKey);
  if (!g || g.band !== plan.band) {
    const settleToStart = displayed < plan.start - 0.05;
    g = {
      band: plan.band,
      from: displayed,
      to: settleToStart ? plan.start : plan.target,
      t0: now,
      durationMs: settleToStart ? SETTLE_MS : durationMs,
    };
    glides.set(rowKey, g);
  } else if (Math.abs(g.to - plan.target) > 0.05 && g.to !== plan.start) {
    const remaining = Math.max(SETTLE_MS, g.durationMs - (now - g.t0));
    g = { band: plan.band, from: displayed, to: plan.target, t0: now, durationMs: remaining };
    glides.set(rowKey, g);
  }

  const u = easeInOutCubic((now - g.t0) / g.durationMs);
  const next = g.from + (g.to - g.from) * u;
  const fill = Math.max(displayed, next);
  if (u >= 1 && Math.abs(g.to - plan.start) < 0.05 && Math.abs(plan.target - plan.start) > 0.05) {
    glides.set(rowKey, { band: plan.band, from: fill, to: plan.target, t0: now, durationMs });
  }
  peaks.set(rowKey, fill);
  return fill;
}

export function groupAllBuilt(phases: readonly (BatchPhase | undefined)[]): boolean {
  if (phases.length === 0) return false;
  return phases.every(p => p === 'done');
}

export function useEasedBarFill(rowKey: string, plan: BulkBarPlan, drawerHidden = false): number {
  const [fill, setFill] = useState(() => {
    if (plan.kind === 'idle') return 0;
    if (plan.band === 'ready') return 100;
    return plan.start;
  });
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    if (plan.kind === 'idle') {
      setFill(0);
      tickBarFill(rowKey, plan, performance.now(), 0);
      return;
    }
    if (plan.band === 'ready') {
      setFill(100);
      tickBarFill(rowKey, plan, performance.now(), 100);
      return;
    }
    if (!shouldAnimateBulkBar(plan, drawerHidden) || plan.kind === 'hold') {
      setFill(prev => tickBarFill(rowKey, plan, performance.now(), prev));
      return;
    }
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setFill(plan.kind === 'indeterminate' ? plan.start : plan.target);
      return;
    }
    let raf = 0;
    const loop = (now: number) => {
      setFill(prev => tickBarFill(rowKey, planRef.current, now, prev));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rowKey, plan.kind, plan.band, plan.target, plan.durationMs, plan.start, drawerHidden]);

  return fill;
}
