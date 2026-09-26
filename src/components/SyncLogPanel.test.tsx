// WS-logs skip detail — 3-line skip-entry rendering (tag + match-count).
// Same static-markup pattern as SyncLoadingOverlay.test.tsx: no DOM/testing-
// library dependency, just render-to-string and assert on the HTML.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// Operator ruling (sync-log user view): these suites cover the RAW entry
// renderer — what Details ▸ category shows, badges and all — so they render
// `SyncLogRawEntries` directly. The default view itself is covered by
// SyncLogPanel.userView.test.tsx.
import { SyncLogRawEntries, formatEntryText } from './SyncLogPanel';
import type { SyncLogEntry } from '../types';

const AT = 1_700_000_000_000;

function makeSkipEntry(partial: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'e1',
    timestamp: AT,
    syncRunId: 'run-1',
    type: 'skip',
    message: 'S135 skipped — no text match.',
    segmentIndex: 134,
    segmentText: 'This is a test missing segment.',
    reason: 'no text match',
    ...partial,
  };
}

describe('SyncLogPanel — skip entry 3-line format', () => {
  it('renders "Segment N skipped — reason", "[tag] text" and the match-count line', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makeSkipEntry({ segmentTag: 'missing1', matchedWords: 2, totalWords: 8, confidence: 0.25 })]}
      />,
    );
    expect(html).toContain('S135: Unmatched scene — kept as Estimated placeholder — no text match');
    expect(html).toContain('[missing1]');
    expect(html).toContain('This is a test missing segment.');
    expect(html).toContain('matched 2 of 8 words (confidence 0.25)');
  });

  it('omits the bracket prefix when segmentTag is empty/missing', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makeSkipEntry({ segmentTag: undefined, matchedWords: 0, totalWords: 5, confidence: 0 })]}
      />,
    );
    expect(html).not.toContain('[undefined]');
    expect(html).not.toContain('[]');
    expect(html).toContain('This is a test missing segment.');
  });

  it('renders "matched 0 of 0 words (no content to match)" when totalWords is 0', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makeSkipEntry({ matchedWords: 0, totalWords: 0, confidence: 0 })]}
      />,
    );
    expect(html).toContain('matched 0 of 0 words (no content to match)');
  });

  it('omits the match-count line entirely for an old entry missing the new fields (backward compat)', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makeSkipEntry({ segmentTag: undefined, matchedWords: undefined, totalWords: undefined, confidence: undefined })]}
      />,
    );
    // G2 close-out FIX 3's copy rename put the substring "matched" into the
    // skip label itself ("Unmatched scene"), so this checks for the
    // match-count line's own shape rather than the bare word.
    expect(html).not.toMatch(/matched \d+ of \d+ words/);
    expect(html).not.toContain('confidence');
    // The rest of the entry still renders without crashing.
    expect(html).toContain('S135: Unmatched scene — kept as Estimated placeholder — no text match');
    expect(html).toContain('This is a test missing segment.');
  });

  it('does not crash and renders normally for a non-skip entry', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[{
          id: 'e2', timestamp: AT, syncRunId: 'run-1', type: 'info',
          message: 'Sync completed: 8 of 8 segments matched.',
        }]}
      />,
    );
    expect(html).toContain('Sync completed: 8 of 8 segments matched.');
  });
});

// ---------------------------------------------------------------------------
// WS4 — the two new run-level entry kinds render, and old entries still do.
// ---------------------------------------------------------------------------

function renderPanel(entries: SyncLogEntry[]): string {
  return renderToStaticMarkup(<SyncLogRawEntries entries={entries} />);
}

