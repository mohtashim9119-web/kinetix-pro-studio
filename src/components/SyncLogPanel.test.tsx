// WS-logs skip detail — 3-line skip-entry rendering (tag + match-count).
// Same static-markup pattern as SyncLoadingOverlay.test.tsx: no DOM/testing-
// library dependency, just render-to-string and assert on the HTML.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncLogPanel } from './SyncLogPanel';
import type { SyncLogEntry } from '../types';

const AT = 1_700_000_000_000;

function makeSkipEntry(partial: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'e1',
    timestamp: AT,
    syncRunId: 'run-1',
    type: 'skip',
    message: 'Scene 135 skipped — no audio match.',
    segmentIndex: 134,
    segmentText: 'This is a test missing segment.',
    reason: 'no audio match',
    ...partial,
  };
}

describe('SyncLogPanel — skip entry 3-line format', () => {
  it('renders "Segment N skipped — reason", "[tag] text" and the match-count line', () => {
    const html = renderToStaticMarkup(
      <SyncLogPanel
        syncLog={[makeSkipEntry({ segmentTag: 'missing1', matchedWords: 2, totalWords: 8, confidence: 0.25 })]}
        onClearLog={() => {}}
      />,
    );
    expect(html).toContain('Segment 135 skipped — no audio match');
    expect(html).toContain('[missing1]');
    expect(html).toContain('This is a test missing segment.');
    expect(html).toContain('matched 2 of 8 words (confidence 0.25)');
  });

  it('omits the bracket prefix when segmentTag is empty/missing', () => {
    const html = renderToStaticMarkup(
      <SyncLogPanel
        syncLog={[makeSkipEntry({ segmentTag: undefined, matchedWords: 0, totalWords: 5, confidence: 0 })]}
        onClearLog={() => {}}
      />,
    );
    expect(html).not.toContain('[undefined]');
    expect(html).not.toContain('[]');
    expect(html).toContain('This is a test missing segment.');
  });

  it('renders "matched 0 of 0 words (no content to match)" when totalWords is 0', () => {
    const html = renderToStaticMarkup(
      <SyncLogPanel
        syncLog={[makeSkipEntry({ matchedWords: 0, totalWords: 0, confidence: 0 })]}
        onClearLog={() => {}}
      />,
    );
    expect(html).toContain('matched 0 of 0 words (no content to match)');
  });

  it('omits the match-count line entirely for an old entry missing the new fields (backward compat)', () => {
    const html = renderToStaticMarkup(
      <SyncLogPanel
        syncLog={[makeSkipEntry({ segmentTag: undefined, matchedWords: undefined, totalWords: undefined, confidence: undefined })]}
        onClearLog={() => {}}
      />,
    );
    expect(html).not.toContain('matched');
    expect(html).not.toContain('confidence');
    // The rest of the entry still renders without crashing.
    expect(html).toContain('Segment 135 skipped — no audio match');
    expect(html).toContain('This is a test missing segment.');
  });

  it('does not crash and renders normally for a non-skip entry', () => {
    const html = renderToStaticMarkup(
      <SyncLogPanel
        syncLog={[{
          id: 'e2', timestamp: AT, syncRunId: 'run-1', type: 'info',
          message: 'Sync completed: 8 of 8 segments matched.',
        }]}
        onClearLog={() => {}}
      />,
    );
    expect(html).toContain('Sync completed: 8 of 8 segments matched.');
  });
});
