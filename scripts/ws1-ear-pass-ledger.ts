/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session S — THE EAR-PASS LEDGER (ruling R-AM, made machine-checkable).
//
// WHY THIS EXISTS, from a measured failure. WS1 Session Q pinned all SEVEN of
// R.12's corrected boundaries as POSITIVE regression assertions on the live
// production path. Session S's live ear pass over all ten v6 unscripted runs
// scored FIVE of those seven WRONG (audibly early). For a whole session the
// suite was therefore asserting defective values as correct, and going green
// while doing it — the exact failure mode the Zero-Defect Register was built
// to prevent, reintroduced one file over because the register's rule ("close
// only rows with an ear pass") lived in prose and in one file's own review
// discipline rather than in a function anything could call.
//
// THE RULE, now executable: A VALUE MAY BE PINNED AS A POSITIVE ASSERTION ONLY
// IF AN EAR PASS HAS SCORED THAT VALUE CORRECT, AND NO LATER EAR PASS HAS
// SCORED IT WRONG. Anything else is a CHANGE DETECTOR — legitimate, useful,
// and required to say so at its call site (`pinChangeDetector`), never dressed
// up as a correctness claim.
//
// THIS FILE IS THE RECORD OF WHAT THE OWNER'S EARS HAVE ACTUALLY HEARD, and
// nothing else. It is append-mostly: a row is added when a sitting happens; a
// row is never edited to change a verdict, because a later sitting that
// disagrees is itself a row, and the disagreement is data (see
// `042_eleven_years`, scored CORRECT in Session H and WRONG in Session S —
// both rows are here, and the LATER one governs).
//
// IT IS NOT A REPLACEMENT FOR THE ZERO-DEFECT REGISTER
// (`scripts/phase4-fa-replay.test.ts`'s `KNOWN_BAD` /
// `CLOSED_BY_POSITIVE_ASSERTION`). The register answers "which defects are
// open"; this ledger answers "what has anyone actually LISTENED to". The
// register's `verification: 'ear' | 'structural'` field is the same
// distinction seen from the other side, and Session S's demotion is the first
// time the two have been made to agree by machine rather than by hand.
// ---------------------------------------------------------------------------

/** The listening sittings on record, in chronological order. `order` is what
 *  decides supersession: for one (corpus, tag, value) the HIGHEST-order row
 *  governs, so a later sitting overturning an earlier one needs no bookkeeping
 *  beyond being added. */
export const EAR_SITTINGS = {
  /** WS1 Sessions A/B — the original 12-item ear pass. */
  'ear-12': 1,
  /** WS1 Session D, ruling R-AF — the blinded OV3 triage of R-AA's three
   *  candidates. */
  'ov3-triage': 2,
  /** WS1 Session H — the second blinded 12-row listening pass. */
  'ear-12-h': 3,
  /** WS1 Session K — the owner's 24-row mover audit (22/24). */
  'mover-audit-k': 4,
  /** WS1 Session P — the per-conjunct live-bundle probe whose Class A / Class
   *  B tables carry ear-correct targets. Entered here in WS1 Session S by
   *  TRANSCRIPTION from `scripts/phase4-fa-replay.test.ts`'s KNOWN_BAD rows
   *  (`origin: 'session-p-live'`, whose own comment records that an ear pass
   *  was already on record for these eight rows), not from a fresh sitting.
   *  Recorded so R-AM's machine check has something to cash those rows'
   *  `earCorrect` fields against; the values are the register's, unchanged. */
  'session-p-live': 5,
  /** WS1 Session S — the owner's live pass over ALL TEN v6 unscripted-run
   *  boundaries, scored in the app on the shipped production path. */
  'live-runs-s': 6,
  /** WS1 Session T — an A/B SIDE-BY-SIDE sitting (not solo listening): for
   *  each row the owner heard the shipped/clamped value and candidate B
   *  (unclamped whole-silence midpoint) played back to back and picked one.
   *  PROCESS NOTE, recorded because this sitting overturned a solo-listened
   *  one: side-by-side comparison supersedes solo listening. `live-runs-s`
   *  (order 6) was a single continuous playback per boundary — one value
   *  heard once, scored against the owner's memory of what "right" sounds
   *  like — and it passed `383_sixty_four` at 1188.95. Placed side by side
   *  against 1189.05, the owner reversed that call: both sit inside 1.26s of
   *  literal digital silence, indistinguishable in isolation, and only the
   *  comparison surfaced that 1188.95 was early. No other `live-runs-s` CORRECT
   *  verdict has been re-run A/B as of this sitting — see this file's own
   *  audit note below listing every solo-listened CORRECT pin still standing
   *  unconfirmed by a comparison pass. */
  'ear-verify-t': 7,
} as const;

