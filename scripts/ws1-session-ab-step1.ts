/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AB — Step 1/1a/1b: re-derive R.11's constants from live
// cross-corpus evidence (scripts/ws1-session-ab-r11-corpus-probe.test.ts
// output, counterfactual mode), with sensitivity + LOOCV + corpus holdout.
// Read-only analysis; run via tsx.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EAR_PASS_LEDGER, earPassAuthorising, earPassRejects, type Corpus } from './ws1-ear-pass-ledger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '.work-phase4', 'session-ab');

interface Row {
  corpus: 'v6' | '173' | 'spanish';
  tag: string; edge: 'start' | 'end';
  fitDeviation: number;
  declinedAt: string | null;
  wouldFireIfC1Passed: boolean;
  committedValue?: number; correctedValue?: number;
  spanMaxConf?: number | null;
}

const rows: Row[] = [];
for (const key of ['v6', '173', 'spanish'] as const) {
  const d = JSON.parse(readFileSync(resolve(OUT, `r11-probe-${key}.json`), 'utf-8'));
  rows.push(...(d.rows as Row[]));
}

function classify(r: Row): 'ALREADY_CORRECT' | 'DEFECT_FIXED' | 'DEFECT_UNFIXED' | 'UNVERIFIED' {
  const corpus = r.corpus as Corpus;
  if (r.committedValue === undefined) return 'UNVERIFIED';
  if (earPassAuthorising(corpus, r.tag, r.committedValue)) return 'ALREADY_CORRECT';
  if (r.correctedValue !== undefined && earPassAuthorising(corpus, r.tag, r.correctedValue)) return 'DEFECT_FIXED';
  if (earPassRejects(corpus, r.tag, r.committedValue)) return 'DEFECT_UNFIXED';
  return 'UNVERIFIED';
}
const withClass = rows.map(r => ({ ...r, cls: classify(r) }));

// ===========================================================================
// R11_MIN_FIT_DEVIATION re-derivation.
// ===========================================================================
console.log('###################### R11_MIN_FIT_DEVIATION ######################');
const truePositives = withClass.filter(r => r.cls === 'DEFECT_FIXED');
console.log('DEFECT_FIXED (ear-confirmed: committed is wrong, R.11\'s own proposal is the ear-confirmed right value):');
for (const r of truePositives) console.log(' ', r.corpus, r.tag, r.edge, 'fitDev='+r.fitDeviation);
const worstBadFitDev = Math.min(...truePositives.map(r => r.fitDeviation));
console.log('worst (lowest) confirmed-fixed fitDeviation:', worstBadFitDev);

// Nearest negative candidate: NOT a no-op (a real correction would be
// proposed), reaches C2 (agreedAnchor + backingSilence resolve), and is
// either ALREADY_CORRECT (correcting it would be a genuine false positive)
// or DEFECT_UNFIXED-but-not-this-rules-defect (R.12/R.13 territory, must stay
// declined for mutual exclusion) - i.e. any candidate for which "R.11 firing
// here" is not licensed. Restricted to fitDeviation < worstBadFitDev (a
// negative ABOVE the positive can't be separated by this conjunct at all —
// reported separately below).
const dangerousNegatives = withClass.filter(r =>
  r.declinedAt !== 'C3 no-op delta' && r.declinedAt !== null &&
  (r.cls === 'ALREADY_CORRECT' || r.cls === 'DEFECT_UNFIXED') &&
  r.correctedValue !== undefined && r.committedValue !== undefined &&
  Math.abs(r.correctedValue - r.committedValue) > 0.05);
console.log('\nCandidates where firing would be a genuine false positive (non-no-op, ALREADY_CORRECT or DEFECT_UNFIXED-not-R11s-to-fix):');
dangerousNegatives.sort((a, b) => b.fitDeviation - a.fitDeviation);
for (const r of dangerousNegatives) console.log(' ', r.corpus, r.tag, r.edge, 'fitDev='+r.fitDeviation, r.cls, 'wouldFireIfC1Passed='+r.wouldFireIfC1Passed);
const nearestNegFitDev = Math.max(...dangerousNegatives.filter(r => r.fitDeviation < worstBadFitDev).map(r => r.fitDeviation));
console.log('\nnearest negative (highest fitDeviation among dangerous negatives BELOW the worst positive):', nearestNegFitDev);
console.log('any dangerous negative AT OR ABOVE the worst positive fitDeviation (would make separation impossible)?',
  dangerousNegatives.filter(r => r.fitDeviation >= worstBadFitDev).map(r => `${r.corpus}/${r.tag}/${r.edge}@${r.fitDeviation}`));

if (Number.isFinite(nearestNegFitDev) && nearestNegFitDev < worstBadFitDev) {
  const mid = Math.sqrt(worstBadFitDev * nearestNegFitDev);
  console.log('\nGEOMETRIC MIDPOINT candidate for R11_MIN_FIT_DEVIATION:', mid);
  console.log('current shipped value: 1.3093; margin vs worst positive:', (worstBadFitDev / mid).toFixed(4) + 'x; margin vs nearest negative:', (mid / nearestNegFitDev).toFixed(4) + 'x');
}

