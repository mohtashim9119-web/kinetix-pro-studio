/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AB — ad hoc analysis over the three r11-probe-*.json dumps
// (scripts/ws1-session-ab-r11-corpus-probe.test.ts output), cross-referenced
// against scripts/ws1-ear-pass-ledger.ts. Not a test; run via tsx. Read-only.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EAR_PASS_LEDGER, earPassAuthorising, earPassRejects, type Corpus } from './ws1-ear-pass-ledger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '.work-phase4', 'session-ab');

interface Row {
  corpus: 'v6' | '173' | 'spanish';
  chunkIndex: number; segIdx: number; tag: string; edge: 'start' | 'end';
  fit: number; fitDeviation: number; chunkWords: number; chunkOnsets: number;
  chunkStartSec: number; chunkEndSec: number;
  conjunct1_fitDeviation_gt_threshold: boolean;
  declinedAt: string | null;
  committedValue?: number; correctedValue?: number; delta?: number;
  spanMaxConf?: number | null; spanWordCount?: number;
}

const rows: Row[] = [];
for (const key of ['v6', '173', 'spanish'] as const) {
  const d = JSON.parse(readFileSync(resolve(OUT, `r11-probe-${key}.json`), 'utf-8'));
  rows.push(...(d.rows as Row[]));
}

function classify(r: Row): 'EAR_CONFIRMED_ALREADY_CORRECT' | 'EAR_CONFIRMED_DEFECT_UNFIXED' | 'EAR_CONFIRMED_DEFECT_FIXED' | 'UNVERIFIED' {
  const corpus = r.corpus as Corpus;
  if (r.committedValue === undefined) return 'UNVERIFIED';
  const committedAuth = earPassAuthorising(corpus, r.tag, r.committedValue);
  if (committedAuth) return 'EAR_CONFIRMED_ALREADY_CORRECT'; // the value sitting there now is ear-confirmed right
  // Committed is not itself ear-confirmed right. Check whether R.11's OWN
  // proposal is ear-confirmed right regardless of whether any sitting ever
  // explicitly scored the PRE-correction value wrong (R.11's original 3 +
  // 192 were closed-on-arrival: the ledger records the post-correction value
  // as CORRECT but never separately logged the pre-correction value as WRONG).
  if (r.correctedValue !== undefined) {
    const correctedAuth = earPassAuthorising(corpus, r.tag, r.correctedValue);
    if (correctedAuth) return 'EAR_CONFIRMED_DEFECT_FIXED';
  }
  const committedRej = earPassRejects(corpus, r.tag, r.committedValue);
  if (committedRej) return 'EAR_CONFIRMED_DEFECT_UNFIXED'; // committed known wrong, proposal not (yet) verified right
  return 'UNVERIFIED';
}

console.log('====== FULL CANDIDATE POPULATION, sorted by fitDeviation desc ======');
console.log('corpus tag edge fitDev declinedAt classification committed corrected spanMaxConf');
const withClass = rows.map(r => ({ ...r, cls: classify(r) }));
withClass.sort((a, b) => (b.fitDeviation === Infinity ? 1e9 : b.fitDeviation) - (a.fitDeviation === Infinity ? 1e9 : a.fitDeviation));
for (const r of withClass) {
  console.log([
    r.corpus, r.tag, r.edge, r.fitDeviation.toFixed(4), r.declinedAt ?? 'FIRES', r.cls,
    r.committedValue?.toFixed(3) ?? '-', r.correctedValue?.toFixed(3) ?? '-', r.spanMaxConf ?? '-',
  ].join('\t'));
}

console.log('\n====== SUMMARY ======');
const fires = withClass.filter(r => r.declinedAt === null);
console.log('FIRES (raw detections):', fires.length);
for (const r of fires) console.log(' ', r.corpus, r.tag, r.cls, 'fitDev='+r.fitDeviation, 'spanMaxConf='+r.spanMaxConf);