describe('SyncLogPanel — WS4 entry kinds', () => {
  it('renders a silence-error entry with its badge, message and reason', () => {
    const html = renderPanel([{
      id: 'e-sil',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'silence-error',
      message: 'Silence detection failed — segment boundaries fall back to spoken-word midpoints instead of audio gaps.',
      errorMessage: 'Unable to decode audio data',
    }]);

    expect(html).toContain('SILENCE');
    expect(html).toContain('Silence detection failed');
    expect(html).toContain('reason: Unable to decode audio data');
    expect(html).toContain('text-red-400');
  });

  it('renders a malformed-token entry with its badge, message and counts', () => {
    const html = renderPanel([{
      id: 'e-tok',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'malformed-token',
      message: 'Filtered 3 of 420 transcript token(s) with unusable timestamps before alignment.',
      skippedTokenCount: 3,
      totalTokenCount: 420,
    }]);

    expect(html).toContain('TOKENS');
    expect(html).toContain('Filtered 3 of 420');
    expect(html).toContain('3 of 420 tokens had invalid timestamps');
    expect(html).toContain('text-blue-400');
  });

  it('renders a silence-error entry that has no errorMessage without crashing', () => {
    const html = renderPanel([{
      id: 'e-sil2',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'silence-error',
      message: 'Silence detection failed.',
    }]);

    expect(html).toContain('SILENCE');
    expect(html).not.toContain('reason:');
    expect(html).not.toContain('undefined');
  });

  it('renders a malformed-token entry missing its counts without printing undefined', () => {
    const html = renderPanel([{
      id: 'e-tok2',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'malformed-token',
      message: 'Filtered some tokens.',
    }]);

    expect(html).toContain('TOKENS');
    expect(html).toContain('Filtered some tokens.');
    expect(html).not.toContain('undefined');
  });

  // 'fa-fallback' is retired (operator ruling): it is no longer in the type
  // union and old persisted entries are filtered on load — see
  // SyncLogPanel.userView.test.tsx's old-project test. 'fa-paused' is what
  // runs emit, and its backend error must still reach the raw view.
  it('renders an fa-paused entry with its verbatim backend error and fix hint', () => {
    const html = renderPanel([{
      id: 'e-fa-paused',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'fa-paused',
      message: 'High-precision sync paused — the alignment engine reported an error. Waiting for you to choose how to proceed.',
      owningRule: 'FA',
      reason: 'inference-failed',
      severity: 'warning',
      errorMessage: 'failed to initialize onnxruntime: ORT_DYLIB_PATH not set',
      fixHint: 'Try again. If it keeps happening, continue with Whisper timing for this run.',
    }]);

    expect(html).toContain('FA PAUSED');
    expect(html).toContain('Waiting for you to choose');
    expect(html).toContain('error: failed to initialize onnxruntime: ORT_DYLIB_PATH not set');
    expect(html).toContain('Try again');
    expect(html).not.toContain('undefined');
  });

  it('renders an fa-paused entry with no errorMessage without printing undefined', () => {
    const html = renderPanel([{
      id: 'e-fa-paused-2',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'fa-paused',
      message: 'High-precision sync paused — the chunk plan came out empty. Waiting for you to choose how to proceed.',
      owningRule: 'FA',
      reason: 'empty-chunk-plan',
      severity: 'warning',
      fixHint: 'Check that the scene document has text for at least one scene, then try again.',
    }]);

    expect(html).toContain('FA PAUSED');
    expect(html).not.toContain('error:');
    expect(html).toContain('Check that the scene document has text');
    expect(html).not.toContain('undefined');
  });

  it('still renders pre-WS4 entry kinds unchanged', () => {
    const html = renderPanel([
      { id: 'a', timestamp: AT, syncRunId: 'run-1', type: 'info', message: 'Sync completed: 8 of 8 segments matched.' },
      { id: 'b', timestamp: AT, syncRunId: 'run-1', type: 'abort', message: 'Inputs do not correspond.' },
    ]);

    expect(html).toContain('INFO');
    expect(html).toContain('ABORT');
    expect(html).toContain('Sync completed: 8 of 8 segments matched.');
    expect(html).not.toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// WS2 Step 12 (A3) — Manage Models & Add-ons deep-link from a model-missing
// fa-preflight entry.
// ---------------------------------------------------------------------------

describe('SyncLogPanel — models-modal deep-link', () => {
  function makePreflightEntry(errorMessage: string): SyncLogEntry {
    return {
      id: 'e-preflight',
      timestamp: AT,
      syncRunId: 'run-1',
      type: 'fa-preflight',
      message: 'High-precision sync is not ready for this run.',
      errorMessage,
      fixHint: 'Install the alignment model for this language, then run Apply Sync again.',
    };
  }

  it('renders a "Manage models & add-ons" link when the detail names a missing FA model and a handler is given', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makePreflightEntry('No FA model found for language "es". Tried: /a, /b.')]}
        onOpenModelsModal={() => {}}
      />,
    );
    expect(html).toContain('Manage models');
  });

  it('omits the link when no onOpenModelsModal handler is passed', () => {
    const html = renderPanel([makePreflightEntry('No FA model found for language "es". Tried: /a, /b.')]);
    expect(html).not.toContain('Manage models');
  });

  it('omits the link when the detail is not about a missing model', () => {
    const html = renderToStaticMarkup(
      <SyncLogRawEntries
        entries={[makePreflightEntry('failed to initialize onnxruntime: ORT_DYLIB_PATH not set')]}
        onOpenModelsModal={() => {}}
      />,
    );
    expect(html).not.toContain('Manage models');
  });
});

