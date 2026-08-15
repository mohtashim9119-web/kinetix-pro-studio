// WS1 Session A (owner ruling R10) — FA replay gate.
//
// The Whisper-anchored golden replay (phase4-handoff-replay-sync.test.ts) has
// existed since Step Y and catches any src/ regression in the Whisper timing
// path. Nothing equivalent exists for forced alignment: every FA regression
// found to date (ear-pass items 6/7/9 of the 12-item list, `docs/work-in-
// progress.md`'s §11 item 6 addenda) was caught by the owner's ears, not CI.
// This file is that gate for the FA side.
//
// NOT a live recomputation. It cannot be: reproducing FA's committed output
// needs the real Rust ONNX inference (`fa::fa_align` against the real
// production chunk plan, `computeFaChunkPlan`) that only runs inside
// `npm run tauri:dev:fa` with a real `ORT_DYLIB_PATH` and the real per-
// language `model.onnx` files — none of which this harness has, by design
// (CLAUDE.md: "an FA call at runtime with ORT_DYLIB_PATH unset fails cleanly
// rather than crashing"). Instead, this replays the FROZEN result of that
// real run: `scripts/fixtures/phase4-fa-second-baseline-{v6,173,spanish}-
// {segments,skipped}.csv` (`scripts/fixtures/README.md`'s "R-H second
// baseline" section) are already the committed output of feeding FA's real
// per-word timings through the identical downstream pipeline the Whisper
// golden replay exercises (`filterMalformedTokens` -> `alignScenestoTranscript`
// -> `distributeSegmentTimes` -> `applyAnchorBasedTiming` -> coverage gate ->
// `filterToCoveredSegments` -> `snapCoveredBoundaries` -> `headExtendFirstSegment`,
// `docs/work-in-progress.md`'s §11 item 6) — captured once, outside this
// harness, via a scratch `tauri::test::mock_context` pass that was never
// committed (real ONNX inference cannot run inside `npx vitest`). Those CSVs
// were "read by nothing" per their own README section before this file
// existed; this file is what makes them load-bearing.
//
// Runs fully OFFLINE from committed fixtures only. No model, no
// ORT_DYLIB_PATH, no network — passes in a clean checkout.
//
// CHANGE DETECTOR, NOT A CORRECTNESS ASSERTION. The pinned values below
// include the ear-pass's KNOWN-BAD boundaries (items 4/5/6/7/10/11) exactly
// as FA currently gets them wrong — this test passing does not mean FA is
// right, only that it is the SAME wrong it was at this session's HEAD
// (`f8250a3`). Session B's planned rewrite of `faAnchors.ts`'s
// `findAgreeingSilence` (owner ruling R-R, `sync-pipeline-v2-plan.md`) is
// expected to move items 6 and 7 toward their `earCorrect` values. When that
// happens and `phase4-fa-second-baseline-*` is regenerated (real Rust
// capture, same process §11 item 6 used), THIS FILE'S KNOWN_BAD table and
// its per-row assertions must be updated in the same commit — a failure here
// after that fix lands is the diff to read as progress, not as breakage.
//
// Golden replay (`phase4-handoff-replay-sync.test.ts`) is untouched by this
// file and must stay 6/6.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = resolve(REPO, 'scripts', 'fixtures');

/** Same minimal RFC4180-ish reader `phase4-handoff-replay-sync.test.ts` uses —
 *  duplicated rather than imported so this file has no dependency on that
 *  one beyond both reading the same `scripts/fixtures/` directory. */
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

function loadCsv(name: string): Record<string, string>[] {
  return parseCsv(readFileSync(resolve(FIXTURES, name), 'utf-8'));
}

interface FaSegRow {
  order: number;
  tag: string;
  startTime: number;
  duration: number;
  endTime: number;
  anchorSource: string;
}

function loadFaSecondBaseline(key: string): FaSegRow[] {
  return loadCsv(`phase4-fa-second-baseline-${key}-segments.csv`).map(r => ({
    order: Number(r.order),
    tag: r.tag!,
    startTime: Number(r.startTime),
    duration: Number(r.duration),
    endTime: Number(r.endTime),
    anchorSource: r.anchorSource!,
  }));
}

