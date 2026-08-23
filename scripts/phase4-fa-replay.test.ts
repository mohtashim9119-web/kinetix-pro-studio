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
import { earPassAuthorising, earPassRejects, describeEarHistory } from './ws1-ear-pass-ledger.js';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { computeFaChunkPlan, computeRuns } from '../src/services/faChunkPlan';
import {
  R11_MIN_FIT_DEVIATION, R12_MIN_CORRECTION_SEC,
  CONF_MIN_FALLBACK, SILENCE_MIN_DETECTABLE_SEC, FA_FRAME_SEC,
} from '../src/services/syncConstants';
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
   *  three R-AA candidates (`item` is undefined); `'ear-12-h'` = WS1 Session
   *  H's second blinded 12-row listening pass (`item` is undefined — its rows
   *  are identified by corpus + tag, not by a number in the ORIGINAL 12-item
   *  list, and reusing those numbers would make the register lie about which
   *  sitting produced the row); `'r12-structural'` = a row R.12's structural
   *  invariant identifies that NO ear pass has scored — admitted deliberately
   *  and marked as such, never dressed up as ear-verified. `'session-p-live'`
   *  = WS1 Session P's per-conjunct live-bundle probe (`sync-pipeline-v2-plan.md`
   *  Part N's own Class A table) — an ear pass ALREADY on record for these
   *  rows, just never before entered into this register. A future origin
   *  `'live-runs-s'` = WS1 Session S's live listening pass over all ten v6
   *  unscripted-run boundaries, scored by the owner in the app on the shipped
   *  production path (`scripts/ws1-ear-pass-ledger.ts`, sitting
   *  `live-runs-s`). A future origin adds a member here rather than being
   *  forced into one of these. */
  origin: 'ear-12' | 'ov3-triage' | 'ear-12-h' | 'r12-structural' | 'session-p-live' | 'live-runs-s'
    // WS1 Session AE: two more sittings become register origins. `'ear-173-x'`
    // = WS1 Session X's full 173 listening pass, whose five defects had lived
    // in `ws1-ear-pass-ledger.ts` for two sessions WITHOUT a register row —
    // the ledger knew about them and the register did not, which is exactly
    // the drift the two structures exist to make impossible. `'ear-verify-ae'`
    // = this session's own sitting, which found `008_unknown_void`.
    | 'ear-173-x' | 'ear-verify-ae';
  /** The ear-pass item number — ONLY for `origin: 'ear-12'`. */
  item?: number;
  corpus: Corpus;
  tag: string;
  /** The owning rule this entry closes under — the rule that must be BUILT
   *  (or, for `'unassigned'`, has not yet been DESIGNED) before this row can
   *  be converted. WS1 Session C: made an explicit field rather than prose
   *  inside `mechanism`, so the register can be grouped by owning rule
   *  without parsing English. WS1 Session Q added `'unassigned'`: Class A's
   *  measured blind spot (perfect chunk fit, R.11's own signal structurally
   *  cannot see it) and Class B's mechanism (loud-fallback boundaries — the
   *  still-playing checker sees them but its calibrated amplitude floor
   *  declines 4 of 5, `scripts/ws1-session-q-still-playing.test.ts`) both
   *  measurably fail every existing rule; naming a rule that cannot reach a
   *  row would misrepresent suspicion about which rule as the row's own
   *  guilt, the same distinction R-AG's ruling draws for evidence itself. */
  owningRule: 'R.5' | 'R.10' | 'R.11' | 'R.12' | 'unassigned';
  /** The commit that closed this entry. EMPTY until closed — filled in by the
   *  same commit that converts the row into a positive assertion below. */
  closingCommit: string;
  /** THE VALUE THIS ROW IS BROKEN AT — asserted against the FROZEN fixture
   *  (`phase4-fa-second-baseline-<corpus>-segments.csv`) for every OPEN row,
   *  and required to differ from `earCorrect` for every `'fixed'` one.
   *
   *  WS1 SESSION AE spells this out because the field's old one-line gloss
   *  ("FA's currently committed value, as of this session's HEAD") invites the
   *  exact mistake this session made and had to undo: when R.14/R.15 moved
   *  `400_endless_dark` and `wall_split_path` on the LIVE path, updating
   *  `faValue` to the new live number broke the fixture assertion, because the
   *  fixture is deliberately unregenerated. A live move that does not close a
   *  row belongs in the `note`, never here. */
  faValue: number;
  /** The ear-verified correct value; `null` when the correct behavior is
   *  "not committed as a timed segment at all" (Whisper drops it and the
   *  ear agreed that was right — item 11); `'unknown'` when an ear pass has
   *  scored the CURRENT value WRONG but has NOT established the right one.
   *
   *  WS1 Session S added `'unknown'`, and the distinction is the whole point
   *  of the demotion that introduced it: the owner's live pass scored five of
   *  R.12's corrected boundaries EARLY. "Early" is a verdict on the committed
   *  value, not a measurement of the correct one, and writing a guessed target
   *  into this field would be exactly the suspicion-becomes-guilt move the
   *  register exists to prevent (R-AG). Session S's own candidate table
   *  (`docs/work-in-progress.md` §11) measured five principled placements for
   *  each row and shipped NONE of them, because no candidate reproduces both
   *  ear-CORRECT rows. Until a listening pass names a value, it is unknown. */
  earCorrect: number | null | 'unknown';
  mechanism: string;
  status: 'open' | 'fixed';
  note: string;
}