// ---------------------------------------------------------------------------
// Log-grouping feature (2026-08-03) — grouped entries (groupedItems set)
// ---------------------------------------------------------------------------

function makeGroupedEntry(partial: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'e-grouped',
    timestamp: AT,
    syncRunId: 'run-1',
    type: 'warning',
    message: '4 scenes matched fewer than 60% of their words.',
    severity: 'warning',
    fixHint: "Some of this scene's words may have been matched into a neighboring scene — check its cut points and its neighbors' on the timeline.",
    groupedItems: [
      { message: 'Segment 1 ("Small and permanent.") matched only 1 of 3 words (33%).' },
      { message: 'Segment 5 ("A wide shot.") matched only 1 of 3 words (33%).' },
      { message: 'Segment 9 ("Cut to black.") matched only 1 of 3 words (33%).' },
      { message: 'Segment 12 ("The end.") matched only 1 of 2 words (50%).' },
    ],
    ...partial,
  };
}

describe('SyncLogPanel — grouped entries', () => {
  it('renders the collapsed one-line summary by default', () => {
    const html = renderPanel([makeGroupedEntry()]);
    expect(html).toContain('4 scenes matched fewer than 60% of their words.');
    expect(html).toContain('WARN');
  });

  it('does not render per-item detail before the user expands it (collapsed by default)', () => {
    const html = renderPanel([makeGroupedEntry()]);
    // Static markup can't simulate the click that would expand it — this
    // pins the actual first-render (collapsed) state a real user sees.
    expect(html).not.toContain('Small and permanent');
  });

  it('exposes an expand affordance (aria-expanded) for a grouped entry', () => {
    const html = renderPanel([makeGroupedEntry()]);
    expect(html).toContain('aria-expanded="false"');
  });

  it('does not treat a single non-grouped entry as grouped (no expand affordance)', () => {
    const html = renderPanel([{
      id: 'e-plain', timestamp: AT, syncRunId: 'run-1', type: 'warning',
      message: 'A single plain warning.', severity: 'warning', fixHint: 'do something',
    }]);
    expect(html).toContain('A single plain warning.');
    // G5's group-header toggle legitimately carries its own aria-expanded —
    // this checks for the per-ENTRY grouped-item expand button specifically,
    // identified by its distinct className (renderEntry's `isGrouped` arm).
    expect(html).not.toContain('flex items-start gap-1 mt-1 text-left');
  });

  it('renders normally and does not crash when groupedItems is an empty array', () => {
    const html = renderPanel([makeGroupedEntry({ groupedItems: [] })]);
    expect(html).toContain('4 scenes matched fewer than 60% of their words.');
    // treated as non-grouped (isGrouped requires length > 0) — no per-entry
    // expand button around the message; the group-header toggle above it
    // legitimately has its own aria-expanded (G5).
    expect(html).not.toContain('flex items-start gap-1 mt-1 text-left');
  });
});