// ---------------------------------------------------------------------------
// WS1 SESSION T — SOLO-LISTENED PIN AUDIT (Step 2's second half).
//
// Every `'CORRECT'` verdict in this ledger, audited for whether its own
// sitting was a SOLO listen (one value played, scored against memory) or an
// A/B COMPARISON (two or more candidates played back to back). Only
// `ear-verify-t` (this session) and `ov3-triage` (Session D's blinded OV3
// triage of R-AA's three candidates, which by its own design compared
// candidates) are A/B by construction. Every other sitting recorded a solo
// verdict per row — INCLUDING `live-runs-s`, whose `383_sixty_four` row this
// session's A/B pass just overturned.
//
// WHAT THIS MEANS: a solo `'CORRECT'` is not thereby wrong — `383` was
// right about direction (candidate B) for five other rows on the very same
// sitting — but it is UNAUDITED against the specific failure mode measured
// here: two candidates 0.10s apart, both sitting inside a region a listener
// cannot resolve in isolation. The rows below are flagged for exactly that
// reason, not reopened; `EAR_PASS_LEDGER`'s supersession-by-order already
// means a future A/B pass that disagrees with any of them simply outranks
// them by being added, no bookkeeping required here.
//
// FLAGGED (solo-listened CORRECT, no A/B comparison yet run against it):
//   - `live-runs-s`: '125_night_circle'@370.75, '192_scout_listening'@571.07,
//     '226_four_scouts'@671.17, and every EARLY/WRONG verdict on that sitting
//     (their negative status is likewise unconfirmed by a comparison pass).
//   - `ear-12`, `ear-12-h`, `mover-audit-k`: every CORRECT row — the original
//     12-item pass, the second 12-row pass, and the 24-row mover audit were
//     all solo listens.
//   - `session-p-live`: transcribed from `phase4-fa-replay.test.ts`'s own
//     KNOWN_BAD table, not a fresh sitting at all; its own provenance comment
//     already says so.
//
// NOT a call to re-run all of them now — flagged so the NEXT session that
// touches any of these rows knows the standing verdict is solo, and can
// choose to A/B it rather than assume solo-equals-settled.
// ---------------------------------------------------------------------------

export type EarSitting = keyof typeof EAR_SITTINGS;
export type Corpus = 'v6' | '173' | 'spanish';

/**
 * `'CORRECT'`   — the owner heard this exact value and accepted it.
 * `'EARLY'`     — heard, and the cut happens BEFORE it should.
 * `'LATE'`      — heard, and the cut happens AFTER it should.
 * `'WRONG'`     — heard and rejected, direction not characterised.
 * `'ABSENT-OK'` — the correct outcome is that the scene is not committed at
 *                 all, and the owner agreed (ear-12 item 11).
 */
export type EarVerdict = 'CORRECT' | 'EARLY' | 'LATE' | 'WRONG' | 'ABSENT-OK';

export interface EarPassRow {
  sitting: EarSitting;
  corpus: Corpus;
  tag: string;
  /** The value the owner actually LISTENED TO. `null` only for `'ABSENT-OK'`,
   *  where there is no committed boundary to listen to. */
  scoredValue: number | null;
  verdict: EarVerdict;
  /** Widened match tolerance, with the reason, for a row whose ear pass was
   *  run on a DIFFERENT arm of the pipeline than the pin under test. Default
   *  is 0.005s (the register's own tolerance). Never widen this to make a
   *  failing pin pass — it exists for a measured, named arm difference. */
  armToleranceSec?: number;
  note: string;
}

