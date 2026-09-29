/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// The amount-drop defect family, pinned on the real 14-segment project
// ("3. Voiceover.mp3", audio sha256 ab5e4f18…) under BOTH engines' transcript
// dialects:
//
//   cloud  (faster-whisper words)   "$11"  ",000."          (83 tokens)
//   local  (whisper.cpp -ml 1)      "$" "11" "," "000" "."  (103 tokens)
//
// Two defects, both fixed together:
//   1. `canonicalize` read numbers above 9999 digit by digit and canonicalized
//      each transcript token alone, so the script's "$11,000" and either
//      dialect's fragments only partially matched.
//   2. `normalizeForForcedAlignment` DROPPED the token, so the chunk text sent
//      to forced alignment read "have in your savings account you" — no amount
//      at all — and alignment stretched the neighbouring words over its speech.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseProjectData } from '../App';
import { applyAnchorBasedTiming } from './syncEngine';
import { alignScenestoTranscript, filterMalformedTokens } from './whisperService';
import { computeFaChunkPlan } from './faChunkPlan';
import { loadFaLanguageData } from './faLanguageData';
import { findAmountGroups, expandTokensToWords, isAmountSeparatorToken } from './transcriptWords';
import type { TranscriptToken } from '../types';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = (name: string): string => resolve(REPO, 'scripts', 'fixtures', name);
const readJson = <T,>(name: string): T => JSON.parse(readFileSync(FIX(name), 'utf-8')) as T;
const DURATION = 32.69;

type Engine = 'cloud' | 'local';
const tokens = (engine: Engine): TranscriptToken[] =>
  readJson<{ tokens: TranscriptToken[] }>(`amount-14seg-${engine}-tokens.json`).tokens;
const silences = readJson<{ silences: Array<{ startSec: number; endSec: number }> }>('amount-14seg-silences.json').silences;

async function segments() {
  const parsed = await parseProjectData(
    readFileSync(FIX('amount-14seg-script.txt'), 'utf-8'),
    readFileSync(FIX('amount-14seg-scene-details.txt'), 'utf-8'),
    [], DURATION,
  );
  return applyAnchorBasedTiming(parsed, DURATION);
}

describe('the two dialect fixtures are the ones the defect was pinned on', () => {
  it('83 cloud tokens and 103 local tokens', () => {
    expect(tokens('cloud')).toHaveLength(83);
    expect(tokens('local')).toHaveLength(103);
  });
});

describe('transcript amount runs (transcriptWords.ts)', () => {
  it('cloud: "$11" ",000." is ONE amount group', () => {
    const t = tokens('cloud');
    const groups = findAmountGroups(t);
    const g = groups.find(x => t[x.start]!.text === '$11')!;
    expect(g).toBeDefined();
    expect(t[g.end]!.text).toBe(',000.');
    expect(g.end - g.start).toBe(1);
  });
  it('local: "$" "11" "," "000" is ONE amount group (the "," survives the malformed-token filter)', () => {
    const raw = tokens('local');
    const kept = filterMalformedTokens(raw, DURATION, 'en').tokens;
    const g = findAmountGroups(kept).find(x => kept[x.start]!.text === '$' && kept[x.start + 1]!.text === '11')!;
    expect(g).toBeDefined();
    expect(kept.slice(g.start, g.end + 1).map(t => t.text)).toEqual(['$', '11', ',', '000']);
  });
  it('the merged group reads as the same words as the script side', () => {
    for (const engine of ['cloud', 'local'] as const) {
      const words = expandTokensToWords(filterMalformedTokens(tokens(engine), DURATION, 'en').tokens, 'en').words.map(w => w.word).join(' ');
      expect(words).toContain('eleven thousand dollars');
      expect(words).toContain('nine thousand four hundred dollars');
    }
  });
  it('never merges by sentence shape: "in 2003." "." "5 people" and "2003" "," "500" stay apart', () => {
    const mk = (...t: string[]) => t.map((text, i) => ({ text, startSec: i, endSec: i + 1 }));
    expect(findAmountGroups(mk('in', '2003', '.', '5', 'people'))).toEqual([]);
    expect(findAmountGroups(mk('2003', ',', '500', 'people'))).toEqual([]);
    expect(findAmountGroups(mk('have,', 'in', 'your'))).toEqual([]);
  });
  it('a separator token is kept only between an amount head and a 3-digit tail', () => {
    expect(isAmountSeparatorToken(',', { text: '11' }, { text: '000' })).toBe(true);
    expect(isAmountSeparatorToken(',', { text: 'account' }, { text: 'you' })).toBe(false);
    expect(isAmountSeparatorToken('.', { text: '11' }, { text: '000' })).toBe(false);
  });
});

for (const engine of ['cloud', 'local'] as const) {
  describe(`${engine} dialect`, () => {
    it('the script amounts fully match: seg 3 and seg 13 are 9/9 matched, confidence 1', async () => {
      const segs = await segments();
      const usable = filterMalformedTokens(tokens(engine), DURATION, 'en').tokens;
      const alignments = alignScenestoTranscript(segs, usable, silences, DURATION, 'en');
      const seg3 = alignments[2]!;
      const seg13 = alignments[12]!;
      expect(segs[2]!.text).toContain('$11,000');
      expect([seg3.matchedWords, seg3.totalWords, seg3.confidence]).toEqual([9, 9, 1]);
      expect([seg13.matchedWords, seg13.totalWords, seg13.confidence]).toEqual([9, 9, 1]);
    });

    it("scene 3's last matched word is the amount's final word (its last token), not the previous word", async () => {
      const segs = await segments();
      const usable = filterMalformedTokens(tokens(engine), DURATION, 'en').tokens;
      const alignments = alignScenestoTranscript(segs, usable, silences, DURATION, 'en');
      const last = usable[alignments[2]!.lastTokenIdx]!;
      // cloud: ",000." ; local: "000" — the final fragment of "$11,000".
      expect(last.text).toBe(engine === 'cloud' ? ',000.' : '000');
      expect(last.endSec).toBeGreaterThan(5.7); // past "account" (ends 4.86/4.57)
      const seg13Last = usable[alignments[12]!.lastTokenIdx]!;
      expect(seg13Last.text.toLowerCase()).toContain('cash');
    });

    it('the chunk text sent to forced alignment carries the amount words', async () => {
      const segs = await segments();
      const ld = loadFaLanguageData('en')!;
      const chunks = computeFaChunkPlan(segs, tokens(engine), silences, DURATION, undefined, 'en', ld.vocabChars, ld.cardinalData);
      const text = chunks.map(c => c.text).join(' | ');
      expect(text).toContain('savings account eleven thousand dollars');
      expect(text).toContain('pay nine thousand four hundred dollars in cash');
      expect(text).not.toMatch(/account you\b(?! need)/); // the old "have in your savings account you" chunk
    });
  });
}