describe('formatEntryText — Copy button export (grouped entries)', () => {
  it('includes the summary line AND every item for a grouped entry', () => {
    const text = formatEntryText(makeGroupedEntry());
    expect(text).toContain('4 scenes matched fewer than 60% of their words.');
    expect(text).toContain('Segment 1 ("Small and permanent.") matched only 1 of 3 words (33%).');
    expect(text).toContain('Segment 5 ("A wide shot.") matched only 1 of 3 words (33%).');
    expect(text).toContain('Segment 9 ("Cut to black.") matched only 1 of 3 words (33%).');
    expect(text).toContain('Segment 12 ("The end.") matched only 1 of 2 words (50%).');
  });

  it('exports exactly one line per item, in order, alongside the summary line', () => {
    const text = formatEntryText(makeGroupedEntry());
    const lines = text.split('\n');
    // header+summary line, then 4 item lines.
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('Segment 1');
    expect(lines[4]).toContain('Segment 12');
  });

  it('is unaffected for a non-grouped entry (no groupedItems)', () => {
    const text = formatEntryText({
      id: 'e-plain', timestamp: AT, syncRunId: 'run-1', type: 'info',
      message: 'Sync completed: 8 of 8 segments matched.',
    });
    expect(text).not.toContain('  - ');
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 5 — honest numbering ("S{n} / Clip {n}") and the
// longestRun hole-bridging annotation, as actually rendered by the panel
// (not just the message string App.tsx built — SyncLogPanel reconstructs its
// own skip-line text from segmentIndex/absorbedByDisplayIndex/reason, so the
// live render needs its own coverage independent of syncLog.test.ts).
// ---------------------------------------------------------------------------
describe('SyncLogPanel — S/Clip numbering and longestRun annotation', () => {
  it('renders "S{n} / Clip {n}" for a skip with an absorbing host', () => {
    const html = renderPanel([makeSkipEntry({
      segmentIndex: 111,
      absorbedByDisplayIndex: 109,
      reason: 'no text match',
    })]);
    expect(html).toContain('S112 / Clip 110: Unmatched scene');
    expect(html).not.toContain('Segment 112');
  });

  it('renders plain "S{n}" with no Clip suffix when there is no absorbing host', () => {
    const html = renderPanel([makeSkipEntry({ segmentIndex: 2, absorbedByDisplayIndex: undefined })]);
    expect(html).toContain('S3: Unmatched scene');
    expect(html).not.toContain('Clip');
  });

  it('annotates longestRun when it exceeds matchedWords — the hole-bridging note', () => {
    const html = renderPanel([makeSkipEntry({
      segmentIndex: 0, matchedWords: 7, totalWords: 9, confidence: 0.778, longestRun: 9,
    })]);
    expect(html).toContain('longest run 9');
    expect(html).toContain('bridged holes');
  });

  it('does not annotate longestRun when it does not exceed matchedWords', () => {
    const html = renderPanel([makeSkipEntry({
      segmentIndex: 0, matchedWords: 4, totalWords: 4, confidence: 1, longestRun: 4,
    })]);
    expect(html).toContain('longest run 4');
    expect(html).not.toContain('bridged holes');
  });

  it('falls back to "no text match" (not the old wording) when reason is missing', () => {
    const html = renderPanel([makeSkipEntry({ reason: undefined, matchedWords: undefined, totalWords: undefined, confidence: undefined })]);
    expect(html).toContain('no text match');
    expect(html).not.toContain('no audio match');
  });
});
