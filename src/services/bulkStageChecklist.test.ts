/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  bulkStageChecklist,
  checklistNeverRegresses,
  laterCheckpoint,
  type ChecklistStep,
} from './bulkStageChecklist';

function tones(steps: readonly ChecklistStep[]): Record<string, string> {
  return Object.fromEntries(steps.map(s => [s.id, `${s.tone}:${s.label}`]));
}

describe('forward-only stage checklist', () => {
  it('(a) transitions never regress — a done step stays done', () => {
    const staged = bulkStageChecklist({ checkpoint: 'staged', phase: 'cloud', queuePhase: 'Transcribing on the cloud…' });
    const aligning = bulkStageChecklist({ checkpoint: 'transcript-cached', phase: 'cloud', queuePhase: 'Aligning on the cloud…' });
    expect(checklistNeverRegresses(staged, aligning)).toBe(true);
    expect(aligning.find(s => s.id === 'staged')?.tone).toBe('done');
    const sequence = [
      bulkStageChecklist({ checkpoint: undefined, phase: 'queued' }),
      bulkStageChecklist({ checkpoint: 'staged', phase: 'cloud', queuePhase: 'Transcribing on the cloud…' }),
      bulkStageChecklist({ checkpoint: 'transcript-cached', phase: 'cloud', queuePhase: 'Aligning on the cloud…' }),
      bulkStageChecklist({ checkpoint: 'aligned', phase: 'finishing' }),
      bulkStageChecklist({ checkpoint: 'ready', phase: 'done' }),
    ];
    for (let i = 1; i < sequence.length; i++) {
      expect(checklistNeverRegresses(sequence[i - 1]!, sequence[i]!)).toBe(true);
    }
    expect(laterCheckpoint('transcript-cached', 'staged')).toBe('transcript-cached');
  });

  it('(b) after transcription, chips show Staged done + Transcribed done + Aligning active — no sequence restart', () => {
    const steps = bulkStageChecklist({
      checkpoint: 'transcript-cached',
      phase: 'cloud',
      queuePhase: 'Aligning on the cloud…',
      serverStage: 'align',
    });
    expect(tones(steps)).toEqual({
      staged: 'done:Staged',
      transcribe: 'done:Transcribed',
      align: 'active:Aligning',
      build: 'future:Built',
    });
    expect(JSON.stringify(steps)).not.toMatch(/transcript-cached/i);
    const equalityHighlight = steps.filter(s => s.tone === 'active');
    expect(equalityHighlight).toHaveLength(1);
    expect(steps.find(s => s.id === 'staged')?.tone).not.toBe('future');
  });

  it('(c) retry keeps completed stages done', () => {
    const afterFail = bulkStageChecklist({ checkpoint: 'transcript-cached', phase: 'failed' });
    const retryAlign = bulkStageChecklist({
      checkpoint: 'transcript-cached',
      phase: 'cloud',
      queuePhase: 'Aligning on the cloud…',
    });
    expect(checklistNeverRegresses(afterFail, retryAlign)).toBe(true);
    expect(retryAlign.find(s => s.id === 'transcribe')?.tone).toBe('done');
    expect(retryAlign.find(s => s.id === 'staged')?.tone).toBe('done');
    expect(retryAlign.find(s => s.id === 'align')?.tone).toBe('active');
  });
});
