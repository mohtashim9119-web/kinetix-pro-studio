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
// CHANGE DETECTOR, NOT A CORRECTNESS ASSERTION — with a GROWING set of
// exceptions. The pinned values below include the ear-pass's still-open
// KNOWN-BAD boundaries exactly as FA currently gets them wrong: this file
// passing does not mean FA is right, only that it is the SAME wrong it was when
// those values were pinned. The exceptions are `CLOSED_BY_POSITIVE_ASSERTION`,
// where red means regression rather than drift — item 6 at 174.74, item 9 at
// 65.12, items 4/5 at 931.40/130.96 (R.5), and items 10/11 (R.10). KNOWN_BAD is
// down to three entries, all R.11.
//
// WS1 SESSION B RE-PIN. Owner ruling R-U (the zero-seam rejection rule)
// landed in `faAnchors.ts`'s `findAgreeingSilence`, and the
// `phase4-fa-second-baseline-*-segments.csv` fixtures were regenerated from a
// real ONNX re-capture — the same process §11 item 6 used, and reproducible:
// the regeneration driver was first validated by replaying the PREVIOUS
// capture's words through it and reproducing all three committed fixtures
// byte-for-byte. What moved, and why, in one line each:
//   - item 6 (173 `vessel_damage_clue`) 172.91 -> 174.74, the ear-correct
//     value, residual 0.000s. FIXED; it left KNOWN_BAD for a positive pin.
//   - 15 other boundaries moved (6 v6 + 10 173 total, spanish 0), all inside
//     Session A.5's 179/649 upper bound and all listed in
//     `docs/work-in-progress.md` §11's R-Y re-capture table. None is ear-verified either
//     way yet — that is Session C's listening pass.
//
// WS1 SESSION B.1 RE-PIN (owner ruling R-AA — the SEAM REGION reading). R-U's
// mechanism is unchanged; its seam DEFINITION is amended from the instant
// `tokens[i].startSec` to the interval `[tokens[i-1].endSec, tokens[i].startSec]`.
// The region reading's movers are a strict SUBSET of the instant reading's:
// 4/649 instead of 16/649 (3 v6 + 1 173 + 0 spanish), re-measured from Session
// B's own captured FA inference for this reading, which the shipped code
// reproduces chunk-for-chunk. What that means for this file:
//   - item 6 (173 `vessel_damage_clue`) still resolves to 174.74. Its positive
//     assertion below survives BOTH re-pins unchanged, which is the point of
//     pinning the ear-correct value rather than the current one.
//   - item 7 and the V6 seam 150/151 control are untouched again; the three
//     NAMED_WINDOWS keep their exact BOUNDS and only their indices move.
//   - item 11 (173 `blue_monkey`) does NOT move under the region reading, so
//     its known-bad pin goes back to its pre-Session-B 36.96.
//   - the 12 boundaries the instant reading moved and this one does not are
//     reverted in the fixtures to their pre-Session-B values, and recorded as
//     named candidate defects in `docs/work-in-progress.md` §11 — three of them
//     are in the 44 known >0.5s FA-vs-Whisper movers and are being left unfixed
//     by this ruling, deliberately and on the record.
// M1-M5 were re-run against these re-pinned values: M5 (the items-6/7 error
// class reproduced at a currently-correct boundary) goes RED, and M4 remains a
// true no-op verified by chunk-plan equality on all three corpora.
//   - item 7 (v6 `152_frozen_brush_mice`) is bit-identical at 449.20, exactly
//     as owner ruling R-V predicted: it is an FA word-timing defect (R-U),
//     not an anchoring defect (R.11), and no change inside `faAnchors.ts` can
//     reach it.
//   - item 9 left KNOWN_BAD: 616abb2 closed it, and the Spanish fixture now
//     shows the live 65.12 instead of the stale 66.73.
//   - the V6 seam 150/151 control did not move (stop-and-rule exit S2 clear).
// The M1-M5 mutation matrix was re-run against these re-pinned values: M1,
// M2, M3 and — the one that matters — M5, the items-6/7 error class
// reproduced at a currently-correct boundary, all still go RED. M4 remains a
// true no-op, verified by chunk-plan equality on all three corpora rather
// than by the gate staying green.
//
// WS1 SESSION E RE-PIN (R.10 — scripted text never spoken,
// `src/services/faUnspokenGate.ts`). The FIRST re-pin that changes the SHAPE of
// a corpus rather than a boundary value, and the one thing to read here is why
// that shape change does NOT mean the anchor path moved:
//   - 173 commits 173 segments instead of 175 and skips 2. `perilous_realms`
//     (an on-screen-only title) and `blue_monkey` (a planted, never-voiced test
//     string) are scripted text the audio never says. A CTC objective must
//     place every target token somewhere, so FA had carved both out of their
//     neighbours' speech at max word confidence 1.7e-05 / 6.4e-06; R.10 refuses
//     them and hands them to the same skip path Whisper's own drops use.
//   - items 10 and 11 CONVERTED out of KNOWN_BAD. Item 10 (`hostile_landscape`)
//     is now a positive assertion at its ear-correct 0.00, residual 0.000s.
//     Item 11 has no numeric target — the ear-correct outcome is that the scene
//     is not committed at all — so it converted to an ABSENCE assertion, the
//     register's first. `REGISTER_HIGH_WATER` 5 -> 3.
//   - v6 and spanish are UNCHANGED, every value and every row.
//   - all three chunk digests, all three run digests and all three anchor
//     digests are BIT-IDENTICAL, because R.10 runs after inference and never
//     touches the chunk plan. That required fixing `loadAnchorPathInputs`,
//     which had been relying on `-segments.csv` being the complete pre-skip
//     parse — true only while FA skipped nothing. It now merges `-segments.csv`
//     with `-skipped.csv` to rebuild the real 447/175/27 parse; reading the
//     shortened file alone flips 173's chunk digest to b24e4e63bae5f2b3, which
//     would have been a false alarm pointing at `faAnchors.ts` for a change two
//     stages downstream of it. Measured both ways before the fix was written.
//   - M1-M5 re-run after re-pinning: M1/M2/M3/M5 RED, M4 green and reconfirmed a
//     TRUE no-op by chunk-plan BYTE equality on all three corpora. M5 — the
//     items-6/7 error class at a currently-correct boundary — is red for the
//     FOURTH consecutive re-pin. `faAnchors.ts` sha256 b61e94cb… unchanged.
//
// Golden replay (`phase4-handoff-replay-sync.test.ts`) is untouched by this
// file and must stay 6/6.
//
// SESSION A.5 EXTENSION (Step 2c). Everything above this line describes the
// FIXTURE-LEVEL half of this gate, which is all that existed at 37e9271. That
// half never imports `src/` at all, so it is blind to any change in the code
// that PRODUCES those fixtures: the Step 2b mutation matrix ran M1-M5 against
// `faAnchors.ts`'s `findAgreeingSilence` and every one of them stayed GREEN,
// M5 (the items-6/7 regression this gate exists to catch, reproduced at a
// currently-correct boundary) included. The third describe block at the bottom
// of this file closes that hole by replaying `findAgreeingSilence`'s real
// downstream product — the anchor set, the R.0 run partition, and the
// production chunk plan — through the REAL production functions
// (`faChunkPlan.ts`'s `computeRuns`/`computeFaChunkPlan`, which call
// `computeFaAnchors`, which calls `findAgreeingSilence`), still fully offline
// from committed fixtures. See that block's own header for why the chunk plan
// is the causally complete cut point, and for the one leg that provably
// cannot be replayed offline.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { computeFaChunkPlan, computeRuns } from '../src/services/faChunkPlan';
import { R11_MIN_FIT_DEVIATION } from '../src/services/syncConstants';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

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
const EXPECTED_SHAPE: Record<Corpus, {
  segmentCount: number; skippedCount: number; audioDuration: number;
  /** The COMPLETE, pre-skip-filter parse — `segmentCount + skippedCount`, and
   *  the number of scenes the scene doc actually contains. Held separately
   *  because the anchor-path replay below needs the complete array and the
   *  committed one is no longer it (see `loadAnchorPathInputs`). */
  parsedSegmentCount: number;
  /** WS1 Session E — which scenes were skipped, by tag, in pre-filter index
   *  order. Pins R.10's FIRING SET, not just its size: a rule that started
   *  dropping a different segment would otherwise pass on the count alone. */
  skippedTags: string[];
}> = {
  v6: { segmentCount: 447, skippedCount: 0, parsedSegmentCount: 447, skippedTags: [], audioDuration: 1421.29 },
  // WS1 Session E (R.10): 175 -> 173 committed, 0 -> 2 skipped. `perilous_realms`
  // (an on-screen-only title) and `blue_monkey` (a planted, never-voiced test
  // string) are scripted text the audio never says; FA was forced to carve them
  // out of their neighbours' speech and now refuses them instead. Both are
  // segments the Whisper path ALREADY drops — `phase4-baseline-173-skipped.csv`
  // lists exactly these two at exactly these indices, which is independent,
  // pre-existing confirmation that R.10 removed a divergence rather than a scene.
  '173': {
    segmentCount: 173, skippedCount: 2, parsedSegmentCount: 175,
    skippedTags: ['perilous_realms', 'blue_monkey'], audioDuration: 709.01,
  },
  spanish: { segmentCount: 27, skippedCount: 0, parsedSegmentCount: 27, skippedTags: [], audioDuration: 92.04 },
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
  /** Stable register key. Every entry has one; it is what `REGISTER_ROSTER`
   *  holds and what `CLOSED_BY_POSITIVE_ASSERTION` matches on. WS1 Session D
   *  introduced it because the OV3 triage produced defects with NO ear-item
   *  number — they came from a blinded 5-row sitting, not the original 12-item
   *  list — and inventing item numbers for them would have made the register
   *  lie about where its entries came from. */
  id: string;
  /** WHERE this entry came from. `'ear-12'` = the original 12-item ear pass
   *  (`item` is then set); `'ov3-triage'` = ruling R-AF's blinded triage of the
   *  three R-AA candidates (`item` is undefined). A future origin adds a
   *  member here rather than being forced into one of these. */
  origin: 'ear-12' | 'ov3-triage';
  /** The ear-pass item number — ONLY for `origin: 'ear-12'`. */
  item?: number;
  corpus: Corpus;
  tag: string;
  /** The owning rule this entry closes under — the rule that must be BUILT
   *  before this row can be converted. WS1 Session C: made an explicit field
   *  rather than prose inside `mechanism`, so the register can be grouped by
   *  owning rule without parsing English. */
  owningRule: 'R.5' | 'R.10' | 'R.11';
  /** The commit that closed this entry. EMPTY until closed — filled in by the
   *  same commit that converts the row into a positive assertion below. */
  closingCommit: string;
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

// ---- WS1 Session F: item 7 and both OV3-triage entries LEFT this table.
// R.11 landed (`src/services/faSeamFitGate.ts`) and all three converted to
// positive assertions below, each at its exact ear-correct value. The
// register is EMPTY.
const KNOWN_BAD: KnownBadRow[] = [];

// ===========================================================================
// WS1 SESSION C — THE ZERO-DEFECT REGISTER.
//
// Ruling R-AD (`sync-pipeline-v2-plan.md`, "WS1 SESSION C RULINGS") makes the
// `KNOWN_BAD` manifest above THE Zero-Defect Register, and makes "the register
// is empty" a criterion of the STAGE 1 LOCK GATE. That turns "Stage 1 has zero
// defects" from a claim somebody writes in a doc into a test that is currently
// failing-by-skip and must be made to pass.
//
// Four properties are enforced below, each with its own test:
//
//  (1) THE REGISTER IS EMPTY — `it.skip`, with the open items named in its
//      skip reason. Un-skipping it is the Stage 1 lock's machine check. It is
//      skipped rather than failing so a red suite always means a REGRESSION,
//      never "the known work isn't done yet"; the skip reason carries the
//      list, so the manifest can never quietly grow without the reason going
//      stale next to it.
//
//  (2) THE REGISTER ONLY EVER SHRINKS — `REGISTER_HIGH_WATER` records the
//      largest the manifest has ever been. Growth is a hard failure with an
//      explicit message, so adding a sixth open defect cannot happen as a
//      silent one-line diff: it takes a deliberate edit to a constant whose
//      name says what it means.
//
//  (3) AN ENTRY CANNOT BE DELETED, ONLY CONVERTED — `REGISTER_ROSTER` lists
//      every ear-pass item that has EVER been in the register. Every roster
//      member must be either (a) still open in KNOWN_BAD, or (b) present in
//      `CLOSED_BY_POSITIVE_ASSERTION` below, which is asserted against the
//      committed fixture at the EAR-CORRECT value. Removing a row from
//      KNOWN_BAD without adding its positive assertion fails this test. This
//      is the pattern item 6 already follows at 174.74, generalized so it is
//      no longer one hand-written `it` block that a future session might not
//      think to copy.
//
//  (4) EVERY OPEN ENTRY NAMES ITS OWNING RULE AND HAS NO CLOSING COMMIT —
//      bookkeeping consistency, so `closingCommit` cannot be filled in while
//      the row is still open, and a closed row cannot lack one.
// ===========================================================================

/** Every entry that has ever been in the register, by `id`. APPEND-ONLY.
 *  Removing an id from this list is how the register would get falsified, so
 *  the roster is the thing that must not shrink, while KNOWN_BAD is the thing
 *  that must. WS1 Session D changed this from numbers to ids: the OV3 triage
 *  produced two defects with no ear-item number at all, and the roster has to
 *  be able to name them without inventing one. */
const REGISTER_ROSTER = [
  'item-4', 'item-5', 'item-6', 'item-7', 'item-9', 'item-10', 'item-11',
  'ov3-abysmal-opinion', 'ov3-226-four-scouts',
] as const;

/** High-water mark for the OPEN manifest.
 *
 *  WS1 Session C: 5 (items 4,5,7,10,11).
 *
 *  WS1 Session D RAISED it to 7 and then LOWERED it to 5 in the same commit,
 *  and both halves matter. It was raised because owner ruling R-AF's OV3
 *  triage confirmed two NEW defects by ear (`abysmal_opinion`,
 *  `226_four_scouts`) — the guard doing exactly its job: growth cost a
 *  deliberate edit to this constant, an append to the roster above, an entry
 *  in KNOWN_BAD, and a row in `docs/work-in-progress.md` §11's register table.
 *  It was then lowered because R.5 landed in the same commit and closed items
 *  4 and 5 into positive assertions, taking the open count 7 -> 5.
 *
 *  WS1 Session E LOWERED it 5 -> 3. R.10 landed and closed items 10 and 11,
 *  the only two entries that rule owned.
 *
 *  WS1 Session F LOWERED it 3 -> 0. R.11 landed (`src/services/
 *  faSeamFitGate.ts`) and closed the three remaining entries — item 7,
 *  `ov3-abysmal-opinion`, `ov3-226-four-scouts` — the whole of R.11's known
 *  scope. THE REGISTER IS EMPTY. Session F's detector also surfaced one NEW,
 *  structurally identical, UNVERIFIED candidate (v6 `192_scout_listening`,
 *  committed 570.18 -> 571.07) — deliberately NOT added to the register or
 *  this roster: it came from neither the 12-item ear pass nor a triage
 *  sitting, and entering it here without an ear pass would misrepresent
 *  suspicion as guilt (the exact distinction R-AG's "membership in the 44 is
 *  suspicion, not guilt" ruling draws). It IS reflected in the committed FA
 *  second-baseline fixture (the rule fired for real) and is carried forward
 *  as an explicit open triage item — see `docs/work-in-progress.md` §11.
 *
 *  This may be lowered when entries close. Raising it is allowed only with
 *  the full ceremony above — see the failure message on the shrink-only
 *  test. */
const REGISTER_HIGH_WATER = 0;

/** Entries CONVERTED out of KNOWN_BAD, each carrying the positive assertion
 *  that replaced its known-bad pin. This is what makes deletion impossible:
 *  a row leaves KNOWN_BAD only by arriving here, and arriving here means the
 *  ear-correct value is asserted against the committed fixture. */
const CLOSED_BY_POSITIVE_ASSERTION: Array<{
  id: string; item?: number; corpus: Corpus; tag: string;
  /** The ear-verified correct boundary — or `null` when the ear-correct
   *  outcome is "this scene is NOT committed as a timed segment at all"
   *  (item 11). A null entry asserts the tag's ABSENCE from the committed
   *  fixture, which is every bit as much a positive assertion as a number:
   *  re-committing that scene fails the test. WS1 Session E widened this from
   *  `number` when R.10 gave the register its first non-numeric closure.
   *  `KNOWN_BAD.earCorrect` has carried the same convention since Session A. */
  earCorrect: number | null;
  closingCommit: string; why: string;
}> = [
  {
    id: 'item-4', item: 4, corpus: 'v6', tag: '308_scouts_leading', earCorrect: 931.40,
    closingCommit: 'WS1-SESSION-D',
    why: 'R.5 (unscripted-audio excision). The spoken "Level 8. The one who teaches what cannot be taught ' +
      'easily." [925.14, 928.93] is excised from the chunk window, so `307_forty_nine_years` is no longer ' +
      'offered heading frames for "You are forty-nine." Residual 0.000s against the ear-correct 931.40, and it ' +
      'lands exactly on the Whisper-committed value too.',
  },
  {
    id: 'item-5', item: 5, corpus: 'v6', tag: '043_night_migration', earCorrect: 130.96,
    closingCommit: 'WS1-SESSION-D',
    why: 'R.5 (unscripted-audio excision). Same mechanism as item 4, on "Level two. The boy who carries fire." ' +
      '[125.54, 129.01]. The confidence recovery is the proof the fix is real rather than coincidental: ' +
      '"eleven" moves 127.96 -> 129.99 and its confidence goes 5.9e-07 -> 1.0. Residual 0.000s.',
  },
  {
    id: 'item-6', item: 6, corpus: '173', tag: 'vessel_damage_clue', earCorrect: 174.74,
    closingCommit: '92746cf',
    why: 'R-U zero-seam rejection (and still resolved under R-AA seam-region). Residual 0.000s. ' +
      'Survived both re-pins unchanged, which is the point of pinning the ear-correct value.',
  },
  {
    id: 'item-10', item: 10, corpus: '173', tag: 'hostile_landscape', earCorrect: 0.00,
    closingCommit: 'WS1-SESSION-E',
    why: 'R.10 (scripted text never spoken, `src/services/faUnspokenGate.ts`). The on-screen-only title ' +
      '`perilous_realms` ("The Hardest Warhammer 40K Environments to Fight In") is never voiced, but a CTC ' +
      'objective must place every target token somewhere, so FA carved it out of [0.00, 1.36] and pushed this ' +
      'segment\'s onset to 1.36. With the title refused, this becomes the first committed segment and ' +
      '`headExtendFirstSegment` stretches it back to 0. Residual 0.000s against the ear-correct 0.00.',
  },
  {
    id: 'item-11', item: 11, corpus: '173', tag: 'blue_monkey', earCorrect: null,
    closingCommit: 'WS1-SESSION-E',
    why: 'R.10. The planted "blue monkey jumped over the moon" test string is never voiced; Whisper drops the ' +
      'scene entirely and the ear agreed that is correct, so there was never a numeric target to converge on — ' +
      'the fix is the drop, not a different timestamp. FA committed a real [36.96, 37.73) span for it at max ' +
      'word confidence 6.4257e-06; R.10 refuses it and `ancient_nature_thriving` absorbs the 0.77s under Model P ' +
      '(duration 2.34 -> 3.11), leaving the partition gapless. This entry asserts ABSENCE: if the tag ever ' +
      'reappears in the committed fixture, R.10 has regressed.',
  },
  {
    id: 'item-9', item: 9, corpus: 'spanish', tag: '023_scylla_six_sailors', earCorrect: 65.12,
    closingCommit: '616abb2',
    why: 'Forced-split chunk-plan attribution bug. The fixture refresh in WS1 Session B means the ' +
      'Spanish baseline finally SHOWS the live 65.12 instead of the stale 66.73, so this can now ' +
      'carry a real positive assertion rather than only a note. WS1 Session C converted it.',
  },
  {
    id: 'item-7', item: 7, corpus: 'v6', tag: '152_frozen_brush_mice', earCorrect: 451.03,
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11 (chunk-fit boundary correction, `src/services/faSeamFitGate.ts`). Chunk [448.34, 451.70] ' +
      'carries 10 script words against 7 Whisper token onsets (fit 1.4286) — FA crushes "when the brush mice ' +
      'stop" into near-zero-confidence garbage (max 1.49e-3 in the correction span) instead of the real ' +
      'silence [450.36, 451.70] that already, correctly, anchors the chunk\'s own end (an untouched R.1 ' +
      'agreed anchor). Corrected to that silence\'s midpoint, residual 0.000s against the ear-correct 451.03.',
  },
  {
    id: 'ov3-abysmal-opinion', item: undefined, corpus: '173', tag: 'abysmal_opinion', earCorrect: 17.88,
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11 — item 7\'s own root cause, found through a different symptom (WS1 Session D diagnosis). ' +
      'Chunk [16.64, 18.08] carries "the numbers. They\'re" (fit 1.5, text surplus); FA crushes it to near-zero ' +
      'confidence (max 3.895e-3 in the correction span) instead of the real silence [17.68, 18.08] anchoring ' +
      'the chunk\'s own end. Corrected to that silence\'s midpoint, residual 0.000s against the ear-correct 17.88.',
  },
  {
    id: 'ov3-226-four-scouts', item: undefined, corpus: 'v6', tag: '226_four_scouts', earCorrect: 671.18,
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11, same root cause. Chunk [669.40, 671.50] carries "night scouts now. Four of them" (fit 0.75, ' +
      'audio surplus); FA crushes "four of them" to near-zero confidence (max 9.693e-4 in the correction span) ' +
      'instead of the real silence [670.86, 671.50] anchoring the chunk\'s own end. Corrected to that silence\'s ' +
      'midpoint, residual 0.000s against the ear-correct 671.18. Adjacency to R.5\'s "Level 6" excision two ' +
      'segments earlier (the owner\'s pre-registered, refuted Level-N hypothesis, WS1 Session D) was a red ' +
      'herring — R.11 fires here for the same chunk-fit reason as item 7 and `abysmal_opinion`, unrelated to R.5.',
  },
];

/** WS1 Session F — R.11's own detector surfaced ONE new, structurally
 *  identical, UNVERIFIED candidate beyond the three register members. It is
 *  reflected for real in the committed FA second-baseline fixture (the rule
 *  fired, corrected 570.18 -> 571.07, exactly as `detectSeamFitDefects`
 *  computes) but is deliberately NOT in `REGISTER_ROSTER` or
 *  `CLOSED_BY_POSITIVE_ASSERTION` — it came from neither the 12-item ear
 *  pass nor an owner triage sitting, so entering it as a positive assertion
 *  would misrepresent suspicion as guilt. Pinned here as its own change
 *  detector (not a correctness assertion) so a regression in the fixture is
 *  still caught, without claiming an ear pass that never happened. */
const UNVERIFIED_R11_CANDIDATE = {
  corpus: 'v6' as const, tag: '192_scout_listening', pinnedValue: 571.07,
  why: 'Same evidentiary shape as the three register members: chunk [569.80, 571.36] carries "you both go ' +
    'still. you listen." — fit 1.5 — and the correction span holds near-zero FA confidence throughout ' +
    '(max 4.073e-5). Flagged for an owner ear pass (docs/work-in-progress.md §11); NOT ear-verified.',
};

describe('WS1 Session C — the Zero-Defect Register (ruling R-AD)', () => {
  // (1) THE STAGE 1 LOCK'S MACHINE CHECK. UN-SKIPPED — WS1 Session F closed
  // the last three entries (item 7, ov3-abysmal-opinion, ov3-226-four-scouts)
  // via R.11. The register is EMPTY. Red here means a NEW defect entered
  // KNOWN_BAD without the shrink-only guard below catching it first, which
  // should not be possible — treat a failure here as a bug in the guard.
  it('the Zero-Defect Register is EMPTY', () => {
    expect(
      KNOWN_BAD.filter(k => k.status === 'open').map(k => `${k.id} (${k.owningRule}, ${k.corpus} ${k.tag})`),
      'the Zero-Defect Register still has open entries',
    ).toEqual([]);
  });

  // (2) SHRINK-ONLY.
  it('the register only ever SHRINKS (open count <= high-water mark)', () => {
    const open = KNOWN_BAD.filter(k => k.status === 'open');
    expect(
      open.length,
      `The Zero-Defect Register GREW: ${open.length} open entries against a high-water mark of ` +
      `${REGISTER_HIGH_WATER}. A new defect is not forbidden — but it must be recorded deliberately: ` +
      `raise REGISTER_HIGH_WATER in the same commit, add the item to REGISTER_ROSTER, and record it in ` +
      `docs/work-in-progress.md §11's register table. Do NOT raise the constant to make this green ` +
      `without doing the other two. Open entries now: ${open.map(k => k.id).join(', ')}.`,
    ).toBeLessThanOrEqual(REGISTER_HIGH_WATER);
  });

  // (3) CONVERSION, NOT DELETION.
  it('every roster entry is either still open or CLOSED BY A POSITIVE ASSERTION', () => {
    const open = new Set(KNOWN_BAD.filter(k => k.status === 'open').map(k => k.id));
    const closed = new Set(CLOSED_BY_POSITIVE_ASSERTION.map(c => c.id));
    for (const id of REGISTER_ROSTER) {
      expect(
        open.has(id) || closed.has(id),
        `Register entry ${id} has VANISHED: it is neither open in KNOWN_BAD nor present in ` +
        `CLOSED_BY_POSITIVE_ASSERTION. An entry may only be CONVERTED, never deleted — move it to ` +
        `CLOSED_BY_POSITIVE_ASSERTION with its ear-correct value and the commit that closed it.`,
      ).toBe(true);
      expect(
        open.has(id) && closed.has(id),
        `Register entry ${id} is BOTH open and closed — one of the two lists is stale.`,
      ).toBe(false);
    }
  });

  // (3b) ...and the positive assertions are real assertions against the fixture.
  for (const c of CLOSED_BY_POSITIVE_ASSERTION) {
    const target = c.earCorrect === null ? 'NOT COMMITTED AT ALL' : `EAR-CORRECT ${c.earCorrect}`;
    it(`${c.id} (${c.corpus} ${c.tag}) is pinned at its ${target} — closed by ${c.closingCommit}`, () => {
      const row = loadFaSecondBaseline(c.corpus).find(r => r.tag === c.tag);

      if (c.earCorrect === null) {
        // The ear-correct outcome is an ABSENCE. Asserted in both directions:
        // the scene must be gone from the committed timeline AND still present
        // in the skip fixture, so "dropped" can never degrade into "silently
        // lost from both files".
        expect(
          row,
          `${c.id}: ${c.corpus} "${c.tag}" is COMMITTED again at ${row?.startTime}. This is a CLOSED ` +
          `register entry whose ear-correct outcome is that the scene is not committed at all — red here ` +
          `means R.10 REGRESSED. Do not re-pin it. ${c.why}`,
        ).toBeUndefined();
        const skipped = loadCsv(`phase4-fa-second-baseline-${c.corpus}-skipped.csv`);
        expect(
          skipped.map(r => r.segmentTag),
          `${c.id}: dropped from the timeline but missing from the skip fixture too — a scene must be ` +
          `accounted for in exactly one of the two files.`,
        ).toContain(c.tag);
        return;
      }

      expect(row, `${c.corpus} ${c.tag} row`).toBeDefined();
      expect(
        Math.abs(row!.startTime - c.earCorrect),
        `${c.id}: ear-correct ${c.earCorrect}, got ${row!.startTime}. This is a CLOSED register ` +
        `entry with a positive assertion — red here means forced alignment REGRESSED on a boundary ` +
        `that was measured correct. Do not re-pin it to whatever the new run produces. ${c.why}`,
      ).toBeLessThan(0.005);
    });
  }

  // (4) BOOKKEEPING CONSISTENCY.
  it('open entries name an owning rule and carry no closing commit; closed entries carry one', () => {
    for (const kb of KNOWN_BAD.filter(k => k.status === 'open')) {
      expect(['R.5', 'R.10', 'R.11'], `${kb.id}: owningRule`).toContain(kb.owningRule);
      expect(kb.closingCommit, `${kb.id} is still open but already names a closing commit`).toBe('');
      // WS1 Session D — the origin/item pairing must stay honest in both
      // directions: an ear-pass entry carries its item number, and a triage
      // entry must NOT have acquired one.
      if (kb.origin === 'ear-12') expect(typeof kb.item, `${kb.id}: an ear-12 entry must carry its item number`).toBe('number');
      else expect(kb.item, `${kb.id}: a triage entry must NOT invent an ear-pass item number`).toBeUndefined();
      expect(REGISTER_ROSTER as readonly string[], `${kb.id} is open but missing from REGISTER_ROSTER`).toContain(kb.id);
    }
    for (const c of CLOSED_BY_POSITIVE_ASSERTION) {
      expect(c.closingCommit.length, `closed entry ${c.id} must name the commit that closed it`).toBeGreaterThan(0);
    }
  });

  // (5) The register's own census, printed so a reader of CI output can see the
  //     state of the programme without opening this file.
  it('register census (informational)', () => {
    const open = KNOWN_BAD.filter(k => k.status === 'open');
    const byRule = new Map<string, string[]>();
    for (const k of open) byRule.set(k.owningRule, [...(byRule.get(k.owningRule) ?? []), k.id]);
    // eslint-disable-next-line no-console
    console.log(
      `[fa-replay:register] OPEN ${open.length}/${REGISTER_HIGH_WATER} — ` +
      [...byRule.entries()].map(([r, ids]) => `${r}: ${ids.join('/')}`).join('; ') +
      ` | CLOSED ${CLOSED_BY_POSITIVE_ASSERTION.length} (${CLOSED_BY_POSITIVE_ASSERTION.map(c => `${c.id}@${c.closingCommit}`).join(', ')})` +
      ` | roster ${REGISTER_ROSTER.length}`,
    );
    expect(open.length + CLOSED_BY_POSITIVE_ASSERTION.length).toBe(REGISTER_ROSTER.length);
  });
});

describe('WS1 Session A — FA replay gate (R10): structural shape, offline, fixtures only', () => {
  for (const key of CORPORA) {
    it(`${key}: FA second-baseline fixture reproduces the expected shape (row count, skip count, contiguity, coverage)`, () => {
      const rows = loadFaSecondBaseline(key);
      const skipped = loadCsv(`phase4-fa-second-baseline-${key}-skipped.csv`);
      const expected = EXPECTED_SHAPE[key];

      expect(rows.length, `${key}: FA-committed segment count`).toBe(expected.segmentCount);
      expect(skipped.length, `${key}: FA-committed skip count`).toBe(expected.skippedCount);
      expect(skipped.map(r => r.segmentTag), `${key}: WHICH scenes were skipped (R.10's firing set)`)
        .toEqual(expected.skippedTags);
      expect(
        rows.length + skipped.length,
        `${key}: committed + skipped must still account for every parsed scene`,
      ).toBe(expected.parsedSegmentCount);

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

  it('the manifest is EMPTY — WS1 Session F closed the last three entries via R.11', () => {
    // Item 6 left this table in WS1 Session B; item 9 in Session C; items 4/5
    // in Session D (R.5); items 10/11 in Session E (R.10); item 7 and both
    // OV3 triage entries in Session F (R.11). KNOWN_BAD is now empty — every
    // roster member is accounted for in CLOSED_BY_POSITIVE_ASSERTION instead
    // (test (3) above already enforces this pairing).
    expect(KNOWN_BAD.map(k => k.id)).toEqual([]);
  });

  it('ear-pass item 6 (R-U, fixed): 173 vessel_damage_clue is pinned at its EAR-CORRECT 174.74', () => {
    // The only positive correctness assertion in this file. Everything else
    // pins what FA currently does, right or wrong; this pins what the owner's
    // ear verified. Owner ruling R-U (the zero-seam rejection rule,
    // `sync-pipeline-v2-plan.md`) vetoed the false anchor at 173.12 — a
    // detected silence [172.70, 173.12] lying wholly inside Whisper token 464
    // "chemical" [172.57, 173.18], spanning no token seam at all — and the
    // boundary landed on 174.74 exactly, residual 0.000s.
    //
    // If this goes red, forced alignment has REGRESSED on a boundary that was
    // measured correct. Do not re-pin it to whatever the new run produces.
    const row = loadFaSecondBaseline('173').find(r => r.tag === 'vessel_damage_clue');
    expect(row, '173 vessel_damage_clue row').toBeDefined();
    expect(Math.abs(row!.startTime - 174.74), `ear-correct 174.74, got ${row!.startTime}`).toBeLessThan(0.005);
  });
});

describe('WS1 Session F — R.11: chunk-fit boundary correction', () => {
  it('item 7, ov3-abysmal-opinion, ov3-226-four-scouts are pinned at their EAR-CORRECT values', () => {
    const v6 = loadFaSecondBaseline('v6');
    const c173 = loadFaSecondBaseline('173');
    const item7 = v6.find(r => r.tag === '152_frozen_brush_mice');
    const scouts = v6.find(r => r.tag === '226_four_scouts');
    const opinion = c173.find(r => r.tag === 'abysmal_opinion');
    expect(item7, 'item 7 row').toBeDefined();
    expect(Math.abs(item7!.startTime - 451.03), `item 7: ear-correct 451.03, got ${item7!.startTime}`).toBeLessThan(0.005);
    expect(scouts, '226_four_scouts row').toBeDefined();
    expect(Math.abs(scouts!.startTime - 671.18), `226_four_scouts: ear-correct 671.18, got ${scouts!.startTime}`).toBeLessThan(0.005);
    expect(opinion, 'abysmal_opinion row').toBeDefined();
    expect(Math.abs(opinion!.startTime - 17.88), `abysmal_opinion: ear-correct 17.88, got ${opinion!.startTime}`).toBeLessThan(0.005);
  });

  it('the new UNVERIFIED candidate (192_scout_listening) is reflected in the fixture — pinned as a change detector, not a correctness claim', () => {
    const v6 = loadFaSecondBaseline('v6');
    const row = v6.find(r => r.tag === UNVERIFIED_R11_CANDIDATE.tag);
    expect(row, '192_scout_listening row').toBeDefined();
    expect(
      Math.abs(row!.startTime - UNVERIFIED_R11_CANDIDATE.pinnedValue),
      `192_scout_listening moved from its pinned (unverified) ${UNVERIFIED_R11_CANDIDATE.pinnedValue} to ` +
      `${row!.startTime}. This is NOT an ear-verified correctness assertion — if this is an intentional R.11 ` +
      `change, re-pin the value; if unexpected, it is a real regression in the detector or the fixture.`,
    ).toBeLessThan(0.005);
  });

  it('controls unmoved by R.11: item 6 (174.74), V6 seam 150/151 (457.81), items 4/5 (931.40/130.96), items 10/11 (0.00/dropped)', () => {
    const v6 = loadFaSecondBaseline('v6');
    const c173 = loadFaSecondBaseline('173');
    expect(c173.find(r => r.tag === 'vessel_damage_clue')!.startTime).toBeCloseTo(174.74, 2);
    expect(v6.find(r => r.tag === '155_predator_passing_under')!.startTime).toBeCloseTo(457.81, 2);
    expect(v6.find(r => r.tag === '308_scouts_leading')!.startTime).toBeCloseTo(931.40, 2);
    expect(v6.find(r => r.tag === '043_night_migration')!.startTime).toBeCloseTo(130.96, 2);
    expect(c173.find(r => r.tag === 'hostile_landscape')!.startTime).toBeCloseTo(0.00, 2);
    expect(c173.find(r => r.tag === 'blue_monkey')).toBeUndefined();
  });

  it('M6 — a mutation specific to R.11 must turn this gate RED (mutation-matrix entry, verified this session)', () => {
    // Documents the mutation actually run this session (not committed as a
    // standing mutant — matches M1-M5's own established pattern of a
    // manually-verified-per-session matrix, not permanent CI infrastructure):
    // R11_MIN_FIT_DEVIATION raised above item 7/abysmal_opinion/
    // 226_four_scouts's own fitDeviation (1.3333, the lowest of the three)
    // makes ALL THREE registered corrections fail to fire, which flips both
    // the register-empty test and the three ear-correct pins above to RED.
    // Verified directly against the real production detector this session —
    // see the WS1 Session F ledger entry (docs/work-in-progress.md §11) for
    // the exact run. This test itself only documents the mutation was run
    // and confirms the CURRENT (unmutated) state stays green, which is what
    // licenses trusting the mutation result reported in the ledger.
    expect(R11_MIN_FIT_DEVIATION).toBeLessThan(4 / 3); // 226_four_scouts's own fitDeviation — must stay reachable.
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

// ===========================================================================
// WS1 Session A.5 (Step 2c) — LIVE REPLAY OF THE ANCHOR PATH.
//
// WHY THIS EXISTS. R10 asked for a replay of FA word timings AND derived
// segment boundaries through the downstream path — i.e. through
// `faAnchors.ts`'s `findAgreeingSilence`. What shipped at 37e9271 was
// fixture-level structural pinning only. Step 2b measured the consequence
// directly: five mutations of `findAgreeingSilence` (+1 token-index shift,
// +0.3s time shift, agreement check disabled, nearest/furthest preference
// inverted, and the items-6/7 error class reproduced at a currently-correct
// boundary) all left the gate GREEN. A gate that stays green while the
// function it names in its own header is rewritten is not a gate.
//
// WHAT IS REPLAYED, AND WHY IT IS THE COMPLETE CUT. `findAgreeingSilence`
// reaches a committed segment boundary through exactly one channel: it fixes
// the R.1 anchor set, the anchors fix the R.0 run partition, and the runs fix
// the production chunk plan (`computeFaChunkPlan`) that
// `forcedAlignmentRun.ts:81` hands to Rust. Rust's ONNX inference is
// deterministic given (audio window, text) — so two chunk plans that are
// row-for-row identical produce identical FA word timings, and any boundary
// movement attributable to this function must first appear as a chunk-plan
// difference. Pinning the plan row-for-row is therefore a complete change
// detector for `findAgreeingSilence`, not a proxy for one.
//
// WHAT IS *NOT* REPLAYED (stated, not papered over). The inference leg
// itself — chunk plan -> FA word timings -> `snapCoveredBoundaries` ->
// committed boundary — still cannot run here: it needs the real ONNX runtime
// and the per-language `model.onnx`, which this harness deliberately does not
// have. So this block proves "the chunk plan did/did not change"; it cannot
// prove "the boundary moved to 174.74". The KNOWN_BAD manifest above remains
// the mechanism that records the second half, and Session B still owes a real
// FA re-capture when its fix lands.
//
// FIDELITY, MEASURED NOT ASSUMED (Session A.5): this reconstruction was diffed
// against the real production capture (`.work-phase4/replay/*/
// fa_production_chunks.json`, the plan actually sent to Rust for the R-H
// second baseline): v6 280/280 and 173 118/118 chunks byte-identical, zero
// differences. Spanish differs at exactly one boundary (chunk 3/4, recon
// 61.36 vs captured 65.58) because that capture predates 616abb2's
// forced-split attribution fix and was never regenerated — the same staleness
// the item-9 manifest note above records. The pinned Spanish values below are
// the CURRENT (post-616abb2) ones, which is what a change detector must pin.
//
// STILL A CHANGE DETECTOR, NOT A CORRECTNESS ASSERTION. Every number below is
// what `findAgreeingSilence` produces TODAY, wrong boundaries included: the
// `173` chunk [173.12, 174.96] and the `v6` chunk [448.34, 451.70] pinned by
// name are precisely the too-early, too-short windows that produce ear-pass
// items 6 and 7. When Session B's rewrite lands, these assertions go RED and
// that is the expected, named diff — update the values, do not widen the
// tolerance.
// ===========================================================================

interface AnchorPathSpec {
  key: Corpus;
  audioDuration: number;
  /** `computeRuns` output length, and how many of those runs end on a real
   *  R.1 agreed anchor (the rest are corpus-end / forced splits). */
  runCount: number;
  anchorCount: number;
  chunkCount: number;
  /** sha256(first 16 hex) over the serialized structure — the whole-corpus
   *  change detector. Row-level readability comes from NAMED_WINDOWS below. */
  anchorDigest: string;
  runDigest: string;
  chunkDigest: string;
}

const ANCHOR_PATH: AnchorPathSpec[] = [
  {
    key: 'v6', audioDuration: 1421.29,
    // WS1 Session D (R.5): 264 -> 273 chunks. Each of V6's ten unscripted
    // "Level N" recitations splits its containing chunk in two and is excised
    // from both halves; the tenth sits at corpus start, so its "before" side
    // has no text and its window is trimmed rather than split — nine splits,
    // one trim, +9 chunks. `anchorDigest`/`runDigest` are UNCHANGED, which is
    // the point: R.5 acts on chunk TEXT and WINDOWS only, never on the R.1
    // anchor set or the R.0 run partition, so `faAnchors.ts` is provably not
    // involved. 173 and spanish are bit-identical on all three digests.
    runCount: 313, anchorCount: 312, chunkCount: 273,
    anchorDigest: 'f3f469a68664596a', runDigest: '4d95968b519576da', chunkDigest: 'd5dc8d7924dc8402',
  },
  {
    key: '173', audioDuration: 709.01,
    runCount: 143, anchorCount: 142, chunkCount: 112,
    anchorDigest: 'd2e3f269cd884a26', runDigest: '4e9af8b426d90c3d', chunkDigest: 'b4c4611508f7b58e',
  },
  {
    key: 'spanish', audioDuration: 92.04,
    runCount: 6, anchorCount: 4, chunkCount: 5,
    anchorDigest: 'ac2408783c30f62f', runDigest: '41a72024d26d3389', chunkDigest: 'c7e4be33cf7ab3c7',
  },
];

/** Chunk windows spelled out in full so a failure names a real boundary
 *  instead of only flipping a digest. Each is tied to an entry in KNOWN_BAD
 *  above, or to the V6 seam 150/151 control. */
const NAMED_WINDOWS: Array<{
  corpus: Corpus; chunkIndex: number; startSec: number; endSec: number; why: string;
}> = [
  {
    corpus: '173', chunkIndex: 31, startSec: 161.46, endSec: 174.96,
    why: 'item 6, RESOLVED by R-U and STILL resolved under R-AA\'s seam-region reading. The two pre-R-U chunks — ' +
      '[161.46, 173.12] and [173.12, 174.96] — are ONE window, because the anchor that cut them at 173.12 came from ' +
      'silence [172.70, 173.12], which lies wholly inside Whisper token 464 ("chemical", 172.57-173.18) and spans no ' +
      'token seam under either reading. The committed boundary moved 172.91 -> 174.74, the ear-correct value. This ' +
      'window must NOT split again at 173.12. Its BOUNDS are bit-identical to the instant reading\'s; only the chunk ' +
      'INDEX moved (22 -> 31), because the region reading restores 35 anchors earlier in the corpus.',
  },
  {
    corpus: 'v6', chunkIndex: 79, startSec: 448.34, endSec: 451.7,
    why: 'item 7, UNCHANGED by R-U and by R-AA, and expected to stay so (owner ruling R-V). Its END anchor comes from ' +
      'silence [450.36, 451.70], which swallows THREE token seams (1222/1223/1224) — many seams, not zero, so the ' +
      'zero-seam veto never fires here under either reading. Item 7 is an FA word-timing defect (R.11), reachable ' +
      'only from outside faAnchors.ts. Its chunk INDEX moved 80 -> 72 (R-U) -> 76 (R-AA) -> 79 (R.5, WS1 Session D: ' +
      'three unscripted-audio excisions earlier in V6 each add a chunk); its BOUNDS have never moved.',
  },
  {
    corpus: 'v6', chunkIndex: 80, startSec: 451.7, endSec: 460.56,
    why: 'V6 seam 150/151 control (ear-pass item 8, both sources correct): the chunk containing the ' +
      '154_silent_night_birds / 155_predator_passing_under seam at 457.83. R-U predicted this does not move, and ' +
      'it did not; R-AA does not move it either (stop-and-rule exit S2, cleared twice); nor does R.5 (S2 cleared a ' +
      'third time). Index moved 81 -> 73 -> 77 -> 80; bounds must not move.',
  },
];

function loadAnchorPathInputs(key: Corpus): {
  tokens: TranscriptToken[]; silences: SilenceInterval[]; segments: VideoSegment[];
} {
  const tokens: TranscriptToken[] = loadCsv(`phase4-baseline-${key}-words.csv`)
    .map(r => ({ text: r.text!, startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const silences: SilenceInterval[] = loadCsv(`phase4-baseline-${key}-silences.csv`)
    .map(r => ({ startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  // What this needs is the COMPLETE, PRE-SKIP-FILTER parse in order
  // (447/175/27 rows) — the array `App.tsx`'s `anchorTimed` hands to
  // `runForcedAlignmentForSync`, which is built before any skip decision
  // exists. Until WS1 Session E the `-segments.csv` fixture WAS that array, but
  // only by coincidence: FA happened to skip nothing on all three corpora, so
  // committed and parsed were the same 175 rows.
  //
  // R.10 ended that coincidence — 173 now commits 173 rows and skips 2 — so the
  // complete parse is reconstructed here by re-inserting the `-skipped.csv`
  // rows at their own `segmentIndex`, exactly as the Whisper-side baseline pair
  // (`phase4-baseline-*-segments.csv` + `-skipped.csv`) has always been split.
  // Reading `-segments.csv` alone would silently feed a SHORTER array and flip
  // the chunk digest — a false alarm attributing to `faAnchors.ts` a change that
  // happens two stages downstream of it. Measured, not assumed: the merged
  // array reproduces all three pinned digests bit-identically, which is the
  // proof that R.10 does not touch the chunk plan.
  //
  // The skipped rows carry `startTime`/`duration` for this one purpose. They are
  // FROZEN INPUTS, not outputs — the values those scenes carried before R.10
  // refused them — so that this change detector's input stays constant across a
  // change that is not about the anchor path. `computeFaAnchors` never reads
  // segment timing at all; `computeFaChunkPlan`'s text attribution does.
  const parse = (r: Record<string, string>, text: string, order: number): VideoSegment => ({
    id: r.segmentTag ?? r.tag!, text, startTime: Number(r.startTime), duration: Number(r.duration),
    transition: 'none', animation: 'none', order,
  }) as unknown as VideoSegment;

  const committed = loadCsv(`phase4-fa-second-baseline-${key}-segments.csv`);
  const skippedRows = loadCsv(`phase4-fa-second-baseline-${key}-skipped.csv`);
  const skippedByIndex = new Map(skippedRows.map(r => [Number(r.segmentIndex), r]));
  const total = committed.length + skippedRows.length;
  const segments: VideoSegment[] = [];
  let next = 0;
  for (let i = 0; i < total; i++) {
    const sk = skippedByIndex.get(i);
    if (sk) { segments.push(parse(sk, sk.segmentText!, i)); continue; }
    const c = committed[next++]!;
    segments.push(parse(c, c.text!, i));
  }
  if (segments.length !== EXPECTED_SHAPE[key].parsedSegmentCount) {
    throw new Error(
      `${key}: reconstructed parse is ${segments.length} rows, expected ` +
      `${EXPECTED_SHAPE[key].parsedSegmentCount} — the segments/skipped fixture pair no longer ` +
      `accounts for every scene.`,
    );
  }
  return { tokens, silences, segments };
}

/** V6's Hirschberg pass (3900 query words x 3998 subject words) dominates the
 *  cost here — several seconds per call, and `computeRuns` and
 *  `computeFaChunkPlan` each run their own. Well past vitest's 5s default, and
 *  not worth restructuring production code (exporting `computeRunContext`) to
 *  avoid: this session is explicitly no-production-code. */
const ANCHOR_PATH_TIMEOUT_MS = 120_000;

const r3 = (n: number): string => n.toFixed(3);
const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

describe('WS1 Session A.5 — FA replay gate II: the anchor path, replayed through real production code', () => {
  for (const spec of ANCHOR_PATH) {
    it(`${spec.key}: computeFaAnchors -> runs -> chunk plan reproduces its pinned structure`, () => {
      const { tokens, silences, segments } = loadAnchorPathInputs(spec.key);
      const runs = computeRuns(segments, tokens, silences, spec.audioDuration);
      const chunks = computeFaChunkPlan(segments, tokens, silences, spec.audioDuration);
      const anchorTimes = runs.filter(r => r.endProvenance === 'agreed-anchor').map(r => r.windowEnd);

      expect(runs.length, `${spec.key}: R.0 run count`).toBe(spec.runCount);
      expect(anchorTimes.length, `${spec.key}: accepted R.1 anchor count`).toBe(spec.anchorCount);
      expect(chunks.length, `${spec.key}: production chunk count`).toBe(spec.chunkCount);

      // Model P (CLAUDE.md) over the run partition itself, not just over the
      // committed segments: gapless, monotonic, spanning [0, audioDuration].
      expect(runs[0]!.windowStart, `${spec.key}: first run must start at 0`).toBe(0);
      expect(
        Math.abs(runs[runs.length - 1]!.windowEnd - spec.audioDuration),
        `${spec.key}: last run must end at audioDuration`,
      ).toBeLessThan(1e-6);
      for (let i = 1; i < runs.length; i++) {
        expect(
          Math.abs(runs[i]!.windowStart - runs[i - 1]!.windowEnd),
          `${spec.key}: gap or overlap between run ${i - 1} and run ${i}`,
        ).toBeLessThan(1e-9);
      }

      const failHint = (what: string): string =>
        `${spec.key}: ${what} changed. This is the SOLE channel by which faAnchors.ts's ` +
        `findAgreeingSilence reaches a committed boundary, so a change here IS a behavior change. ` +
        `If this is Session B's R-R rewrite landing, re-pin the digests and the NAMED_WINDOWS rows ` +
        `in the same commit and record the movement in docs/work-in-progress.md §11 — do not delete ` +
        `the assertion.`;

      expect(digest(anchorTimes.map(r3).join('|')), failHint('the R.1 anchor time set')).toBe(spec.anchorDigest);
      expect(
        digest(runs.map(r => `${r3(r.windowStart)},${r3(r.windowEnd)},${r.startProvenance},${r.endProvenance}`).join('|')),
        failHint('the R.0 run partition (windows + provenance)'),
      ).toBe(spec.runDigest);
      expect(
        digest(chunks.map(c => `${r3(c.startSec)},${r3(c.endSec)},${c.text}`).join('|')),
        failHint('the production chunk plan (windows + attributed text)'),
      ).toBe(spec.chunkDigest);
    }, ANCHOR_PATH_TIMEOUT_MS);
  }

  it('the named chunk windows behind ear-pass items 6/7 and the V6 seam control are unmoved', () => {
    const cache = new Map<Corpus, ReturnType<typeof computeFaChunkPlan>>();
    for (const w of NAMED_WINDOWS) {
      if (!cache.has(w.corpus)) {
        const spec = ANCHOR_PATH.find(s => s.key === w.corpus)!;
        const { tokens, silences, segments } = loadAnchorPathInputs(w.corpus);
        cache.set(w.corpus, computeFaChunkPlan(segments, tokens, silences, spec.audioDuration));
      }
      const chunk = cache.get(w.corpus)![w.chunkIndex];
      expect(chunk, `${w.corpus}: chunk ${w.chunkIndex} does not exist — the plan's SHAPE changed`).toBeDefined();
      expect(
        Math.abs(chunk!.startSec - w.startSec),
        `${w.corpus} chunk ${w.chunkIndex} startSec: pinned ${w.startSec}, got ${chunk!.startSec}. ${w.why}`,
      ).toBeLessThan(0.005);
      expect(
        Math.abs(chunk!.endSec - w.endSec),
        `${w.corpus} chunk ${w.chunkIndex} endSec: pinned ${w.endSec}, got ${chunk!.endSec}. ${w.why}`,
      ).toBeLessThan(0.005);
    }
  }, ANCHOR_PATH_TIMEOUT_MS);
});