// ===========================================================================
// R11_MAX_SPAN_WORD_CONF re-derivation.
// ===========================================================================
console.log('\n\n###################### R11_MAX_SPAN_WORD_CONF ######################');
console.log('spanMaxConf among DEFECT_FIXED (true positives, evidence must stay near-empty):');
for (const r of truePositives) console.log(' ', r.corpus, r.tag, r.edge, 'spanMaxConf='+r.spanMaxConf);
const worstBadSpanConf = Math.max(...truePositives.filter(r => typeof r.spanMaxConf === 'number').map(r => r.spanMaxConf as number));
console.log('worst (highest) confirmed-fixed spanMaxConf:', worstBadSpanConf);

// Nearest negative: candidates that pass C1+C2+C3 (real, non-no-op, chunk-edge
// candidate) but MUST decline via C4 evidence (real word present) because
// firing there would be wrong (ALREADY_CORRECT) or would invade another
// rule's territory (DEFECT_UNFIXED, e.g. 125_night_circle / R.12).
const spanNegatives = withClass.filter(r =>
  (r.declinedAt === 'C4 spanMaxConf') &&
  (r.cls === 'ALREADY_CORRECT' || r.cls === 'DEFECT_UNFIXED') &&
  typeof r.spanMaxConf === 'number');
spanNegatives.sort((a, b) => (a.spanMaxConf as number) - (b.spanMaxConf as number));
console.log('\nCandidates R.11 must keep declining via C4 (ALREADY_CORRECT or DEFECT_UNFIXED, real evidence present):');
for (const r of spanNegatives) console.log(' ', r.corpus, r.tag, r.edge, 'spanMaxConf='+r.spanMaxConf, r.cls, 'fitDev='+r.fitDeviation);
const nearestNegSpanConf = spanNegatives.length > 0 ? (spanNegatives[0]!.spanMaxConf as number) : NaN;
console.log('\nnearest negative (lowest spanMaxConf among must-decline candidates):', nearestNegSpanConf);

if (Number.isFinite(nearestNegSpanConf) && nearestNegSpanConf > worstBadSpanConf) {
  const mid = Math.sqrt(worstBadSpanConf * nearestNegSpanConf);
  console.log('\nGEOMETRIC MIDPOINT candidate for R11_MAX_SPAN_WORD_CONF:', mid);
  console.log('current shipped value: 1.0835e-2');
  console.log('margin vs worst positive:', (mid / worstBadSpanConf).toFixed(4) + 'x; margin vs nearest negative:', (nearestNegSpanConf / mid).toFixed(4) + 'x');
} else {
  console.log('\nSEPARATION FAILS: nearest negative', nearestNegSpanConf, 'does not exceed worst positive', worstBadSpanConf);
}

// ===========================================================================
// Step 1a — sensitivity, both directions, exact flip point (fitDeviation).
// ===========================================================================
console.log('\n\n###################### SENSITIVITY — R11_MIN_FIT_DEVIATION ######################');
const CURRENT_FIT = 1.3093;
for (const pct of [-10, -5, 5, 10]) {
  const candidate = CURRENT_FIT * (1 + pct / 100);
  // Would any dangerous negative flip PASS(decline)->FAIL(fire)? I.e. does
  // lowering the threshold admit a dangerous negative to C1, and does it
  // actually reach firing (wouldFireIfC1Passed)?
  const flipped = dangerousNegatives.filter(r => r.fitDeviation > candidate && r.wouldFireIfC1Passed);
  // Would any confirmed positive flip FIRE->DECLINE?
  const lostPositives = truePositives.filter(r => r.fitDeviation <= candidate);
  console.log(`${pct > 0 ? '+' : ''}${pct}% -> ${candidate.toFixed(4)}:`, 'newly-admitted dangerous negatives that would fire:', flipped.length, flipped.map(r=>r.tag), '| positives lost:', lostPositives.length, lostPositives.map(r=>r.tag));
}
// exact flip point downward: the highest-fitDeviation dangerous negative with wouldFireIfC1Passed, below current.
const downwardFlips = dangerousNegatives.filter(r => r.wouldFireIfC1Passed && r.fitDeviation < CURRENT_FIT);
downwardFlips.sort((a, b) => b.fitDeviation - a.fitDeviation);
console.log('\nAll dangerous negatives with wouldFireIfC1Passed=true, below current threshold, descending:');
for (const r of downwardFlips) console.log(' ', r.corpus, r.tag, r.edge, 'fitDev='+r.fitDeviation, r.cls);
if (downwardFlips.length > 0) {
  const flipAt = downwardFlips[0]!.fitDeviation;
  const pctDown = ((CURRENT_FIT - flipAt) / CURRENT_FIT) * 100;
  console.log(`EXACT DOWNWARD FLIP: threshold would have to drop to ${flipAt} (${pctDown.toFixed(3)}% below current ${CURRENT_FIT}) before ${downwardFlips[0]!.tag} fires.`);
} else {
  console.log('No dangerous negative in the population has wouldFireIfC1Passed=true below current threshold at all (checked down to the lowest fitDeviation present).');
}
// exact flip point upward: the lowest-fitDeviation confirmed positive.
const upwardFlipAt = Math.min(...truePositives.map(r => r.fitDeviation));
const pctUp = ((upwardFlipAt - CURRENT_FIT) / CURRENT_FIT) * 100;
console.log(`EXACT UPWARD FLIP: threshold would have to rise to ${upwardFlipAt} (+${pctUp.toFixed(3)}%) before losing a confirmed positive (${truePositives.find(r=>r.fitDeviation===upwardFlipAt)?.tag}).`);

