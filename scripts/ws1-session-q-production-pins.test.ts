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

  it('R.12: the SEVEN ear-verified corrected boundaries (WS1 Session T)', async () => {
    const r = await run();
    // Session T's A/B side-by-side pass (`ear-verify-t`) licensed candidate B
    // — the unclamped silence midpoint, with the run's acoustic onset measured
    // off the waveform rather than taken from a Whisper timestamp — on all six
    // rows Session S's ear list covered, and reversed the SOLO-listened
    // `live-runs-s` verdict on 383 in the process (1188.95 -> 1189.05; both
    // sit inside 1.26s of literal digital silence, indistinguishable played
    // alone). `125_night_circle` was already ear-verified since Session S and
    // is unaffected by either change (its backing silence never straddled the
    // run's raw onset in the first place).
    pinEarVerified(r, '042_eleven_years', 125.76);
    pinEarVerified(r, '125_night_circle', 370.75);
    pinEarVerified(r, '176_twenty_six_scout', 522.46);
    pinEarVerified(r, '224_thirty_three', 664.33);
    pinEarVerified(r, '307_forty_nine_years', 925.43);
    pinEarVerified(r, '340_fifty_eight', 1045.62);
    pinEarVerified(r, '383_sixty_four', 1189.05);
  }, TIMEOUT);

  it('R.12 fires EIGHT times on the live v6 bundle after Session S\'s run-edge exclusion', async () => {
    const r = await run();
    // Session Q measured 7. Session S's run-edge exclusion (R-AP) stops R.11
    // claiming `266_forty_one_burden`, whose committed origin (790.33) lies
    // strictly inside R.5 run 6 — so R.12 now reaches its eighth v6 row.
    // The ninth and tenth runs are correctly NOT findings: run 0 is at corpus
    // start (no preceding token) and run 2's carrier already commits outside
    // its run. Session T's clamp removal + onset correction do not change
    // WHICH rows fire, only six of their VALUES (above) — still 8.
    expect(r.fired['R.12']).toBe(8);
    expect(r.fired['R.11']).toBe(5);
  }, TIMEOUT);

  it('L7: 266_forty_one_burden — EAR-VERIFIED at 788.75 (WS1 Session V closes the follow-up A/B)', async () => {
    const r = await run();
    // THE STORY, in order. Session S's R-AP ownership fix (`faRuleStageExclusion.ts`)
    // stopped R.11 stealing this boundary from R.12 and left it committed at
    // 788.65 — RED before Session S (R.11 had it at 792.18, past the run's
    // end; the owner scored that MAJOR). WS1 Session T STEP 0 re-measured
    // 788.65 against that session's own HEAD, before any of Step 1's changes,
    // and the owner's `ear-verify-t` sitting confirmed it CORRECT.
    //
    // IT DID NOT STAY CLOSED AT THAT VALUE. Step 1's onset correction is
    // UNIFORM — the same `acousticRunExtent(run, tokens, silences)` call
    // every other row in this block goes through, deliberately not
    // special-cased — and run 6 has a backing silence [788.04, 789.46] whose
    // end (789.46) sits past run 6's OWN raw Whisper onset (789.26), the
    // identical shape every other R.12 row in this file has. The correction
    // moves the onset there, which moves this row's OWN computed value from
    // 788.65 to 788.75. That is a MEASURED consequence of the mandated,
    // non-special-cased fix, not a choice.
    //
    // WS1 SESSION V ran exactly the follow-up A/B sitting Session T flagged
    // as needed (`ear-verify-v`, `ws1-ear-pass-ledger.ts`): the first ear
    // pass to hear 788.75 on its own, re-measured against a fresh run-id-
    // stamped bundle. It scores CORRECT. THE "REGRESSION" READING IS
    // REFUTED: 788.75 is not a defect away from the confirmed value, it IS
    // the confirmed value — and structurally it is exactly the same
    // full/unclamped-silence-midpoint family (Session S Step 3's candidate
    // (a)) the other six R.12 rows were already confirmed at, so this is the
    // established correction landing consistently, not a special case.
    pinEarVerified(r, '266_forty_one_burden', 788.75);
    // The structural claim from Session S still holds regardless of the
    // exact value: the boundary is not past the end of its own run.
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
    // the Session H / Session S disagreement, or the Session S / Session T one.
    expect(earPassAuthorising('v6', '042_eleven_years', 125.54)).toBeUndefined();
    expect(earPassRejects('v6', '042_eleven_years', 125.54)?.sitting).toBe('live-runs-s');
    // WS1 Session T named 042's ear-verified value as the corrected one
    // (125.76), not Session S's fallback figure; WS1 Session V's own A/B
    // pass (`ear-verify-v`, order 8) re-confirmed the SAME value and, by
    // R-AM's supersede-by-order rule, is now the row `earHistory` returns —
    // not a disagreement, the latest sitting saying the same thing.
    expect(earPassAuthorising('v6', '042_eleven_years', 125.76)?.sitting).toBe('ear-verify-v');
    expect(earPassAuthorising('v6', '125_night_circle', 370.75)?.sitting).toBe('live-runs-s');
    // THE 383 REVERSAL — a later A/B sitting overturns an earlier SOLO one.
    // `live-runs-s` (order 6) scored 1188.95 CORRECT by itself; `ear-verify-t`
    // (order 7) heard both candidates side by side and picked 1189.05 instead;
    // `ear-verify-v` (order 8) re-confirmed 1189.05 again.
    expect(earPassAuthorising('v6', '383_sixty_four', 1188.95), 'the solo verdict is superseded, not authorising').toBeUndefined();
    expect(earPassRejects('v6', '383_sixty_four', 1188.95)?.sitting).toBe('ear-verify-t');
    expect(earPassAuthorising('v6', '383_sixty_four', 1189.05)?.sitting).toBe('ear-verify-v');
    // ...and a boundary nobody has ever listened to authorises nothing.
    expect(earPassAuthorising('v6', '322_body_readiness', 986.88)).toBeUndefined();
    expect(describeEarHistory('v6', '322_body_readiness')).toBe('no ear pass has EVER scored this boundary');
    // L7, CLOSED THIS SESSION: `ear-verify-v` is the FIRST sitting to hear
    // 788.75 on its own (788.65 was the `ear-verify-t`-era production value,
    // before Step 1's onset correction moved it), and it authorises 788.75 —
    // no longer the open conflict Session T left it as.
    expect(earPassAuthorising('v6', '266_forty_one_burden', 788.65)?.sitting).toBe('ear-verify-t');
    expect(earPassAuthorising('v6', '266_forty_one_burden', 788.75)?.sitting).toBe('ear-verify-v');
    // The Session S sitting is on record in full: ten rows, 4 CORRECT / 5
    // EARLY / 1 WRONG.
    const s = EAR_PASS_LEDGER.filter(x => x.sitting === 'live-runs-s');
    expect(s).toHaveLength(10);
    expect(s.filter(x => x.verdict === 'CORRECT')).toHaveLength(4);
    expect(s.filter(x => x.verdict === 'EARLY')).toHaveLength(5);
    expect(s.filter(x => x.verdict === 'WRONG')).toHaveLength(1);
  });
});
