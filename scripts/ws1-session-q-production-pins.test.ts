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
// chunk plan — `run-id p-20260819T120922Z-cbb403c1`), covering every rule
// this session touched: R.12's fix (all 7 post-fix corrected values) and
// R.13 (the 4 already-closed ear-pass pins its own invariant depends on
// staying put).
//
// RED BEFORE / GREEN AFTER, per boundary: reverting `faRunPlacementGate.ts`'s
// `acousticRunExtent` fix (this file's own `M11-A` in the Session Q mutation
// matrix) turns R.12's seven assertions red; reverting the R.13 carrier fix
// (`M12`) does not move these four pins (R.13 fires 0 either way on this
// corpus — see `ws1-session-q-invariants.test.ts`'s own header) but IS
// covered by that file's RED-before/GREEN-after unit test instead, since
// none of these four pins depend on R.13 firing.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { VideoSegment } from '../src/types';

describe('WS1 Session Q — production-path pin set (R-AO / R-AM, live-fidelity bundle)', () => {
  const TIMEOUT = 300_000;

  it('R.12: all seven post-fix corrected boundaries, pinned to 0.005s', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    const at = (tag: string): number => {
      const s = r.committed.find((x: VideoSegment) => tagOf(x) === tag);
      expect(s, `${tag} must be on the committed timeline`).toBeDefined();
      return s!.startTime;
    };
    // Corrected values, as measured this session (Step 5b / Step 8 rootcause,
    // reproducing WS1 Session H's original figures exactly).
    expect(at('042_eleven_years'), '042_eleven_years').toBeCloseTo(125.54, 2);
    expect(at('125_night_circle'), '125_night_circle').toBeCloseTo(370.75, 2);
    expect(at('176_twenty_six_scout'), '176_twenty_six_scout').toBeCloseTo(521.71, 2);
    expect(at('224_thirty_three'), '224_thirty_three').toBeCloseTo(663.785, 3);
    expect(at('307_forty_nine_years'), '307_forty_nine_years').toBeCloseTo(924.92, 2);
    expect(at('340_fifty_eight'), '340_fifty_eight').toBeCloseTo(1044.67, 2);
    expect(at('383_sixty_four'), '383_sixty_four').toBeCloseTo(1188.95, 2);
    // The eighth v6 run-carrying boundary, 085_the_spear_bearer, is NOT a
    // finding at all (`085_the_spear_bearer`'s committed 250.81 already sits
    // outside the run — Whisper alone was already correct there; see
    // KNOWN_BAD's structural-derivation note) — asserting it here would pin
    // R.12 declining, not R.12 correcting, a different claim.
    expect(r.fired['R.12']).toBe(7);
  }, TIMEOUT);

  it('the four EAR-PASS pins hold at their ear-verified values', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    const at = (tag: string): number => {
      const s = r.committed.find((x: VideoSegment) => tagOf(x) === tag);
      expect(s, `${tag} must be on the committed timeline`).toBeDefined();
      return s!.startTime;
    };
    expect(at('192_scout_listening'), '192_scout_listening').toBeCloseTo(571.07, 2);
    expect(at('226_four_scouts'), '226_four_scouts').toBeCloseTo(671.17, 2);
    expect(at('232_sudden_halt'), '232_sudden_halt').toBeCloseTo(684.09, 2);
    expect(at('233_firelight_speech'), '233_firelight_speech').toBeCloseTo(686.54, 2);
  }, TIMEOUT);
});