console.log('\nEAR_CONFIRMED_DEFECT_FIXED among fires:', fires.filter(r => r.cls === 'EAR_CONFIRMED_DEFECT_FIXED').length);
console.log('EAR_CONFIRMED_DEFECT_UNFIXED among fires:', fires.filter(r => r.cls === 'EAR_CONFIRMED_DEFECT_UNFIXED').length);
console.log('UNVERIFIED among fires:', fires.filter(r => r.cls === 'UNVERIFIED').length);

console.log('\n====== C1-PASS, C3 no-op (candidate flagged suspicious, but already correct) ======');
const c1PassC3NoOp = withClass.filter(r => r.conjunct1_fitDeviation_gt_threshold && r.declinedAt === 'C3 no-op delta');
c1PassC3NoOp.sort((a, b) => b.fitDeviation - a.fitDeviation);
for (const r of c1PassC3NoOp) console.log(' ', r.corpus, r.tag, r.edge, 'fitDev='+r.fitDeviation.toFixed(4), r.cls, 'committed='+r.committedValue);

console.log('\n====== ALL C1-declined (fitDeviation <= threshold), top 20 by fitDeviation ======');
const c1Declined = withClass.filter(r => r.declinedAt === 'C1 fitDeviation');
c1Declined.sort((a, b) => b.fitDeviation - a.fitDeviation);
for (const r of c1Declined.slice(0, 20)) console.log(' ', r.corpus, r.tag, r.edge, 'fitDev='+r.fitDeviation.toFixed(4), r.cls);

console.log('\n====== C4 spanMaxConf declines (real acoustic evidence present), sorted by spanMaxConf asc (closest to firing) ======');
const c4Declined = withClass.filter(r => r.declinedAt === 'C4 spanMaxConf' && typeof r.spanMaxConf === 'number');
c4Declined.sort((a, b) => (a.spanMaxConf as number) - (b.spanMaxConf as number));
for (const r of c4Declined.slice(0, 15)) console.log(' ', r.corpus, r.tag, r.edge, 'spanMaxConf='+r.spanMaxConf, 'fitDev='+r.fitDeviation.toFixed(4), r.cls);

console.log('\n====== Known Class A / historical R.11 tags — direct lookups ======');
for (const [corpus, tag] of [
  ['v6', '152_frozen_brush_mice'], ['173', 'abysmal_opinion'], ['v6', '226_four_scouts'], ['v6', '192_scout_listening'],
  ['v6', '214_solitary_fire'], ['v6', '231_slowing_pace'], ['v6', '447_scout_facing_dark'],
  ['v6', '232_sudden_halt'], ['v6', '233_firelight_speech'], ['v6', '322_body_readiness'], ['v6', '266_forty_one_burden'],
  ['v6', '043_night_migration'], ['v6', '444_scout_past_watch'],
] as const) {
  const matches = withClass.filter(r => r.corpus === corpus && r.tag === tag);
  if (matches.length === 0) { console.log(corpus, tag, '=> NOT A CANDIDATE (no chunk-edge alignment)'); continue; }
  for (const r of matches) console.log(corpus, tag, r.edge, 'fitDev='+r.fitDeviation.toFixed(4), r.declinedAt ?? 'FIRES', r.cls, 'committed='+r.committedValue, 'corrected='+r.correctedValue, 'spanMaxConf='+r.spanMaxConf);
}

console.log('\n====== Ledger coverage check: tags in EAR_PASS_LEDGER not appearing as ANY candidate row (per corpus) ======');
for (const corpus of ['v6', '173', 'spanish'] as const) {
  const ledgerTags = new Set(EAR_PASS_LEDGER.filter(r => r.corpus === corpus).map(r => r.tag));
  const candidateTags = new Set(rows.filter(r => r.corpus === corpus).map(r => r.tag));
  const missing = [...ledgerTags].filter(t => !candidateTags.has(t));
  console.log(corpus, 'ledger tags:', ledgerTags.size, 'candidate tags:', candidateTags.size, 'ledger tags absent from candidates:', missing.join(', ') || '(none)');
}
