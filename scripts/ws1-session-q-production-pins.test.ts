/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 7. THE PRODUCTION-PATH PIN SET (rulings R-AO / R-AM).
//
// R-AO: a rule is not closed until observed firing by name on the real
// production path. `ws1-production-path.test.ts` (Session N) already does
// this against `transcript_tokens.json`/`silences_app.json` — the FILTERED
// token arm and the 16kHz silence arm, per Part N(a)'s own finding NOT the
// arms production actually uses. This file is the same pin set, on the
// LIVE-FIDELITY bundle (raw tokens, native silences, regenerated FA, live
// chunk plan — `run-id p-20260819T120922Z-cbb403c1`).
//
// ---------------------------------------------------------------------------
// WS1 SESSION S — FIVE OF THIS FILE'S SEVEN R.12 PINS WERE WRONG, AND ARE
// DEMOTED. R-AM IS NOW MACHINE-CHECKED.
//
// Session Q pinned ALL SEVEN of R.12's corrected boundaries here as positive
// regression assertions, on the strength of WS1 Session H's own figures.
// Session S's live ear pass over all ten v6 unscripted runs scored FIVE of
// them audibly EARLY: `042_eleven_years` (125.54), `176_twenty_six_scout`
// (521.71), `224_thirty_three` (663.785), `307_forty_nine_years` (924.92) and
// `340_fifty_eight` (1044.67). For a full session this file asserted defective
// values as correct and went green doing it.
//
// THE TWO KINDS OF PIN ARE NOW DIFFERENT FUNCTIONS, and each machine-checks
// its own claim against `ws1-ear-pass-ledger.ts`:
//
//   `pinEarVerified(...)`    — a POSITIVE correctness assertion. Refuses to
//                              run unless an ear pass scored THAT value
//                              CORRECT and no later sitting overturned it.
//   `pinChangeDetector(...)` — pins what production currently does on a row
//                              whose value the ear has REJECTED (or never
//                              scored). Refuses to run if the ledger would
//                              actually authorise the value, so a row cannot
//                              be quietly understated either.
//
// Neither can be satisfied by editing this file alone: the authorisation lives
// in the ledger, and adding a ledger row means claiming a sitting happened.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import {
  earPassAuthorising, earPassRejects, describeEarHistory, EAR_PASS_LEDGER,
} from './ws1-ear-pass-ledger.js';
import type { ProductionRun } from './ws1-session-p-pipeline.js';
import type { VideoSegment } from '../src/types';

/** Per-FILE memo — same rationale as `ws1-session-s-exclusion.test.ts`'s:
 *  `runProductionPath` is a pure function of a stamped bundle, this file asks
 *  it the same question six times, and the shared harness stays deliberately
 *  uncached. Every test here only READS the result. */
let memo: Promise<ProductionRun> | undefined;
const run = (): Promise<ProductionRun> => (memo ??= runProductionPath(CORPORA.v6!));

const at = (r: ProductionRun, tag: string): number => {
  const s = r.committed.find((x: VideoSegment) => tagOf(x) === tag);
  expect(s, `${tag} must be on the committed timeline`).toBeDefined();
  return s!.startTime;
};

/** A POSITIVE correctness assertion. R-AM: only an ear pass authorises one. */
function pinEarVerified(r: ProductionRun, tag: string, value: number, precision = 2): void {
  const auth = earPassAuthorising('v6', tag, value);
  expect(
    auth,
    `R-AM VIOLATION: ${tag} is pinned at ${value} as a POSITIVE assertion, but no ear pass ` +
    `authorises that value. Ledger history — ${describeEarHistory('v6', tag)}. Either run the ear ` +
    `pass and add the row to ws1-ear-pass-ledger.ts, or demote this to pinChangeDetector().`,
  ).toBeDefined();
  expect(at(r, tag), `${tag} (ear-verified by ${auth?.sitting})`).toBeCloseTo(value, precision);
}

/** A CHANGE DETECTOR on a row the ear has rejected or never scored. Pins what
 *  production does today; claims nothing about whether it is right. */
function pinChangeDetector(r: ProductionRun, tag: string, value: number, precision = 2): void {
  expect(
    earPassAuthorising('v6', tag, value),
    `${tag} is pinned at ${value} as a mere change detector, but the ear ledger AUTHORISES that ` +
    `value — promote it to pinEarVerified(). Ledger history: ${describeEarHistory('v6', tag)}.`,
  ).toBeUndefined();
  expect(at(r, tag), `${tag} (KNOWN-BAD change detector, NOT a correctness claim)`).toBeCloseTo(value, precision);
}

