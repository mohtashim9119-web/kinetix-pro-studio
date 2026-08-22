/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AB — Step 4a: extend Session Z's n=3 lead-in measurement
// (lethal_nature_hazard/iron_bounce/logic_clash, median 20ms, range 10-30ms)
// across the full ear-confirmed control population, real Whisper tokens.
// Read-only; run via tsx.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const REPLAY = resolve(REPO, '.work-phase4', 'replay');

interface Control { corpus: 'v6' | '173' | 'spanish'; tag: string; value: number }
const controls: Control[] = JSON.parse(readFileSync(resolve(REPO, '.work-phase4/session-ab/ear-confirmed-controls.json'), 'utf-8'))
  .filter((c: Control) => c.tag !== 'run-0-onset' && c.tag !== 'run-2-onset');

const tokenCache = new Map<string, Array<{ text: string; startSec: number; endSec: number }>>();
function tokensFor(corpus: string): Array<{ text: string; startSec: number; endSec: number }> {
  if (!tokenCache.has(corpus)) {
    const d = JSON.parse(readFileSync(resolve(REPLAY, corpus, 'whisper_raw_tokens.json'), 'utf-8'));
    tokenCache.set(corpus, d.tokens);
  }
  return tokenCache.get(corpus)!;
}

console.log('corpus\ttag\tearCorrect\trightAnchorWord\trightAnchorStart\tleadInMs');
const leadIns: number[] = [];
for (const c of controls) {
  const toks = tokensFor(c.corpus);
  const right = toks.find(t => t.startSec > c.value && t.text.trim().length > 0 && /[a-zA-Z]/.test(t.text));
  if (!right) continue;
  const leadInMs = (right.startSec - c.value) * 1000;
  leadIns.push(leadInMs);
  console.log(`${c.corpus}\t${c.tag}\t${c.value}\t${JSON.stringify(right.text)}\t${right.startSec}\t${leadInMs.toFixed(1)}`);
}

// classA targets too (for reference — not controls, but informative)
const CLASS_A: Array<{ corpus: 'v6'; tag: string; target: number }> = [
  { corpus: 'v6', tag: '214_solitary_fire', target: 630.09 },
  { corpus: 'v6', tag: '447_scout_facing_dark', target: 1418.53 },
];
console.log('\nClass A targets (reference, NOT part of the control statistics):');
for (const c of CLASS_A) {
  const toks = tokensFor(c.corpus);
  const right = toks.find(t => t.startSec > c.target && t.text.trim().length > 0 && /[a-zA-Z]/.test(t.text));
  if (!right) continue;
  console.log(`${c.corpus}\t${c.tag}\t${c.target}\t${JSON.stringify(right.text)}\t${right.startSec}\t${((right.startSec - c.target) * 1000).toFixed(1)}`);
}

leadIns.sort((a, b) => a - b);
const n = leadIns.length;
const median = n % 2 === 1 ? leadIns[(n - 1) / 2]! : (leadIns[n / 2 - 1]! + leadIns[n / 2]!) / 2;
const mean = leadIns.reduce((a, b) => a + b, 0) / n;
const sd = Math.sqrt(leadIns.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
console.log(`\nn=${n} lead-ins (ms), full distribution:`, leadIns.map(v => v.toFixed(1)).join(', '));
console.log(`median=${median.toFixed(1)}ms mean=${mean.toFixed(1)}ms sd=${sd.toFixed(1)}ms min=${leadIns[0]?.toFixed(1)}ms max=${leadIns[n - 1]?.toFixed(1)}ms`);
console.log(`fraction within [10,30]ms (Session Z's n=3 range): ${(leadIns.filter(v => v >= 10 && v <= 30).length / n * 100).toFixed(1)}%`);
console.log(`fraction negative (right anchor BEFORE earCorrect — a lead-in model would UNDERSHOOT): ${(leadIns.filter(v => v < 0).length / n * 100).toFixed(1)}%`);
