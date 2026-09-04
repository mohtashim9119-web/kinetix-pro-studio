/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — the recovery rules, tested where they are stated.
//
// The three properties this file exists for are all NEGATIVES, which is why
// they are asserted against pure functions rather than through the component
// tree: "restore does not clear", "record does not write language", "clear
// returns the same object when there is nothing to clear". A negative asserted
// through App.tsx is asserted through everything that could mask it.
//
// The apply ORDERING (restore → timeline write → clear, and clear only on a
// reported success) is exercised here as a scripted sequence over these same
// functions, including the failing-write case, because that ordering is the
// requirement — `App.tsx`'s `handleApplyUnappliedTranscript` is the wiring of
// it, not the statement of it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  buildUnappliedTranscript,
  clearUnappliedTranscript,
  restoreUnappliedTranscriptTokens,
  unappliedTranscriptStaleness,
  isUnappliedTranscriptStale,
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
    globalTransition: TransitionType.None,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.None,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...over,
  };
}

const TOKENS = [tok('hello', 0), tok('world', 0.5)];

describe('buildUnappliedTranscript', () => {
  it('records tokens, asset id, file identity and an ISO completion instant', () => {
    const at = new Date('2026-09-04T12:00:00.000Z');
    const rec = buildUnappliedTranscript(TOKENS, 'asset-1', 'vo.mp3|123|999', at);
    expect(rec.tokens).toEqual(TOKENS);
    expect(rec.assetId).toBe('asset-1');
    expect(rec.fileIdentity).toBe('vo.mp3|123|999');
    expect(rec.completedAt).toBe('2026-09-04T12:00:00.000Z');
  });

  it('copies the token array so a later writer clearing the live cache cannot empty it', () => {
    const live: TranscriptToken[] = [...TOKENS];
    const rec = buildUnappliedTranscript(live, 'asset-1', 'id');
    live.length = 0;
    expect(rec.tokens).toHaveLength(2);
  });

  it('normalizes an absent file identity to the empty string, not undefined', () => {
    // An absent identity is an UNKNOWN, and `unappliedTranscriptStaleness`
    // depends on being able to tell it from a real one — see the staleness
    // block below.
    expect(buildUnappliedTranscript(TOKENS, 'a', undefined).fileIdentity).toBe('');
  });
});

describe('withUnappliedTranscript', () => {
  it('touches exactly one key — in particular never language or detectedLanguage', () => {
    // THE INVARIANT: only an explicit transcription completion or an explicit
    // user override may write `language` (types.ts, languageDefaultDrift.test.ts).
    // Recording a recovery marker is neither. A second, differently-reasoned
    // language writer hidden inside this helper is exactly the drift that
    // guard exists to stop, so it is asserted structurally (key-set diff)
    // rather than by naming the two fields — a future field added to the
    // helper fails this too.
    const before = project({ language: 'es', detectedLanguage: 'es' });
    const after = withUnappliedTranscript(before, buildUnappliedTranscript(TOKENS, 'a', 'id'));

    const changed = (Object.keys(after) as (keyof Project)[]).filter(k => after[k] !== before[k]);
    expect(changed).toEqual(['unappliedTranscript']);
    expect(after.language).toBe('es');
    expect(after.detectedLanguage).toBe('es');
  });

  it('does not mutate the input project', () => {
    const before = project();
    withUnappliedTranscript(before, buildUnappliedTranscript(TOKENS, 'a', 'id'));
    expect(before.unappliedTranscript).toBeUndefined();
  });
});

describe('restoreUnappliedTranscriptTokens', () => {
  const rec = buildUnappliedTranscript(TOKENS, 'staging-asset', 'vo.mp3|123|999');

  it('puts the tokens back into the live cache', () => {
    const after = restoreUnappliedTranscriptTokens(project(), rec);
    expect(after.transcriptTokens).toEqual(TOKENS);
  });

  it('DOES NOT clear the record — the whole retention guarantee rests on this', () => {
    // If restore also cleared, a timeline write that subsequently aborted
    // would already have destroyed the only durable copy. Clearing is a
    // separate call the caller makes only on a reported success.
    const after = restoreUnappliedTranscriptTokens(
      withUnappliedTranscript(project(), rec), rec,
    );
    expect(after.unappliedTranscript).toEqual(rec);
  });

  it('restores the file identity, which survives a reload, and not the asset id, which does not', () => {
    const after = restoreUnappliedTranscriptTokens(project({ lastTranscribedAssetId: 'committed' }), rec);
    expect(after.lastTranscribedFileIdentity).toBe('vo.mp3|123|999');
    // Writing `record.assetId` here would point `cachedTokensReady` at a
    // staging-time id that no longer exists after a reload.
    expect(after.lastTranscribedAssetId).toBe('committed');
  });

  it('leaves an existing identity alone when the record carries none', () => {
    const identityless = buildUnappliedTranscript(TOKENS, 'a', '');
    const after = restoreUnappliedTranscriptTokens(
      project({ lastTranscribedFileIdentity: 'kept|1|2' }), identityless,
    );
    expect(after.lastTranscribedFileIdentity).toBe('kept|1|2');
  });
});

