// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Sync-log user view (operator ruling, supersedes the six-group UI for the
// user surface). Every log below is composed from the REAL builders the
// pipeline itself calls (App.tsx's skip/info/abort/no-asset builders,
// syncLog.ts's rule/FA/lock builders, syncWpmGate.ts, and the real
// word-coverage / scene-density validators feeding buildGroupedViolationEntry)
// — no hand-typed entry shapes, so a builder's wording or field change that
// would break the classifier breaks these tests too.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SyncLogPanel } from './SyncLogPanel';
import type { SyncLogEntry, SyncRunSummary, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';
import {
  buildSkipLogEntries,
  buildSyncInfoEntry,
  buildSyncAbortEntry,
  buildNoAssetSummaryEntry,
  buildRescueLogEntries,
  buildLockNotRestoredLogEntries,
} from '../App';
import {
  buildSyncEngineEntry,
  buildLockFindingLogEntries,
  buildSeamFitLogEntries,
  buildMalformedTokenEntry,
  buildGroupedViolationEntry,
  buildFaPreflightEntry,
  buildMediaImportEntry,
  buildFaVictimRetimedLogEntry,
  buildWhisperModelFailureEntry,
  buildUnsupportedLanguageEntry,
  buildLockRefusedLogEntry,
  buildFaPausedEntry,
  buildFaGateClosedEntry,
  buildFaUserChoseWhisperEntry,
  buildSilenceErrorEntry,
  buildCtcInfeasibleLogEntry,
  buildLocalCoverageWarningEntry,
} from '../services/syncLog';
import { buildSyncLogUserView, attentionKindForEntry, resolveAttentionItemSegmentId, ATTENTION_ORDER, type AttentionKind } from '../services/syncLogUserView';
import { buildWpmCheckLogEntry } from '../services/syncWpmGate';
import { validateWordCoverage, validateSceneDensity } from '../services/syncContracts';
import type { SegmentAlignment } from '../services/whisperService';
import type { SeamFitFinding } from '../services/faSeamFitGate';
import type { SkippedScenePlaceholder } from '../services/skippedScenePlaceholders';

const RUN = 'run-latest';
const AT = 1_700_000_000_000;

function seg(i: number, text: string, duration = 1): VideoSegment {
  return {
    id: `seg-${i}`, order: i, text, startTime: i, duration,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
  };
}

function alignWords(matchedWords: number, totalWords: number): SegmentAlignment {
  return {
    t0: 0, t1: 0, firstTokenIdx: 0, lastTokenIdx: 0,
    confidence: totalWords > 0 ? matchedWords / totalWords : 0,
    matched: true, matchedWords, totalWords, longestRun: Math.min(matchedWords, 1),
  };
}

function seamFinding(i: number): SeamFitFinding {
  return {
    segmentIndex: i, segmentId: `seg-${i}`, committedValue: i, correctedValue: i + 0.2, delta: 0.2,
    chunkIndex: 0, chunkStartSec: 0, chunkEndSec: 10, fit: 1.5, fitDeviation: 1.5,
    spanMaxConfidence: 0.001, edge: 'start',
  };
}

function summary(partial: Partial<SyncRunSummary> = {}): SyncRunSummary {
  return {
    syncRunId: RUN, timestamp: AT, totalSegments: 20, coveredSegments: 20,
    skippedSegments: 0, aborted: false, ...partial,
  };
}

/** A degraded FA run: 3 skips (2 kept as Estimated placeholders), weak
 *  matches, dense scenes, victims re-timed, plus ~30 adjustments/locks/
 *  tokens/rescues/preflight/imports that have NO attention role. Exactly 50. */
function buildFiftyEntryLog(): SyncLogEntry[] {
  const committed = Array.from({ length: 20 }, (_, i) => seg(i, `scene ${i} text words here`));
  const skipRecords = [3, 7, 11].map(i => ({
    segmentIndex: i, segmentText: `dropped scene ${i}`, reason: 'no text match' as const,
    segmentTag: `tag${i}`, matchedWords: 0, totalWords: 5, confidence: 0,
  }));
  const placeholders = new Map<number, SkippedScenePlaceholder>([3, 7].map(i => [i, {
    segmentIndex: i, segmentId: `ph-${i}`, slotStartSec: i, slotEndSec: i + 0.5, estimatedWordCount: 4,
  }]));
  const weak = validateWordCoverage(
    [seg(1, 'one two three four five six'), seg(2, 'one two three four five six')],
    [alignWords(1, 6), alignWords(2, 6)],
  );
  const dense = validateSceneDensity([seg(4, 'many words', 0.5)], [alignWords(40, 40)]);
  const log: SyncLogEntry[] = [
    buildFaPreflightEntry(RUN, { ready: true, summary: 'Forced alignment ready (en).' }, AT),
    buildSyncEngineEntry(RUN, 'forced-alignment', 812, AT),
    buildMalformedTokenEntry(RUN, 2, 900, AT),
    ...buildSkipLogEntries(RUN, skipRecords, AT, undefined, placeholders),
    ...buildRescueLogEntries(RUN, [4, 5, 6].map(i => ({
      segmentIndex: i, recoveredVia: 'windowed' as const, recoveredRegion: { startSec: i, endSec: i + 1 },
    })), AT),
    buildGroupedViolationEntry(RUN, weak, AT)!,
    buildGroupedViolationEntry(RUN, dense, AT)!,
    buildFaVictimRetimedLogEntry(RUN, [
      { segmentIndex: 8, segmentId: 'seg-8', segmentTag: 'victim8', trustedStartSec: 8, trustedEndSec: 9, estimatedWordCount: 5 },
      { segmentIndex: 9, segmentId: 'seg-9', segmentTag: 'victim9', trustedStartSec: 9, trustedEndSec: 10, estimatedWordCount: 3 },
    ], AT)!,
    ...buildSeamFitLogEntries(RUN, Array.from({ length: 18 }, (_, i) => seamFinding(i)), committed, AT),
    ...buildLockFindingLogEntries(RUN, Array.from({ length: 8 }, (_, i) => ({
      kind: 'lock-preserved-adjustment' as const, segmentId: `seg-${i}`, segmentIndex: i, amountSec: 0.1,
    })), AT),
    buildMediaImportEntry('import-1', 'files', { imported: 4, deduped: 0, unsupportedSkipped: 0, failed: 0 }, AT),
    buildMediaImportEntry('import-2', 'zip', { imported: 2, deduped: 1, unsupportedSkipped: 0, failed: 0 }, AT),
    buildSyncInfoEntry(RUN, 20, 17, 3, AT),
  ];
  // Pad to exactly 50 with more rule corrections (the real high-volume type).
  const pad = buildSeamFitLogEntries(RUN, Array.from({ length: 50 - log.length }, (_, i) => seamFinding(i)), committed, AT);
  return [...log, ...pad];
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

function mount(syncLog: SyncLogEntry[], syncRunSummaries?: SyncRunSummary[], offlineAssetNames?: string[]): void {
  root = createRoot(container);
  act(() => {
    root.render(
      <SyncLogPanel
        syncLog={syncLog}
        syncRunSummaries={syncRunSummaries}
        offlineAssetNames={offlineAssetNames}
        onClearLog={() => {}}
      />,
    );
  });
}

/** Every row the user sees without clicking anything: raw entry cards,
 *  attention lines and the details line. The old UI rendered one card per
 *  entry — this is the number the budget caps. */
function visibleRows(): { rawCards: number; attention: number; details: number } {
  return {
    rawCards: container.querySelectorAll('[data-testid="sync-log-raw-entry"]').length,
    attention: container.querySelectorAll('[data-testid="sync-attention-line"]').length,
    details: container.querySelectorAll('[data-testid="sync-details-line"]').length,
  };
}

function click(el: Element | null | undefined): void {
  expect(el).toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('SyncLogPanel user view — the budget', () => {
  it('a 50-entry log renders AT MOST 10 attention lines + 1 details line, and no raw cards', () => {
    const log = buildFiftyEntryLog();
    expect(log).toHaveLength(50);
    mount(log, [summary({ coveredSegments: 17, skippedSegments: 3 })]);
    const rows = visibleRows();
    expect(rows.rawCards).toBe(0);
    expect(rows.attention).toBeLessThanOrEqual(10);
    expect(rows.details).toBe(1);
    expect(rows.rawCards + rows.attention + rows.details).toBeLessThanOrEqual(11);
  });
});

// ---------------------------------------------------------------------------
// Healthy run — nothing but the headline, the calm line and one grey line.
// ---------------------------------------------------------------------------
function buildHealthyLog(): SyncLogEntry[] {
  const committed = Array.from({ length: 5 }, (_, i) => seg(i, `scene ${i}`));
  return [
    buildFaPreflightEntry(RUN, { ready: true, summary: 'Forced alignment ready (en).' }, AT),
    buildSyncEngineEntry(RUN, 'forced-alignment', 300, AT),
    ...buildSeamFitLogEntries(RUN, [seamFinding(1), seamFinding(2)], committed, AT),
    buildSyncInfoEntry(RUN, 5, 5, 0, AT),
  ];
}

describe('SyncLogPanel user view — healthy run', () => {
  it('renders 0 attention lines, the green all-clear status, and one collapsed details line', () => {
    mount(buildHealthyLog(), [summary({ totalSegments: 5, coveredSegments: 5 })]);
    const rows = visibleRows();
    expect(rows.attention).toBe(0);
    expect(rows.rawCards).toBe(0);
    expect(rows.details).toBe(1);
    const status = container.querySelector('[data-testid="sync-status"]');
    expect(status?.getAttribute('data-state')).toBe('clear');
    expect(status?.textContent).toBe('Everything is running smoothly.');
    expect(container.querySelector('[data-testid="sync-headline"]')).toBeNull(); // summary lives inside Details
    const detailsButton = container.querySelector('[data-testid="sync-details-line"] button');
    expect(detailsButton?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="sync-details-line"]')?.textContent)
      .toBe('Details (5 events) · 2 adjustments · 1 preflight · 2 engine notes');
    click(detailsButton);
    expect(container.querySelector('[data-testid="sync-headline"]')?.textContent)
      .toMatch(/^Forced alignment · 5\/5 scenes matched · 0 placeholders · 0 estimated · \d\d:\d\d:\d\d$/);
  });
});

// ---------------------------------------------------------------------------
// Honesty pin — a degraded run is never shown green by the app: it opens red
// and only turns green on the user's own dismissal (user ruling wins); a new
// degraded run opens red again. The run summary (inside Details) still
// carries its placeholder and estimated counts.
// ---------------------------------------------------------------------------
describe('SyncLogPanel user view — honesty pin', () => {
  it('a degraded run opens red; green only after the user dismisses every item; red again on a new degraded run', () => {
    const log = buildFiftyEntryLog();
    const run1 = summary({ coveredSegments: 17, skippedSegments: 3 });
    mount(log, [run1]);
    const status = (): Element | null => container.querySelector('[data-testid="sync-status"]');
    expect(status()?.getAttribute('data-state')).toBe('attention');
    const n = container.querySelectorAll('[data-testid="sync-attention-line"]').length;
    expect(status()?.textContent).toBe(`${n} items need your attention`);
    while (container.querySelector('[data-testid="sync-attention-dismiss"]')) {
      click(container.querySelector('[data-testid="sync-attention-dismiss"]'));
    }
    expect(status()?.getAttribute('data-state')).toBe('clear');

    act(() => root.unmount());
    const run2 = log.map(e => ({ ...e, id: `${e.id}-r2`, timestamp: AT + 60_000 }));
    mount([...log, ...run2], [run1, summary({ timestamp: AT + 60_000, coveredSegments: 17, skippedSegments: 3 })]);
    expect(status()?.getAttribute('data-state')).toBe('attention');
  });

  it("the degraded run's summary (inside Details) carries placeholder + estimated counts", () => {
    mount(buildFiftyEntryLog(), [summary({ coveredSegments: 17, skippedSegments: 3 })]);
    click(container.querySelector('[data-testid="sync-details-line"] button'));
    const headline = container.querySelector('[data-testid="sync-headline"]')?.textContent ?? '';
    expect(headline).toContain('Forced alignment');
    expect(headline).toContain('17/20 scenes matched');
    expect(headline).toContain('2 placeholders'); // skips 3 and 7 kept a slot; 11 did not
    expect(headline).toContain('2 estimated'); // the two re-timed victims
  });

  it('a character-timing fallback run reads as fully estimated, never clean', () => {
    const view = buildSyncLogUserView([
      { ...buildSyncInfoEntry(RUN, 6, 6, 0, AT), type: 'warning',
        message: 'Sync completed on character-based timing — no cached transcript was available for the voiceover. 6 segment(s) placed.' },
    ]);
    expect(view.headline.engine).toBe('character');
    expect(view.headline.estimated).toBe(6);
    expect(view.attention.map(l => l.kind)).toEqual(['estimated-timings']);
  });
});

// ---------------------------------------------------------------------------
// Old project — persisted 'fa-fallback' entries (pre-Wave-1) load through
// the REAL loader and the panel renders without them.
// ---------------------------------------------------------------------------
describe('SyncLogPanel user view — old project with fa-fallback entries', () => {
  it('renders, filtering the retired type, when handed a legacy log directly', () => {
    const legacy = {
      ...buildSyncEngineEntry(RUN, 'whisper', 10, AT),
      id: 'legacy-fa', type: 'fa-fallback',
      message: 'High-precision sync was ON but did not run. This run used Whisper timing instead.',
    } as unknown as SyncLogEntry;
    mount([legacy, buildSyncInfoEntry(RUN, 3, 3, 0, AT)]);
    expect(container.textContent).not.toContain('did not run');
    expect(container.textContent).toContain('Details (1 event)');
    click(container.querySelector('[data-testid="sync-details-line"] button'));
    click(container.querySelector('[data-category="engine"] button'));
    expect(container.textContent).not.toContain('FA FALLBACK');
    expect(container.textContent).toContain('Sync completed: 3 of 3 segments matched.');
  });
});

// ---------------------------------------------------------------------------
// Raw details — every type still renders with its badge, one level down.
// ---------------------------------------------------------------------------
function buildEveryTypeLog(): SyncLogEntry[] {
  const committed = Array.from({ length: 4 }, (_, i) => seg(i, `scene ${i}`));
  return [
    ...buildSkipLogEntries(RUN, [{ segmentIndex: 1, segmentText: 'gone', reason: 'no text match' }], AT),
    buildSyncAbortEntry(RUN, 'Sync aborted: no voiceover transcript.', AT),
    buildWpmCheckLogEntry(RUN, 1000, 60, AT)!,
    buildSyncInfoEntry(RUN, 4, 3, 1, AT),
    buildSilenceErrorEntry(RUN, 'ffmpeg exited 1', AT),
    buildMalformedTokenEntry(RUN, 1, 50, AT),
    buildNoAssetSummaryEntry(RUN, [2, 3], 4, 2, AT)!,
    ...buildRescueLogEntries(RUN, [{ segmentIndex: 0, recoveredVia: 'global', recoveredRegion: { startSec: 0, endSec: 1 } }], AT),
    buildUnsupportedLanguageEntry(RUN, 'ja', AT),
    ...buildLockFindingLogEntries(RUN, [
      { kind: 'lock-span-overflow', segmentId: 'seg-0', segmentIndex: 0, amountSec: 0.4 },
      { kind: 'lock-preserved-adjustment', segmentId: 'seg-1', segmentIndex: 1, amountSec: 0.1 },
    ], AT),
    buildLockRefusedLogEntry(RUN, 2, 3, 0.5, AT),
    ...buildLockNotRestoredLogEntries(RUN, [{ reason: 'out-of-bounds', oldText: 'old', segmentIndex: 1 }], AT),
    ...buildSeamFitLogEntries(RUN, [seamFinding(1)], committed, AT),
    buildFaPausedEntry(RUN, 'inference-failed', 'ORT error', AT),
    buildFaPreflightEntry(RUN, { ready: true, summary: 'Forced alignment ready (en).' }, AT),
    buildFaGateClosedEntry(RUN, AT),
    buildWhisperModelFailureEntry(RUN, 'model-not-found', AT),
    buildMediaImportEntry('import-1', 'files', { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 }, AT),
  ];
}

const EVERY_BADGE = [
  'SKIP', 'ABORT', 'WARN', 'INFO', 'SILENCE', 'TOKENS', 'NO ASSET', 'RESCUE', 'LANGUAGE',
  'LOCK OVERFLOW', 'LOCK', 'LOCK REFUSED', 'LOCK NOT RESTORED', 'RULE', 'FA PAUSED',
  'FA PRE-FLIGHT', 'FA OFF', 'WHISPER MODEL', 'MEDIA',
];

describe('SyncLogPanel user view — raw details view', () => {
  it('covers all 19 entry types', () => {
    expect(new Set(buildEveryTypeLog().map(e => e.type)).size).toBe(19);
  });

  it('Details expands to counts, then each count to its raw entries with their badges', () => {
    const log = buildEveryTypeLog();
    mount(log);
    const badgesBefore = [...container.querySelectorAll('.uppercase.rounded.border')].length;
    expect(badgesBefore).toBe(0); // badge zoo stays out of the default view

    click(container.querySelector('[data-testid="sync-details-line"] button'));
    const counts = [...container.querySelectorAll('[data-testid="sync-details-count"]')];
    expect(counts.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-testid="sync-log-raw-entry"]').length).toBe(0); // counts only, no raw yet

    for (const c of counts) click(c.querySelector('button'));
    expect(container.querySelectorAll('[data-testid="sync-log-raw-entry"]').length).toBe(log.length);
    const badges = new Set([...container.querySelectorAll('.uppercase.rounded.border')].map(b => b.textContent));
    for (const badge of EVERY_BADGE) expect(badges, badge).toContain(badge);
  });

  it('open sections persist for the session (sessionStorage) across a remount', () => {
    mount(buildHealthyLog());
    click(container.querySelector('[data-testid="sync-details-line"] button'));
    expect(JSON.parse(sessionStorage.getItem('kx-sync-log-open-sections') ?? '[]')).toEqual(['details']);
    act(() => root.unmount());
    mount(buildHealthyLog());
    expect(container.querySelectorAll('[data-testid="sync-details-count"]').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Kind mapping — each of the ten kinds lands from its real trigger.
// ---------------------------------------------------------------------------
const TRIGGERS: Record<AttentionKind, () => SyncLogEntry[]> = {
  'unmatched-scene': () => buildSkipLogEntries(RUN, [{ segmentIndex: 4, segmentText: 'planted', reason: 'no text match', segmentTag: 'planted' }], AT),
  'estimated-timings': () => [buildCtcInfeasibleLogEntry(RUN, [], [{ chunkIndex: 0, startSec: 1, endSec: 2, wordCount: 3 }], AT)!],
  'weak-match': () => [buildGroupedViolationEntry(RUN, validateWordCoverage([seg(0, 'a b c d e f')], [alignWords(1, 6)]), AT)!],
  'too-dense': () => [buildGroupedViolationEntry(RUN, validateSceneDensity([seg(0, 'x', 0.5)], [alignWords(40, 40)]), AT)!],
  'script-audio-mismatch': () => [buildWpmCheckLogEntry(RUN, 1000, 60, AT)!],
  'no-media': () => [buildNoAssetSummaryEntry(RUN, [2, 3, 4], 5, 2, AT)!],
  'offline-media': () => [],
  'model-missing': () => [buildWhisperModelFailureEntry(RUN, 'model-hash-mismatch', AT)],
  'language-pack-missing': () => [buildUnsupportedLanguageEntry(RUN, 'ja', AT)],
  'sync-incomplete': () => [buildSyncAbortEntry(RUN, 'Sync aborted: voiceover required.', AT)],
};

describe('SyncLogPanel user view — kind mapping', () => {
  it.each(ATTENTION_ORDER.map(k => [k]))('%s lands as exactly its own line', (kind) => {
    const offline = kind === 'offline-media' ? ['broll.mp4'] : [];
    const view = buildSyncLogUserView(TRIGGERS[kind](), [], offline);
    expect(view.attention.map(l => l.kind)).toEqual([kind]);
  });

  it('a log with every trigger renders all ten lines, in order, red/amber only', () => {
    const log = ATTENTION_ORDER.flatMap(k => TRIGGERS[k]());
    mount(log, undefined, ['broll.mp4']);
    const lines = [...container.querySelectorAll('[data-testid="sync-attention-line"]')];
    expect(lines.map(l => l.getAttribute('data-kind'))).toEqual([...ATTENTION_ORDER]);
    expect(lines.map(l => l.getAttribute('data-tone'))).toEqual([
      'red', 'amber', 'amber', 'amber', 'red', 'amber', 'red', 'red', 'red', 'red',
    ]);
    expect(lines[0]!.textContent).toBe('1 scene not found in the voiceover');
    expect(lines[5]!.textContent).toBe('3 scenes have no media');
  });

  it('scenes expand inside their line', () => {
    mount(TRIGGERS['unmatched-scene']());
    const line = container.querySelector('[data-kind="unmatched-scene"]')!;
    expect(line.textContent).not.toContain('[planted]');
    click(line.querySelector('button'));
    expect(line.textContent).toContain('S5: [planted] planted');
  });

  it('the other FA-degradation triggers map to estimated timings too', () => {
    expect(attentionKindForEntry(buildFaVictimRetimedLogEntry(RUN, [
      { segmentIndex: 1, segmentId: 's1', trustedStartSec: 0, trustedEndSec: 1, estimatedWordCount: 2 },
    ], AT)!)).toBe('estimated-timings');
    expect(attentionKindForEntry(buildFaUserChoseWhisperEntry(RUN, 'inference-failed', AT))).toBe('estimated-timings');
    expect(attentionKindForEntry(buildFaGateClosedEntry(RUN, AT))).toBeUndefined();
    expect(attentionKindForEntry(buildLocalCoverageWarningEntry(RUN, { coverage: 0.3, scriptWordCount: 100 }, AT)))
      .toBe('script-audio-mismatch');
  });

  it('an FA pause maps by reason; once answered (a later run) it drops to details', () => {
    const paused = buildFaPausedEntry('run-paused', 'model-not-found', undefined, AT);
    expect(attentionKindForEntry(paused)).toBe('model-missing');
    expect(attentionKindForEntry(buildFaPausedEntry(RUN, 'unsupported-language', undefined, AT))).toBe('language-pack-missing');
    expect(attentionKindForEntry(buildFaPausedEntry(RUN, 'zero-words', undefined, AT))).toBe('sync-incomplete');

    const pausedSummary = summary({ syncRunId: 'run-paused', coveredSegments: 0, aborted: true, abortReason: 'fa-paused' });
    expect(buildSyncLogUserView([paused], [pausedSummary]).attention.map(l => l.kind)).toEqual(['model-missing']);

    const later = buildHealthyLog().map(e => ({ ...e, timestamp: AT + 60_000 }));
    const view = buildSyncLogUserView([paused, ...later], [pausedSummary, summary({ timestamp: AT + 60_000, totalSegments: 5, coveredSegments: 5 })]);
    expect(view.attention).toEqual([]);
    expect(view.details.counts.find(c => c.category === 'engine')?.entries).toContain(paused);
  });

  it('attention is scoped to the latest run — an earlier run\'s skips do not linger', () => {
    const old = TRIGGERS['unmatched-scene']().map(e => ({ ...e, syncRunId: 'run-old' }));
    const later = buildHealthyLog().map(e => ({ ...e, timestamp: AT + 60_000 }));
    const view = buildSyncLogUserView([...old, ...later], [
      summary({ syncRunId: 'run-old', coveredSegments: 19, skippedSegments: 1 }),
      summary({ timestamp: AT + 60_000, totalSegments: 5, coveredSegments: 5 }),
    ]);
    expect(view.attention).toEqual([]);
    expect(view.details.total).toBe(old.length + later.length);
  });
});

// ---------------------------------------------------------------------------
// Operator feedback round 1 — plain title, click-to-jump items, dismiss.
// ---------------------------------------------------------------------------
describe('SyncLogPanel user view — title, jump, dismiss', () => {
  function mountWith(log: SyncLogEntry[], segments: VideoSegment[], onSeek: (id: string) => void, summaries?: SyncRunSummary[]): void {
    root = createRoot(container);
    act(() => {
      root.render(
        <SyncLogPanel syncLog={log} syncRunSummaries={summaries} segments={segments} onSeekToSegment={onSeek} onClearLog={() => {}} />,
      );
    });
  }

  it('the section title carries no count', () => {
    mount(buildFiftyEntryLog());
    const title = [...container.querySelectorAll('span')].find(el => el.textContent?.startsWith('Sync Log'));
    expect(title?.textContent).toBe('Sync Log');
  });

  it('a grouped per-scene finding jumps to that scene on click', () => {
    const timeline = [seg(0, 'intro line'), seg(1, 'y 12 patas debajo de su cuerpo.', 0.5), seg(2, 'outro')];
    const dense = validateSceneDensity(timeline, [alignWords(1, 1), alignWords(40, 40), alignWords(1, 1)]);
    const seeks: string[] = [];
    mountWith([buildGroupedViolationEntry(RUN, dense, AT)!], timeline, id => seeks.push(id));
    const line = container.querySelector('[data-kind="too-dense"]')!;
    click(line.querySelector('button'));
    const item = line.querySelector('button[data-testid="sync-attention-item"]');
    click(item);
    expect(seeks).toEqual(['seg-1']);
  });

  it('resolves by text when the validator index has drifted (placeholder re-inserted)', () => {
    const live = [seg(0, 'intro line'), { ...seg(1, 'placeholder'), id: 'ph' }, { ...seg(2, 'the dense scene text'), id: 'dense' }];
    const item = { text: 'x', sceneRef: { index: 1, name: 'the dense scene…' } };
    expect(resolveAttentionItemSegmentId(item, live)).toBe('dense');
    expect(resolveAttentionItemSegmentId({ text: 'x', sceneRef: { index: 1, name: 'nowhere…' } }, live)).toBeUndefined();
  });

  it('an item with no resolvable scene renders as plain text, not a jump', () => {
    mountWith(TRIGGERS['script-audio-mismatch'](), [], () => {});
    const line = container.querySelector('[data-kind="script-audio-mismatch"]')!;
    click(line.querySelector('button'));
    expect(line.querySelector('button[data-testid="sync-attention-item"]')).toBeNull();
    expect(line.querySelector('p[data-testid="sync-attention-item"]')).toBeTruthy();
  });

  it('dismiss hides the line for this run only; entries stay under Details; a new run raises it again', () => {
    const log = TRIGGERS['unmatched-scene']();
    const run1 = [summary({ coveredSegments: 19, skippedSegments: 1 })];
    mountWith(log, [], () => {});
    click(container.querySelector('[data-testid="sync-attention-dismiss"]'));
    expect(container.querySelectorAll('[data-testid="sync-attention-line"]').length).toBe(0);
    expect(container.querySelector('[data-testid="sync-status"]')?.getAttribute('data-state')).toBe('clear');
    expect(container.textContent).toContain('Details (1 event)');

    act(() => root.unmount());
    mountWith(log, [], () => {});
    expect(container.querySelectorAll('[data-testid="sync-attention-line"]').length).toBe(0); // persisted

    act(() => root.unmount());
    const nextRun = log.map(e => ({ ...e, id: `${e.id}-2`, timestamp: AT + 60_000 }));
    mountWith([...log, ...nextRun], [], () => {}, [...run1, summary({ timestamp: AT + 60_000, coveredSegments: 19, skippedSegments: 1 })]);
    expect(container.querySelectorAll('[data-testid="sync-attention-line"]').length).toBe(1);
  });
});