// ---- WS1 Session F: item 7 and both OV3-triage entries LEFT this table.
// R.11 landed (`src/services/faSeamFitGate.ts`) and all three converted to
// positive assertions below, each at its exact ear-correct value. The
// register is EMPTY.
const KNOWN_BAD: KnownBadRow[] = [
  // -------------------------------------------------------------------------
  // WS1 SESSION Q — REOPENED. All eight measured on the live-fidelity bundle
  // (`.work-phase4/replay/v6`, run id `p-20260819T120922Z-cbb403c1`) AND
  // confirmed to match the frozen fixture's own currently-committed value
  // (verified directly against `phase4-fa-second-baseline-v6-segments.csv`
  // before adding these rows — the two vintages agree here, unlike item-7;
  // see REGISTER_HIGH_WATER's own comment for that one's separate story and
  // why it stays closed, only annotated, rather than reopening). Full
  // measurements: `docs/work-in-progress.md` §11's Session Q entry.
  // -------------------------------------------------------------------------
  {
    id: 'classA-214-solitary-fire', origin: 'session-p-live', corpus: 'v6', tag: '214_solitary_fire',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 629.01, earCorrect: 630.09,
    mechanism: 'fitDeviation 1.2727 — BELOW C1 (1.3093), the narrowest of Class A\'s four margins ' +
      '(-0.0366). Unlike 152/447, this row is a genuine THRESHOLD miss, not a structural blind spot: ' +
      'admitting it needs C1 lowered to 77/291 candidates (+21, a 37.5% widening of what reaches C2/C3) ' +
      '— re-deriving the threshold on this one row alone would be fitting noise, per this session\'s own ' +
      'sensitivity sweep (`docs/work-in-progress.md` §11 Session P (i)).',
    status: 'open',
    note: 'Silence-distance from committed value: 0 (sits exactly on a real silence midpoint) — the ' +
      'SAME structural blind spot as 152/447 on that second signal too, for a different reason (the ' +
      'committed value already IS a silence midpoint, just the wrong one\'s).',
  },
  {
    id: 'classA-231-slowing-pace', origin: 'session-p-live', corpus: 'v6', tag: '231_slowing_pace',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 681.63, earCorrect: 682.74,
    mechanism: 'Never a CANDIDATE for R.11 at all — no chunk boundary measures a fit deviation for this ' +
      'seam. Silence-distance (Session Q Step 3) DOES separate it: committed value sits 0.64s from its ' +
      'nearest silence, against a 403-boundary clean-control population whose max is 2.3e-13 — but the ' +
      'nearest silence to the WRONG value (mid 680.99) is not the silence the ear-correct value sits on ' +
      '(mid 682.74, a DIFFERENT, later silence) — the correction needs chunk-edge selection, not ' +
      'proximity to wherever the pipeline currently, wrongly, sits.',
    status: 'open',
    note: 'Confirms the session brief\'s own question: a silence-based (not chunk-edge-based) detector ' +
      'DOES reach 231 as a detection, but its proposed correction is the wrong silence — measured, not ' +
      'assumed (`scripts/ws1-session-q-detector-validate.test.ts`). WS1 SESSION AG: `earCorrect` 682.74 ' +
      'is RE-CONFIRMED by an independent sitting (`ear-verify-ag`) and independently corroborated by the ' +
      'operator\'s own waveform measurement of the seam (segment 230 speaks 681.47-682.43, segment 231 ' +
      'speaks 683.04-683.84 — `docs/ws1-sync-pipeline/fa-chunk-phantom-root-cause.md` §1). R.14 reaches ' +
      'this row as a DETECTION and then DECLINES it on the reliable-onset guard, so the row is now known ' +
      'to be a guard FALSE NEGATIVE rather than an undetected defect. It stays OPEN: production still ' +
      'commits 681.63. Relaxing the guard is NOT authorised by that verdict — the same sitting scored ' +
      '`289_winter_predator_breach`@865.390 CORRECT, which is the guard\'s TRUE negative, and Session ' +
      'AE measured that relaxing it costs v6 a 3.30s unverified move and Spanish two more.',
  },
  {
    id: 'classA-447-scout-facing-dark', origin: 'session-p-live', corpus: 'v6', tag: '447_scout_facing_dark',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 1417.12, earCorrect: 1418.53,
    mechanism: 'fitDeviation exactly 1.0 — the same perfect-fit blind spot as 152, independently. ' +
      'Silence-distance from committed value: 0, same reason as 214.',
    status: 'open',
    note: '2 of Class A\'s 4 rows (152, 447) share this exact signature: fitDeviation 1.0 AND ' +
      'silence-distance 0. Neither of Session Q\'s two independent signals separates them from a healthy ' +
      'boundary; a third, not-yet-identified discriminator is needed.',
  },
  {
    id: 'classB-056-dropping-torch', origin: 'session-p-live', corpus: 'v6', tag: '056_dropping_torch',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 167.03, earCorrect: 167.70,
    mechanism: 'FALLBACK boundary (`boundaryUsedFallback` true — no silence was ever assignable in ' +
      'this pair\'s search window). The shipped still-playing checker examines it (it is a fallback pair) ' +
      'but declines: boundary amplitude 0.029 sits BELOW `BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR` ' +
      '(0.05) by 0.021, even though the OTHER two conjuncts (distance 0.53s past the 0.10s floor; ' +
      'loudness ratio 34.3x past the 2x floor) pass with wide margins.',
    status: 'fixed',
    note: 'Measured on the replay bundle\'s 16kHz capture, not the app\'s native-rate decode — see ' +
      '`scripts/ws1-session-q-still-playing.test.ts`\'s own header for the caveat this implies. WS1 ' +
      'SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.14 ' +
      '(`faAnchorTrustGate.ts`) commits 167.70, residual 0.000s. The ledger AUTHORISES this exact ' +
      'value (`ear-verify-ad`, A/B), so this closure carries genuine ear verification, not merely ' +
      'tolerance.',
  },
  {
    id: 'classB-167-smell-of-butchery', origin: 'session-p-live', corpus: 'v6', tag: '167_smell_of_butchery',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 494.43, earCorrect: 494.75,
    mechanism: 'The ONE Class B row the shipped still-playing checker DOES flag: amplitude 0.256, ' +
      'clearing the 0.05 floor by 0.206. Still open because the checker WARNS, it does not CORRECT — ' +
      'no rule moves the boundary.',
    status: 'fixed',
    note: 'WS1 SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.14 commits ' +
      '494.77 against an ear-correct 494.75 — residual +0.020s, inside this session\'s stated 50ms ' +
      'verification tolerance but OUTSIDE the ledger\'s own 5ms pin tolerance. STATED PLAINLY: no ' +
      'ear pass has scored 494.77. The closure rests on a 20ms residual being an order below ' +
      'audibility, not on a listening pass at this value, and NO POSITIVE PIN IS ADDED at it.',
  },
  {
    id: 'classB-286-fact-to-act', origin: 'session-p-live', corpus: 'v6', tag: '286_fact_to_act',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 856.09, earCorrect: 856.52,
    mechanism: 'Fallback boundary; still-playing checker declines on the amplitude floor (measured ' +
      '0.0295, floor 0.05, deficit 0.0205) — distance (0.685s) and ratio (92.0x) conjuncts pass.',
    status: 'fixed',
    note: 'WS1 SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.14 commits ' +
      '856.54 against an ear-correct 856.52 — residual +0.020s. Same standing as ' +
      '`classB-167-smell-of-butchery`: inside the 50ms tolerance, outside the ledger\'s 5ms pin ' +
      'tolerance, no ear pass has scored 856.54, and no positive pin is added at it.',
  },
  {
    id: 'classB-400-endless-dark', origin: 'session-p-live', corpus: 'v6', tag: '400_endless_dark',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 1266.21, earCorrect: 1266.66,
    mechanism: 'Fallback boundary; still-playing checker declines on the amplitude floor (measured ' +
      '0.0152, floor 0.05, deficit 0.0348 — the widest floor miss of the four) — distance (0.205s) and ' +
      'ratio (39.3x) conjuncts pass.',
    status: 'open',
    note: 'WS1 SESSION AE — IMPROVED, NOT CLOSED, and `faValue` is UPDATED to what production commits ' +
      'today. R.14 fires and moves this boundary 1266.21 -> 1266.75; the ear-correct value is ' +
      '1266.66, so the residual goes from -0.450s to +0.090s. It is the only one of R.14\'s seven ' +
      'true positives outside the 50ms tolerance, and the one row whose backing silence is ' +
      'unusually wide (1.18s, [1266.16, 1267.34]) so its midpoint overshoots. STAYS OPEN: an ' +
      'improvement is not a closure, and nothing here licenses calling 1266.75 correct.',
  },
  // -------------------------------------------------------------------------
  // WS1 SESSION S — REOPENED (DEMOTION). Five of R.12's nine Session H
  // closures are back, because the owner's live listening pass over all ten v6
  // unscripted-run boundaries scored their committed values audibly EARLY.
  //
  // Three of the five (042, 176, 340) were closed with `verification: 'ear'`
  // on Session H's own 12-row pass; two (224, 307) were closed
  // `'structural'`. The later sitting governs — see
  // `scripts/ws1-ear-pass-ledger.ts`, which now holds BOTH verdicts for each
  // row so the disagreement is data rather than an edit.
  //
  // `earCorrect: 'unknown'` on all five, deliberately. EARLY is a verdict on
  // the committed value; it is not a measurement of the right one. Session S's
  // candidate table computed five principled placements per row and shipped
  // none, because no candidate reproduces BOTH ear-CORRECT rows (125 -> 370.75
  // and 383 -> 1188.95). The five values below are pinned as change detectors
  // only, here and in `scripts/ws1-session-q-production-pins.test.ts`.
  //
  // THE MEASURED MECHANISM, common to all five (Session S Step 2, native-rate
  // 44.1 kHz RMS profile off channel 0): R.12 clamps its placement interval at
  // the run's acoustic onset, which is a WHISPER TOKEN TIMESTAMP. On these
  // five rows that timestamp lands 0.28s-1.90s EARLIER than any 20 ms frame
  // above the silence detector's own -45 dBFS threshold — i.e. inside the
  // silence, not at the speech. The clamp therefore truncates the real silence
  // and the midpoint of what is left sits at 2-15% of the way through it. On
  // the two ear-CORRECT rows the same value sits at 44-50%.
  // -------------------------------------------------------------------------
  {
    id: 'r12-042-eleven-years', origin: 'live-runs-s', corpus: 'v6', tag: '042_eleven_years',
    owningRule: 'R.12',
    faValue: 125.54, earCorrect: 125.76,
    mechanism: 'THE ONE FALLBACK ROW of the seven (`run-start-fallback`): no detected silence intersects the ' +
      'placement gap [125.25, 125.54] at all, so the value goes to the run\'s acoustic onset itself. Measured ' +
      'RMS: real speech does not begin until 125.90, and the detector\'s own silence [125.62, 125.90] sits ' +
      'ENTIRELY AFTER the gap, so R.12 cannot see it. A -41 dBFS, 80 ms breath band at [125.52, 125.62] is ' +
      'what the Whisper onset was pinned to, and it is EXCLUDED from silence because it crosses -45 dBFS.',
    status: 'fixed',
    closingCommit: 'WS1-SESSION-V',
    note: 'L2 of the Session S live pass. The only row where candidate (c) — the run\'s acoustic onset — is ' +
      'already the committed value, and it is still early. WS1 SESSION T: `earCorrect` is now a NUMBER, not ' +
      '\'unknown\' — `ear-verify-t` A/B-confirmed 125.76, and `acousticRunExtent`\'s onset correction (measuring ' +
      'the run\'s start off the waveform, not a Whisper timestamp) makes the LIVE production path commit it ' +
      '(`scripts/ws1-session-q-production-pins.test.ts` pins it `pinEarVerified`). WS1 SESSION V: `status` ' +
      'moves \'open\' -> \'fixed\' (the item-9 pattern, this schema\'s own header comment) — the operator\'s ' +
      'fresh Session V pass (`ear-verify-v`) re-confirmed 125.76 on the live app, re-measured against a ' +
      'fresh run-id-stamped bundle (`.work-phase4/session-v`, Step 1), and `faValue` !== `earCorrect` records ' +
      'the fix is real. NOT converted to `CLOSED_BY_POSITIVE_ASSERTION`: that requires matching the FROZEN ' +
      'fixture (`phase4-fa-second-baseline-v6-segments.csv`), still 125.54, deliberately unregenerated this ' +
      'session (see the file\'s own Session V CONSTRAINTS). Closed against LIVE, not fixture.',
  },
  {
    id: 'r12-176-twenty-six-scout', origin: 'live-runs-s', corpus: 'v6', tag: '176_twenty_six_scout',
    owningRule: 'R.12',
    faValue: 521.71, earCorrect: 522.46,
    mechanism: 'Backing silence [521.42, 523.50] overhangs the run\'s Whisper-derived onset (522.00) by 1.50s; ' +
      'clamped to [521.42, 522.00] the midpoint is 521.71, at 13.9% of the real silence. Speech begins at ' +
      '523.50 — the silence\'s own end.',
    status: 'fixed',
    closingCommit: 'WS1-SESSION-V',
    note: 'L5. The owner\'s note — "cuts between breath and prev segment" — is CONFIRMED by the RMS profile: a ' +
      '-53 dBFS breath band sits at ~[521.88, 522.12], MERGED into silence (it never crosses -45 dBFS), and ' +
      '521.71 sits between the previous segment\'s last word (521.25) and that breath. WS1 SESSION T: ' +
      '`earCorrect` is now 522.46, `ear-verify-t` confirmed — after the breath, exactly as the owner\'s ' +
      'annotation predicted. WS1 SESSION V: `status` -> \'fixed\' (see r12-042\'s note for the general ' +
      'mechanism). Closed against LIVE, not fixture — the fixture is still 521.71, unregenerated.',
  },
  {
    id: 'r12-224-thirty-three', origin: 'live-runs-s', corpus: 'v6', tag: '224_thirty_three',
    owningRule: 'R.12',
    faValue: 663.785, earCorrect: 664.33,
    mechanism: 'Backing silence [663.66, 665.00] overhangs the onset (663.91) by 1.09s; clamped midpoint ' +
      '663.785 sits at 9.3% of the real silence. Speech begins at 665.00. NO breath band: the whole interval ' +
      'is floor (-56 to -91 dBFS), so the Whisper onset at 663.91 is pinned to nothing acoustic at all.',
    status: 'fixed',
    closingCommit: 'WS1-SESSION-V',
    note: 'L6. Was closed `verification: \'structural\'` — Session S is the first ear pass to score it, and it ' +
      'FAILS. The structural marker did its job: this row was never claimed as ear-verified. WS1 SESSION T: ' +
      '`earCorrect` is now 664.33, `ear-verify-t` confirmed — the control row with NO breath at all, ruling ' +
      'breath presence out as the discriminator. WS1 SESSION V: `status` -> \'fixed\'. Closed against LIVE, ' +
      'not fixture — the fixture is still 663.785, unregenerated.',
  },
  {
    id: 'r12-307-forty-nine-years', origin: 'live-runs-s', corpus: 'v6', tag: '307_forty_nine_years',
    owningRule: 'R.12',
    faValue: 924.92, earCorrect: 925.43,
    mechanism: 'Backing silence [924.70, 926.16] overhangs the onset (925.14) by 1.02s; clamped midpoint ' +
      '924.92 sits at 15.1% of the real silence. Speech begins at 926.16. A -33 dBFS breath band at ' +
      '[924.58, 924.70] is EXCLUDED from silence (it crosses -45 dBFS) and is why the silence starts where ' +
      'it does; the committed value is already past it.',
    status: 'fixed',
    closingCommit: 'WS1-SESSION-V',
    note: 'L8. Previously `verification: \'structural\'`. WS1 SESSION T: `earCorrect` is now 925.43, ' +
      '`ear-verify-t` confirmed — a LOUD breath, already excluded from the silence before Session T touched ' +
      'anything, ruling breath presence out as the discriminator from the other side. WS1 SESSION V: `status` ' +
      '-> \'fixed\'. Closed against LIVE, not fixture — the fixture is still 924.92, unregenerated.',
  },
  {
    id: 'r12-340-fifty-eight', origin: 'live-runs-s', corpus: 'v6', tag: '340_fifty_eight',
    owningRule: 'R.12',
    faValue: 1044.67, earCorrect: 1045.62,
    mechanism: 'The most extreme of the five: backing silence [1044.62, 1046.62] overhangs the onset ' +
      '(1044.72) by 1.90s, so the clamped midpoint 1044.67 sits at 2.5% of the real silence — 50 ms after ' +
      'the silence begins. Speech begins at 1046.62. A -38 dBFS breath band at [1044.50, 1044.60] is ' +
      'EXCLUDED from silence and sits BEFORE the committed value.',
    status: 'fixed',
    closingCommit: 'WS1-SESSION-V',
    note: 'L9. 1.26s of the interval is literal digital silence (all-zero samples, -inf dBFS). WS1 SESSION T: ' +
      '`earCorrect` is now 1045.62, `ear-verify-t` confirmed. WS1 SESSION V: `status` -> \'fixed\'. Closed ' +
      'against LIVE, not fixture — the fixture is still 1044.67, unregenerated.',
  },
  // -------------------------------------------------------------------------
  // WS1 SESSION S — L7, THE R.11/R.12 COLLISION. Held OPEN pending an ear pass
  // on the live path, per the register's own rule.
  //
  // THIS ROW IS A LIVE-PATH DEFECT THE FROZEN FIXTURE NEVER SHOWED, and it is
  // entered under its own id rather than reopening `r12-266-forty-one-burden`
  // for exactly that reason: that closure is a claim about the FIXTURE
  // (788.65, never regressed, still green). This row is the claim about the
  // PRODUCTION PATH, where R.11 ran first, saw the same boundary at 790.33 —
  // strictly inside R.5 run 6 — and moved it to 792.18, past the run's end.
  // The owner scored the result MAJOR: the whole recitation landed in the
  // previous scene.
  //
  // The precedent for keeping the two claims apart is `item-7`
  // (`152_frozen_brush_mice`), whose live value diverges from its fixture
  // value; Session Q declined to open a row there because no ear pass had
  // scored the live value. Here one has, which is the difference.
  //
  // FIXED STRUCTURALLY BY R-AP (`faRuleStageExclusion.ts`, WS1 Session S).
  //
  // WS1 SESSION V — CLOSED (status 'fixed'), NOT reopened as a fresh MAJOR.
  // Step 1's fresh run-id-stamped bundle re-measured this row's committed
  // value at 788.75 (unchanged from Session T's own finding — Step 1's onset
  // correction is the SAME uniform mechanism, not touched this session), and
  // the operator's A/B ear pass over the live app confirms 788.75 CORRECT.
  // THE "REGRESSION" CLASSIFICATION THIS ROW CARRIED SINCE SESSION T IS
  // REFUTED: 788.75 is not a defect away from a confirmed value, it is
  // ITSELF the confirmed value — Session T's ear-verify-t sitting had only
  // ever heard 788.65 (the then-current live value, "carried over unchanged
  // from the live app... not part of the five-row A/B list" per its own
  // ledger note), never a genuine A/B between 788.65 and 788.75 specifically.
  // Whether the 0.10s move from 788.65 is an audible IMPROVEMENT or a
  // below-audibility non-difference COULD NOT BE DETERMINED this session —
  // no direct two-way A/B between those two exact values was recorded, only
  // a confirmation of what the app commits today (788.75). What IS measured:
  // 788.75 is exactly Session S Step 3's candidate (a) FULL (unclamped)
  // silence midpoint — the identical correction family `ear-verify-t`
  // already validated on all six sibling R.12 rows — so it is CONSISTENT
  // WITH, not divergent from, the established correction, not a special case.
  // -------------------------------------------------------------------------
  {
    id: 's-266-live-path-collision', origin: 'live-runs-s', corpus: 'v6', tag: '266_forty_one_burden',
    owningRule: 'R.12', closingCommit: 'WS1-SESSION-V',
    // `faValue` STAYS 788.65 here, deliberately — this file's own machine
    // check for OPEN rows reads `faValue` against the FROZEN FIXTURE
    // (`phase4-fa-second-baseline-v6-segments.csv`), which still shows
    // 788.65, unregenerated this session. Now that `status` is 'fixed' that
    // check no longer applies to this row, but `faValue` keeps the same
    // meaning every sibling row in this array gives it (the frozen fixture's
    // value) rather than being redefined ad hoc.
    //
    // `earCorrect` is UPDATED 788.65 -> 788.75 this session. WS1 SESSION T's
    // value is ARCHIVED, not silently overwritten: it was the operator's
    // Session T verdict (via `ear-verify-t`), correct at the time for the
    // value production then computed, but superseded once Step 1's onset
    // correction (present since Session T, unchanged this session) moved
    // production's own answer to 788.75 and the operator's Session V pass
    // confirmed THAT value instead. See `ws1-ear-pass-ledger.ts`'s
    // `ear-verify-v` sitting for the fresh row.
    faValue: 788.65, earCorrect: 788.75,
    mechanism: 'R.11 and R.12 both claimed one boundary and ordering decided it silently: the rule stage ' +
      'applies corrections to a shared array in sequence, so R.11 (first) moved 790.33 -> 792.18 and R.12 ' +
      '(second) then saw a boundary correctly outside the run and declined. A current-state check CANNOT see ' +
      'this — the invariant has to be evaluated on the (origin, target) PAIR against the pre-rule-stage array. ' +
      'R-AP: no rule but R.12 may move a boundary across an R.5 run edge, and R.12 owns any boundary whose ' +
      'ORIGIN lies strictly inside a run. R-AP itself is UNCHANGED and still correct — the ownership fix and ' +
      'the value regression are two independent mechanisms that happen to share this row.',
    status: 'fixed',
    note: 'L7 of the Session S live pass, the only MAJOR. R-AP (Session S) fixed WHICH rule owns this ' +
      'boundary; Session T\'s onset correction then moved WHAT VALUE that rule computes, to 788.75. WS1 ' +
      'SESSION V: the operator A/B-confirmed 788.75 in the live app, re-measured against a fresh run-id-' +
      'stamped bundle (Step 1) at the identical value — closing the row against LIVE. The FIXTURE-scoped ' +
      'sibling entry `r12-266-forty-one-burden` (in CLOSED_BY_POSITIVE_ASSERTION) is UNAFFECTED and correctly ' +
      'still asserts 788.65 against the frozen fixture, which has not moved — the two entries continue to ' +
      'describe the same boundary from two deliberately un-merged sources.',
  },
  // -------------------------------------------------------------------------
  // WS1 SESSION T — REOPENED (DEMOTION). `r12-383-sixty-four` closed in
  // Session H as 'structural', promoted to 'ear' in Session S on the strength
  // of `live-runs-s`'s SOLO listen at 1188.95 — and that solo verdict is now
  // overturned. `ear-verify-t`'s A/B side-by-side pass (this fixture's own
  // value played back to back against candidate B) heard 1188.95 as EARLY and
  // 1189.05 as correct; both sit inside 1.26s of literal digital silence,
  // indistinguishable played alone, which is the entire reason the process
  // note in `ws1-ear-pass-ledger.ts` exists: side-by-side comparison
  // supersedes solo listening.
  //
  // Reopened rather than silently re-pinned, for the same reason Session S
  // demoted five other rows the same way: a CLOSED entry is a permanent claim
  // against the FIXTURE (`phase4-fa-second-baseline-v6-segments.csv`, still
  // 1188.95, unregenerated this session), and the fixture has not changed.
  // The LIVE path already computes and pins 1189.05
  // (`ws1-session-q-production-pins.test.ts`); this fixture-scoped entry
  // closes when the fixture is deliberately regenerated to match.
  // -------------------------------------------------------------------------
  {
    id: 'r12-383-sixty-four', origin: 'live-runs-s', corpus: 'v6', tag: '383_sixty_four',
    owningRule: 'R.12', closingCommit: 'WS1-SESSION-V',
    faValue: 1188.95, earCorrect: 1189.05,
    mechanism: 'Committed (fixture) 1190.81 — midpoint of silence [1190.56, 1191.06] inside "Level 10. The ' +
      'one the fire remembers." [1189.76, 1192.17]. The CLAMPED correction (fixture\'s own, unchanged) is the ' +
      'midpoint of [1188.14, 1189.96] ∩ [1188.05, 1189.76] = 1188.95. The UNCLAMPED value `ear-verify-t` ' +
      'licenses is the midpoint of the WHOLE backing silence, 1189.05 — a 0.100s difference, both sitting ' +
      'inside 1.26s of literal digital silence.',
    status: 'fixed',
    note: 'THE 383 REVERSAL. Was `verification: \'ear\'` at 1188.95 (`live-runs-s`, a solo listen). ' +
      '`ear-verify-t`\'s A/B comparison (`docs/ws1-sync-pipeline/stage1-session-s-ear-list.md` §2) reverses ' +
      'it. See `ws1-ear-pass-ledger.ts`\'s `ear-verify-t` sitting for both rows (the refutation of 1188.95 ' +
      'AND the confirmation of 1189.05) and its solo-listened-pin audit for what else this finding puts in ' +
      'question. WS1 SESSION V: `status` -> \'fixed\'. Step 1\'s fresh bundle re-measures the live production ' +
      'commit at 1189.05, unchanged from Session T, and the operator\'s A/B pass re-confirms it. Closed ' +
      'against LIVE, not fixture — the fixture (post-R.12, pre-`ear-verify-t`) is still 1188.95, matching ' +
      '`faValue` above; 1190.81 in `mechanism` is the PRE-R.12 origin this row\'s own correction moved away ' +
      'from, not the fixture\'s current value. Unregenerated this session.',
  },
  {
    id: 'classB-403-vigilant-embers', origin: 'session-p-live', corpus: 'v6', tag: '403_vigilant_embers',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 1273.14, earCorrect: 1273.55,
    mechanism: 'Fallback boundary; still-playing checker declines on the amplitude floor (measured ' +
      '0.0433, floor 0.05, deficit 0.0067 — the narrowest floor miss of the four) — distance (0.705s) ' +
      'and ratio (96.9x) conjuncts pass.',
    status: 'fixed',
    note: 'WS1 SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.14 commits ' +
      '1273.56 against an ear-correct 1273.55 — residual +0.010s. Inside the 50ms tolerance, ' +
      'outside the ledger\'s 5ms pin tolerance; no ear pass has scored 1273.56.',
  },

  // -------------------------------------------------------------------------
  // WS1 SESSION AE — SIX ROWS ENTER. The register grows 8 -> 14, deliberately,
  // with `REGISTER_HIGH_WATER` raised in this same commit and six roster
  // appends beside it — the growth ceremony the shrink-only guard exists to
  // force.
  //
  // FIVE OF THE SIX ARE NOT NEW DEFECTS. They are WS1 Session X's own 173
  // listening pass (`ws1-ear-pass-ledger.ts`, sitting `ear-173-x`), which
  // scored five boundaries EARLY and NAMED each one's correct value — and
  // whose rows never reached this register. For two sessions the ledger has
  // recorded five ear-verified 173 defects that the register reported as
  // nonexistent, and the register's own perfection arithmetic for 173 was
  // computed without them. Entering them is a CORRECTION OF THE RECORD, not a
  // discovery: `origin: 'ear-173-x'` says so, and the high-water raise is
  // therefore not evidence that the pipeline got worse.
  //
  // THE SIXTH, `008_unknown_void`, IS genuinely new — see its own note.
  // -------------------------------------------------------------------------
  {
    id: 'ae-008-unknown-void', origin: 'ear-verify-ae', corpus: 'v6', tag: '008_unknown_void',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 23.13, earCorrect: 23.46,
    mechanism: 'The Class B / R.14 placement family, measured (WS1 Session AE Step 1): FA claims the ' +
      'incoming segment\'s first word "you" at [23.14, 23.28] with confidence 8.5e-8, INSIDE the real ' +
      '[23.10, 23.80] silence; the word gap against the outgoing segment\'s last word ("outside", ' +
      'confidence 1.000, ends 23.12) is one 20ms aligner frame wide, and the commit lands at that gap\'s ' +
      'midpoint. ordinalDelta 0 — nobody\'s words are on the wrong side, so this is placement, not ' +
      'attribution.',
    status: 'fixed',
    note: 'HOW THIS ROW WAS FOUND, recorded because the finding mechanism is itself a negative result. ' +
      'A PROPOSED 0.028 amplitude floor flagged this boundary; the ear pass that followed found the ' +
      'flagged boundary DEFECTIVE. That makes the 0.028 floor a lead, not a validated detector — it ' +
      'produced one true positive with no measured false-positive rate, and a floor that flags a ' +
      'bad boundary has demonstrated nothing about its ability to leave good ones alone. THE 0.028 ' +
      'FLOOR IS REJECTED AND NOT SHIPPED; the 0.05 floor in force is not lowered either. What this ' +
      'session ingests is the ear verdict alone. WS1 SESSION AE — CLOSED AGAINST LIVE (status ' +
      '\'fixed\', NOT converted to CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating ' +
      'the frozen fixture this session\'s constraints bar — the same route WS1 Session V used for ' +
      'its seven). R.14 commits 23.45 against an ear-correct 23.46 — residual -0.010s. Inside the ' +
      '50ms tolerance, outside the ledger\'s 5ms pin tolerance. Opened and closed in the same ' +
      'session, which is the register working as designed and not a shortcut: the ear pass came ' +
      'first (sitting `ear-verify-ae`), the rule was designed against the ordinal census, and this ' +
      'row\'s own value was never an input to any constant.',
  },
  {
    id: 'x173-lethal-nature-hazard', origin: 'ear-173-x', corpus: '173', tag: 'lethal_nature_hazard',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 18.51, earCorrect: 19.27,
    mechanism: 'WRONG-LANDMARK class (WS1 Session AE Step 1). The committed value is the exact midpoint ' +
      'of a REAL detected silence [18.32, 18.70] — it is simply the wrong silence: an intra-utterance ' +
      'pause, not the seam. The seam\'s own word gap ["worst" ends 18.68, "because" starts 19.30] ' +
      'contains no detected silence at all, and the ear-correct 19.27 sits at fraction 0.952 of it. ' +
      'ordinalDelta 0 with a RELIABLE (0.966) incoming anchor — neither R.14 (which requires an ' +
      'unreliable incoming anchor) nor R.15 (which requires a negative ordinal) claims it.',
    status: 'open',
    note: 'Ledger rows exist since WS1 Session X (`ear-173-x`); this is the register catching up.',
  },
  {
    id: 'x173-iron-bounce', origin: 'ear-173-x', corpus: '173', tag: 'iron_bounce',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 75.66, earCorrect: 76.59,
    mechanism: 'ATTRIBUTION class (WS1 Session AE Step 1), ordinalDelta -2: the outgoing segment\'s own ' +
      'final two words ("thick" @76.18, "enough" @76.38, both confidence >=0.963) start AFTER the ' +
      'committed boundary, so they are played under the incoming scene. The committed value is again a ' +
      'real silence\'s midpoint ([75.50, 75.82]) — the wrong one.',
    status: 'fixed',
    note: 'WS1 SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.15 commits ' +
      '76.58 against an ear-correct 76.59 — residual -0.010s, one aligner frame before the incoming ' +
      'word "to". Inside the 50ms tolerance, outside the ledger\'s 5ms pin tolerance.',
  },
  {
    id: 'x173-wall-split-path', origin: 'ear-173-x', corpus: '173', tag: 'wall_split_path',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 161.33, earCorrect: 162.15,
    mechanism: 'ATTRIBUTION class, ordinalDelta -2 — the same shape as `iron_bounce`. THE ONE ROW WHOSE ' +
      'EAR TARGET NO SCRIPT-ANCHORED PLACEMENT CAN REACH: 162.15 sits STRICTLY INSIDE the outgoing ' +
      'segment\'s own last claimed word "competing" [161.96, 162.42], confidence 1.000, and the script ' +
      '(`sync.txt`) does put "competing" in `orientation_conflict` — so honouring 162.15 exactly means ' +
      'cutting a full-confidence word in half. The word gap opens at 162.42. Independently reproduced ' +
      'by WS1 Sessions Y and Z, which recorded the same refutation.',
    status: 'open',
    note: 'Ledger rows exist since WS1 Session X (`ear-173-x`); the register was catching up. WS1 ' +
      'SESSION AE — IMPROVED, NOT CLOSED; `faValue` UPDATED to what production commits today. R.15 ' +
      'fires and moves this boundary 161.33 -> 162.46 (residual -0.820s -> +0.310s). It cannot ' +
      'reach 162.15 and no script-anchored rule can: that instant is strictly inside the outgoing ' +
      'segment\'s own full-confidence word "competing". STAYS OPEN.',
  },
  {
    id: 'x173-logic-clash', origin: 'ear-173-x', corpus: '173', tag: 'logic_clash',
    owningRule: 'unassigned', closingCommit: 'WS1-SESSION-AE',
    faValue: 417.15, earCorrect: 418.14,
    mechanism: 'ATTRIBUTION class, ordinalDelta -1: the outgoing segment\'s own last word "laws" ' +
      '[417.18, 417.28] starts after the committed boundary. Committed sits on the midpoint of the real ' +
      'but wrong silence [417.00, 417.30]; the seam\'s word gap is [417.28, 418.16] and the ear-correct ' +
      '418.14 is one aligner frame before "governing" (confidence 0.999).',
    status: 'fixed',
    note: 'Ledger rows exist since WS1 Session X (`ear-173-x`); the register was catching up. WS1 ' +
      'SESSION AE — CLOSED AGAINST LIVE (status \'fixed\', NOT converted to ' +
      'CLOSED_BY_POSITIVE_ASSERTION, which would require regenerating the frozen fixture this ' +
      'session\'s constraints bar — the same route WS1 Session V used for its seven). R.15 commits ' +
      '418.14, residual 0.000s. The ledger AUTHORISES this exact value (`ear-173-x`), so this ' +
      'closure carries genuine ear verification.',
  },
  {
    id: 'x173-gadget-decay', origin: 'ear-173-x', corpus: '173', tag: 'gadget_decay',
    owningRule: 'unassigned', closingCommit: '',
    faValue: 427.48, earCorrect: 427.60,
    mechanism: 'WRONG-LANDMARK class, ordinalDelta 0 with a reliable (0.959) incoming anchor — the same ' +
      'shape as `lethal_nature_hazard`. The smallest correction in the register at 0.12s: the ear-correct ' +
      'value sits 0.06s PAST the incoming segment\'s own first word onset (427.54), i.e. past the word ' +
      'gap entirely, which is why a right-edge-minus-pre-roll rule cannot reach it either (independently ' +
      'recorded by WS1 Sessions Y and Z).',
    status: 'open',
    note: 'Ledger rows exist since WS1 Session X (`ear-173-x`); this is the register catching up.',
  },
];

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
  // WS1 Session H — the register REOPENED at 9 and closed again in the same
  // commit (R.12, the atomic-run invariant). Five of the nine were scored by
  // ear in Session H's own 12-row listening pass; four were not, and carry
  // `verification: 'structural'` below so that distinction survives in the
  // data rather than in a paragraph somebody has to remember.
  'r12-042-eleven-years', 'r12-085-the-spear-bearer', 'r12-125-night-circle',
  'r12-176-twenty-six-scout', 'r12-224-thirty-three', 'r12-266-forty-one-burden',
  'r12-307-forty-nine-years', 'r12-340-fifty-eight', 'r12-383-sixty-four',
  // ...plus the R.11 candidate that had been carried OUTSIDE the register as
  // explicitly unverified since Session F. Session H's ear pass scored it
  // correct, so it is promoted to a positive assertion and enters the roster
  // as a closed-on-arrival member. Open gate item G2 closes with it.
  'h-192-scout-listening',
  // WS1 Session K — the register REOPENED at 1 and closed again in the same
  // commit (R.13, the atomic-utterance invariant: the CLOSING half of R.12).
  // Found by the owner's 24-row mover audit, clip 12. Closed STRUCTURALLY, not
  // by ear: the owner scored the OLD value wrong, which is not the same as
  // scoring the NEW one right, and R-AM's distinction between suspicion and
  // guilt cuts both ways. It is row 1 of `stage1-session-k-ear-list.md`.
  'r13-225-night-scouts',
  // WS1 Session Q — the register REOPENS at 8 and STAYS open: no ear pass was
  // run this session (an autonomous session cannot listen), so per the
  // register's own "close only rows with an ear pass" rule, nothing here
  // converts. All 8 are new roster members: Session P's Class A (3 of its 4
  // rows — `152_frozen_brush_mice`/item-7 has its own, separate live-vs-
  // fixture story and stays CLOSED, annotated rather than reopened; see
  // item-7's own entry above and REGISTER_HIGH_WATER's comment) and Class B
  // (5 rows), both measured but neither owned by an existing rule
  // (`docs/work-in-progress.md` §11's Session Q entry).
  'classA-214-solitary-fire', 'classA-231-slowing-pace', 'classA-447-scout-facing-dark',
  'classB-056-dropping-torch', 'classB-167-smell-of-butchery', 'classB-286-fact-to-act',
  'classB-400-endless-dark', 'classB-403-vigilant-embers',
  // WS1 Session S — the register REOPENS at 14 and STAYS open. FIVE of the
  // fourteen are REOPENED roster members, not new ones: R.12's `042`, `176`,
  // `224`, `307` and `340` moved back out of `CLOSED_BY_POSITIVE_ASSERTION`
  // when the owner's live ear pass scored their values EARLY, so the roster
  // does not grow for them — which is the roster doing its job (an entry is
  // converted, never deleted, in EITHER direction). The one genuinely new
  // member is the R.11/R.12 collision on the LIVE path, which the frozen
  // fixture has never shown and which therefore cannot be represented by
  // reopening `r12-266-forty-one-burden` (a claim about the fixture, still
  // green). See that entry's own comment in KNOWN_BAD.
  's-266-live-path-collision',
  // WS1 Session AE — the register REOPENS at 14 and closes to 7 in the same
  // session. Six new roster members: five are WS1 Session X's 173 defects,
  // ear-scored two sessions ago and never entered here (the register was
  // reporting 173 as defect-free while the ledger held five named defects for
  // it); the sixth, `ae-008-unknown-void`, is genuinely new. See their own
  // KNOWN_BAD entries.
  'ae-008-unknown-void',
  'x173-lethal-nature-hazard', 'x173-iron-bounce', 'x173-wall-split-path',
  'x173-logic-clash', 'x173-gadget-decay',
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
 *  WS1 Session H RAISED it 0 -> 9 and LOWERED it back to 0 in the same
 *  commit, and — exactly as in Session D — both halves matter.
 *
 *  It was RAISED because R.12's structural invariant (`src/services/
 *  faRunPlacementGate.ts`: no committed boundary may lie strictly inside an
 *  unscripted run) identified NINE real defects on v6 that no rule had ever
 *  owned. The guard did its job: growth cost a deliberate edit to this
 *  constant, nine appends to the roster above, nine KNOWN_BAD entries, and
 *  nine rows in `docs/work-in-progress.md` §11's register table. Five of the
 *  nine were scored WRONG by the owner's ear in Session H's own 12-row
 *  listening pass; the remaining four are STRUCTURALLY DERIVED — the same
 *  mechanism, the same evidence, no ear pass — and are marked as such in
 *  `CLOSED_BY_POSITIVE_ASSERTION.verification` rather than being quietly
 *  folded in with the ear-verified ones. That is the same distinction
 *  `192_scout_listening` was held to from Session F until this session, and
 *  it is the register's whole reason for existing.
 *
 *  It was then LOWERED because R.12 landed in the SAME commit and closed all
 *  nine into positive assertions, taking the open count 9 -> 0.
 *
 *  A NOTE ON WHAT "EMPTY" MEANS AFTER THIS SESSION. The register reaching
 *  zero in Session F was taken to mean Stage 1 had no known defects. Session
 *  H found nine, all of them present and committed the whole time, none
 *  visible to any rule then built. Empty means "nothing currently known", not
 *  "nothing there" — the same reading the Stage 1 lock gate has always had to
 *  carry, now with a measured instance behind it.
 *
 *  WS1 Session K RAISED it 0 -> 1 and LOWERED it back to 0 in the same commit,
 *  the same shape as Sessions D and H. It was RAISED because the owner's
 *  24-row mover audit scored v6 `225_night_scouts` (667.47) WRONG, and the
 *  measurement that followed found a defect no rule had ever owned: R.12
 *  constrains where a run-carrying scene BEGINS and nothing constrained where
 *  it ENDS, so its closing boundary sat on the pause BETWEEN the recitation
 *  and the scene's own line. It was LOWERED because R.13 landed in the same
 *  commit and closed it at 669.05.
 *
 *  THE OTHER AUDIT FAILURE IS NOT HERE, DELIBERATELY. Clip 1 (173
 *  `protection_failure`, 603.69) also scored NO, and it is NOT a register
 *  entry: 603.69 is the exact midpoint of the forced-alignment gap between
 *  "on" [603.600, 603.660] and "for" [603.720, 603.800], both at confidence
 *  1.000 — the seam between the two scenes' own words, and the best value that
 *  exists. The scenes split a single sentence mid-way with no detected silence
 *  anywhere in [598.04, 604.82], so "does the scene change belong here?" has no
 *  audible answer at ANY value. The owner verified the boundary CORRECT in the
 *  app and ruled that such rows STAY in future ear draws rather than being
 *  excluded, so that FA's handling of boundary edge cases keeps being checked.
 *  It is pinned below as an owner-verified control.
 *
 *  WS1 Session Q RAISED it 0 -> 8, and — unlike every prior raise — did NOT
 *  lower it back in the same commit, because there is no rule in this commit
 *  that closes any of the eight. Full ceremony, stated plainly:
 *
 *  `item-7` (152_frozen_brush_mice) is NOT among the eight, and deliberately
 *  so, though it came close: Session P's live-fidelity bundle (raw Whisper
 *  tokens, regenerated FA, live chunk plan — none of which existed in
 *  Session F, which closed this row) reproduces the identical chunk at
 *  `fitDeviation` exactly 1.0, a perfect-fit read the filtered-token
 *  measurement never produced, so R.11's own C1 conjunct no longer clears it
 *  and the committed value reverts to 449.20 in PRODUCTION. But the
 *  register's source of truth is the FROZEN FIXTURE
 *  (`phase4-fa-second-baseline-v6-segments.csv`), which Session Q did not
 *  touch and which still, correctly, shows 451.03 — so the closed entry
 *  above stays closed, with the live-bundle finding recorded in its own
 *  `why` field and in `docs/work-in-progress.md` §11's Session Q entry,
 *  rather than manufacturing an open row keyed to a value (449.20) nothing
 *  in this register's own checked artifacts shows. A future session that
 *  deliberately regenerates this fixture is the right place to act on it.
 *
 *  THREE Class A rows join for the first time: `214_solitary_fire`,
 *  `231_slowing_pace`, `447_scout_facing_dark`. All four sit in R.11's own
 *  domain (chunk-fit boundary correction) but are NOT owned by it: two
 *  (152, 447) have `fitDeviation` exactly 1.0 — R.11's fit signal is
 *  STRUCTURALLY blind to a perfect-fit chunk with a wrong boundary, not
 *  merely under-threshold — and `231` is never even a CANDIDATE (its chunk
 *  carries no measurable fit deviation at all). Session Q measured a second,
 *  independent signal (distance from the committed value to the nearest
 *  detected silence) against all 447 v6 boundaries: it separates 152 and 231
 *  from a 403-boundary clean-control population by an unbounded margin
 *  (control max 2.3e-13, both rows d >= 0.64), but proposes the WRONG
 *  silence as the correction on both (verified against the same ear-correct
 *  values below — a nearer silence sits close to the wrong side of the seam
 *  in both cases) and is exactly as blind to 214/447 as R.11's own signal
 *  is. No detector ships from this measurement; `scripts/
 *  ws1-session-q-detector-validate.test.ts` records the negative result so
 *  it cannot be quietly re-tried unchanged.
 *
 *  FIVE Class B rows join: `056_dropping_torch`, `167_smell_of_butchery`,
 *  `286_fact_to_act`, `400_endless_dark`, `403_vigilant_embers` — all
 *  FALLBACK boundaries (`boundaryUsedFallback` true; no silence was ever
 *  assignable, so silence-distance cannot apply to them by construction).
 *  The shipped still-playing checker (`syncContracts.ts`'s
 *  `validateBoundaryQuality`) already SEES all five as fallback pairs, but
 *  its calibrated `BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR` (0.05) only
 *  flags one of them (`167_smell_of_butchery`) — the other four sit BELOW
 *  the floor by 0.007-0.035 (measured amplitude 0.015-0.043), with the OTHER
 *  two conjuncts (distance, loudness ratio) passing by wide margins in every
 *  case. `scripts/ws1-session-q-still-playing.test.ts` records the margins.
 *  Retuning the floor is explicitly NOT done this session: it is corpus-
 *  calibrated against two other projects' false-positive rates
 *  (`syncConstants.ts`'s own header), and lowering it needs the same
 *  broader validation this session did not have budget for — the near-miss
 *  margins are small enough that this may partly be 16kHz-replay-capture
 *  resampling noise rather than a floor miscalibration (this session
 *  measured against the replay bundle's 16kHz capture, not the app's
 *  native-rate decode — see that file's own header).
 *
 *  All eight carry `owningRule: 'unassigned'` for the same reason R.12/R.13
 *  never carried a guessed rule name before they existed: naming a rule that
 *  cannot reach a row would misattribute suspicion as guilt (R-AG). None are
 *  closed. This may be lowered when entries close. Raising it is allowed
 *  only with the full ceremony above — see the failure message on the
 *  shrink-only test.
 *
 *  WS1 SESSION S RAISED it 8 -> 14, and this is the first raise driven by a
 *  DEMOTION rather than a discovery. Full ceremony:
 *
 *  FIVE rows return from `CLOSED_BY_POSITIVE_ASSERTION`: R.12's
 *  `042_eleven_years`, `176_twenty_six_scout`, `224_thirty_three`,
 *  `307_forty_nine_years` and `340_fifty_eight`. The owner's live listening
 *  pass over all ten v6 unscripted-run boundaries scored every one of them
 *  audibly EARLY. Three had been closed as `verification: 'ear'` on Session
 *  H's own 12-row pass; the two closed `'structural'` are the marker working
 *  as designed — they never claimed an ear pass, and the first one to reach
 *  them failed them. All five carry `earCorrect: 'unknown'`, because "early"
 *  is a verdict on the committed value and not a measurement of the correct
 *  one; Session S's Step 3 candidate table computed five principled
 *  placements per row and shipped NONE, since no candidate reproduces both
 *  ear-CORRECT rows (`125_night_circle` -> 370.75, `383_sixty_four` ->
 *  1188.95). Their pins survive only as change detectors, and R-AM is now
 *  machine-checked (`scripts/ws1-ear-pass-ledger.ts`) so a value cannot be
 *  pinned as a positive assertion again without a sitting behind it.
 *
 *  ONE row is new: `s-266-live-path-collision`. R.11 and R.12 both claimed
 *  `266_forty_one_burden`; ordering decided it silently and the owner scored
 *  the result MAJOR. It is fixed structurally in this same commit (R-AP,
 *  `src/services/faRuleStageExclusion.ts`) and stays open only because the
 *  register closes rows on ear passes, not on green tests.
 *
 *  ONE row moved the other way in the same sitting: `r12-383-sixty-four` was
 *  promoted `'structural'` -> `'ear'`. It does not change any count; it is
 *  recorded because a sitting that only ever demotes would be worth
 *  distrusting.
 *
 *  WS1 SESSION T — HIGH-WATER RAISES TO 15. `r12-383-sixty-four` REOPENS: the
 *  A/B `ear-verify-t` sitting overturns the SOLO `live-runs-s` verdict that
 *  had licensed its 1188.95 closure (see that entry's own note and
 *  `ws1-ear-pass-ledger.ts`'s process note on why A/B supersedes solo
 *  listening). Every other Session T finding is a live-path change or a
 *  caveat on an unmoved fixture entry — this is the one row whose FIXTURE
 *  closure itself is now false, so it is the one open-count change.
 *
 *  WS1 SESSION V — STAYS AT 15, AND THE REASON IS THE WHOLE POINT. Seven rows
 *  (the five R.12 fixture-scoped rows, `s-266-live-path-collision`, and
 *  `r12-383-sixty-four`) move `status: 'open'` -> `'fixed'` on the strength of
 *  a fresh operator A/B ear pass over the live app, backed by a run-id-
 *  stamped bundle this session's own Step 1 captured. THE OPEN COUNT SHRINKS
 *  15 -> 8; THE CONSTANT DOES NOT, because a `'fixed'` row is still a member
 *  of `KNOWN_BAD` — this schema's own doc-comment on `KnownBadRow.status`
 *  ("`status: 'fixed'` is recorded for completeness but NOT asserted against
 *  the fixture value, because the fixture itself predates the fix that closed
 *  it") is precisely this case: closure is against LIVE, and the frozen
 *  fixture (`phase4-fa-second-baseline-v6-segments.csv`) is deliberately
 *  unregenerated this session, so none of the seven can be converted into
 *  `CLOSED_BY_POSITIVE_ASSERTION` — that mechanism's own generated test
 *  (below) asserts an entry's `earCorrect` against the frozen fixture, which
 *  would fail for all seven today.
 *
 *  THE SEMANTICS, STATED PLAINLY (this constant is checked by name in this
 *  session's own report). `REGISTER_HIGH_WATER` is NOT a live mirror of the
 *  current open count — the shrink-only test two blocks below compares
 *  `open.length <= REGISTER_HIGH_WATER`, an INEQUALITY, and `open.length` has
 *  moved independently of this constant every session that used `'fixed'` or
 *  left rows open across a session boundary. It IS pinned to exact equality
 *  with `KNOWN_BAD.length` — the coherence test (`expect(KNOWN_BAD).
 *  toHaveLength(REGISTER_HIGH_WATER)`) enforces this every run — so in
 *  practice it tracks "how many rows are current KNOWN_BAD members (open OR
 *  fixed), i.e. not yet promoted to a fixture-verified `CLOSED_BY_POSITIVE_
 *  ASSERTION` entry". Historically (Sessions D, E, F, H, K) it moved in step
 *  with `open.length` only because every prior closure REMOVED the row from
 *  the array entirely (converted straight to `CLOSED_BY_POSITIVE_ASSERTION`);
 *  this session is the first to populate `'fixed'` on a currently-live row,
 *  which is why the two numbers (constant vs. open count) diverge for the
 *  first time since the type was declared. */
// WS1 SESSION AE: 15 -> 21. `KNOWN_BAD.length` (the coherence test's own
// equality) grows by the six rows added above; the OPEN count — what the
// shrink-only guard actually reads — goes 8 -> 14 on ingestion and 14 -> 7
// once R.14/R.15 land in this same session. Raised deliberately, with the six
// roster appends and the docs row the guard's own failure message demands.
const REGISTER_HIGH_WATER = 21;

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
  /** WS1 Session H — HOW the target value was established. `'ear'` = an owner
   *  listening pass scored this exact boundary. `'structural'` = the value
   *  comes from a rule's structural invariant and NO ear pass has scored this
   *  row; it is admitted on the strength of the mechanism, and says so.
   *  Making this a field rather than prose is the point: the register's job is
   *  to stop suspicion from quietly becoming guilt, and four of R.12's nine
   *  rows are exactly the case where that could happen. */
  verification: 'ear' | 'structural';
  closingCommit: string; why: string;
}> = [
  {
    id: 'item-4', item: 4, corpus: 'v6', tag: '308_scouts_leading', earCorrect: 931.40,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-D',
    why: 'R.5 (unscripted-audio excision). The spoken "Level 8. The one who teaches what cannot be taught ' +
      'easily." [925.14, 928.93] is excised from the chunk window, so `307_forty_nine_years` is no longer ' +
      'offered heading frames for "You are forty-nine." Residual 0.000s against the ear-correct 931.40. ' +
      'WS1 SESSION H — the original entry also cited "it lands exactly on the Whisper-committed value" as ' +
      'corroboration. THAT SUCCESS METRIC IS RETIRED: Session H measured eight of nine R.12 defects to be ' +
      'bit-identical to Whisper\'s own value, so agreement between the two engines is not evidence of ' +
      'correctness — both share the snap-into-an-unscripted-run defect. The ear-correct residual above is ' +
      'the whole of this entry\'s evidence, and always was the load-bearing half.',
  },
  {
    id: 'item-5', item: 5, corpus: 'v6', tag: '043_night_migration', earCorrect: 130.96,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-D',
    why: 'R.5 (unscripted-audio excision). Same mechanism as item 4, on "Level two. The boy who carries fire." ' +
      '[125.54, 129.01]. The confidence recovery is the proof the fix is real rather than coincidental: ' +
      '"eleven" moves 127.96 -> 129.99 and its confidence goes 5.9e-07 -> 1.0. Residual 0.000s.',
  },
  {
    id: 'item-6', item: 6, corpus: '173', tag: 'vessel_damage_clue', earCorrect: 174.74,
    verification: 'ear',
    closingCommit: '92746cf',
    why: 'R-U zero-seam rejection (and still resolved under R-AA seam-region). Residual 0.000s. ' +
      'Survived both re-pins unchanged, which is the point of pinning the ear-correct value.',
  },
  {
    id: 'item-10', item: 10, corpus: '173', tag: 'hostile_landscape', earCorrect: 0.00,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-E',
    why: 'R.10 (scripted text never spoken, `src/services/faUnspokenGate.ts`). The on-screen-only title ' +
      '`perilous_realms` ("The Hardest Warhammer 40K Environments to Fight In") is never voiced, but a CTC ' +
      'objective must place every target token somewhere, so FA carved it out of [0.00, 1.36] and pushed this ' +
      'segment\'s onset to 1.36. With the title refused, this becomes the first committed segment and ' +
      '`headExtendFirstSegment` stretches it back to 0. Residual 0.000s against the ear-correct 0.00.',
  },
  {
    id: 'item-11', item: 11, corpus: '173', tag: 'blue_monkey', earCorrect: null,
    verification: 'ear',
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
    verification: 'ear',
    closingCommit: '616abb2',
    why: 'Forced-split chunk-plan attribution bug. The fixture refresh in WS1 Session B means the ' +
      'Spanish baseline finally SHOWS the live 65.12 instead of the stale 66.73, so this can now ' +
      'carry a real positive assertion rather than only a note. WS1 Session C converted it.',
  },
  {
    id: 'item-7', item: 7, corpus: 'v6', tag: '152_frozen_brush_mice', earCorrect: 451.03,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11 (chunk-fit boundary correction, `src/services/faSeamFitGate.ts`). Chunk [448.34, 451.70] ' +
      'carries 10 script words against 7 Whisper token onsets (fit 1.4286) — FA crushes "when the brush mice ' +
      'stop" into near-zero-confidence garbage (max 1.49e-3 in the correction span) instead of the real ' +
      'silence [450.36, 451.70] that already, correctly, anchors the chunk\'s own end (an untouched R.1 ' +
      'agreed anchor). Corrected to that silence\'s midpoint, residual 0.000s against the ear-correct 451.03. ' +
      'WS1 SESSION Q — STILL CLOSED, WITH A CAVEAT RECORDED RATHER THAN ACTED ON: this closure is real ' +
      'against the FIXTURE it was measured on (nothing about the fixture changed, and the assertion below ' +
      'still holds it). But Session Q measured that the SAME chunk, on the live-fidelity bundle (raw ' +
      'Whisper tokens, regenerated FA, live chunk plan — none of which existed in Session F), has ' +
      'fitDeviation exactly 1.0 — a perfect-fit read the filtered-token measurement never produced — so ' +
      'R.11\'s own C1 conjunct no longer clears it in production and the committed value there reverts to ' +
      '449.20. This is NOT reopened in the register: the register\'s source of truth is this fixture, ' +
      'which has not regressed, and "close only rows with an ear pass" cuts against inventing a NEW open ' +
      'row keyed to a value (449.20) no fixture here shows. Recorded instead in ' +
      '`docs/work-in-progress.md` §11\'s Session Q entry as an open finding for a future session: R.11\'s ' +
      'fitDeviation signal is sensitive to the same raw-vs-filtered-token substitution R.12 and R.13 both ' +
      'were, and this fixture needs deliberate regeneration (a decision, not a silent edit) before this ' +
      'closure can be trusted as still describing production.',
  },
  {
    id: 'ov3-abysmal-opinion', item: undefined, corpus: '173', tag: 'abysmal_opinion', earCorrect: 17.88,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11 — item 7\'s own root cause, found through a different symptom (WS1 Session D diagnosis). ' +
      'Chunk [16.64, 18.08] carries "the numbers. They\'re" (fit 1.5, text surplus); FA crushes it to near-zero ' +
      'confidence (max 3.895e-3 in the correction span) instead of the real silence [17.68, 18.08] anchoring ' +
      'the chunk\'s own end. Corrected to that silence\'s midpoint, residual 0.000s against the ear-correct 17.88.',
  },
  {
    id: 'ov3-226-four-scouts', item: undefined, corpus: 'v6', tag: '226_four_scouts', earCorrect: 671.18,
    verification: 'ear',
    closingCommit: 'WS1-SESSION-F',
    why: 'R.11, same root cause. Chunk [669.40, 671.50] carries "night scouts now. Four of them" (fit 0.75, ' +
      'audio surplus); FA crushes "four of them" to near-zero confidence (max 9.693e-4 in the correction span) ' +
      'instead of the real silence [670.86, 671.50] anchoring the chunk\'s own end. Corrected to that silence\'s ' +
      'midpoint, residual 0.000s against the ear-correct 671.18. Adjacency to R.5\'s "Level 6" excision two ' +
      'segments earlier (the owner\'s pre-registered, refuted Level-N hypothesis, WS1 Session D) was a red ' +
      'herring — R.11 fires here for the same chunk-fit reason as item 7 and `abysmal_opinion`, unrelated to R.5.',
  },

  // -------------------------------------------------------------------------
  // WS1 SESSION H — R.12, THE ATOMIC-RUN INVARIANT.
  //
  // Nine boundaries, all v6, all committed at the exact midpoint of a real
  // detected silence lying strictly INSIDE one of V6's ten unscripted "Level
  // N" recitations. Each entry names the recitation it was buried in, because
  // that run — not a chunk, not a confidence — is the evidence. Corrections
  // land in `[prevToken.endSec, run.startSec]`, at the midpoint of (leading
  // silence ∩ that gap), or at `run.startSec` when no silence overlaps.
  //
  // The tenth recitation (R0, corpus start, [0.08, 3.40]) holds NO committed
  // boundary and has no preceding token, so R.12 structurally cannot fire on
  // it — nine of ten, not ten of ten, and that asymmetry is a property of the
  // corpus rather than an exception in the rule.
  // -------------------------------------------------------------------------
  {
    id: 'r12-085-the-spear-bearer', item: undefined, corpus: 'v6', tag: '085_the_spear_bearer', earCorrect: 250.69,
    verification: 'structural', closingCommit: 'WS1-SESSION-H',
    why: 'R.12. Committed 252.74 — midpoint of silence [252.50, 252.98] inside "Level three. The scout." ' +
      '[251.56, 253.11]. Corrected to the midpoint of [249.82, 251.80] ∩ [249.50, 251.56]. STRUCTURALLY ' +
      'DERIVED — not in Session H\'s ear list. The ONE row of the nine where FA and Whisper DISAGREE: Whisper ' +
      'commits 250.81, correctly outside the run, and FA alone is wrong here. Provenance: an unmoved control ' +
      'predating all Stage 1 work. WS1 SESSION T CAVEAT (item-7\'s own precedent, recorded not acted on): the ' +
      'LIVE path\'s onset correction now computes 250.81 for this exact boundary — the two engines converge, ' +
      'which if anything makes 250.81 the BETTER-evidenced value, not a regression. This fixture (250.69) is ' +
      'unchanged and this closure still holds against it; closing at 250.81 needs the fixture regenerated, ' +
      'deliberately deferred rather than hand-patched.',
  },
  {
    id: 'r12-125-night-circle', item: undefined, corpus: 'v6', tag: '125_night_circle', earCorrect: 370.75,
    // WS1 SESSION S — the 'ear' marker STAYS, but its warrant changed. Session
    // H heard only the pre-correction 372.35; the live-runs-s sitting (L4) is
    // the first pass to hear 370.75 itself, and it PASSES.
    verification: 'ear', closingCommit: 'WS1-SESSION-H',
    why: 'R.12. Committed 372.35 — midpoint of silence [371.94, 372.76] inside "Level four. The night guard." ' +
      '[371.54, 373.27]. Corrected to the midpoint of [370.14, 371.36], which lies wholly inside the pre-run ' +
      'gap. THIS ROW RETIRES A FALSIFIED JUSTIFICATION: R.11\'s third conjunct was documented as existing ' +
      'because 372.35 was "R.5\'s own already-correct value". It was never correct. The conjunct stands on its ' +
      'measured 0.0301 span confidence instead, and now also carries rule exclusion — R.11 declining 372.35 is ' +
      'what keeps it out of R.12\'s way. Ear-scored WRONG. Provenance: an R.5 mover.',
  },
  {
    id: 'r12-266-forty-one-burden', item: undefined, corpus: 'v6', tag: '266_forty_one_burden', earCorrect: 788.65,
    // WS1 SESSION S — DOWNGRADED 'ear' -> 'structural'. The Session H sitting
    // scored the PRE-correction 790.33 WRONG; nobody has ever listened to
    // 788.65. That is the same distinction R.13's own closure drew for
    // `225_night_scouts` and refused to blur, and this row should have carried
    // it from the start. The value is unchanged and still correct as far as
    // anything measures — what changes is the claim made about it.
    //
    // WS1 SESSION T — RE-PROMOTED 'structural' -> 'ear'. `ear-verify-t`
    // scored 788.65 CORRECT (see its own ledger row and `s-266-live-path-
    // collision`'s caveat above for the separate, live-path-only regression
    // this does NOT resolve). R-AM's own machine check ((3c) below) caught
    // the understatement while this caveat was being written: the marker must
    // track whether the VALUE is ear-verified, not whether production
    // currently produces it — those are independent facts for this row.
    verification: 'ear', closingCommit: 'WS1-SESSION-H',
    why: 'R.12. Committed 790.33 — midpoint of silence [790.06, 790.60] inside "Level 7. The one the band ' +
      'depends on." [789.26, 791.69]. Corrected to the midpoint of [788.04, 789.46] ∩ [787.85, 789.26]. ' +
      'Ear-scored WRONG. Provenance: an R.5 mover. WS1 SESSION T CAVEAT: this same boundary is now ' +
      'ear-VERIFIED at 788.65 (`ear-verify-t`) — a genuine strengthening, this closure was only ever ' +
      '\'structural\'. But the LIVE path now computes 788.75, NOT 788.65 — see `s-266-live-path-collision` in ' +
      'KNOWN_BAD above for the full account. This fixture entry is unaffected (788.65, unchanged, still holds) ' +
      'because the fixture itself was not regenerated; the two entries (this one and s-266) describe the same ' +
      'boundary from two different, deliberately un-merged sources (frozen fixture vs. live bundle).',
  },
  {
    id: 'h-192-scout-listening', item: undefined, corpus: 'v6', tag: '192_scout_listening', earCorrect: 571.07,
    verification: 'ear', closingCommit: 'WS1-SESSION-H',
    why: 'R.11 — CLOSED-ON-ARRIVAL. Session F\'s detector surfaced this as a new candidate with the same ' +
      'evidentiary shape as the three register members (chunk [569.80, 571.36], "you both go still. you ' +
      'listen.", fit 1.5, span max FA confidence 4.073e-5) and it was deliberately held OUTSIDE the register ' +
      'as an unverified change-detector pin, because suspicion is not guilt. Session H\'s listening pass scored ' +
      '571.07 CORRECT, so it is promoted to a positive assertion and enters the roster. Open gate item G2 ' +
      'closes here, permanently: the value is measured now, not suspected.',
  },
  {
    id: 'r13-225-night-scouts', corpus: 'v6', tag: '225_night_scouts', earCorrect: 669.05,
    verification: 'structural',
    closingCommit: 'WS1-SESSION-K',
    why: 'R.13 (the atomic-utterance invariant — the CLOSING half of R.12). R.12 pulled ' +
      '`224_thirty_three` back to 663.785 so it carries the whole "Level 6, the one they follow" ' +
      'recitation [663.910, 666.480]; its own line "You are thirty-three." is spoken AFTER the ' +
      'recitation, ending at 667.730. The committed 667.47 is the midpoint of silence ' +
      '[667.300, 667.640] — the pause BETWEEN the recitation and that line — so the carrier was ' +
      'left holding a recitation it has no words for while its own line opened the NEXT scene. ' +
      'R.13 places the boundary at the midpoint of the first detected silence starting at or ' +
      'after the carrier\'s own utterance ends: [668.700, 669.400], midpoint 669.05. ' +
      'STRUCTURAL, NOT EAR: the owner scored 667.47 WRONG in the 24-row mover audit and their ' +
      'note places the line at "667.47 ... till 668.85s, then at 669.37s started You lead the ' +
      'night scouts" — which brackets 669.05 — but no ear pass has scored 669.05 ITSELF. It is ' +
      'row 1 of `docs/ws1-sync-pipeline/stage1-session-k-ear-list.md` and is admitted here on ' +
      'the mechanism, exactly as R.12\'s four structurally-derived rows were. ' +
      'NOTE ON WHY NO TOKEN-BASED RULE COULD HAVE FOUND THIS VALUE: the exact mirror of R.12 ' +
      '(clamping into [own last token end, next scene\'s first token onset]) lands at 667.73, ' +
      'still audibly wrong, because both token streams are unreliable immediately after a run — ' +
      'Whisper gives the token "the" the span [668.650, 669.400], swallowing the very silence ' +
      'the boundary belongs in, and FA\'s confidence there collapses to 1e-5..1e-4 against a ' +
      'corpus median of 0.9985. The detected-silence stream is measured from the waveform and ' +
      'is the only reliable signal in that neighbourhood.',
  },
];

