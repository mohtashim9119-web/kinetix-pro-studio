/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AE — STEP 2 (rate-arm movement census) + STEP 3 (detector
// feature extraction). Generator, gated out of the default sweep:
//
//   WS1_SESSION_AE_MEASURE=1 npx vitest run scripts/ws1-session-ae-features.test.ts
//
// Emits, per corpus, `.work-phase4/session-ae/step23-features-<corpus>.json`:
//   * `native` / `sixteenK` — the committed boundary array the REAL production
//     path produces on each silence arm. The native arm is what the app ships
//     (`silenceDetector.ts` decodes the original voiceover via
//     `AudioContext.decodeAudioData` and reads channel 0); the 16 kHz arm is
//     the replay capture's own transcode. The delta between them IS the
//     native-rate movement census.
//   * per-boundary features for the two candidate detectors, all of them
//     derived from the immutable origin array, the script tokens and the
//     Hirschberg path — plus, separately labelled, the silence array, so the
//     analysis can show exactly which conjuncts are script-anchored and which
//     are not.
// Nothing is decided here. This file measures.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline';

const MEASURE = process.env.WS1_SESSION_AE_MEASURE === '1';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.work-phase4', 'session-ae');

interface Feat {
  index: number; tag: string; leftTag: string; committed: number;
  leftLastTokenIdx: number; rightFirstTokenIdx: number; lastFaWordBeforeCommitted: number; ordinalDelta: number | null;
  lLastStart: number | null; lLastEnd: number | null; lLastConf: number | null;
  rFirstStart: number | null; rFirstEnd: number | null; rFirstConf: number | null;
  gapWidth: number | null;
  /** SILENCE-ARM features — deliberately named so the spec can state which
   *  conjuncts are script-anchored and which are acoustic. */
  containingSilence: [number, number] | null;
  nextSilence: [number, number] | null;
  rFirstInsideSilence: boolean;
  lLastInsideSilence: boolean;
  /** How many FA word ONSETS lie in (committed, nextSilenceMid). */
  onsetsToNextSilenceMid: number | null;
  /** Onset of the right segment's first CLAIMED token whose confidence reaches
   *  the `CONF_MIN_FALLBACK` reliability line — the first instant FA offers
   *  reliable evidence that the right segment is actually speaking. */
  rFirstReliableStart: number | null;
  rFirstReliableConf: number | null;
  /** The next committed boundary, so an ordering guard can be evaluated. */
  nextCommitted: number | null;
}

async function featuresFor(key: 'v6' | '173' | 'spanish', silencesFile?: string): Promise<{ feats: Feat[]; committed: Array<{ tag: string; startTime: number }> }> {
  const run = await runProductionPath(CORPORA[key]!, false, silencesFile);
  const toks = run.usableFaTokens;
  const sils = run.silences;
  const feats: Feat[] = [];
  const inSil = (a: number, b: number): boolean => sils.some(s => a >= s.startSec && b <= s.endSec);
  for (let i = 1; i < run.committed.length; i++) {
    const B = run.committed[i]!.startTime;
    const lA = run.keptAlignments[i - 1]!, rA = run.keptAlignments[i]!;
    const lT = lA.lastTokenIdx >= 0 ? toks[lA.lastTokenIdx] : undefined;
    const rT = rA.firstTokenIdx >= 0 ? toks[rA.firstTokenIdx] : undefined;
    let lastBefore = -1;
    for (let t = 0; t < toks.length; t++) { if (toks[t]!.startSec < B) lastBefore = t; else break; }
    let relStart: number | null = null, relConf: number | null = null;
    if (rA.firstTokenIdx >= 0 && rA.lastTokenIdx >= 0) {
      for (let t = rA.firstTokenIdx; t <= rA.lastTokenIdx; t++) {
        const c = (toks[t] as { confidence?: number } | undefined)?.confidence ?? 0;
        if (c >= 0.056) { relStart = toks[t]!.startSec; relConf = c; break; }
      }
    }
    const containing = sils.find(s => B >= s.startSec && B <= s.endSec) ?? null;
    const next = sils.find(s => s.startSec > B) ?? null;
    const mid = next ? (next.startSec + next.endSec) / 2 : null;
    feats.push({
      index: i, tag: tagOf(run.committed[i]!), leftTag: tagOf(run.committed[i - 1]!), committed: B,
      leftLastTokenIdx: lA.lastTokenIdx, rightFirstTokenIdx: rA.firstTokenIdx,
      lastFaWordBeforeCommitted: lastBefore,
      ordinalDelta: lA.lastTokenIdx < 0 ? null : lastBefore - lA.lastTokenIdx,
      lLastStart: lT?.startSec ?? null, lLastEnd: lT?.endSec ?? null,
      lLastConf: lT ? ((lT as { confidence?: number }).confidence ?? null) : null,
      rFirstStart: rT?.startSec ?? null, rFirstEnd: rT?.endSec ?? null,
      rFirstConf: rT ? ((rT as { confidence?: number }).confidence ?? null) : null,
      gapWidth: lT && rT ? rT.startSec - lT.endSec : null,
      containingSilence: containing ? [containing.startSec, containing.endSec] : null,
      nextSilence: next ? [next.startSec, next.endSec] : null,
      rFirstInsideSilence: rT ? inSil(rT.startSec, rT.endSec) : false,
      lLastInsideSilence: lT ? inSil(lT.startSec, lT.endSec) : false,
      onsetsToNextSilenceMid: mid === null ? null : toks.filter(w => w.startSec > B && w.startSec < mid).length,
      rFirstReliableStart: relStart, rFirstReliableConf: relConf,
      nextCommitted: i + 1 < run.committed.length ? run.committed[i + 1]!.startTime : null,
    });
  }
  return { feats, committed: run.committed.map(s => ({ tag: tagOf(s), startTime: s.startTime })) };
}

describe.skipIf(!MEASURE)('WS1 Session AE — Steps 2/3 feature extraction', () => {
  for (const key of ['v6', '173', 'spanish'] as const) {
    it(`extracts ${key}`, async () => {
      const native = await featuresFor(key);
      const sixteen = await featuresFor(key, 'silences_app.json');
      mkdirSync(OUT, { recursive: true });
      writeFileSync(resolve(OUT, `step23-features-${key}.json`), JSON.stringify({
        corpus: key,
        nativeArm: 'silences_native.json', sixteenKArm: 'silences_app.json',
        native: native.feats, nativeCommitted: native.committed,
        sixteenK: sixteen.feats, sixteenKCommitted: sixteen.committed,
      }, null, 1));
    }, 900_000);
  }
});