function loadWhisperBaseline(key: string): Map<string, number> {
  const rows = loadCsv(`phase4-baseline-${key}-segments.csv`);
  return new Map(rows.map(r => [r.tag!, Number(r.startTime)]));
}

const CORPORA = ['v6', '173', 'spanish'] as const;
type Corpus = (typeof CORPORA)[number];

/** Expected shape at this session's HEAD (`f8250a3`) — R-H second-baseline
 *  session found 0 skipped segments on all three projects (`docs/work-in-
 *  progress.md` §11 item 6: "FA produced zero skipped segments on all three
 *  projects, recovering the 3 V6 + 3 173 + 1 Spanish segments Whisper's
 *  turbo transcript could never match at all"). */
const EXPECTED_SHAPE: Record<Corpus, { segmentCount: number; skippedCount: number; audioDuration: number }> = {
  v6: { segmentCount: 447, skippedCount: 0, audioDuration: 1421.29 },
  '173': { segmentCount: 175, skippedCount: 0, audioDuration: 709.01 },
  spanish: { segmentCount: 27, skippedCount: 0, audioDuration: 92.04 },
};

/**
 * KNOWN-BAD manifest — the 12-item ear pass's failures, values as recorded
 * in `docs/work-in-progress.md`'s §11 item 6 mechanism table and its
 * addenda. `status: 'open'` entries are asserted against the committed
 * `phase4-fa-second-baseline-*` fixture below (Session B's scope, or a
 * later rule's scope — see `mechanism`). `status: 'fixed'` is recorded for
 * completeness but NOT asserted against the fixture value, because the
 * fixture itself predates the fix that closed it (see the item-9 note).
 */
interface KnownBadRow {
  item: number;
  corpus: Corpus;
  tag: string;
  /** FA's currently committed value, as of this session's HEAD. */
  faValue: number;
  /** The ear-verified correct value, or `null` when the correct behavior is
   *  "not committed as a timed segment at all" (Whisper drops it and the
   *  ear agreed that was right — item 11). */
  earCorrect: number | null;
  mechanism: string;
  status: 'open' | 'fixed';
  note: string;
}

const KNOWN_BAD: KnownBadRow[] = [
  {
    item: 4, corpus: 'v6', tag: '308_scouts_leading', faValue: 928.67, earCorrect: 931.40,
    mechanism: 'R.5 (unscripted audio: "Level 8..." present in the WAV, absent from the scene doc)',
    status: 'open',
    note: 'R.5 is scoped, not built (sync-pipeline-v2-plan.md). Not Session B scope (Session B = R-R, items 6/7 only).',
  },
  {
    item: 5, corpus: 'v6', tag: '043_night_migration', faValue: 128.43, earCorrect: 130.96,
    mechanism: 'R.5 (unscripted audio: "Level two..." present in the WAV, absent from the scene doc)',
    status: 'open',
    note: 'R.5 is scoped, not built. Not Session B scope.',
  },
  {
    item: 6, corpus: '173', tag: 'vessel_damage_clue', faValue: 172.91, earCorrect: 174.74,
    mechanism: "faAnchors.ts's findAgreeingSilence: false anchor from Whisper timestamp smear (owner ruling R-R)",
    status: 'open',
    note: 'Session B scope — findAgreeingSilence rewrite (R-R ruling, sync-pipeline-v2-plan.md). Expected to move toward 174.74.',
  },
  {
    item: 7, corpus: 'v6', tag: '152_frozen_brush_mice', faValue: 449.20, earCorrect: 451.03,
    mechanism: "faAnchors.ts's findAgreeingSilence: false anchor from Whisper timestamp smear (owner ruling R-R)",
    status: 'open',
    note: 'Session B scope — findAgreeingSilence rewrite (R-R ruling, sync-pipeline-v2-plan.md). Expected to move toward 451.03.',
  },
  {
    item: 9, corpus: 'spanish', tag: '023_scylla_six_sailors', faValue: 66.73, earCorrect: 65.12,
    mechanism: "faChunkPlan.ts's attributeByIndex: forced-split window mis-attribution",
    status: 'fixed',
    note: 'CLOSED by 616abb2 — current code produces 65.12 (verified: commit 616abb2\'s own real-corpus measurement). ' +
      'The 66.73 above is what scripts/fixtures/phase4-fa-second-baseline-spanish-segments.csv still shows, because ' +
      'that fixture predates 616abb2 and — being "read by nothing" per its own README section until this file — was ' +
      'never regenerated. NOT asserted below: asserting a known-stale fixture value as "current" would be a false ' +
      'regression signal. Recorded here so a future reader does not mistake the stale fixture for live behavior.',
  },
  {
    item: 10, corpus: '173', tag: 'hostile_landscape', faValue: 1.36, earCorrect: 0.00,
    mechanism: 'R.10 (scripted text never spoken: on-screen-only title "perilous_realms" steals its neighbour\'s onset)',
    status: 'open',
    note: 'R.10 is specified, not built (sync-pipeline-v2-plan.md). Not Session B scope (Session B = R-R, items 6/7 only).',
  },
  {
    item: 11, corpus: '173', tag: 'blue_monkey', faValue: 36.96, earCorrect: null,
    mechanism: 'R.10 (scripted text never spoken: the planted "blue monkey" string is never voiced)',
    status: 'open',
    note: 'Whisper drops this segment entirely and the ear agreed that is correct — there is no numeric earCorrect ' +
      'to converge on; the fix is R.10\'s drop/skip gate, not a different timestamp. FA currently commits a real ' +
      '[36.96, 37.73) span for it instead of dropping it. Not Session B scope.',
  },
];

