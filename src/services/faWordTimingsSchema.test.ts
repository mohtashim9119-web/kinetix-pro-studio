// @vitest-environment jsdom
/**
 * `Project.faWordTimings` schema round-trip (WS1 Task 5 Slice D18, Step 4).
 *
 * The field has no production writer yet (types.ts's own doc comment on
 * `faWordTimings`) — nothing in `src/` reads or writes it outside this test.
 * What this file proves is narrower and more concrete than "the type
 * compiles": that a Project carrying a REAL, full-scale word-timing array
 * (not a 2-3 entry toy) survives the actual persistence round trip
 * (`projectStore.ts`'s `saveProject`/`loadProject`, i.e. real JSON.stringify
 * through real jsdom localStorage and back) byte-for-byte, and that adding
 * this field to a Project object has zero effect on the shipped sync
 * pipeline's own behavior — the six golden-replay tests
 * (`scripts/phase4-handoff-replay-sync.test.ts`) never construct a `Project`
 * at all, so their continuing to pass unmodified alongside this file is
 * itself part of the byte-identity evidence, not a redundant check.
 *
 * Word-timing data: the REAL 1645-word MMS-FA capture already committed at
 * `scripts/fixtures/phase4-fa-tokens-173.json` (WS1 Task 5's own R-H
 * fixture, captured against the 173-segment/709.01s corpus) — read-only
 * here, never modified — rather than a hand-rolled synthetic array, so the
 * scale and content are grounded in a real corpus, not a guess. 1645 is
 * close to (and larger than) the ~1,616 figure named in this slice's task
 * spec; using the real, already-committed count is more honest than rounding
 * it to match.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { saveProject, loadProject } from './projectStore';
import { TransitionType, AnimationType } from '../types';
import type { Project, VideoSegment, TranscriptToken } from '../types';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Same minimal RFC4180-ish reader `phase4-handoff-replay-sync.test.ts` uses
 *  (duplicated, not imported — that file lives under `scripts/`, outside
 *  `src/`'s own module graph, and this is a ~15-line helper, not worth a
 *  shared module for one reuse). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Record<string, string>);
}

interface FaWordToken {
  text: string;
  start: number;
  end: number;
  score: number;
  seg: number;
}

function load173Segments(): VideoSegment[] {
  const csv = readFileSync(resolve(REPO, 'scripts/fixtures/phase4-baseline-173-segments.csv'), 'utf-8');
  return parseCsv(csv).map((row, i): VideoSegment => ({
    id: `seg-${i}`,
    text: row.text!,
    order: Number(row.order),
    startTime: Number(row.startTime),
    duration: Number(row.duration),
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
  }));
}

/** The real, committed 173-corpus FA capture (709.01s audio) — read-only. */
function load173RealFaWordTimings(): TranscriptToken[] {
  const raw = readFileSync(resolve(REPO, 'scripts/fixtures/phase4-fa-tokens-173.json'), 'utf-8');
  const fixture = JSON.parse(raw) as { words: FaWordToken[] };
  return fixture.words.map((w, i): TranscriptToken => ({
    startSec: w.start,
    endSec: w.end,
    text: w.text,
    confidence: w.score,
    wordIndex: i,
  }));
}

function buildProject(faWordTimings: TranscriptToken[]): Project {
  return {
    id: 'p-d18-schema',
    name: '173-corpus schema check',
    script: '',
    sceneDetails: '',
    segments: load173Segments(),
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    faWordTimings,
  };
}

beforeEach(() => {
  localStorage.clear();
});

/**
 * WS2 T1.2 — `load173Segments()`'s `seg-${i}` ids are a legacy (pre-T1.2)
 * shape, so `loadProject` intentionally backfills them to stable
 * content-derived ids (segmentId.ts) — a deliberate migration, not a retime,
 * and covered separately by projectStoreSegmentId.test.ts. Strip `id` before
 * asserting the rest of a segment round-trips byte-for-byte.
 */
function stripIds(segments: VideoSegment[]): Omit<VideoSegment, 'id'>[] {
  return segments.map(({ id: _id, ...rest }) => rest);
}

describe('Project.faWordTimings — real-scale schema round trip (WS1 Task 5 Slice D18)', () => {
  it('the committed 173-corpus FA fixture is at the scale this slice targets (~1,616 entries)', () => {
    const faWordTimings = load173RealFaWordTimings();
    expect(faWordTimings.length).toBe(1645);
    expect(faWordTimings.length).toBeGreaterThan(1600);
  });

  it('wordIndex is monotonic, gapless, and zero-based across the full real capture', () => {
    const faWordTimings = load173RealFaWordTimings();
    faWordTimings.forEach((t, i) => expect(t.wordIndex).toBe(i));
  });

  it('every entry carries confidence and text alongside wordIndex — the full persisted shape', () => {
    const faWordTimings = load173RealFaWordTimings();
    for (const t of faWordTimings) {
      expect(typeof t.confidence).toBe('number');
      expect(typeof t.text).toBe('string');
      expect(t.text.length).toBeGreaterThan(0);
      expect(t.endSec).toBeGreaterThanOrEqual(t.startSec);
    }
  });

  it('survives a real saveProject/loadProject round trip byte-for-byte, at full 1645-entry scale', async () => {
    const faWordTimings = load173RealFaWordTimings();
    const project = buildProject(faWordTimings);

    await saveProject(project);
    const loaded = await loadProject(project.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.project.faWordTimings).toEqual(faWordTimings);
    // Every OTHER field is unperturbed by this field's presence — the schema
    // addition doesn't silently reshape the rest of the persisted project.
    expect(loaded!.project.segments.length).toBe(project.segments.length);
    expect(stripIds(loaded!.project.segments)).toEqual(stripIds(project.segments));
    expect(loaded!.project.name).toBe(project.name);
    expect(loaded!.project.globalOverlayConfig).toEqual(project.globalOverlayConfig);
  });

  it('round-trips through plain JSON.stringify/parse with no precision loss or reordering', () => {
    const faWordTimings = load173RealFaWordTimings();
    const roundTripped = JSON.parse(JSON.stringify(faWordTimings)) as TranscriptToken[];
    expect(roundTripped).toEqual(faWordTimings);
  });

  it('a Project WITHOUT faWordTimings still round-trips identically (field stays fully optional)', async () => {
    const project = buildProject(load173RealFaWordTimings());
    const { faWordTimings: _drop, ...withoutField } = project;
    await saveProject(withoutField as Project);
    const loaded = await loadProject(withoutField.id);
    expect(loaded!.project.faWordTimings).toBeUndefined();
    expect(stripIds(loaded!.project.segments)).toEqual(stripIds(withoutField.segments));
  });
});
