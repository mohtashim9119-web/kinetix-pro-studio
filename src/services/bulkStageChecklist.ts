/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Forward-only bulk stage checklist.
//
// Cause of the loop (P6): BulkProjectsModal highlighted
// `record.checkpoint === stage`. Checkpoint is a single cursor. When the
// run moved from transcribe (`staged`) to align (`transcript-cached`), the
// Staged chip lost its highlight and every other chip stayed dim — the
// sequence looked like it restarted. Chips also printed the checkpoint key
// (`transcript-cached`) instead of a human label.
//
// This module derives four steps from the furthest checkpoint plus the live
// queue/server phase. Rank never goes backwards.

import type { BatchPhase, BulkCheckpoint } from './bulkBatch';

export type ChecklistStepId = 'staged' | 'transcribe' | 'align' | 'build';
export type ChecklistTone = 'done' | 'active' | 'future';

export interface ChecklistStep {
  id: ChecklistStepId;
  label: string;
  tone: ChecklistTone;
}

export const CHECKLIST_LABELS: Record<ChecklistStepId, { done: string; active: string }> = {
  staged: { done: 'Staged', active: 'Staged' },
  transcribe: { done: 'Transcribed', active: 'Transcribing' },
  align: { done: 'Aligned', active: 'Aligning' },
  build: { done: 'Built', active: 'Building' },
};

const RANK: Record<ChecklistStepId, number> = { staged: 1, transcribe: 2, align: 3, build: 4 };
const IDS: ChecklistStepId[] = ['staged', 'transcribe', 'align', 'build'];

export function checkpointRank(checkpoint: BulkCheckpoint | undefined): number {
  switch (checkpoint) {
    case 'ready':
    case 'built': return 4;
    case 'aligned': return 3;
    case 'transcript-cached': return 2;
    case 'staged': return 1;
    default: return 0;
  }
}

export function laterCheckpoint(
  current: BulkCheckpoint | undefined,
  next: BulkCheckpoint | undefined,
): BulkCheckpoint | undefined {
  if (!next) return current;
  if (!current) return next;
  return checkpointRank(next) >= checkpointRank(current) ? next : current;
}

export function liveStepFromPhase(
  phase: BatchPhase | undefined,
  queuePhase: string | undefined,
  serverStage?: 'transcribe' | 'align' | null,
): ChecklistStepId | undefined {
  if (phase === 'done') return undefined;
  if (phase === 'finishing' || phase === 'cloud-done') return 'build';
  if (serverStage === 'align' || /aligning/i.test(queuePhase ?? '')) return 'align';
  if (serverStage === 'transcribe' || /transcrib/i.test(queuePhase ?? '')) return 'transcribe';
  return undefined;
}

export function bulkStageChecklist(input: {
  checkpoint?: BulkCheckpoint;
  phase?: BatchPhase;
  queuePhase?: string;
  serverStage?: 'transcribe' | 'align' | null;
}): ChecklistStep[] {
  const doneThrough = input.phase === 'done' ? 4 : checkpointRank(input.checkpoint);
  const live = liveStepFromPhase(input.phase, input.queuePhase, input.serverStage);
  let activeRank = live ? RANK[live] : 0;
  if (activeRank > 0 && activeRank <= doneThrough) activeRank = 0;
  if (activeRank === 0 && (input.phase === 'cloud' || input.phase === 'queued') && doneThrough < 4) {
    activeRank = Math.min(4, Math.max(doneThrough, 0) + 1);
  }
  return IDS.map(id => {
    const rank = RANK[id];
    const tone: ChecklistTone = rank <= doneThrough ? 'done' : rank === activeRank ? 'active' : 'future';
    const label = tone === 'active' ? CHECKLIST_LABELS[id].active : CHECKLIST_LABELS[id].done;
    return { id, label, tone };
  });
}

export function checklistNeverRegresses(prev: readonly ChecklistStep[], next: readonly ChecklistStep[]): boolean {
  for (const step of next) {
    const before = prev.find(s => s.id === step.id);
    if (before?.tone === 'done' && step.tone !== 'done') return false;
  }
  return true;
}
