/**
 * The row note and the editor toast say WHY a resume did not happen. The bulk
 * row used to pick one of three fixed strings by notice kind and drop the
 * reason, so a spent recovery budget, a live claim and a cut bitstream all read
 * "Couldn't resume the saved checkpoint".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { bulkRowResumeNote, editorResumeToast } from './resumeRefusalText';
import type { ResumeRefusalNotice } from './exportResumeSession';

const KINDS: ResumeRefusalNotice['kind'][] = ['bitstream_touched', 'budget_exhausted', 'live_claim_blocked', 'never_checkpointed', 'no_checkpoint_yet'];
const notice = (kind: ResumeRefusalNotice['kind']): ResumeRefusalNotice => ({ sessionId: 's', kind, reason: `the real reason for ${kind}` });

describe('the real reason reaches the operator', () => {
  for (const kind of KINDS) {
    it(`bulk row note carries the reason — ${kind}`, () => {
      expect(bulkRowResumeNote(notice(kind))).toContain(`the real reason for ${kind}`);
    });
    it(`editor toast carries the reason — ${kind}`, () => {
      expect(editorResumeToast(notice(kind))).toContain(`the real reason for ${kind}`);
    });
  }

  it('a spent budget reads as its own reason, count included', () => {
    const reason = 'Resume unavailable — 4 of 4 recovery attempts used without progress. Starting fresh.';
    expect(bulkRowResumeNote({ sessionId: 's', kind: 'budget_exhausted', reason })).toBe(reason);
    expect(editorResumeToast({ sessionId: 's', kind: 'budget_exhausted', reason })).toBe(reason);
  });

  it('the bulk slot and the editor toast both use these, not fixed strings', () => {
    const host = readFileSync(resolve(import.meta.dirname, '..', '..', 'components', 'BulkExportHost.tsx'), 'utf-8');
    const app = readFileSync(resolve(import.meta.dirname, '..', '..', 'App.tsx'), 'utf-8');
    expect(host).toContain('bulkRowResumeNote(notice)');
    expect(app).toContain('showToast(editorResumeToast(notice))');
  });
});