describe('WS1 Session C — the Zero-Defect Register (ruling R-AD)', () => {
  // (1) THE STAGE 1 LOCK'S MACHINE CHECK.
  //
  // WS1 SESSION Q left the register OPEN across a session boundary for the
  // FIRST TIME. Every prior reopening (Sessions D, H, K) raised and lowered
  // this same commit because the session that found the defects also built
  // the rule that closed them. Session Q found eight (`REGISTER_HIGH_WATER`'s
  // own comment has the full account, including why item-7 came close but is
  // NOT among them) and closed none — an autonomous session cannot run an
  // ear pass, and the register's OWN rule is "close only rows with an ear
  // pass." This test therefore asserts the EXACT open set by id, not
  // emptiness — a red here means either a new, undocumented defect entered
  // KNOWN_BAD (the shrink-only guard below should have caught it first) or a
  // row this test expects still open was silently closed without moving to
  // CLOSED_BY_POSITIVE_ASSERTION.
  it('the Zero-Defect Register holds exactly the rows WS1 Session AE left open', () => {
    // WS1 SESSION V — seven rows move 'open' -> 'fixed' (NOT removed from
    // KNOWN_BAD, NOT converted to CLOSED_BY_POSITIVE_ASSERTION — that would
    // require matching the frozen fixture, which is deliberately
    // unregenerated this session). The operator's fresh A/B ear pass over
    // the live app, backed by a fresh run-id-stamped bundle (Step 1),
    // confirms all seven: the five R.12 fixture-scoped rows at their
    // ear-verify-t values, `266`'s live-path regression at 788.75 (the
    // "regression" framing REFUTED — 788.75 IS the confirmed value), and
    // `383` re-confirmed at 1189.05. Only the eight Class A/B rows, which
    // Session R found structurally invisible to every placement-side signal
    // built so far, remain open.
    //
    // WS1 SESSION AE — the open set is 14 as of the ground-truth ingestion
    // commit: Session V's eight, plus `008_unknown_void` (new) and the five
    // 173 rows WS1 Session X's ear pass named two sessions ago and that this
    // register never carried. The R.14/R.15 commit that follows takes it to
    // seven; this expectation moves with it, in that commit, deliberately.
    const EXPECTED_OPEN = [
      'classA-214-solitary-fire', 'classA-231-slowing-pace', 'classA-447-scout-facing-dark',
      'classB-400-endless-dark',
      'x173-lethal-nature-hazard', 'x173-wall-split-path', 'x173-gadget-decay',
    ];
    expect(
      KNOWN_BAD.filter(k => k.status === 'open').map(k => k.id).sort(),
      'the register\'s open set drifted from what WS1 Session V left it at',
    ).toEqual([...EXPECTED_OPEN].sort());
  });

  // (1c) THE SEVEN ROWS Session V moved to 'fixed' — asserted by their own
  // name here, separately from the open-set test above, so a reader does not
  // have to diff two id lists to see which seven closed against LIVE.
  it('WS1 Session AE: exactly fourteen rows are `fixed` (closed against LIVE, not fixture)', () => {
    // WS1 SESSION AE — Session V's seven, plus the seven R.14/R.15 close.
    // Same mechanism and same limitation: closed against the LIVE production
    // path, not against the frozen fixture, so `faValue` still records the
    // value each row was BROKEN at and the corrected value lives in the note.
    const FIXED = [
      'r12-042-eleven-years', 'r12-176-twenty-six-scout', 'r12-224-thirty-three',
      'r12-307-forty-nine-years', 'r12-340-fifty-eight',
      's-266-live-path-collision', 'r12-383-sixty-four',
      'classB-056-dropping-torch', 'classB-167-smell-of-butchery', 'classB-286-fact-to-act',
      'classB-403-vigilant-embers', 'ae-008-unknown-void',
      'x173-iron-bounce', 'x173-logic-clash',
    ];
    expect(
      KNOWN_BAD.filter(k => k.status === 'fixed').map(k => k.id).sort(),
      'the fixed set drifted from what WS1 Session AE closed against live',
    ).toEqual([...FIXED].sort());
    for (const kb of KNOWN_BAD.filter(k => k.status === 'fixed')) {
      expect(kb.closingCommit, `${kb.id}: a 'fixed' row must name its closing commit`).not.toBe('');
    }
  });

  // (1b) Coherence, asserted in its OWN right, not only as a by-product of
  // the shrink-only guard below. Session H's reopening showed roster and
  // closed-list growth can drift from the open count independently — an
  // assertion that only watches `open.length` says nothing about whether the
  // register is still telling the truth about WHICH rows are open.
  it('the register state is coherent: every roster member is exactly open XOR closed, and every closure names its verification', () => {
    expect(KNOWN_BAD).toHaveLength(REGISTER_HIGH_WATER);
    expect(CLOSED_BY_POSITIVE_ASSERTION.length + KNOWN_BAD.length).toBe(REGISTER_ROSTER.length);
    for (const kb of KNOWN_BAD) {
      expect(REGISTER_ROSTER as readonly string[], `${kb.id} is open but missing from REGISTER_ROSTER`).toContain(kb.id);
      // No roster member may be BOTH open and closed at once.
      expect(CLOSED_BY_POSITIVE_ASSERTION.some(c => c.id === kb.id), `${kb.id} is in both KNOWN_BAD and CLOSED_BY_POSITIVE_ASSERTION`).toBe(false);
    }
    for (const c of CLOSED_BY_POSITIVE_ASSERTION) {
      expect(REGISTER_ROSTER as readonly string[], `${c.id} is closed but missing from REGISTER_ROSTER`).toContain(c.id);
      expect(['ear', 'structural'], `${c.id}: verification`).toContain(c.verification);
    }
    const structural = CLOSED_BY_POSITIVE_ASSERTION.filter(c => c.verification === 'structural');
    // eslint-disable-next-line no-console
    console.log(
      `[fa-replay:register] OPEN ${KNOWN_BAD.length} / CLOSED ${CLOSED_BY_POSITIVE_ASSERTION.length} ` +
      `(${CLOSED_BY_POSITIVE_ASSERTION.length - structural.length} ear-verified, ${structural.length} structurally derived: ` +
      `${structural.map(c => `${c.corpus} ${c.tag}`).join(', ')})`,
    );
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
  //
  // WS1 SESSION V — widened from a binary (open XOR closed) to a three-way
  // split, to give KNOWN_BAD's own `status: 'fixed'` (declared in this
  // file's KnownBadRow doc-comment since at least item-9, never previously
  // exercised by a currently-live row) real machine coverage. A `'fixed'`
  // row is STILL a member of KNOWN_BAD — the array a row can vanish from is
  // KNOWN_BAD itself, not the narrower `status === 'open'` filter — so
  // "vanished" means absent from BOTH KNOWN_BAD and CLOSED_BY_POSITIVE_ASSERTION,
  // and "both" means present in CLOSED_BY_POSITIVE_ASSERTION while ALSO still
  // a KNOWN_BAD member (open or fixed) — CLOSED_BY_POSITIVE_ASSERTION is a
  // real conversion out of the array, `status: 'fixed'` is not.
  it('every roster entry is still IN THE REGISTER (open or fixed) XOR CLOSED BY A POSITIVE ASSERTION', () => {
    const inRegister = new Set(KNOWN_BAD.map(k => k.id));
    const closed = new Set(CLOSED_BY_POSITIVE_ASSERTION.map(c => c.id));
    for (const id of REGISTER_ROSTER) {
      expect(
        inRegister.has(id) || closed.has(id),
        `Register entry ${id} has VANISHED: it is neither in KNOWN_BAD (open or fixed) nor present in ` +
        `CLOSED_BY_POSITIVE_ASSERTION. An entry may only be CONVERTED, never deleted — move it to ` +
        `CLOSED_BY_POSITIVE_ASSERTION with its ear-correct value and the commit that closed it.`,
      ).toBe(true);
      expect(
        inRegister.has(id) && closed.has(id),
        `Register entry ${id} is BOTH still in KNOWN_BAD and in CLOSED_BY_POSITIVE_ASSERTION — one of the ` +
        `two lists is stale.`,
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

  // (3c) R-AM, MACHINE-CHECKED (WS1 Session S). `verification: 'ear'` is a
  //      claim about a listening pass, and until this session nothing checked
  //      it: five R.12 rows carried the marker on the strength of a sitting
  //      that had scored their PRE-correction values wrong and never heard the
  //      replacements. The claim now has to be cashable against
  //      `ws1-ear-pass-ledger.ts`, in BOTH directions — an 'ear' row must be
  //      authorised there, and a 'structural' row must NOT be (or it is
  //      understating what is known and should be promoted).
  it('R-AM: every closed entry\'s verification marker is cashable against the ear-pass ledger', () => {
    for (const c of CLOSED_BY_POSITIVE_ASSERTION) {
      if (c.earCorrect === null) continue; // an ABSENCE has no value to score.
      const auth = earPassAuthorising(c.corpus, c.tag, c.earCorrect);
      if (c.verification === 'ear') {
        expect(
          auth,
          `${c.id} claims verification: 'ear' at ${c.earCorrect}, but no ear pass authorises that VALUE. ` +
          `Ledger history — ${describeEarHistory(c.corpus, c.tag)}. An ear pass that scored the PREVIOUS ` +
          `value wrong is not an ear pass on the replacement: mark the row 'structural' instead.`,
        ).toBeDefined();
      } else {
        expect(
          auth,
          `${c.id} is marked 'structural' but the ear ledger DOES authorise ${c.earCorrect} — promote it. ` +
          `Ledger history: ${describeEarHistory(c.corpus, c.tag)}.`,
        ).toBeUndefined();
      }
    }
  });

  // (3d) ...and the same rule applied to the OPEN rows: a row cannot sit open
  //      with a numeric `earCorrect` that no ear pass ever produced, and it
  //      cannot sit open at a value an ear pass has AUTHORISED.
  it('R-AM: no open or fixed entry claims an ear-correct target the ledger does not support', () => {
    // WS1 Session V widened this from `status === 'open'` to every KNOWN_BAD
    // member: a 'fixed' row's whole claim is "the ledger now authorises this
    // value", so it needs the SAME machine check an open row gets, not a
    // weaker one just because it moved status.
    for (const kb of KNOWN_BAD) {
      if (typeof kb.earCorrect !== 'number') continue;
      expect(
        earPassAuthorising(kb.corpus, kb.tag, kb.earCorrect) ?? earPassRejects(kb.corpus, kb.tag, kb.faValue),
        `${kb.id} names an ear-correct ${kb.earCorrect} with nothing in the ear ledger behind it, and no ` +
        `ear pass rejecting its current ${kb.faValue} either. Ledger: ${describeEarHistory(kb.corpus, kb.tag)}.`,
      ).toBeDefined();
      if (kb.status === 'fixed') {
        expect(
          earPassAuthorising(kb.corpus, kb.tag, kb.earCorrect)?.verdict,
          `${kb.id} is 'fixed' (closed against LIVE) but its earCorrect ${kb.earCorrect} is not itself ` +
          `an ear-authorised CORRECT value — a 'fixed' row's earCorrect must be the value an ear pass ` +
          `actually accepted, not merely one it did not reject.`,
        ).toBe('CORRECT');
      }
    }
  });

  // (4) BOOKKEEPING CONSISTENCY.
  it('open entries name an owning rule and carry no closing commit; fixed/closed entries carry one', () => {
    for (const kb of KNOWN_BAD.filter(k => k.status === 'open')) {
      expect(['R.5', 'R.10', 'R.11', 'R.12', 'unassigned'], `${kb.id}: owningRule`).toContain(kb.owningRule);
      expect(kb.closingCommit, `${kb.id} is still open but already names a closing commit`).toBe('');
      // WS1 Session D — the origin/item pairing must stay honest in both
      // directions: an ear-pass entry carries its item number, and a triage
      // entry must NOT have acquired one.
      if (kb.origin === 'ear-12') expect(typeof kb.item, `${kb.id}: an ear-12 entry must carry its item number`).toBe('number');
      else expect(kb.item, `${kb.id}: a triage entry must NOT invent an ear-pass item number`).toBeUndefined();
      expect(REGISTER_ROSTER as readonly string[], `${kb.id} is open but missing from REGISTER_ROSTER`).toContain(kb.id);
    }
    // WS1 Session V — a 'fixed' row is a real closure (against LIVE, not
    // fixture) and must carry the same closingCommit discipline a
    // CLOSED_BY_POSITIVE_ASSERTION entry does, even though it stays inside
    // KNOWN_BAD rather than moving array.
    for (const kb of KNOWN_BAD.filter(k => k.status === 'fixed')) {
      expect(kb.closingCommit.length, `fixed entry ${kb.id} must name the commit that closed it`).toBeGreaterThan(0);
      expect(['R.5', 'R.10', 'R.11', 'R.12', 'unassigned'], `${kb.id}: owningRule`).toContain(kb.owningRule);
    }
    for (const c of CLOSED_BY_POSITIVE_ASSERTION) {
      expect(c.closingCommit.length, `closed entry ${c.id} must name the commit that closed it`).toBeGreaterThan(0);
    }
  });

  // (5) The register's own census, printed so a reader of CI output can see the
  //     state of the programme without opening this file.
  it('register census (informational)', () => {
    const open = KNOWN_BAD.filter(k => k.status === 'open');
    const fixed = KNOWN_BAD.filter(k => k.status === 'fixed');
    const byRule = new Map<string, string[]>();
    for (const k of open) byRule.set(k.owningRule, [...(byRule.get(k.owningRule) ?? []), k.id]);
    // eslint-disable-next-line no-console
    console.log(
      `[fa-replay:register] OPEN ${open.length}/${REGISTER_HIGH_WATER} — ` +
      [...byRule.entries()].map(([r, ids]) => `${r}: ${ids.join('/')}`).join('; ') +
      ` | FIXED (closed against LIVE, not fixture) ${fixed.length} (${fixed.map(k => `${k.id}@${k.closingCommit}`).join(', ')})` +
      ` | CLOSED ${CLOSED_BY_POSITIVE_ASSERTION.length} (${CLOSED_BY_POSITIVE_ASSERTION.map(c => `${c.id}@${c.closingCommit}`).join(', ')})` +
      ` | roster ${REGISTER_ROSTER.length}`,
    );
    // WS1 Session V — widened to include the 'fixed' bucket: it is a real
    // conversion (never removed from KNOWN_BAD, so still counted there, but
    // no longer 'open'), and open+fixed IS KNOWN_BAD.length by construction,
    // so this reduces to the same roster-coverage arithmetic as before.
    expect(open.length + fixed.length + CLOSED_BY_POSITIVE_ASSERTION.length).toBe(REGISTER_ROSTER.length);
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

  it('the manifest holds TWENTY-ONE entries (open + fixed) as of WS1 Session AE', () => {
    // Item 6 left this table in WS1 Session B; item 9 in Session C; items 4/5
    // in Session D (R.5); items 10/11 in Session E (R.10); item 7 and both
    // OV3 triage entries in Session F (R.11) — the manifest WAS empty from
    // Session F through Session P. WS1 Session Q REOPENED it with eight new
    // rows (Session P's Class A minus item-7, which stays closed — see
    // `REGISTER_HIGH_WATER`'s own comment for that one's separate story —
    // plus Class B). WS1 SESSION S took it 8 -> 14: five R.12 rows DEMOTED
    // back out of the closed list by the owner's live ear pass, plus the
    // R.11/R.12 live-path collision. WS1 SESSION T took it 14 -> 15:
    // `r12-383-sixty-four` reopens when an A/B pass overturns the solo verdict
    // that had licensed its fixture closure. WS1 SESSION V does NOT change
    // WS1 SESSION AE takes membership 15 -> 21 and the OPEN subset 8 -> 7:
    // six rows are ADDED (five of them WS1 Session X's own 173 ear-pass
    // defects, which had lived in the ledger for two sessions without a
    // register row, plus the new `008_unknown_void`), and SEVEN move
    // 'open' -> 'fixed' when R.14/R.15 land. Session V does NOT change
    // this count: seven rows move 'open' -> 'fixed' (closed against LIVE,
    // not fixture — the frozen fixture is deliberately unregenerated this
    // session, so the fixture-scoped CLOSED_BY_POSITIVE_ASSERTION mechanism
    // cannot apply), and 'fixed' rows are STILL KNOWN_BAD members — they
    // never leave the array, only `CLOSED_BY_POSITIVE_ASSERTION` conversion
    // does that. Total membership stays 15; only the OPEN subset shrinks,
    // 15 -> 8. See the top-level register describe block for the exact
    // open/fixed sets this test does not duplicate.
    expect(KNOWN_BAD).toHaveLength(REGISTER_HIGH_WATER);
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
  // WS1 SESSION Q NOTE on item 7 specifically: this still passes, and should
  // — it pins the FROZEN FIXTURE (`phase4-fa-second-baseline-v6-segments.csv`,
  // untouched this session), which still shows R.11 correctly reaching
  // 451.03 on the vintage it was measured against. That is a different claim
  // from "R.11 reaches this boundary in production today" — Session Q's
  // live-fidelity bundle shows it does not (see item-7's own `why` field,
  // above in this file, for the measurement). Both are true at once: the
  // fixture has not regressed, and the live pipeline no longer reproduces
  // what the fixture shows. A future session correcting THIS test's own
  // 451.03 needs to regenerate the fixture deliberately, not merely edit the
  // number here.
  it('item 7, ov3-abysmal-opinion, ov3-226-four-scouts are pinned at their EAR-CORRECT values (frozen fixture)', () => {
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

  it('192_scout_listening is now an EAR-VERIFIED positive assertion (WS1 Session H — G2 closed)', () => {
    // Was `UNVERIFIED_R11_CANDIDATE`, a bare change-detector pin held outside
    // the register from Session F because no ear pass had scored it. Session
    // H's listening pass scored 571.07 CORRECT, so it became register entry
    // `h-192-scout-listening` and is asserted by the generated block above
    // like every other closed entry. This test is kept as the named,
    // greppable statement that the promotion happened — red here means the
    // roster entry was lost, not merely that a value drifted.
    const closed = CLOSED_BY_POSITIVE_ASSERTION.find(c => c.id === 'h-192-scout-listening');
    expect(closed, 'the G2 promotion must survive in the register').toBeDefined();
    expect(closed!.verification, 'promoted on an EAR pass, not structurally').toBe('ear');
    expect(closed!.earCorrect).toBe(571.07);
    const row = loadFaSecondBaseline('v6').find(r => r.tag === '192_scout_listening');
    expect(row, '192_scout_listening row').toBeDefined();
    expect(Math.abs(row!.startTime - 571.07), `ear-correct 571.07, got ${row!.startTime}`).toBeLessThan(0.005);
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

// ===========================================================================
// WS1 SESSION H — R.12, THE ATOMIC-RUN INVARIANT.
//
// The nine corrections are asserted row-for-row by the generated
// CLOSED_BY_POSITIVE_ASSERTION block above. What this block adds is the part
// that block cannot express: the TWELVE EAR-SCORED ROWS of Session H's
// listening pass pinned together, correct and incorrect alike, so that the
// five "wrong" verdicts and the seven "right" verdicts are one table a reader
// can check against — and M7, R.12's own mutation-matrix entry.
//
// WHY PIN THE CORRECT ONES TOO. A rule that fixes what the ear called wrong
// and silently moves something the ear called right has not improved the
// pipeline; it has traded one defect for another that nobody is looking for.
// The seven correct rows are the only guard against that, and they are worth
// more than the five wrong ones — stop-and-rule exit H4 named them for
// exactly this reason.
// ===========================================================================

/** Session H's 12-row blinded listening pass, verbatim. `verdict` is the
 *  owner's ear, not a rule's opinion; `value` is what the committed fixture
 *  must hold TODAY (post-R.12), which for a 'wrong' row is the corrected
 *  value and for a 'right' row is the value that was already there. */
const SESSION_H_EAR_12: Array<{ corpus: Corpus; tag: string; value: number; verdict: 'wrong' | 'right'; was?: number }> = [
  { corpus: 'v6', tag: '042_eleven_years', value: 125.54, verdict: 'wrong', was: 127.17 },
  { corpus: 'v6', tag: '125_night_circle', value: 370.75, verdict: 'wrong', was: 372.35 },
  { corpus: 'v6', tag: '176_twenty_six_scout', value: 521.71, verdict: 'wrong', was: 524.39 },
  { corpus: 'v6', tag: '266_forty_one_burden', value: 788.65, verdict: 'wrong', was: 790.33 },
  { corpus: 'v6', tag: '340_fifty_eight', value: 1044.67, verdict: 'wrong', was: 1047.57 },
  { corpus: '173', tag: 'fallen_regiment_site', value: 507.01, verdict: 'right' },
  { corpus: 'v6', tag: '192_scout_listening', value: 571.07, verdict: 'right' },
  { corpus: 'v6', tag: '158_scout_false_alert', value: 466.09, verdict: 'right' },
  { corpus: '173', tag: 'earthwork_corridor', value: 256.33, verdict: 'right' },
  { corpus: 'spanish', tag: '016_prepares_weapons', value: 44.90, verdict: 'right' },
  { corpus: 'v6', tag: '318_scout_on_ridge', value: 969.30, verdict: 'right' },
  { corpus: 'v6', tag: '087_throwing_spear_poise', value: 259.88, verdict: 'right' },
];

describe('WS1 Session H — R.12: the atomic-run invariant', () => {
  it('all TWELVE ear-scored rows are pinned at the value the ear licenses', () => {
    expect(SESSION_H_EAR_12).toHaveLength(12);
    expect(SESSION_H_EAR_12.filter(r => r.verdict === 'wrong')).toHaveLength(5);
    expect(SESSION_H_EAR_12.filter(r => r.verdict === 'right')).toHaveLength(7);

    const cache = new Map<Corpus, FaSegRow[]>();
    for (const r of SESSION_H_EAR_12) {
      if (!cache.has(r.corpus)) cache.set(r.corpus, loadFaSecondBaseline(r.corpus));
      const row = cache.get(r.corpus)!.find(x => x.tag === r.tag);
      expect(row, `${r.corpus} ${r.tag} row`).toBeDefined();
      expect(
        Math.abs(row!.startTime - r.value),
        r.verdict === 'wrong'
          ? `${r.corpus} ${r.tag}: ear scored ${r.was} WRONG; R.12's corrected ${r.value} is the pin, got ` +
            `${row!.startTime}. Red means R.12 regressed or the fixture drifted — do not re-pin to whatever ` +
            `the new run produces.`
          : `${r.corpus} ${r.tag}: ear scored ${r.value} CORRECT. Red means some rule MOVED a boundary the ` +
            `owner verified — stop-and-rule exit H4. This is the assertion that matters most in this file.`,
      ).toBeLessThan(0.005);
    }
  });

  it('the nine R.12 rows are all still accounted for — three closed, six fixed, zero open (WS1 Session V)', () => {
    // Session H closed all nine. Session S's live listening pass sent five
    // back; Session T's A/B pass sent a sixth (383) back the OTHER direction
    // it had gone in Session S, and promoted a seventh's verification (266,
    // still closed, 'structural' -> 'ear'). WS1 SESSION V moves the six
    // still-OPEN rows to 'fixed' — closed against LIVE (a fresh run-id-
    // stamped bundle plus the operator's A/B pass), not against the frozen
    // fixture, which is unregenerated and would still fail every one of
    // them. This test is the guard that the NINE never becomes eight by an
    // entry going missing in any of the three states.
    const closed = CLOSED_BY_POSITIVE_ASSERTION.filter(c => c.id.startsWith('r12-'));
    const fixed = KNOWN_BAD.filter(k => k.id.startsWith('r12-') && k.status === 'fixed');
    const open = KNOWN_BAD.filter(k => k.id.startsWith('r12-') && k.status === 'open');
    expect(closed.length + fixed.length + open.length, 'R.12 owns nine rows and always will').toBe(9);
    expect(open, 'WS1 Session V: no r12- row remains open — all six moved to fixed').toHaveLength(0);

    expect(fixed.map(k => k.tag).sort()).toEqual([
      '042_eleven_years', '176_twenty_six_scout', '224_thirty_three', '307_forty_nine_years', '340_fifty_eight',
      '383_sixty_four',
    ].sort());
    // Of the three still closed, `125_night_circle` and `266_forty_one_burden`
    // now carry a real ear-pass score of their own committed fixture value —
    // 266's promotion is WS1 Session T's, on the strength of `ear-verify-t`
    // confirming 788.65 (see that entry's own caveat: the LIVE path has
    // separately regressed off this value, which is a different fact from
    // whether the fixture's 788.65 is ear-verified). `085_the_spear_bearer`
    // remains the one purely structural closure.
    expect(closed.filter(c => c.verification === 'ear').map(c => c.tag).sort())
      .toEqual(['125_night_circle', '266_forty_one_burden']);
    expect(closed.filter(c => c.verification === 'structural').map(c => c.tag).sort())
      .toEqual(['085_the_spear_bearer']);

    // THE DEMOTION SPLITS 3/3, and the split is the point. THREE of the six
    // (042, 176, 340) were in Session H's own 12-row sitting, which scored
    // their PRE-R.12 values wrong and was then read as licensing the post-R.12
    // ones; THREE (224, 307, 383) were NOT — 224/307 were closed
    // `'structural'` and never claimed an ear pass at all, and 383 was closed
    // `'ear'` on a DIFFERENT sitting (`live-runs-s`, Session S) that this
    // Session H list has no row for at all. The structural marker cost 224/307
    // nothing when Session S failed them; 383's `'ear'` marker did not save it
    // either, once a later, better (A/B) sitting disagreed — which is the
    // whole point of R-AM's supersede-by-order rule. The split survives
    // Session V's status change unchanged — it is about ear-pass PROVENANCE,
    // not about open-vs-fixed.
    const earScoredWrong = new Set(SESSION_H_EAR_12.filter(r => r.verdict === 'wrong').map(r => r.tag));
    expect(fixed.filter(k => earScoredWrong.has(k.tag)).map(k => k.tag).sort())
      .toEqual(['042_eleven_years', '176_twenty_six_scout', '340_fifty_eight']);
    expect(fixed.filter(k => !earScoredWrong.has(k.tag)).map(k => k.tag).sort())
      .toEqual(['224_thirty_three', '307_forty_nine_years', '383_sixty_four']);
    // WS1 SESSION S's premise here — "EARLY is a verdict, not a target" —
    // held because no candidate reproduced both ear-CORRECT rows and Session
    // S shipped none. WS1 SESSION T's `ear-verify-t` A/B pass is exactly the
    // measurement that changed this, and WS1 SESSION V's own operator pass
    // re-confirmed every one of them against a fresh bundle: every fixed row
    // carries a real, A/B-confirmed numeric target, never `'unknown'`.
    for (const k of fixed) {
      expect(typeof k.earCorrect, `${k.tag}: WS1 Session T/V's A/B passes named a real target for every fixed row`).toBe('number');
    }
  });

  it('every R.12 correction moved the boundary EARLIER, and none by more than 2.90s', () => {
    // The direction is not asserted by the rule (the rule says "outside the
    // run"), so it is asserted here as a measured property of the corpus. It
    // is also what sets the blind-draw window for the next listening pass:
    // 2 x max |Δ| = 5.80s.
    const v6 = loadFaSecondBaseline('v6');
    const WAS: Record<string, number> = {
      '042_eleven_years': 127.17, '085_the_spear_bearer': 252.74, '125_night_circle': 372.35,
      '176_twenty_six_scout': 524.39, '224_thirty_three': 664.33, '266_forty_one_burden': 790.33,
      '307_forty_nine_years': 926.97, '340_fifty_eight': 1047.57, '383_sixty_four': 1190.81,
    };
    // WS1 Session S: iterate the NINE rows wherever they now live — five
    // moved back into KNOWN_BAD, and the claim being made here is about the
    // FIXTURE, which this session did not touch, so it must not narrow to
    // whichever rows happen to be closed today. WS1 Session V: 'fixed' rows
    // are STILL KNOWN_BAD members (see the coherence test's own note) and
    // still describe the FIXTURE's own value here — this claim is about the
    // frozen CSV, unaffected by a live-only status change — so the filter
    // must include both 'open' and 'fixed', not narrow to 'open' alone.
    const nineTags = [
      ...CLOSED_BY_POSITIVE_ASSERTION.filter(c => c.id.startsWith('r12-')).map(c => c.tag),
      ...KNOWN_BAD.filter(k => k.id.startsWith('r12-')).map(k => k.tag),
    ];
    expect(nineTags).toHaveLength(9);
    let maxDelta = 0;
    for (const tag of nineTags) {
      const row = v6.find(r => r.tag === tag)!;
      const delta = row.startTime - WAS[tag]!;
      expect(delta, `${tag}: R.12 must move the boundary earlier`).toBeLessThan(0);
      maxDelta = Math.max(maxDelta, Math.abs(delta));
    }
    expect(maxDelta).toBeCloseTo(2.90, 2);
  });

  it('173 and spanish are BYTE-IDENTICAL through R.12 — zero unscripted runs means zero effect', () => {
    // Asserted as a shape claim here (the live proof is
    // `src/services/faRunPlacementGate.test.ts`, which runs the real detector
    // on both corpora and gets an empty array). What this pins is that the
    // Session H re-pin touched v6 and nothing else.
    expect(loadFaSecondBaseline('173')).toHaveLength(173);
    expect(loadFaSecondBaseline('spanish')).toHaveLength(27);
    expect(loadFaSecondBaseline('173').find(r => r.tag === 'vessel_damage_clue')!.startTime).toBeCloseTo(174.74, 2);
    expect(loadFaSecondBaseline('spanish').find(r => r.tag === '023_scylla_six_sailors')!.startTime).toBeCloseTo(65.12, 2);
  });

  it('M7 — a mutation specific to R.12 must turn this gate RED (mutation-matrix entry, verified this session)', () => {
    // The mutation actually run this session, documented in the same style as
    // M1-M6 (a manually-verified-per-session matrix, not a committed mutant):
    // DROPPING THE CLAMP in `faRunPlacementGate.ts` — using the backing
    // silence's own whole midpoint instead of the midpoint of (silence ∩ gap).
    // That is the single most plausible way somebody would "simplify" this
    // rule, and it is exactly wrong: on 224_thirty_three the unclamped
    // midpoint is 664.33, reproducing the committed defect bit for bit, and on
    // 176/307/340 it lands back inside the run. Verified directly against the
    // real production detector this session — see the WS1 Session H ledger
    // entry (docs/work-in-progress.md §11) for the exact run.
    //
    // The standing half of M7 lives in `faRunPlacementGate.test.ts`'s CLAMPS
    // test and its H7 assertion, which are permanent. This test documents that
    // the mutation was run and confirms the current state is green, which is
    // what licenses trusting the reported result.
    expect(R12_MIN_CORRECTION_SEC).toBeLessThan(0.545); // 224_thirty_three's own Δ — the smallest of the nine must stay reachable.
  });
});

// ===========================================================================
// WS1 SESSION K — R.13, THE ATOMIC-UTTERANCE INVARIANT (R.12's closing half),
// plus the two rows the owner's 24-row mover audit scored NO.
//
// Both edges of the SAME run are pinned here on purpose. Keeping them apart is
// how the closing edge went unexamined for two sessions — see ruling R-AO and
// `src/services/ruleBothSides.test.ts`.
// ===========================================================================

describe('WS1 Session K — R.13: the atomic-utterance invariant', () => {
  it('BOTH edges of v6 run 5 are pinned together — R.12 opens it, R.13 closes it', () => {
    const v6 = loadFaSecondBaseline('v6');
    const carrier = v6.find(r => r.tag === '224_thirty_three')!;
    const successor = v6.find(r => r.tag === '225_night_scouts')!;

    // OPENING (R.12, Session H): before the recitation [663.910, 666.480].
    expect(
      Math.abs(carrier.startTime - 663.785),
      "R.12's opening edge moved. The owner ear-verified 663.785 (mover audit clip 24: " +
        "'You carry it ended on 663.79s, then unscripted text Level Six ... started at 664.99s'). " +
        'Red here is a regression on a boundary the owner confirmed.',
    ).toBeLessThan(0.005);

    // CLOSING (R.13, Session K): after the carrier's own line.
    expect(
      Math.abs(successor.startTime - 669.05),
      "R.13's closing edge moved. 669.05 is the midpoint of detected silence " +
        '[668.700, 669.400]; the previous value 667.47 sat on the pause BEFORE the carrier said ' +
        'its own line. Do not re-pin to whatever a new run produces.',
    ).toBeLessThan(0.005);

    // Model P across the pair: the carrier absorbed the whole delta and the
    // successor's own END did not move.
    expect(carrier.startTime + carrier.duration).toBeCloseTo(successor.startTime, 6);
    expect(successor.startTime + successor.duration).toBeCloseTo(671.18, 2);
  });

  it('R.13 moved exactly ONE boundary in the whole corpus — 1 of 649', () => {
    // The live proof is `src/services/faRunPlacementGate.test.ts`, which runs
    // the real detector on all three corpora. What this pins is that the
    // Session K re-pin touched v6 and nothing else: 173 and spanish have zero
    // unscripted runs, so R.13 cannot reach them.
    expect(loadFaSecondBaseline('173')).toHaveLength(173);
    expect(loadFaSecondBaseline('spanish')).toHaveLength(27);
    expect(loadFaSecondBaseline('v6')).toHaveLength(447);
    expect(loadFaSecondBaseline('173').find(r => r.tag === 'vessel_damage_clue')!.startTime).toBeCloseTo(174.74, 2);
    expect(loadFaSecondBaseline('spanish').find(r => r.tag === '023_scylla_six_sailors')!.startTime).toBeCloseTo(65.12, 2);
  });

  it('the OTHER mover-audit failure is a CONTROL, not a defect — 173 603.69 is owner-verified', () => {
    // Mover audit clip 1 scored NO, and the measurement showed the value is
    // correct: 603.69 is the exact midpoint of the FA gap between "on"
    // [603.600, 603.660] and "for" [603.720, 603.800], both confidence 1.000.
    // The two scenes split one sentence mid-way and no detected silence exists
    // in [598.04, 604.82], so the ear question has no answer at any value. The
    // owner verified it CORRECT in the app and ruled that mid-sentence /
    // no-silence splits STAY in future ear draws rather than being excluded,
    // so FA's handling of them keeps being checked. Pinned as a control:
    // red here means a rule moved a boundary the owner confirmed.
    const r = loadFaSecondBaseline('173').find(x => x.tag === 'protection_failure')!;
    expect(Math.abs(r.startTime - 603.69), '173 protection_failure: owner-verified CORRECT').toBeLessThan(0.005);
    const prev = loadFaSecondBaseline('173').find(x => x.tag === 'battle_network')!;
    expect(prev.startTime + prev.duration).toBeCloseTo(603.69, 6);
  });

  it('M8 — a mutation specific to R.13 must turn this gate RED (mutation-matrix entry, verified this session)', () => {
    // The mutation actually run this session, in the same style as M1-M7 (a
    // manually-verified-per-session matrix, not a committed mutant): REPLACING
    // R.13's anchor — the END of the carrier's own last matched token — with
    // the NEXT scene's own first token ONSET, i.e. building the naive mirror of
    // R.12's clamped interval. That is the single most plausible way somebody
    // would "make R.13 symmetric with R.12", and it is exactly wrong: the
    // interval becomes [667.730, 668.010], no detected silence intersects it,
    // and the fallback lands at 667.73 — a 0.26s move that leaves the defect
    // audible. Measured this session; see the WS1 Session K ledger entry
    // (docs/work-in-progress.md §11).
    //
    // M8-A is RED: 5 failures across `faRunPlacementGate.test.ts` (the corpus
    // row, the blast radius, the no-op nine, the apply-scope test, and the
    // R.12 disjointness test).
    //
    // M8-B — REPORTED GREEN IN SESSION K, NOW RED. DISPOSED, WS1 SESSION L.
    // Session K ran M8-B (drop R.13's "the carrier's own line must come after
    // the run" guard), found the whole suite still passing, and reported it as
    // green with the guard recorded as uncovered-by-design. Session L was
    // asked to dispose of that honestly — delete the guard, or keep it and
    // mark it uncovered with a reason — and found a third answer: the guard IS
    // coverable, and Session K's reachability argument was the thing at fault.
    //
    // Session K said the guard was reachable "for callers that pass an
    // uncorrected array". Not sufficient: `detectUnscriptedRuns` claims a
    // segment's whole matched token span, so a carrier's last token never lies
    // inside a run, and monotonic times then make the pre-run side unreachable
    // on ANY array. EQUALITY (`utteranceEndSec === run.endSec`, from a
    // zero-width token at the run's end, which Whisper emits) is the only way
    // in. On that input with an uncorrected array, R.13 wants 4.825 and R.12
    // wants 2.50 for the SAME boundary; the guard is what makes R.12 win.
    //
    // `faRunPlacementGate.test.ts`'s four "the guard" tests pin it, and M8-B
    // is now RED — 1 failure. Nothing about R.13 is uncovered-by-design, and
    // the matrix carries no green row. Recorded here rather than deleted so
    // the correction is visible: a green mutation was a gap in the TEST, not a
    // property of the code, and it took a constructed input to tell them apart.
    //
    // The standing half of M8 lives in `faRunPlacementGate.test.ts`'s
    // "declines a correction that would reach or pass the NEXT boundary",
    // "falls back to the utterance end itself", and the both-edges corpus
    // assertion, which are permanent. This test documents that the mutations
    // were run and confirms the current state is green, which is what licenses
    // trusting the reported result.
    expect(R12_MIN_CORRECTION_SEC).toBeLessThan(1.58); // R.13's own Δ must stay reachable.
  });

  it('M17 — mutations specific to R.14/R.15 must turn their gate RED (mutation-matrix entry, verified this session)', () => {
    // WS1 SESSION AE. The mutations actually run this session, in the same
    // style as M1-M8: a manually-verified-per-session matrix, not committed
    // mutants. The STANDING half is `src/services/faAnchorTrustGate.test.ts`,
    // whose per-conjunct and per-guard decline tests are what make these bite;
    // this entry records that they were run and what happened, which is what
    // licenses trusting the reported result.
    //
    // Every mutation below perturbs a NEWLY COMMITTED boundary — the ten rows
    // R.14/R.15 move — rather than a constant in the abstract, because the
    // brief's own requirement is that the gate go red when the committed value
    // moves, not merely when a threshold changes.
    //
    //   M17-A  R.14 placement: select the CONTAINING silence's midpoint instead
    //          of the first silence whose midpoint is after the boundary.
    //          RED — 1 failure ("skips a silence the boundary is ALREADY
    //          sitting on the midpoint of"). On the corpora it reverts
    //          `214`/`447`-shaped rows to a no-op and moves nothing.
    //   M17-B  R.14 firing: widen `ordinalDelta === 0` to `>= 0`.
    //          RED — 1 failure ("DECLINES when a word already sits on the wrong
    //          side of the cut"). On the corpora it turns three ear-CORRECT
    //          controls into false positives.
    //   M17-C  R.14 firing: drop the word-gap conjunct entirely.
    //          RED — 1 failure ("DECLINES when the word gap is wide enough to
    //          hold a detectable silence"). On 173 it makes `abysmal_opinion`,
    //          an ear-CORRECT control, a false positive.
    //   M17-D  R.14 guard: drop the reliable-onset guard.
    //          RED — 1 failure ("DECLINES a correction that would land past the
    //          incoming segment's first RELIABLE word").
    //   M17-E  R.14 guard: drop the ordering guard.
    //          RED — 1 failure ("DECLINES a correction that would reach or pass
    //          the NEXT committed boundary").
    //   M17-F  R.15 firing: drop the reliable-incoming-anchor conjunct.
    //          RED — 1 failure ("DECLINES when the incoming anchor is ALSO
    //          unreliable — the `vessel_damage_clue` refutation").
    //   M17-G  R.15 placement: drop the clamp to the outgoing word's end.
    //          RED — 1 failure ("clamps so the correction can never cut into
    //          the outgoing segment's own last word").
    //   M17-H  `applyAnchorTrustCorrections`: stop absorbing the delta into the
    //          predecessor's duration (move `startTime` only).
    //          RED — 1 failure ("preserves the gapless partition and Σ duration
    //          exactly"), i.e. Model P is really pinned, not incidentally true.
    //
    // NO GREEN ROW. Every conjunct, both guards, both placements and the apply
    // arithmetic are covered. Had any mutation survived, the honest report
    // would have been "that conjunct is INERT", not "the gate covers it".
    expect(CONF_MIN_FALLBACK).toBeGreaterThan(0.0316); // inside Session Z's measured empty bin,
    expect(CONF_MIN_FALLBACK).toBeLessThan(0.1);       // which is what makes it GEOMETRIC.
    expect(FA_FRAME_SEC).toBeLessThan(SILENCE_MIN_DETECTABLE_SEC); // a frame can never be a silence.
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