describe('clearUnappliedTranscript', () => {
  it('removes the key entirely rather than setting it to undefined', () => {
    const after = clearUnappliedTranscript(
      withUnappliedTranscript(project(), buildUnappliedTranscript(TOKENS, 'a', 'id')),
    );
    expect('unappliedTranscript' in after).toBe(false);
  });

  it('returns the same object identity when there is nothing to clear', () => {
    // A redundant clear must not look like a project edit to the autosave and
    // history layers, which compare by reference.
    const p = project();
    expect(clearUnappliedTranscript(p)).toBe(p);
  });
});

describe('staleness', () => {
  const rec = buildUnappliedTranscript(TOKENS, 'a', 'vo.mp3|123|999');

  it('is fresh when the record and the project agree on file identity', () => {
    expect(unappliedTranscriptStaleness(
      project({ lastTranscribedFileIdentity: 'vo.mp3|123|999' }), rec,
    )).toBe('fresh');
  });

  it('is stale when they disagree', () => {
    expect(unappliedTranscriptStaleness(
      project({ lastTranscribedFileIdentity: 'other.mp3|9|9' }), rec,
    )).toBe('stale');
  });

  it('is unknown — never stale — when either side has no identity to compare', () => {
    // The distinction is load-bearing: `isUnappliedTranscriptStale` must not
    // report a missing comparand as a mismatch, or every post-reload project
    // would show the scary wording.
    expect(unappliedTranscriptStaleness(project(), rec)).toBe('unknown');
    expect(unappliedTranscriptStaleness(
      project({ lastTranscribedFileIdentity: 'x' }), buildUnappliedTranscript(TOKENS, 'a', ''),
    )).toBe('unknown');
    expect(isUnappliedTranscriptStale(project(), rec)).toBe(false);
  });

  it('is decided by identity and never by age', () => {
    // A month-old transcript of the voiceover still in the project is
    // perfectly applicable; "old" is not "stale".
    const ancient = buildUnappliedTranscript(TOKENS, 'a', 'vo.mp3|123|999', new Date('2020-01-01T00:00:00Z'));
    expect(unappliedTranscriptStaleness(
      project({ lastTranscribedFileIdentity: 'vo.mp3|123|999' }), ancient,
    )).toBe('fresh');
  });

  it('never discards on its own — a stale record is still a present record', () => {
    const p = withUnappliedTranscript(project({ lastTranscribedFileIdentity: 'other|1|1' }), rec);
    expect(isUnappliedTranscriptStale(p, rec)).toBe(true);
    expect(p.unappliedTranscript).toBeDefined();
  });
});

describe('the apply sequence — restore, write, clear only on success', () => {
  const rec = buildUnappliedTranscript(TOKENS, 'a', 'vo.mp3|123|999');
  const start = withUnappliedTranscript(project(), rec);

  /** Mirrors `App.tsx`'s `handleApplyUnappliedTranscript`: restore, attempt
   *  the timeline write, and clear only when the write reports success. */
  function applySequence(p: Project, timelineWrite: (p: Project) => Project | null): Project {
    const restored = restoreUnappliedTranscriptTokens(p, rec);
    const written = timelineWrite(restored);
    if (written === null) return restored; // aborted — keep everything
    return clearUnappliedTranscript(written);
  }

  it('clears the record when the timeline write completes', () => {
    const after = applySequence(start, p => ({ ...p, segments: [] }));
    expect(after.unappliedTranscript).toBeUndefined();
    expect(after.transcriptTokens).toEqual(TOKENS);
  });

  it('RETAINS the record when the timeline write fails', () => {
    const after = applySequence(start, () => null);
    expect(after.unappliedTranscript).toEqual(rec);
  });

  it('retains it across repeated failures, so a user can keep retrying', () => {
    let p = start;
    for (let i = 0; i < 3; i++) p = applySequence(p, () => null);
    expect(p.unappliedTranscript).toEqual(rec);
  });
});
