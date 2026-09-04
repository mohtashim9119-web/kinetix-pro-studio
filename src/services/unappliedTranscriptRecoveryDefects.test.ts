/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — Defects A–D probe targets (one guard per defect).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  EMPTY_SCENE_DOC_MESSAGE,
  EMPTY_TRANSCRIPT_MESSAGE,
  FULL_MISMATCH_MESSAGE,
} from '../App';
import {
  classifySyncAbortMessage,
  VOICEOVER_DURATION_ABORT_PREFIX,
} from './applySyncAbort';
import {
  armRecoveryBannerFromPersistedProject,
  recoveryBannerArmedAfterLiveCompletion,
  shouldShowRecoveryBanner,
} from './recoveryBannerVisibility';
import {
  buildUnappliedTranscript,
  clearDiscardedTranscriptCache,
  clearUnappliedTranscript,
  restoreUnappliedTranscriptTokens,
  salvageTranscriptWithoutTimeline,
  transcriptTokensMatchRecord,
  withUnappliedTranscript,
} from './unappliedTranscript';
import { TransitionType, AnimationType, type Project, type TranscriptToken } from '../types';

function tok(text: string, startSec: number): TranscriptToken {
  return { text, startSec, endSec: startSec + 0.4 };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...over,
  };
}

const TOKENS = [tok('hello', 0), tok('world', 0.5)];
const REC = buildUnappliedTranscript(TOKENS, 'asset-1', 'vo.mp3|123|999');

describe('Defect A — recovery banner visibility', () => {
  it('does not show after live completion (field present, not armed)', () => {
    expect(recoveryBannerArmedAfterLiveCompletion(false)).toBe(false);
    expect(shouldShowRecoveryBanner(false, true)).toBe(false);
  });

  it('shows after reload when persistence had an unspent record', () => {
    expect(armRecoveryBannerFromPersistedProject(true)).toBe(true);
    expect(shouldShowRecoveryBanner(true, true)).toBe(true);
  });

  it('reload re-arms even if the prior session dismissed the banner', () => {
    expect(armRecoveryBannerFromPersistedProject(true)).toBe(true);
  });
});

describe('Defect B — abort classification and fallback', () => {
  it('classifies empty scene doc as transcript-unrelated', () => {
    expect(classifySyncAbortMessage(EMPTY_SCENE_DOC_MESSAGE)).toBe('transcript_unrelated');
  });

  it('classifies voiceover duration probe failure as transcript-unrelated', () => {
    expect(classifySyncAbortMessage(`${VOICEOVER_DURATION_ABORT_PREFIX} — sync aborted.`))
      .toBe('transcript_unrelated');
  });

  it('classifies empty transcript and coverage mismatch as timeline failures', () => {
    expect(classifySyncAbortMessage(EMPTY_TRANSCRIPT_MESSAGE)).toBe('timeline_failure');
    expect(classifySyncAbortMessage(FULL_MISMATCH_MESSAGE)).toBe('timeline_failure');
  });

  it('fallback salvages tokens, clears unappliedTranscript, and does not re-arm banner by itself', () => {
    const start = withUnappliedTranscript(project(), REC);
    const after = salvageTranscriptWithoutTimeline(start, REC);
    expect(after.unappliedTranscript).toBeUndefined();
    expect(after.transcriptTokens).toEqual(TOKENS);
    expect(shouldShowRecoveryBanner(false, after.unappliedTranscript !== undefined)).toBe(false);
  });

  it('genuine timeline failure retains the record', () => {
    const start = withUnappliedTranscript(project(), REC);
    const restored = restoreUnappliedTranscriptTokens(start, REC);
    // Simulate timeline_failure abort — no salvage, no clear.
    expect(restored.unappliedTranscript).toEqual(REC);
  });
});

describe('Defect C — Discard clears stored and staged cache', () => {
  it('clearDiscardedTranscriptCache removes matching live tokens and identity', () => {
    const start = withUnappliedTranscript(
      project({
        transcriptTokens: TOKENS,
        lastTranscribedFileIdentity: 'vo.mp3|123|999',
        lastTranscribedAssetId: 'committed-vo',
      }),
      REC,
    );
    const after = clearDiscardedTranscriptCache(clearUnappliedTranscript(start), REC);
    expect(after.unappliedTranscript).toBeUndefined();
    expect(after.transcriptTokens).toBeUndefined();
    expect(after.lastTranscribedFileIdentity).toBeUndefined();
    expect(after.lastTranscribedAssetId).toBeUndefined();
  });

  it('leaves unrelated cached tokens when they differ from the discarded record', () => {
    const other = [tok('other', 1)];
    const start = withUnappliedTranscript(
      project({ transcriptTokens: other, lastTranscribedFileIdentity: 'other.mp3|1|1' }),
      REC,
    );
    expect(transcriptTokensMatchRecord(other, REC)).toBe(false);
    const after = clearDiscardedTranscriptCache(clearUnappliedTranscript(start), REC);
    expect(after.transcriptTokens).toEqual(other);
    expect(after.lastTranscribedFileIdentity).toBe('other.mp3|1|1');
  });
});

describe('Defect C — bottom Apply Sync readiness after Discard', () => {
  function transcriptionReadyAfterDiscard(p: Project, phase: 'idle' | 'done'): boolean {
    const effectiveVoiceoverId = 'vo-1';
    return (
      (phase === 'done' && p.lastTranscribedAssetId === effectiveVoiceoverId)
      || (effectiveVoiceoverId !== undefined
          && p.lastTranscribedAssetId === effectiveVoiceoverId
          && (p.transcriptTokens?.length ?? 0) > 0)
    );
  }

  it('disables Apply Sync after discard cleared the matching cache', () => {
    const after = clearDiscardedTranscriptCache(
      clearUnappliedTranscript(project({ transcriptTokens: TOKENS, lastTranscribedAssetId: 'vo-1' })),
      REC,
    );
    expect(transcriptionReadyAfterDiscard(after, 'idle')).toBe(false);
  });

  it('keeps Apply Sync ready when an unrelated token cache survives discard', () => {
    const other = [tok('live', 2)];
    const after = clearDiscardedTranscriptCache(
      clearUnappliedTranscript(project({
        transcriptTokens: other,
        lastTranscribedAssetId: 'vo-1',
        lastTranscribedFileIdentity: 'other.mp3|2|2',
      })),
      REC,
    );
    expect(transcriptionReadyAfterDiscard(after, 'idle')).toBe(true);
  });
});