describe('WS1 Session Q/S — production-path pin set (R-AO / R-AM, live-fidelity bundle)', () => {
  const TIMEOUT = 300_000;

  it('R.12: the TWO ear-verified corrected boundaries', async () => {
    const r = await run();
    // L4 and L10 of the Session S live pass — the only two of R.12's seven
    // that an ear pass has scored CORRECT.
    pinEarVerified(r, '125_night_circle', 370.75);
    pinEarVerified(r, '383_sixty_four', 1188.95);
  }, TIMEOUT);

  it('R.12: the FIVE demoted rows still produce their known-bad values (change detectors only)', async () => {
    const r = await run();
    // WS1 Session S — every one of these was scored EARLY by the owner's live
    // ear pass. They are pinned so a value CHANGE is visible, not because the
    // value is right. Open register rows: `r12v-042-*` ... `r12v-340-*` in
    // `scripts/phase4-fa-replay.test.ts`'s KNOWN_BAD.
    pinChangeDetector(r, '042_eleven_years', 125.54);
    pinChangeDetector(r, '176_twenty_six_scout', 521.71);
    pinChangeDetector(r, '224_thirty_three', 663.785, 3);
    pinChangeDetector(r, '307_forty_nine_years', 924.92);
    pinChangeDetector(r, '340_fifty_eight', 1044.67);
  }, TIMEOUT);

  it('R.12 fires EIGHT times on the live v6 bundle after Session S\'s run-edge exclusion', async () => {
    const r = await run();
    // Session Q measured 7. Session S's run-edge exclusion (R-AP) stops R.11
    // claiming `266_forty_one_burden`, whose committed origin (790.33) lies
    // strictly inside R.5 run 6 — so R.12 now reaches its eighth v6 row.
    // The ninth and tenth runs are correctly NOT findings: run 0 is at corpus
    // start (no preceding token) and run 2's carrier already commits outside
    // its run.
    expect(r.fired['R.12']).toBe(8);
    expect(r.fired['R.11']).toBe(5);
  }, TIMEOUT);

  it('L7: 266_forty_one_burden is back on R.12\'s value, not R.11\'s', async () => {
    const r = await run();
    // RED before Session S (R.11 committed 792.18, PAST the end of run 6 —
    // the owner scored the whole recitation landing in the previous scene).
    //
    // A CHANGE DETECTOR, not a positive assertion, and the distinction is the
    // Session S pin audit's own finding: the ear-12-h sitting scored the
    // PRE-correction 790.33 WRONG and the live-runs-s sitting scored R.11's
    // 792.18 WRONG, but NOBODY has ever listened to 788.65. It is R.12's
    // structural output at a boundary two ear passes agree is wrong today —
    // which is grounds to ship it, and not grounds to pin it as verified.
    pinChangeDetector(r, '266_forty_one_burden', 788.65);
    // What IS asserted positively is the structural claim: the boundary is no
    // longer past the end of its own run.
    const run6 = r.runExtents[6]!;
    expect(at(r, '266_forty_one_burden')).toBeLessThan(run6.startSec);
  }, TIMEOUT);

  it('R.11\'s remaining five firings: two ear-verified, three change detectors', async () => {
    const r = await run();
    pinEarVerified(r, '192_scout_listening', 571.07);
    pinEarVerified(r, '226_four_scouts', 671.17);
    // WS1 Session S pin audit — NO ear pass has ever scored these three. They
    // were pinned by Session Q as if they were correctness assertions; they
    // are change detectors and now say so. `322_body_readiness` was firing
    // unpinned entirely and is added here so R.11's whole live firing set is
    // covered.
    pinChangeDetector(r, '232_sudden_halt', 684.09);
    pinChangeDetector(r, '233_firelight_speech', 686.54);
    pinChangeDetector(r, '322_body_readiness', 986.88);
  }, TIMEOUT);

  it('R-AM is enforceable, not advisory: the ledger overturns an earlier CORRECT with a later verdict', () => {
    // The mechanism itself, asserted — a green suite must not be able to hide
    // the Session H / Session S disagreement.
    expect(earPassAuthorising('v6', '042_eleven_years', 125.54)).toBeUndefined();
    expect(earPassRejects('v6', '042_eleven_years', 125.54)?.sitting).toBe('live-runs-s');
    expect(earPassAuthorising('v6', '125_night_circle', 370.75)?.sitting).toBe('live-runs-s');
    // ...and a boundary nobody has ever listened to authorises nothing.
    expect(earPassAuthorising('v6', '322_body_readiness', 986.88)).toBeUndefined();
    expect(describeEarHistory('v6', '322_body_readiness')).toBe('no ear pass has EVER scored this boundary');
    // The Session S sitting is on record in full: ten rows, 4 CORRECT / 5
    // EARLY / 1 WRONG.
    const s = EAR_PASS_LEDGER.filter(x => x.sitting === 'live-runs-s');
    expect(s).toHaveLength(10);
    expect(s.filter(x => x.verdict === 'CORRECT')).toHaveLength(4);
    expect(s.filter(x => x.verdict === 'EARLY')).toHaveLength(5);
    expect(s.filter(x => x.verdict === 'WRONG')).toHaveLength(1);
  });
});
