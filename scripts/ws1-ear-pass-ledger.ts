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
  /** WS1 Session V — the operator's live-app A/B pass over the seven rows
   *  Session T's `ear-verify-t` sitting left open in the Zero-Defect Register
   *  (fixture-scoped for five of them, plus the live-path-only `266` and the
   *  reopened `383`). Six of the seven RE-CONFIRM `ear-verify-t`'s own values
   *  at the same numbers — recorded as fresh rows rather than silently
   *  relying on the order-6/7 sittings, because Step 4's closure ceremony
   *  requires a session-V-attributed row to close against. The seventh,
   *  `266_forty_one_burden`, is NEW: no prior sitting had heard 788.75 (only
   *  788.65, `ear-verify-t`'s own value, which Session T's own Step 1 onset
   *  correction had already moved production away from before anyone
   *  listened again) — this sitting is the first to confirm what the app
   *  commits today. */
  'ear-verify-v': 8,
  /** WS1 Session X — the operator's full 173 listening pass (Method A/B):
   *  Section A (9 rows, `docs/ws1-sync-pipeline/stage1-session-w-173-ear-list.md`
   *  — the CSV numbers these 0-8, nine rows; the doc's own "8 rows" header is
   *  stale, left over from before row 0 (5-6) was added to the sitting) +
   *  Section B (12 rows) of that same capture-only run sheet, PLUS three
   *  further defects (21-22, 42-43, 104-105) the operator caught in a fuller
   *  listen-through that were never on either section's candidate list at
   *  all — 24 verdicts total, corpus 173 exclusively. Supersedes every prior
   *  173 verdict at HEAD for any row it re-scores (`vessel_damage_clue`@174.74
   *  re-confirms `ear-12`'s own row unchanged; `protection_failure`@603.69
   *  re-confirms `mover-audit-k`'s). Source: `/Users/mohtashim/Downloads/173
   *  20-seg list - Sheet1.csv` (Section A's Ear-verdict/Class columns filled
   *  in; Section B's are not present in that sheet — its 12/12 PASS verdict
   *  and the three off-list defects are transcribed here from the operator's
   *  own session-brief summary, not from a machine-readable export). */
  'ear-173-x': 9,
  /** WS1 Session AD — the operator's A/B (side-by-side candidate comparison)
   *  pass over the historical row-0/`152_frozen_brush_mice`/item-7 PLUS all 8
   *  open Class A/B rows (`docs/ws1-sync-pipeline/stage1-session-ac-ear-
   *  list.md`'s own candidate list) — closing the exact gap Session AC
   *  identified: none of those 8 rows previously carried a genuine listening
   *  pass, only `session-p-live`'s same-session self-transcription of the
   *  register's own claim. Every value below reconfirms what was already on
   *  record (`session-p-live` for the 8 open rows, `ear-12` for item-7) —
   *  nothing here changes a number, only its evidentiary status. See this
   *  sitting's own row-0 notes for the 450.99 supersession this pass surfaced
   *  while reconciling item-7 against the ledger. */
  'ear-verify-ad': 10,
  /** WS1 Session AE — the operator's A/B (side-by-side candidate comparison)
   *  pass that surfaced `008_unknown_void`, a v6 defect NO candidate list had
   *  ever carried: it was found only because a proposed 0.028 amplitude floor
   *  flagged the boundary, and the listening pass that followed found the
   *  boundary itself defective. THE FLOOR IS REJECTED AND IS NOT SHIPPED, and
   *  the distinction matters enough to record here rather than only in the
   *  session narrative: a detector that flags a boundary which turns out to be
   *  DEFECTIVE has not demonstrated it can tell a good boundary from a bad one
   *  — it has produced one true positive with no measured false-positive rate,
   *  which is a lead, not a detector. The 0.05 floor already in force is
   *  likewise not lowered. What is ingested from this sitting is the EAR
   *  VERDICT alone.
   *
   *  This sitting also re-states, without re-scoring, that WS1 Session X's
   *  `ear-173-x` rows for 173's five defects (5-6, 21-22, 42-43, 104-105,
   *  106-107) were checked value-for-value against the session brief's own
   *  ground-truth list and are IDENTICAL — no row is overwritten, and none
   *  needed to be. */
  'ear-verify-ae': 11,
  /** WS1 Session AG — the operator's listening pass over the five v6 rows
   *  Session AE's own "deferred" list named (the FOUR UNVERIFIED-MOVED R.14
   *  boundaries plus `289_winter_predator_breach`, which R.14's reliable-onset
   *  guard DECLINED), plus a re-hearing of `231_slowing_pace`'s named target.
   *
   *  WHY IT MATTERS BEYOND SIX ROWS. Session AE shipped R.14/R.15 with
   *  precision 10/10 on ear-scored rows and FOUR moves nobody had heard. A
   *  precision figure with an unverified remainder is an interval, not a
   *  number: the true value lay somewhere in [10/14, 14/14] and the register
   *  could not say where. All four are scored CORRECT here, so the interval
   *  collapses — R.14/R.15's precision is 14/14 = 1.000 with NO unverified
   *  remainder, and every boundary the gate has ever moved is now audited.
   *
   *  TWO GUARD VERDICTS, POINTING OPPOSITE WAYS, and both are recorded because
   *  the disagreement is the finding. `289_winter_predator_breach`@865.390 is
   *  CORRECT as committed — the reliable-onset guard was RIGHT to decline it.
   *  `231_slowing_pace`@682.740 is confirmed CORRECT as a target — so the SAME
   *  guard was WRONG to decline that row, which still commits 681.63. One
   *  guard, one true negative and one false negative; relaxing it is therefore
   *  not free, and this sitting does not authorise relaxing it. */
  'ear-verify-ag': 12,
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

  // -------------------------------------------------------------------------
  // WS1 SESSION V — the operator's A/B pass over the seven rows Session T
  // left open in the Zero-Defect Register, re-measured against a fresh
  // run-id-stamped bundle (Step 1, `.work-phase4/session-v`) before the
  // sitting. Six rows re-confirm `ear-verify-t`'s own values unchanged; the
  // seventh (`266_forty_one_burden`) is the FIRST sitting to hear 788.75,
  // the value Step 1's onset correction has committed since Session T but
  // that nobody had listened to on its own until now.
  // -------------------------------------------------------------------------
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '042_eleven_years', scoredValue: 125.760, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '176_twenty_six_scout', scoredValue: 522.460, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '224_thirty_three', scoredValue: 664.330, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '307_forty_nine_years', scoredValue: 925.430, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '340_fifty_eight', scoredValue: 1045.620, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '383_sixty_four', scoredValue: 1189.050, verdict: 'CORRECT',
    note: 'Re-confirmed against a fresh Step 1 bundle; unchanged from `ear-verify-t`\'s own reversal.' },
  { sitting: 'ear-verify-v', corpus: 'v6', tag: '266_forty_one_burden', scoredValue: 788.75, verdict: 'CORRECT',
    note: 'THE FIRST SITTING TO HEAR 788.75 ON ITS OWN. `ear-verify-t` (order 7) heard and confirmed 788.65, ' +
      'the value production computed AT THAT SESSION\'S STEP 0 — before Step 1\'s onset correction (applied ' +
      'uniformly, not special-cased) moved run 6\'s acoustic onset from 789.26 to 789.46 and, with it, this ' +
      'row\'s own computed value to 788.75. That move was discovered by measurement AFTER the 788.65 sitting, ' +
      'so nobody had heard 788.75 until this session. THE "REGRESSION" FRAMING `s-266-live-path-collision` ' +
      'carried since Session T IS REFUTED BY THIS VERDICT: 788.75 is not a defect away from a confirmed ' +
      'value, it is the confirmed value. Structurally it is exactly Session S Step 3\'s candidate (a) FULL ' +
      '(unclamped) silence midpoint — the same correction family `ear-verify-t` already validated on all six ' +
      'sibling rows above — so it is the SAME mechanism landing on the SAME kind of value everywhere, not a ' +
      'special case. WHETHER THE 0.10s MOVE FROM 788.65 IS AN AUDIBLE IMPROVEMENT OR BELOW AUDIBILITY COULD ' +
      'NOT BE DETERMINED FROM THIS SITTING: this pass confirmed what the app commits today (788.75), not a ' +
      'direct two-way A/B against 788.65 specifically the way the six-row list above got. A future session ' +
      'wanting that finer distinction needs to run it as its own A/B, the same way `ear-verify-t` did for ' +
      '383 against 1188.95.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION X — the operator's full 173 listening pass, corpus 173
  // exclusively. Section A (9 rows, idx 0-8 in the CSV's own numbering) +
  // Section B (12 rows) of `docs/ws1-sync-pipeline/stage1-session-w-173-ear-
  // list.md`'s capture-only run sheet, plus three further defects the
  // operator caught in a fuller listen-through that were on NEITHER
  // section's candidate list. `scoredValue` below is the value actually
  // heard: the committed value for every CORRECT row, and BOTH the rejected
  // committed value (EARLY) and the named correct value (CORRECT) for each
  // of the five real defects, following this file's own two-row convention
  // for a named target (see `session-p-live`'s Class A/B pairs above).
  // -------------------------------------------------------------------------
  { sitting: 'ear-173-x', corpus: '173', tag: 'lethal_nature_hazard', scoredValue: 18.51, verdict: 'EARLY',
    note: 'Section A row 0 (5-6). distanceToSilence 0.000 — sits exactly on a real detected silence ' +
      '[18.32,18.70], just not the right one; no silence exists anywhere near the correct instant.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'lethal_nature_hazard', scoredValue: 19.27, verdict: 'CORRECT',
    note: 'Section A row 0 (5-6) named target. No detected silence backs this instant — it sits in the ' +
      'gap between "worst" (ends 18.68, FA confidence collapses to ~0 for the trailing left words) and ' +
      '"because" (starts 19.30, FA confidence 0.97+). Wrong-landmark defect, not a proximity defect.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'rugged_survivalist', scoredValue: 23.16, verdict: 'CORRECT',
    note: 'Section A row 1 (6-7), the operator-reported seam. seam-attribution.json: no word crosses the ' +
      'seam to the wrong side — a placement question, and the ear says 23.16 was already the right placement.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'ancient_schematic_view', scoredValue: 59.59, verdict: 'CORRECT',
    note: 'Section B row 9. Flagged by silence-distance (2.15s) alone, not still-playing.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'iron_bounce', scoredValue: 75.66, verdict: 'EARLY',
    note: 'Off-list defect (21-22), never flagged by any existing signal — distanceToSilence 0.000, sits ' +
      'exactly on real silence [75.50,75.82]. Found only by full listen-through, not by any candidate list.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'iron_bounce', scoredValue: 76.59, verdict: 'CORRECT',
    note: 'Off-list defect (21-22) named target. No detected silence within 3s of this instant.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'maintenance_blade', scoredValue: 110.86, verdict: 'CORRECT',
    note: 'Section B row 10. Flagged by silence-distance (2.10s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'shifting_monolith', scoredValue: 130.17, verdict: 'CORRECT',
    note: 'Section A row 2 (34-35), app-flagged "still playing". Splits mid-sentence inside "...and debris, ' +
      'fused by warp transit into a structure too massive to ignore..." — a legitimate mid-dialogue cut with ' +
      'no silence at the seam; the app was already right. Attached evidence for the R-MD suppression-class ' +
      'question (Step 4).' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'wall_split_path', scoredValue: 161.33, verdict: 'EARLY',
    note: 'Off-list defect (42-43), never flagged by any existing signal — distanceToSilence 0.000, sits ' +
      'exactly on real silence [161.20,161.46]. Found only by full listen-through.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'wall_split_path', scoredValue: 162.15, verdict: 'CORRECT',
    note: 'Off-list defect (42-43) named target. No detected silence within 3s of this instant.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'vessel_damage_clue', scoredValue: 174.74, verdict: 'CORRECT',
    note: 'Section A row 3 (45-46), the fidelity-gate divergence — re-confirms `ear-12`\'s own row at the ' +
      'same value, unchanged. This is the LIVE value; a same-HEAD regeneration against the cached ' +
      '`.work-phase4/replay/173` FA arm produced 172.91 instead (non-determinism, WS1 Session X Step 7) — ' +
      '172.91 was never heard by this sitting and carries no ear verdict.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'listening_error', scoredValue: 191.43, verdict: 'CORRECT',
    note: 'Section B row 11. Flagged by silence-distance (2.37s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'perpendicular_structural_entry', scoredValue: 201.89, verdict: 'CORRECT',
    note: 'Section B row 12. Flagged by silence-distance (4.91s, the widest gap in this sitting) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'rugged_landscape', scoredValue: 228.48, verdict: 'CORRECT',
    note: 'Section B row 13. Flagged by silence-distance (2.92s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'sturdy_plating', scoredValue: 244.60, verdict: 'CORRECT',
    note: 'Section B row 14. Flagged by silence-distance (3.20s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'strategic_equivalence', scoredValue: 305.43, verdict: 'CORRECT',
    note: 'Section B row 15. Flagged by silence-distance (2.81s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'rapid_skirmish_clash', scoredValue: 348.93, verdict: 'CORRECT',
    note: 'Section A row 4 (88-89), app-flagged "still playing".' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'ancient_guardian_mechanism', scoredValue: 382.20, verdict: 'CORRECT',
    note: 'Section A row 5 (96-97), app-flagged "still playing".' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'explosive_focus', scoredValue: 399.29, verdict: 'CORRECT',
    note: 'Section B row 16. Flagged by silence-distance (1.41s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'logic_clash', scoredValue: 417.15, verdict: 'EARLY',
    note: 'Off-list defect (104-105), never flagged by any existing signal — distanceToSilence 0.000, sits ' +
      'exactly on real silence [417.00,417.30]. Found only by full listen-through.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'logic_clash', scoredValue: 418.14, verdict: 'CORRECT',
    note: 'Off-list defect (104-105) named target. Sits in the gap between two real silences ' +
      '([417.00,417.30] and [419.56,420.06]) with no silence of its own.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'gadget_decay', scoredValue: 427.48, verdict: 'EARLY',
    note: 'Section A row 6 (106-107), app-flagged "still playing" — the ONE row in this sitting where the ' +
      'flag was RIGHT. No detected silence anywhere within 3s; a genuine no-anchor fallback boundary.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'gadget_decay', scoredValue: 427.60, verdict: 'CORRECT',
    note: 'Section A row 6 (106-107) named target, +0.12s from committed — the smallest of the five corrections.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'mystery_signal_lag', scoredValue: 472.26, verdict: 'CORRECT',
    note: 'Section B row 17. Flagged by silence-distance (1.86s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'pattern_chaos', scoredValue: 545.89, verdict: 'CORRECT',
    note: 'Section A row 7 (133-134), app-flagged "still playing".' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'unbound_chaos', scoredValue: 563.50, verdict: 'CORRECT',
    note: 'Section B row 18. Flagged by silence-distance (2.48s) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'protection_failure', scoredValue: 603.69, verdict: 'CORRECT',
    note: 'Section A row 8 (144-145), app-flagged "still playing" — re-confirms `mover-audit-k`\'s own row ' +
      'at the same value, unchanged.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'uncertain_outcome', scoredValue: 682.13, verdict: 'CORRECT',
    note: 'Section B row 19. Flagged by silence-distance (1.17s, the narrowest gap in this sitting) alone.' },
  { sitting: 'ear-173-x', corpus: '173', tag: 'troop_deployment', scoredValue: 696.04, verdict: 'CORRECT',
    note: 'Section B row 20. Flagged by silence-distance (1.30s) alone.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION AD — operator A/B pass, row-0/item-7 plus all 8 open rows.
  // Method: candidates played side by side (not solo), per `ear-verify-t`/
  // `ear-verify-v`'s own convention. EVERY value below is IDENTICAL to what
  // was already on record before this sitting — see this file's header note
  // on sitting `ear-verify-ad` for why that is still worth ingesting (it
  // upgrades evidentiary status, not the numbers).
  // -------------------------------------------------------------------------

  // Row 0 — historical, NOT one of the 8 open register rows. Item-7 is CLOSED
  // at the fixture level (`ear-12`'s order-1 sitting already scored 451.03
  // CORRECT) and stays open only as a LIVE-PATH-ONLY defect (fitDeviation
  // pinned at the metric's own mathematical floor of 1.0 — structurally
  // unreachable by R.11 at any threshold, `docs/work-in-progress.md` §11f).
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '152_frozen_brush_mice', scoredValue: 449.20, verdict: 'WRONG',
    note: 'Row 0. The live-path committed value. Confirmed wrong, A/B against the target below.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '152_frozen_brush_mice', scoredValue: 451.03, verdict: 'CORRECT',
    note: 'Row 0 target. RECONFIRMS `ear-12`\'s (order 1, the earliest sitting on record) original ' +
      'verdict, unchanged — a SUPERSESSION, not a correction: the earliest sitting already had this ' +
      'right, and nothing between then and now ever entered a contradicting row INTO THIS LEDGER. ' +
      'SEPARATELY SUPERSEDED, for the record: the value `450.99`, which was NEVER an EAR_PASS_LEDGER ' +
      'entry — it originates in WS1 Session P\'s (2026-08-19, commit `e7e4f9a`) own "Class A is not a ' +
      'threshold problem" per-conjunct prose table (`docs/work-in-progress.md`), which transcribed ' +
      'this row\'s own already-on-record 451.03 as 450.99 and from there propagated into `scripts/ws1-' +
      'generalization.test.ts`\'s banned-timestamp guard list and three Session Q/R measurement ' +
      'scripts\' hardcoded constants (`ws1-session-q-silence-distance.test.ts`, `ws1-session-q-' +
      'detector-validate.test.ts`, `ws1-session-r-containment.test.ts`), none of which re-derived it ' +
      'from this ledger before using it. Those four files are NOT edited this session: each is an ' +
      'append-only record of its OWN session\'s measurement, and `ws1-generalization.test.ts`\'s ' +
      'banned list cannot swap in 451.03 without first checking for a collision against 451.03\'s own ' +
      'LEGITIMATE existing use as a regression pin elsewhere (`src/services/faSeamFitGate.test.ts:250`, ' +
      '`faRunPlacementGate.test.ts:646`) — out of this session\'s scope. 450.99 is hereby marked ' +
      'SUPERSEDED; this ledger has never authorised any value for this row other than 451.03.' },

  // Rows 1-3 — Class A (3 of the 8 open rows).
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '214_solitary_fire', scoredValue: 629.01, verdict: 'WRONG',
    note: 'Row 1. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value ' +
      'with a genuine A/B listening pass.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '214_solitary_fire', scoredValue: 630.09, verdict: 'CORRECT',
    note: 'Row 1 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '231_slowing_pace', scoredValue: 681.63, verdict: 'WRONG',
    note: 'Row 2. Confirmed wrong; committed value re-confirmed against a fresh probe this session, ' +
      'unchanged at 681.63.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '231_slowing_pace', scoredValue: 682.74, verdict: 'CORRECT',
    note: 'Row 2 target. A/B-confirmed CORRECT — the THIRD option in a three-way choice ' +
      '(`stage1-session-ac-ear-list.md` row 2: A=680.99 a naive nearest-silence detector\'s own ' +
      'proposal, B=681.63 committed, C=682.74 this target); the owner picked C.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '447_scout_facing_dark', scoredValue: 1417.12, verdict: 'WRONG',
    note: 'Row 3. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value ' +
      'with a genuine A/B listening pass.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '447_scout_facing_dark', scoredValue: 1418.53, verdict: 'CORRECT',
    note: 'Row 3 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },

  // Rows 4-8 — Class B (5 of the 8 open rows).
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '056_dropping_torch', scoredValue: 167.03, verdict: 'WRONG',
    note: 'Row 4. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '056_dropping_torch', scoredValue: 167.70, verdict: 'CORRECT',
    note: 'Row 4 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '167_smell_of_butchery', scoredValue: 494.43, verdict: 'WRONG',
    note: 'Row 5. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '167_smell_of_butchery', scoredValue: 494.75, verdict: 'CORRECT',
    note: 'Row 5 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '286_fact_to_act', scoredValue: 856.09, verdict: 'WRONG',
    note: 'Row 6. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '286_fact_to_act', scoredValue: 856.52, verdict: 'CORRECT',
    note: 'Row 6 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '400_endless_dark', scoredValue: 1266.21, verdict: 'WRONG',
    note: 'Row 7. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '400_endless_dark', scoredValue: 1266.66, verdict: 'CORRECT',
    note: 'Row 7 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '403_vigilant_embers', scoredValue: 1273.14, verdict: 'WRONG',
    note: 'Row 8. Confirmed wrong. Supersedes `session-p-live`\'s self-transcription of the same value.' },
  { sitting: 'ear-verify-ad', corpus: 'v6', tag: '403_vigilant_embers', scoredValue: 1273.55, verdict: 'CORRECT',
    note: 'Row 8 target. A/B-confirmed CORRECT, same value the register\'s own earCorrect already named. ' +
      'NOTE (Session AD Step 6): at the app\'s real native audio decode rate this boundary\'s OWN ' +
      'amplitude already clears the still-playing checker\'s 0.05 floor, unlike at the replay bundle\'s ' +
      '16kHz rate — detection improves independent of any threshold change; this row\'s CORRECTION ' +
      'status (the target above) is unaffected either way.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION AE — one NEW v6 defect, method A/B, operator-attributed.
  //
  // `008_unknown_void` had never appeared on any candidate list, in any
  // sitting, in this file's whole history. It was reached only because a
  // PROPOSED 0.028 amplitude floor flagged it — and the listening pass then
  // found the flagged boundary itself defective. See this sitting's own note
  // in `EAR_SITTINGS` for why that makes the 0.028 floor evidence of nothing
  // and why it is rejected rather than shipped.
  //
  // Structurally this row is the same defect family as the five Class B rows
  // above, measured (WS1 Session AE Step 1): FA smears the incoming segment's
  // opening words BACKWARD across a real 0.70s silence with confidence 8.5e-8,
  // the word gap collapses to a single 20ms aligner frame, and the commit
  // lands at that gap's midpoint (23.13) instead of the silence's own (23.45).
  // -------------------------------------------------------------------------
  { sitting: 'ear-verify-ae', corpus: 'v6', tag: '008_unknown_void', scoredValue: 23.13, verdict: 'EARLY',
    note: 'The committed value. Confirmed EARLY — the cut lands 0.03s into the [23.10, 23.80] silence, ' +
      'while "You do not know what it is." has not begun.' },
  { sitting: 'ear-verify-ae', corpus: 'v6', tag: '008_unknown_void', scoredValue: 23.46, verdict: 'CORRECT',
    note: 'Target. A/B-confirmed CORRECT against 23.13. Sits 0.01s off the [23.10, 23.80] silence\'s own ' +
      'midpoint (23.45) — the same whole-silence-midpoint family `ear-verify-t` validated on six rows and ' +
      '`ear-verify-ad` on five more, landing on a value nobody had computed when the sitting was run.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION AG — the four UNVERIFIED-MOVED R.14 boundaries, audited.
  //
  // These are NOT defects and were never on any defect list. Each is a
  // boundary R.14 MOVED in Session AE with no ear evidence either way — the
  // remainder that made that session's "precision 10/10" an interval rather
  // than a number. All four scored CORRECT at the moved value, so each one is
  // simultaneously (a) a true positive for the gate and (b) a new ear-verified
  // CONTROL for every future rule, taking the control population 37 -> 43.
  // -------------------------------------------------------------------------
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '039_river_trap', scoredValue: 114.640, verdict: 'CORRECT',
    note: 'R.14 moved this 114.250 -> 114.640 (+0.390) in Session AE with no ear evidence. Heard here and ' +
      'accepted at the MOVED value: the correction was right. Now a positive control.' },
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '083_unbidden_alertness', scoredValue: 245.270, verdict: 'CORRECT',
    note: 'R.14 moved this 244.810 -> 245.270 (+0.460) in Session AE with no ear evidence. Heard here and ' +
      'accepted at the MOVED value. Now a positive control.' },
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '221_skill_removes', scoredValue: 654.450, verdict: 'CORRECT',
    note: 'R.14 moved this 654.230 -> 654.450 (+0.220) in Session AE with no ear evidence — the SMALLEST of ' +
      'the four unverified moves, and the one most at risk of being below audibility either way. Heard here ' +
      'and accepted at the MOVED value. Now a positive control.' },
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '222_long_silence', scoredValue: 659.330, verdict: 'CORRECT',
    note: 'R.14 moved this 658.940 -> 659.330 (+0.390) in Session AE with no ear evidence. Heard here and ' +
      'accepted at the MOVED value. Now a positive control.' },

  // -------------------------------------------------------------------------
  // WS1 SESSION AG — the two GUARD verdicts, which disagree with each other.
  // -------------------------------------------------------------------------
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '289_winter_predator_breach', scoredValue: 865.390, verdict: 'CORRECT',
    note: 'THE GUARD\'S TRUE NEGATIVE. R.14\'s reliable-onset guard DECLINED to move this boundary; the ' +
      'committed value is confirmed CORRECT, so declining was right. A control for any future relaxation ' +
      'of that guard — relaxing it must not move this row.' },
  { sitting: 'ear-verify-ag', corpus: 'v6', tag: '231_slowing_pace', scoredValue: 682.740, verdict: 'CORRECT',
    note: 'THE GUARD\'S FALSE NEGATIVE, and an independent re-confirmation of `ear-verify-ad`\'s own target ' +
      'at the same value. R.14 DECLINED this row on the reliable-onset guard, so production still commits ' +
      '681.63 (heard WRONG by `ear-verify-ad`). The operator\'s own waveform measurement of this seam ' +
      '(`docs/ws1-sync-pipeline/fa-chunk-phantom-root-cause.md` §1) puts segment 231\'s speech at ' +
      '683.04-683.84 and segment 230\'s at 681.47-682.43, independently corroborating that the cut belongs ' +
      'after 682.43 and not at 681.63. Register row `classA-231-slowing-pace` STAYS OPEN: this sitting ' +
      'confirms the target, it does not move production onto it.' },
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