describe('WS1 Session A — FA replay gate (R10): structural shape, offline, fixtures only', () => {
  for (const key of CORPORA) {
    it(`${key}: FA second-baseline fixture reproduces the expected shape (row count, skip count, contiguity, coverage)`, () => {
      const rows = loadFaSecondBaseline(key);
      const skipped = loadCsv(`phase4-fa-second-baseline-${key}-skipped.csv`);
      const expected = EXPECTED_SHAPE[key];

      expect(rows.length, `${key}: FA-committed segment count`).toBe(expected.segmentCount);
      expect(skipped.length, `${key}: FA-committed skip count`).toBe(expected.skippedCount);

      // Model P (CLAUDE.md invariant): every row's anchorSource is
      // 'forced-alignment', order is contiguous from 0, and the partition
      // is gapless (segments[i+1].startTime === segments[i].endTime).
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i]!.order, `${key} row ${i}: order`).toBe(i);
        expect(rows[i]!.anchorSource, `${key} row ${i} (${rows[i]!.tag}): anchorSource`).toBe('forced-alignment');
        expect(
          Math.abs(rows[i]!.endTime - (rows[i]!.startTime + rows[i]!.duration)),
          `${key} row ${i} (${rows[i]!.tag}): endTime !== startTime + duration`,
        ).toBeLessThan(1e-6);
        if (i > 0) {
          expect(
            Math.abs(rows[i]!.startTime - rows[i - 1]!.endTime),
            `${key}: gap or overlap between "${rows[i - 1]!.tag}" and "${rows[i]!.tag}"`,
          ).toBeLessThan(1e-6);
        }
      }

      expect(rows[0]!.startTime, `${key}: first segment must start at 0`).toBe(0);
      expect(
        Math.abs(rows[rows.length - 1]!.endTime - expected.audioDuration),
        `${key}: last segment must end at audioDuration`,
      ).toBeLessThan(1e-2);
    });
  }
});