export const EAR_PASS_LEDGER: readonly EarPassRow[] = [
  // -------------------------------------------------------------------------
  // WS1 Sessions A/B — the original 12-item ear pass.
  // -------------------------------------------------------------------------
  { sitting: 'ear-12', corpus: 'v6', tag: '308_scouts_leading', scoredValue: 931.40, verdict: 'CORRECT',
    note: 'ear-pass item 4, closed by R.5.' },
  { sitting: 'ear-12', corpus: 'v6', tag: '043_night_migration', scoredValue: 130.96, verdict: 'CORRECT',
    note: 'ear-pass item 5, closed by R.5.' },
  { sitting: 'ear-12', corpus: '173', tag: 'vessel_damage_clue', scoredValue: 174.74, verdict: 'CORRECT',
    note: 'ear-pass item 6, closed by R-U/616abb2. The register\'s oldest positive assertion.' },
  { sitting: 'ear-12', corpus: 'v6', tag: '152_frozen_brush_mice', scoredValue: 451.03, verdict: 'CORRECT',
    note: 'ear-pass item 7, closed by R.11. NOTE: WS1 Session Q measured that the LIVE-fidelity bundle ' +
      'reverts this to 449.20 (fitDeviation exactly 1.0 on the live chunk plan); the frozen fixture, ' +
      'which is what the register asserts against, still shows 451.03.' },
  { sitting: 'ear-12', corpus: 'spanish', tag: '023_scylla_six_sailors', scoredValue: 65.12, verdict: 'CORRECT',
    note: 'ear-pass item 9, closed by 616abb2.' },
  { sitting: 'ear-12', corpus: '173', tag: 'hostile_landscape', scoredValue: 0.00, verdict: 'CORRECT',
    note: 'ear-pass item 10, closed by R.10.' },
  { sitting: 'ear-12', corpus: '173', tag: 'blue_monkey', scoredValue: null, verdict: 'ABSENT-OK',
    note: 'ear-pass item 11 — the owner agreed the scene should NOT be committed at all. Closed by R.10.' },

  // -------------------------------------------------------------------------
  // WS1 Session D — ruling R-AF's blinded OV3 triage.
  // -------------------------------------------------------------------------
  { sitting: 'ov3-triage', corpus: '173', tag: 'abysmal_opinion', scoredValue: 17.88, verdict: 'CORRECT',
    note: 'Blinded triage of R-AA\'s candidates; closed by R.11.' },
  { sitting: 'ov3-triage', corpus: 'v6', tag: '226_four_scouts', scoredValue: 671.18, verdict: 'CORRECT',
    armToleranceSec: 0.02,
    note: 'Scored on the 16 kHz silence arm, which places the backing silence\'s midpoint at 671.18; the ' +
      'NATIVE-rate arm the live production path uses places the same silence at 671.17 (measured, ' +
      '`scripts/ws1-silence-arms.test.ts`). The 0.01s is that documented arm difference, not drift — ' +
      'hence the widened tolerance, which is 2x the gap and still an order of magnitude below anything audible.' },

  // -------------------------------------------------------------------------
  // WS1 Session H — the second blinded 12-row listening pass, all twelve rows.
  //
  // WS1 SESSION S PIN AUDIT — READ THE `scoredValue` COLUMN CAREFULLY. Five of
  // these twelve rows scored WRONG, and what the owner listened to on those
  // five was the value FA had committed AT THE TIME: 127.17, 372.35, 524.39,
  // 790.33, 1047.57. The sitting established that those values are wrong. It
  // did NOT establish that R.12's replacements are right — nobody listened to
  // 125.54, 370.75, 521.71, 788.65 or 1044.67 in this sitting.
  //
  // The register nonetheless closed all five as `verification: 'ear'`. That is
  // an overclaim of exactly the kind R.13's own closure explicitly refused to
  // make ("the owner scored the OLD value wrong, which is not the same as
  // scoring the NEW one right"), and it is why this ledger records the value
  // ACTUALLY HEARD rather than the value a rule went on to produce. Session S
  // corrected the register to match: `r12-266-forty-one-burden` is downgraded
  // to `'structural'`, and the five demoted rows carry no ear authorisation at
  // their corrected values from this sitting at all.
  // -------------------------------------------------------------------------
  { sitting: 'ear-12-h', corpus: 'v6', tag: '042_eleven_years', scoredValue: 127.17, verdict: 'WRONG',
    note: 'The PRE-R.12 committed value. R.12 replaced it with 125.54, which this sitting never heard.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '125_night_circle', scoredValue: 372.35, verdict: 'WRONG',
    note: 'The PRE-R.12 committed value. R.12\'s replacement 370.75 was first heard — and passed — in the ' +
      'live-runs-s sitting below.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '176_twenty_six_scout', scoredValue: 524.39, verdict: 'WRONG',
    note: 'The PRE-R.12 committed value. R.12 replaced it with 521.71, scored EARLY in live-runs-s.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '266_forty_one_burden', scoredValue: 790.33, verdict: 'WRONG',
    note: 'The PRE-R.12 committed value — and, not coincidentally, the exact ORIGIN R.11 later moved to ' +
      '792.18 on the live path (Session S L7). R.12\'s replacement 788.65 has never been heard by anyone.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '340_fifty_eight', scoredValue: 1047.57, verdict: 'WRONG',
    note: 'The PRE-R.12 committed value. R.12 replaced it with 1044.67, scored EARLY in live-runs-s.' },
  // The seven rows this sitting scored RIGHT — the values themselves were
  // heard and accepted, so these DO authorise pins.
  { sitting: 'ear-12-h', corpus: 'v6', tag: '192_scout_listening', scoredValue: 571.07, verdict: 'CORRECT',
    note: 'R.11\'s own output, heard and accepted. Promoted the previously-unverified candidate into the ' +
      'register (gate item G2).' },
  { sitting: 'ear-12-h', corpus: '173', tag: 'fallen_regiment_site', scoredValue: 507.01, verdict: 'CORRECT', note: 'Control.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '158_scout_false_alert', scoredValue: 466.09, verdict: 'CORRECT', note: 'Control.' },
  { sitting: 'ear-12-h', corpus: '173', tag: 'earthwork_corridor', scoredValue: 256.33, verdict: 'CORRECT', note: 'Control.' },
  { sitting: 'ear-12-h', corpus: 'spanish', tag: '016_prepares_weapons', scoredValue: 44.90, verdict: 'CORRECT', note: 'Control.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '318_scout_on_ridge', scoredValue: 969.30, verdict: 'CORRECT', note: 'Control.' },
  { sitting: 'ear-12-h', corpus: 'v6', tag: '087_throwing_spear_poise', scoredValue: 259.88, verdict: 'CORRECT', note: 'Control.' },

  // -------------------------------------------------------------------------
  // WS1 Session K — the 24-row mover audit.
  // -------------------------------------------------------------------------
  { sitting: 'mover-audit-k', corpus: '173', tag: 'protection_failure', scoredValue: 603.69, verdict: 'CORRECT',
    note: 'Audit clip 1 initially scored NO; the owner then verified the value CORRECT in the app and ruled ' +
      'that mid-sentence / no-detected-silence splits STAY in future ear draws. Pinned as a control.' },
  { sitting: 'mover-audit-k', corpus: 'v6', tag: '225_night_scouts', scoredValue: 667.47, verdict: 'WRONG',
    note: 'Audit clip 12. The OLD value was scored wrong; R.13 moved it to 669.05, which NO ear pass has ' +
      'scored — hence R.13\'s closure carries `verification: \'structural\'`, not \'ear\'.' },

  // -------------------------------------------------------------------------
  // WS1 Session P — Class A and Class B, transcribed from the register.
  //
  // Each row appears TWICE and deliberately: once rejecting the value FA
  // commits today, once accepting the target the register records as ear
  // correct. Splitting them is what lets R-AM answer the two different
  // questions it is asked ("may this value be pinned?" and "is this row still
  // known-bad?") without either answer implying the other.
  // -------------------------------------------------------------------------
  { sitting: 'session-p-live', corpus: 'v6', tag: '214_solitary_fire', scoredValue: 629.01, verdict: 'WRONG', note: 'Class A.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '214_solitary_fire', scoredValue: 630.09, verdict: 'CORRECT', note: 'Class A target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '231_slowing_pace', scoredValue: 681.63, verdict: 'WRONG', note: 'Class A.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '231_slowing_pace', scoredValue: 682.74, verdict: 'CORRECT', note: 'Class A target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '447_scout_facing_dark', scoredValue: 1417.12, verdict: 'WRONG', note: 'Class A.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '447_scout_facing_dark', scoredValue: 1418.53, verdict: 'CORRECT', note: 'Class A target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '056_dropping_torch', scoredValue: 167.03, verdict: 'WRONG', note: 'Class B.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '056_dropping_torch', scoredValue: 167.70, verdict: 'CORRECT', note: 'Class B target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '167_smell_of_butchery', scoredValue: 494.43, verdict: 'WRONG', note: 'Class B.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '167_smell_of_butchery', scoredValue: 494.75, verdict: 'CORRECT', note: 'Class B target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '286_fact_to_act', scoredValue: 856.09, verdict: 'WRONG', note: 'Class B.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '286_fact_to_act', scoredValue: 856.52, verdict: 'CORRECT', note: 'Class B target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '400_endless_dark', scoredValue: 1266.21, verdict: 'WRONG', note: 'Class B.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '400_endless_dark', scoredValue: 1266.66, verdict: 'CORRECT', note: 'Class B target.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '403_vigilant_embers', scoredValue: 1273.14, verdict: 'WRONG', note: 'Class B.' },
  { sitting: 'session-p-live', corpus: 'v6', tag: '403_vigilant_embers', scoredValue: 1273.55, verdict: 'CORRECT', note: 'Class B target.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION S — the owner's LIVE pass over all ten v6 unscripted runs.
  //
  // Recorded verbatim in `docs/work-in-progress.md` §11's Session S entry.
  // Scored in the app on the shipped production path, post-Session-Q-fix
  // vintage. Score: 4 PASS / 5 EARLY / 1 MAJOR. THIS SITTING IS AUTHORITATIVE
  // over every earlier one it contradicts, by `order`.
  //
  // Two of the ten rows carry no committed segment boundary at the value the
  // owner listened at (L1 0.08 and L3 249.50): those are the two v6 runs R.12
  // does not correct — run 0 is at corpus start (no preceding token, so no
  // legal placement interval exists) and run 2's carrier `085_the_spear_bearer`
  // already sits OUTSIDE its run at 250.69/250.81. Both are recorded with
  // `scoredValue` as the RUN ONSET the owner listened at, and neither
  // authorises a boundary pin, because neither is a boundary.
  // -------------------------------------------------------------------------
  { sitting: 'live-runs-s', corpus: 'v6', tag: 'run-0-onset', scoredValue: 0.08, verdict: 'CORRECT',
    note: 'L1, "scene 1". Run 0 sits at corpus start; R.12 has no preceding token and correctly declines. ' +
      'Not a segment boundary — authorises no pin.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '042_eleven_years', scoredValue: 125.54, verdict: 'EARLY',
    note: 'L2, "scene 42". R.12\'s corrected value. The ONLY row on the `run-start-fallback` path (no ' +
      'detected silence intersects its placement gap at all).' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: 'run-2-onset', scoredValue: 249.50, verdict: 'CORRECT',
    note: 'L3, "scene 84". Run 2; `085_the_spear_bearer` already commits outside the run, so R.12 does ' +
      'not fire. Not a segment boundary — authorises no pin.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '125_night_circle', scoredValue: 370.75, verdict: 'CORRECT',
    note: 'L4. THE FIRST EAR PASS TO SCORE R.12\'s OWN OUTPUT HERE (Session H heard only the pre-correction ' +
      '372.35). The one row whose backing silence lies ENTIRELY inside R.12\'s placement gap, so the clamp ' +
      'does not bite — measured, and the structural difference from the five EARLY rows.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '176_twenty_six_scout', scoredValue: 521.71, verdict: 'EARLY',
    note: 'L5. Owner: "cuts between breath and prev segment" — CONFIRMED by the Session S RMS profile ' +
      '(a -53 dBFS breath band sits at ~[521.86, 522.12], and 521.71 is before it).' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '224_thirty_three', scoredValue: 663.785, verdict: 'EARLY', note: 'L6.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '266_forty_one_burden', scoredValue: 792.18, verdict: 'WRONG',
    note: 'L7, MAJOR — the whole recitation landed in the PREVIOUS segment. R.11 moved this boundary ' +
      'from 790.33 (strictly inside R.5 run 6, [787.85, 791.94]) to 792.18, PAST the run\'s end. R.12 ' +
      'would have moved it to 788.65 (the value the ear-12-h sitting scored CORRECT). Session S Step 1 ' +
      'is the structural exclusion that stops R.11 claiming a boundary R.12 owns.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '307_forty_nine_years', scoredValue: 924.92, verdict: 'EARLY', note: 'L8.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '340_fifty_eight', scoredValue: 1044.67, verdict: 'EARLY', note: 'L9.' },
  { sitting: 'live-runs-s', corpus: 'v6', tag: '383_sixty_four', scoredValue: 1188.95, verdict: 'CORRECT',
    note: 'L10. R.12\'s corrected value. Previously closed as `verification: \'structural\'` — this is the ' +
      'first ear pass to score it, and it PASSES, so the closure is upgraded to \'ear\'. SUPERSEDED below ' +
      '(order 7): the ear-verify-t A/B pass reverses this verdict — see that sitting\'s own note.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION T — A/B side-by-side pass (`docs/ws1-sync-pipeline/
  // stage1-session-s-ear-list.md`'s five-row list, plus its own 383 question,
  // plus a sixth row — L7/266 — carried over unchanged from the live app).
  // Six candidate-B confirmations and one refutation of a prior solo verdict.
  // -------------------------------------------------------------------------
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '042_eleven_years', scoredValue: 125.760, verdict: 'CORRECT',
    note: 'Row 1. A=125.540 (shipped, = the breath onset) vs B=125.760 (unclamped) vs C=125.900 (silence ' +
      'end). Owner: B.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '176_twenty_six_scout', scoredValue: 522.460, verdict: 'CORRECT',
    note: 'Row 2, the row the owner had annotated "cuts between breath and prev segment". A=521.710 (before ' +
      'the -52.8 dBFS breath) vs B=522.460 (after it) vs C=523.500. Owner: B — after the breath, confirming ' +
      'the breath belongs with the run, not the outgoing scene.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '224_thirty_three', scoredValue: 664.330, verdict: 'CORRECT',
    note: 'Row 3, NO breath at all in the gap (floor -56 to -91 dBFS) — the control for breath-irrelevance. ' +
      'A=663.785 vs B=664.330 vs C=665.000. Owner: B, same family as the breath rows.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '307_forty_nine_years', scoredValue: 925.430, verdict: 'CORRECT',
    note: 'Row 4, a LOUD -32.0 dBFS breath sitting BEFORE the detected silence starts (already excluded from ' +
      'it, so A already sits after it). A=924.920 vs B=925.430 vs C=926.160. Owner: B.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '340_fifty_eight', scoredValue: 1045.620, verdict: 'CORRECT',
    note: 'Row 5, the most extreme: the shipped value sat 2.5% into a 2.00s silence. A=1044.670 vs ' +
      'B=1045.620 vs C=1046.620. Owner: B.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '383_sixty_four', scoredValue: 1188.950, verdict: 'EARLY',
    note: 'THE REFUTATION, RECORDED AS ITS OWN ROW so `earPassAuthorising`/`earPassRejects` can see it — the ' +
      'mechanism keys on (corpus, tag, VALUE), so a supersession has to re-score the SAME value, not merely ' +
      'score a nearby one. `live-runs-s` (a SOLO listen) scored 1188.950 CORRECT; heard A/B against 1189.050, ' +
      'the owner now places it as early.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '383_sixty_four', scoredValue: 1189.050, verdict: 'CORRECT',
    note: 'THE REVERSAL. A/B against 1188.950 (the value `live-runs-s`, a SOLO listen, scored CORRECT): ' +
      'the owner now hears 1189.050 as correct and 1188.950 as early. Both sit inside 1.26s of literal ' +
      'digital silence — indistinguishable played alone, resolved only by the comparison. `live-runs-s`\'s ' +
      '1188.95 row is superseded, not deleted; see its own note.' },
  { sitting: 'ear-verify-t', corpus: 'v6', tag: '266_forty_one_burden', scoredValue: 788.65, verdict: 'CORRECT',
    note: 'L7, carried over unchanged from the live app (not part of the five-row A/B list — this is the ' +
      'R-AP ownership fix from Session S, re-confirmed, not a candidate-B row). WS1 Session T STEP 0 measured ' +
      'the pre-Step-1 production value at exactly 788.65 and this sitting confirms it CORRECT. FLAGGED: ' +
      'Step 1\'s onset correction (`acousticRunExtent`, applied uniformly, no special case) moves run 6\'s ' +
      'acoustic onset from 789.26 to 789.46, which moves this row\'s OWN computed value from 788.65 to ' +
      '788.75 — a fresh 0.10s regression AWAY from this very verdict, discovered by measurement after this ' +
      'row was already confirmed. Production commits 788.75 as of this session\'s HEAD, NOT the 788.65 this ' +
      'row authorises; see `ws1-session-q-production-pins.test.ts`\'s own pin and comment for the open item ' +
      'this creates. Not resolved this session — flagged, not special-cased.' },
];

/** Default match tolerance — the Zero-Defect Register's own. */
export const EAR_PIN_TOLERANCE_SEC = 0.005;

const orderOf = (r: EarPassRow): number => EAR_SITTINGS[r.sitting];

/** Every ledger row for one boundary, latest sitting first. */
export function earHistory(corpus: Corpus, tag: string): EarPassRow[] {
  return EAR_PASS_LEDGER.filter(r => r.corpus === corpus && r.tag === tag)
    .slice()
    .sort((a, b) => orderOf(b) - orderOf(a));
}

/**
 * The R-AM check. Returns the ledger row that AUTHORISES pinning `value` for
 * (corpus, tag) as a positive correctness assertion, or `undefined`.
 *
 * A row authorises iff it matches the value within tolerance, its verdict is
 * `'CORRECT'`, and NO LATER sitting scored the same value anything else.
 * Supersession is by `EAR_SITTINGS` order and needs no bookkeeping field: a
 * later sitting that disagrees is simply a later row.
 */
export function earPassAuthorising(corpus: Corpus, tag: string, value: number): EarPassRow | undefined {
  const matches = earHistory(corpus, tag).filter(r => {
    if (r.scoredValue === null) return false;
    return Math.abs(r.scoredValue - value) < (r.armToleranceSec ?? EAR_PIN_TOLERANCE_SEC);
  });
  const latest = matches[0];
  return latest && latest.verdict === 'CORRECT' ? latest : undefined;
}

/** The negative form, for a change-detector pin: the ledger must NOT authorise
 *  this value, or the pin is understating what is known and should be promoted
 *  to a positive assertion. */
export function earPassRejects(corpus: Corpus, tag: string, value: number): EarPassRow | undefined {
  const matches = earHistory(corpus, tag).filter(r => {
    if (r.scoredValue === null) return false;
    return Math.abs(r.scoredValue - value) < (r.armToleranceSec ?? EAR_PIN_TOLERANCE_SEC);
  });
  const latest = matches[0];
  return latest && latest.verdict !== 'CORRECT' ? latest : undefined;
}

/** Human-readable provenance for a failure message. */
export function describeEarHistory(corpus: Corpus, tag: string): string {
  const h = earHistory(corpus, tag);
  if (h.length === 0) return 'no ear pass has EVER scored this boundary';
  return h.map(r => `${r.sitting}: ${r.scoredValue ?? '(absent)'} -> ${r.verdict}`).join(' | ');
}