console.log('\n\n###################### SENSITIVITY — R11_MAX_SPAN_WORD_CONF ######################');
const CURRENT_SPAN = 1.0835e-2;
for (const pct of [-10, -5, 5, 10]) {
  const candidate = CURRENT_SPAN * (1 + pct / 100);
  const flipped = spanNegatives.filter(r => (r.spanMaxConf as number) < candidate); // would newly PASS C4 (i.e. now "empty enough") -> fires
  const lostPositives = truePositives.filter(r => (r.spanMaxConf ?? 0) >= candidate);
  console.log(`${pct > 0 ? '+' : ''}${pct}% -> ${candidate.toExponential(4)}:`, 'newly-admitted dangerous negatives (would now pass C4):', flipped.length, flipped.map(r=>r.tag), '| positives lost:', lostPositives.length, lostPositives.map(r=>r.tag));
}
const flipAtSpan = spanNegatives.length > 0 ? (spanNegatives[0]!.spanMaxConf as number) : NaN;
const pctSpanDown = ((CURRENT_SPAN - flipAtSpan) / CURRENT_SPAN) * 100;
console.log(`EXACT DOWNWARD-DIRECTION FLIP (raising the confidence bar admits the negative): threshold would have to rise to ${flipAtSpan} (+${(-pctSpanDown).toFixed(3)}%) before ${spanNegatives[0]?.tag} passes C4.`);
const upwardFlipSpan = Math.max(...truePositives.map(r => r.spanMaxConf ?? 0));
const pctSpanUp = ((CURRENT_SPAN - upwardFlipSpan) / CURRENT_SPAN) * 100;
console.log(`EXACT UPWARD-DIRECTION FLIP (lowering the confidence bar loses a positive): threshold would have to drop to ${upwardFlipSpan} (-${pctSpanUp.toFixed(3)}%) before losing ${truePositives.find(r=>r.spanMaxConf===upwardFlipSpan)?.tag}.`);

// ===========================================================================
// Step 1b — LOOCV (on confirmed-fixed positives) + corpus holdout.
// ===========================================================================
console.log('\n\n###################### LOOCV ######################');
console.log('Confirmed-fixed true positives available for LOOCV:', truePositives.length, truePositives.map(r => `${r.corpus}/${r.tag}`));
console.log('All from corpus:', [...new Set(truePositives.map(r => r.corpus))]);
for (let i = 0; i < truePositives.length; i++) {
  const held = truePositives[i]!;
  const rest = truePositives.filter((_, j) => j !== i);
  if (rest.length === 0) { console.log(`held out ${held.tag}: cannot derive from n=0 remaining — undefined.`); continue; }
  const worstRest = Math.min(...rest.map(r => r.fitDeviation));
  // Nearest negative unaffected by which positive is held out (negatives are a separate population).
  console.log(`held out ${held.corpus}/${held.tag} (fitDev=${held.fitDeviation}): remaining worst-bad=${worstRest}, held-out point still LOWER than remaining worst-bad (i.e. would still be the binding constraint)? ${held.fitDeviation <= worstRest}`);
}

console.log('\n###################### CORPUS HOLDOUT ######################');
for (const corpus of ['v6', '173', 'spanish'] as const) {
  const fires173style = withClass.filter(r => r.corpus === corpus && r.declinedAt === null);
  console.log(corpus, '— raw C1..C4 fires at CURRENT thresholds:', fires173style.length, fires173style.map(r => r.tag));
}
console.log('\n173 fitDeviation values that would pass a LOWERED threshold (>= 1.2857, the historical nearest-negative) but currently decline at C1, with wouldFireIfC1Passed:');
const c173Sensitive = withClass.filter(r => r.corpus === '173' && r.fitDeviation >= 1.2857 && r.fitDeviation < 1.3093);
for (const r of c173Sensitive) console.log(' ', r.tag, r.edge, r.fitDeviation, 'wouldFireIfC1Passed='+r.wouldFireIfC1Passed, r.cls);