describe('WS1 Session A — FA replay gate (R10): KNOWN-BAD manifest, row-for-row', () => {
  for (const key of CORPORA) {
    const rowsForCorpus = KNOWN_BAD.filter(k => k.corpus === key && k.status === 'open');
    if (rowsForCorpus.length === 0) continue;

    it(`${key}: open KNOWN-BAD boundaries still match their currently-committed FA value`, () => {
      const faRows = new Map(loadFaSecondBaseline(key).map(r => [r.tag, r]));

      for (const kb of rowsForCorpus) {
        const row = faRows.get(kb.tag);
        expect(row, `${key}: item ${kb.item} tag "${kb.tag}" not found in the FA second-baseline fixture`).toBeDefined();
        expect(
          Math.abs(row!.startTime - kb.faValue),
          `item ${kb.item} (${key} "${kb.tag}"): FA-committed startTime moved from the pinned ${kb.faValue} to ` +
          `${row!.startTime}. If this is Session B's findAgreeingSilence rewrite landing and moving this boundary ` +
          `toward ${kb.earCorrect ?? '(no numeric target — see the manifest note)'}, this is PROGRESS — update ` +
          `KNOWN_BAD's faValue/status in this file, do not just widen the tolerance.`,
        ).toBeLessThan(0.005);
      }
    });
  }

  it('every KNOWN_BAD entry is internally consistent (fixed entries have earCorrect === faValue where numeric)', () => {
    for (const kb of KNOWN_BAD.filter(k => k.status === 'fixed')) {
      if (kb.earCorrect !== null) {
        // Not asserted against the fixture (see the item-9 note) — this only
        // guards the manifest's own bookkeeping: a 'fixed' row's recorded
        // faValue should not itself equal earCorrect (that would mean it
        // was never actually broken) unless explicitly noted otherwise.
        expect(kb.faValue, `item ${kb.item}: a 'fixed' entry's faValue equals earCorrect already — is 'status' stale?`)
          .not.toBe(kb.earCorrect);
      }
    }
  });

  it('the manifest itself covers items 4, 5, 6, 7, 9, 10, 11 exactly once each', () => {
    const items = KNOWN_BAD.map(k => k.item).sort((a, b) => a - b);
    expect(items).toEqual([4, 5, 6, 7, 9, 10, 11]);
  });
});

describe('WS1 Session A — FA replay gate (R10): V6 seam 150/151 (Phase 3c control, both correct)', () => {
  it('154_silent_night_birds / 155_predator_passing_under: committed-correct, raw-Whisper-token, and FA values all represented', () => {
    // Three distinct quantities at the same seam, deliberately not collapsed
    // into one number (sync-pipeline-v2-plan.md's Phase 3c entry; ear-pass
    // item 8 in docs/work-in-progress.md's mechanism table):
    //   - committed/ear-correct: the Step M golden baseline's own boundary,
    //     owner-ear-verified correct (Phase 3c's ruling).
    //   - raw Whisper token end for "call" (docs/work-in-progress.md:1598) —
    //     a WORD-level timestamp, not the committed segment boundary; the
    //     committed value differs from it because of the midpoint arithmetic
    //     Phase 3c's own entry walks through.
    //   - FA's second-baseline value — 0.02s off, ear-pass item 8's "FA
    //     working as designed" control case (both sources agree, ear ✓).
    const committedCorrect = 457.83;
    const rawWhisperTokenEndForCall = 457.72;
    const faSecondBaseline = 457.81;

    // The boundary is 155_predator_passing_under's startTime, which equals
    // 154_silent_night_birds's endTime by Model P's gapless partition
    // (CLAUDE.md) — read directly off the next segment's own startTime.
    const whisper = loadWhisperBaseline('v6');
    expect(whisper.get('155_predator_passing_under'), 'committed boundary, Step M golden baseline')
      .toBeCloseTo(committedCorrect, 2);

    const faRows = loadFaSecondBaseline('v6');
    const faBoundaryRow = faRows.find(r => r.tag === '155_predator_passing_under');
    expect(faBoundaryRow, 'FA second-baseline row for 155_predator_passing_under').toBeDefined();
    expect(faBoundaryRow!.startTime).toBeCloseTo(faSecondBaseline, 2);

    // The raw Whisper token value is a fixed historical fact (scripts/fixtures/
    // phase4-baseline-v6-words.csv row 1238, "call") — not re-derived here,
    // just asserted as a documented constant so it stays visible next to the
    // other two.
    expect(rawWhisperTokenEndForCall).toBe(457.72);

    // eslint-disable-next-line no-console
    console.log(
      `[fa-replay:v6-seam-150-151] committed-correct=${committedCorrect} ` +
      `raw-whisper-token(call)=${rawWhisperTokenEndForCall} fa-second-baseline=${faSecondBaseline} ` +
      `(Δcommitted-fa=${(committedCorrect - faSecondBaseline).toFixed(2)}s — ear-pass item 8, both ✓)`,
    );
  });
});
