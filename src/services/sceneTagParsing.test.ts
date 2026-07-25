import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseProjectData, evaluateCoverageGate, filterToCoveredSegments } from '../App';
import { normalizeForMatch, isExactFilenameMatch, contiguousWordMatch, stripMediaExtension, cleanTagName, autoMatchSegments } from './syncEngine';
import { extractSegmentAlignments, countTranscriptWords } from './whisperService';
import { stripRtfIfNeeded, detectTextFileRole } from './textUtils';
import { TransitionType, AnimationType } from '../types';
import type { Asset, VideoSegment, TranscriptToken } from '../types';

function makeSegment(partial: Partial<VideoSegment> & { id: string; text: string }): VideoSegment {
  return {
    startTime: 0,
    duration: 1,
    order: 0,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

function wordTokens(text: string, startAt: number, wordDurationSec: number): TranscriptToken[] {
  return text.split(' ').map((word, i) => ({
    text: word,
    startSec: Number((startAt + i * wordDurationSec).toFixed(3)),
    endSec: Number((startAt + (i + 1) * wordDurationSec).toFixed(3)),
  }));
}

/**
 * Tag format change: [IMAGE: file.jpg] / [VIDEO: file.mp4] -> bare [file.jpg].
 * Matching moved from fuzzy to strict exact (Unicode-normalized) filename
 * comparison — the IMAGE/VIDEO keyword itself was never read for anything but
 * legacy-format detection, so dropping it in favor of a bare tag discards no
 * information any consumer relied on.
 *
 * Path B Decision 6 (2026-07-08): [HEADING: ...] is no longer a distinct tag
 * kind or scene boundary. The HEADING: keyword is stripped exactly like
 * IMAGE:/VIDEO:, and the remainder is matched as an ordinary asset tag —
 * [HEADING: foo.jpg] behaves identically to [IMAGE: foo.jpg].
 */

function makeAsset(overrides: Partial<Asset> & { id: string; name: string }): Asset {
  return { url: `blob:${overrides.id}`, type: 'image', ...overrides };
}

describe('normalizeForMatch / isExactFilenameMatch', () => {
  it('folds smart quotes to straight quotes', () => {
    expect(normalizeForMatch('it’s')).toBe(normalizeForMatch("it's"));
    expect(isExactFilenameMatch('caf’s.jpg', "caf's.jpg")).toBe(true);
  });

  it('folds curly double quotes to straight quotes', () => {
    expect(isExactFilenameMatch('“quote”.jpg', '"quote".jpg')).toBe(true);
  });

  it('folds en/em dash to hyphen', () => {
    expect(isExactFilenameMatch('photo–shoot.jpg', 'photo-shoot.jpg')).toBe(true);
    expect(isExactFilenameMatch('photo—shoot.jpg', 'photo-shoot.jpg')).toBe(true);
  });

  it('strips zero-width space and BOM (Word/Docs paste artifacts)', () => {
    expect(isExactFilenameMatch('hero​.jpg', 'hero.jpg')).toBe(true);
    expect(isExactFilenameMatch('﻿hero.jpg', 'hero.jpg')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isExactFilenameMatch('  Hero.JPG  ', 'hero.jpg')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(isExactFilenameMatch('hero.jpg', 'villain.jpg')).toBe(false);
  });
});

describe('parseProjectData — bare bracket tag format', () => {
  it('matches a bare [file.jpg] tag to the asset with that exact name', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[hero.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('still parses a legacy [IMAGE: file.jpg] tag via the compatibility strip', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[IMAGE: hero.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('still parses a legacy [VIDEO: file.mp4] tag via the compatibility strip', async () => {
    // Asset type is 'image' here purely to avoid the getMediaDuration/video
    // duration-probe path (needs a DOM `document`, unavailable in this
    // jsdom-less test environment) — the IMAGE/VIDEO tag keyword itself has
    // no effect on parsing or matching (the captured keyword is discarded
    // after scene-boundary/heading detection; media type always comes from
    // the resolved asset's own `type` field); only the compatibility-strip
    // regex is under test here.
    const assets = [makeAsset({ id: 'a1', name: 'clip.mp4' })];
    const segments = await parseProjectData(
      'Line one.',
      '[VIDEO: clip.mp4]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('tolerates extra whitespace inside and around the brackets', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[   hero.jpg   ]\nLine one.',
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('handles a punctuation-heavy description line following the tag', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      "Wait... is that -- really -- him?! (Yes!) \"Absolutely,\" she said.",
      '[hero.jpg]\nWait... is that -- really -- him?! (Yes!) "Absolutely," she said.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
    expect(segments[0]?.text).toContain('Absolutely');
  });

  it('matches a [HEADING: file.jpg] tag to the asset with that exact name, like [IMAGE:]', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[HEADING: hero.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('produces a normal segment per [HEADING: ...] scene — no scene-boundary skip', async () => {
    const assets = [
      makeAsset({ id: 'a1', name: 'intro.jpg' }),
      makeAsset({ id: 'a2', name: 'hero.jpg' }),
      makeAsset({ id: 'a3', name: 'outro.jpg' }),
    ];
    const segments = await parseProjectData(
      'Line one.\nLine two.\nLine three.',
      '[HEADING: intro.jpg]\nLine one.\n[hero.jpg]\nLine two.\n[HEADING: outro.jpg]\nLine three.',
      assets,
      10,
    );
    // All three scenes survive as segments — HEADING tags are no longer
    // scene boundaries and no longer produce a skipped/dropped scene.
    expect(segments).toHaveLength(3);
    expect(segments.map(s => s.assetId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('leaves assetId undefined (and keeps the segment) when the filename has no match', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[does-not-exist.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBeUndefined();
  });

  it('matches a smart-quoted tag name against a straight-quote asset name', async () => {
    const assets = [makeAsset({ id: 'a1', name: "sam's place.jpg" })];
    const segments = await parseProjectData(
      'Line one.',
      '[sam’s place.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('matches a straight-quoted tag name against a smart-quote asset name', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'sam’s place.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      "[sam's place.jpg]\nLine one.",
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('matches an em-dash tag name against a hyphenated asset filename', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'before-after.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[before—after.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('matches a tag name containing a zero-width space (simulated Word paste)', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'hero.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[hero​.jpg]\nLine one.',
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1');
  });
});

describe('extension-agnostic exact match (bare tag, no extension)', () => {
  it('strips only allowlisted trailing media extensions, leaving dotted stems intact', () => {
    expect(stripMediaExtension('002_age_24.jpg')).toBe('002_age_24');
    expect(stripMediaExtension('my.scene.02.jpg')).toBe('my.scene.02');
    expect(stripMediaExtension('my.scene.02')).toBe('my.scene.02'); // "02" is not an extension
    expect(stripMediaExtension('002_age_24')).toBe('002_age_24');    // nothing to strip
    expect(stripMediaExtension('archive.zip')).toBe('archive.zip');  // zip not in media allowlist
  });

  it('matches a bare [002_age_24] tag to asset 002_age_24.jpg (THE key case)', async () => {
    const assets = [makeAsset({ id: 'a1', name: '002_age_24.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[002_age_24]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('matches a bare tag against .png, .mp4, and .webm asset variants', async () => {
    for (const name of ['002_age_24.png', '002_age_24.mp4', '002_age_24.webm']) {
      const assets = [makeAsset({ id: 'a1', name })];
      const segments = await parseProjectData('Line one.', '[002_age_24]\nLine one.', assets, 10);
      expect(segments[0]?.assetId, `variant ${name}`).toBe('a1');
    }
  });

  it('unit: isExactFilenameMatch is extension-agnostic on both sides', () => {
    expect(isExactFilenameMatch('002_age_24', '002_age_24.jpg')).toBe(true);
    expect(isExactFilenameMatch('002_age_24.jpg', '002_age_24.jpg')).toBe(true);
    expect(isExactFilenameMatch('002_age_24.jpg', '002_age_24.mp4')).toBe(true); // stem-only
    expect(isExactFilenameMatch('002_age_24', '003_age_24.jpg')).toBe(false);
  });

  it('matches a dotted-stem bare tag [my.scene.02] to my.scene.02.jpg without mangling', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'my.scene.02.jpg' })];
    const segments = await parseProjectData(
      'Line one.',
      '[my.scene.02]\nLine one.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });
});

describe('extension collision (same stem, different extension)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('first-uploaded asset wins and a warn fires when a tag matches multiple assets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const assets = [
      makeAsset({ id: 'a1', name: '002_age_24.jpg', type: 'image' }),
      makeAsset({ id: 'a2', name: '002_age_24.mp4', type: 'video' }),
    ];
    const segments = await parseProjectData(
      'Line one.',
      '[002_age_24]\nLine one.',
      assets,
      10,
    );
    expect(segments[0]?.assetId).toBe('a1'); // first in array order wins
    const collisionWarn = warn.mock.calls.find(c =>
      String(c[0]).includes('matches 2 assets'),
    );
    expect(collisionWarn, 'collision warn should fire').toBeTruthy();
    expect(String(collisionWarn?.[0])).toContain('002_age_24.jpg');
    expect(String(collisionWarn?.[0])).toContain('002_age_24.mp4');
  });

  it('does NOT warn when only one asset matches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const assets = [makeAsset({ id: 'a1', name: '002_age_24.jpg' })];
    await parseProjectData('Line one.', '[002_age_24]\nLine one.', assets, 10);
    expect(warn.mock.calls.some(c => String(c[0]).includes('matches'))).toBe(false);
  });
});

describe('detectTextFileRole — bare-tag aware', () => {
  it('classifies a bare-tag scene doc (3+ tags) as sceneDetails', () => {
    const doc = '[001_a]\nLine.\n[002_b]\nLine.\n[003_c]\nLine.';
    expect(detectTextFileRole(doc)).toBe('sceneDetails');
  });

  it('classifies plain prose (no tags) as script', () => {
    expect(detectTextFileRole('Just a voiceover paragraph with no tags at all.')).toBe('script');
  });

  it('counts [HEADING:] tags the same as any other bracket tag', () => {
    const doc = '[HEADING: a.jpg]\nLine.\n[HEADING: b.jpg]\nLine.\n[HEADING: c.jpg]\nLine.';
    // 3 HEADING: tags now count as ordinary asset tags → sceneDetails.
    expect(detectTextFileRole(doc)).toBe('sceneDetails');
  });

  it('still recognizes legacy [IMAGE:]/[VIDEO:] keyword tags', () => {
    const doc = '[IMAGE: a.jpg]\nLine.\n[VIDEO: b.mp4]\nLine.\n[IMAGE: c.png]\nLine.';
    expect(detectTextFileRole(doc)).toBe('sceneDetails');
  });
});

describe('RTF handling with bare tags (regression: header junk on segment 1)', () => {
  // macOS TextEdit-style RTF: font/color tables leak plain-text remnants
  // (e.g. "Helvetica;") before the first real tag. Under the bare-tag format
  // the old [IMAGE|VIDEO|AUDIO]-keyword slice never fired, so that junk stayed
  // glued to segment 1's tag line and broke asset matching.
  const RTF_BARE =
    '{\\rtf1\\ansi\\ansicpg1252' +
    '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}' +
    '{\\colortbl;\\red255\\green255\\blue255;}' +
    '\\f0\\fs24 \\cf0 [002_age_24]\\\n' +
    'Line one about savings.\\\n' +
    '[003_savings]\\\n' +
    'Line two about age.}';

  const PLAIN_BARE = '[002_age_24]\nLine one about savings.\n[003_savings]\nLine two about age.';

  it('strips RTF header junk so the first tag is clean and matches its asset', async () => {
    const stripped = stripRtfIfNeeded(RTF_BARE);
    // No leaked font-table remnant should survive before the first tag.
    expect(stripped.startsWith('[002_age_24]')).toBe(true);
    expect(stripped).not.toContain('Helvetica');

    const assets = [
      makeAsset({ id: 'a1', name: '002_age_24.jpg' }),
      makeAsset({ id: 'a2', name: '003_savings.png' }),
    ];
    const segments = await parseProjectData('', stripped, assets, 10);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.assetId).toBe('a1'); // the regression: segment 1 matches
    expect(segments[1]?.assetId).toBe('a2');
  });

  it('leaves plain (non-RTF) bare-tag text untouched', () => {
    expect(stripRtfIfNeeded(PLAIN_BARE)).toBe(PLAIN_BARE);
  });

  it('.txt (plain) and .rtf versions of the same content yield identical segments', async () => {
    const assets = [
      makeAsset({ id: 'a1', name: '002_age_24.jpg' }),
      makeAsset({ id: 'a2', name: '003_savings.png' }),
    ];
    const fromPlain = await parseProjectData('', stripRtfIfNeeded(PLAIN_BARE), assets, 10);
    const fromRtf = await parseProjectData('', stripRtfIfNeeded(RTF_BARE), assets, 10);

    expect(fromRtf.length).toBe(fromPlain.length);
    expect(fromRtf.map(s => s.assetId)).toEqual(fromPlain.map(s => s.assetId));
    expect(fromRtf.map(s => s.assetId)).toEqual(['a1', 'a2']);
  });
});

describe('segment count — clean 14-bare-tag doc', () => {
  it('produces exactly 14 segments from 14 bare tags', async () => {
    const names = Array.from({ length: 14 }, (_, i) => `${String(i + 1).padStart(3, '0')}_scene`);
    const sceneDoc = names.map(n => `[${n}]\nVoiceover line for ${n}.`).join('\n');
    const assets = names.map((n, i) => makeAsset({ id: `a${i}`, name: `${n}.jpg` }));

    const segments = await parseProjectData('', sceneDoc, assets, 60);
    expect(segments).toHaveLength(14);
    expect(segments.every(s => s.assetId !== undefined)).toBe(true);
    expect(segments.map(s => s.assetId)).toEqual(assets.map(a => a.id));
  });

  it('produces 14 segments identically whether the doc arrived as .txt or .rtf', async () => {
    const names = Array.from({ length: 14 }, (_, i) => `${String(i + 1).padStart(3, '0')}_scene`);
    const plainDoc = names.map(n => `[${n}]\nVoiceover line for ${n}.`).join('\n');
    // Wrap the same content in a minimal RTF envelope with leading header junk.
    const rtfDoc =
      '{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\fs24 ' +
      names.map(n => `[${n}]\\\nVoiceover line for ${n}.`).join('\\\n') +
      '}';
    const assets = names.map((n, i) => makeAsset({ id: `a${i}`, name: `${n}.jpg` }));

    const fromPlain = await parseProjectData('', stripRtfIfNeeded(plainDoc), assets, 60);
    const fromRtf = await parseProjectData('', stripRtfIfNeeded(rtfDoc), assets, 60);
    expect(fromPlain).toHaveLength(14);
    expect(fromRtf).toHaveLength(14);
    expect(fromRtf.map(s => s.assetId)).toEqual(fromPlain.map(s => s.assetId));
  });
});

describe('cleanTagName — stray edge punctuation', () => {
  it('strips a leading stray colon + whitespace', () => {
    expect(cleanTagName(':  university_engineering_flashback')).toBe('university_engineering_flashback');
  });

  it('preserves filename-legal leading/trailing chars (underscore, hyphen, digit, dotted stem)', () => {
    expect(cleanTagName('_intro.jpg')).toBe('_intro.jpg');
    expect(cleanTagName('002_age_24')).toBe('002_age_24');
    expect(cleanTagName('my.scene.02')).toBe('my.scene.02');
    expect(cleanTagName('-lead-in')).toBe('-lead-in');
  });

  it('does not touch interior spaces (real "my file.jpg" names)', () => {
    expect(cleanTagName('my file.jpg')).toBe('my file.jpg');
  });

  it('folds the legacy IMAGE:/VIDEO: keyword prefix', () => {
    expect(cleanTagName('IMAGE: hero.jpg')).toBe('hero.jpg');
    expect(cleanTagName('VIDEO : clip.mp4')).toBe('clip.mp4');
  });

  it('folds the HEADING: keyword prefix identically (Path B Decision 6)', () => {
    expect(cleanTagName('HEADING: hero.jpg')).toBe('hero.jpg');
    expect(cleanTagName('HEADING : clip.mp4')).toBe('clip.mp4');
  });

  it('handles a stray colon BEFORE a legacy keyword (edge-clean, strip, edge-clean)', () => {
    expect(cleanTagName(': IMAGE: hero.jpg')).toBe('hero.jpg');
    expect(cleanTagName('IMAGE: : hero.jpg')).toBe('hero.jpg');
  });

  it('returns empty string for an empty / punctuation-only tag', () => {
    expect(cleanTagName('')).toBe('');
    expect(cleanTagName('  :  ')).toBe('');
  });
});

describe('Part A regression — stray-colon tag resolves after cleaning', () => {
  it('matches "[:  name]" to asset "name.jpg" (the exact reported bug)', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'university_engineering_flashback.jpg' })];
    const segments = await parseProjectData(
      'Three months ago.',
      '[:  university_engineering_flashback]\nThree months ago.',
      assets,
      10,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('a1');
  });
});

describe('Part B — explicit-tag failures are NOT fuzzy-guessed', () => {
  it('an explicit tag that matches nothing stays undefined and is skipped by autoMatchSegments', async () => {
    // Asset "university.jpg" exists; the tag [hero_shot] does NOT name it, but
    // the spoken text contains "university" — the old fuzzy fallback would have
    // wrongly matched it. It must stay unmatched.
    const assets = [makeAsset({ id: 'a1', name: 'university.jpg' })];
    const parsed = await parseProjectData(
      'Three months ago at university.',
      '[hero_shot]\nThree months ago at university.',
      assets,
      10,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.assetId).toBeUndefined();
    expect(parsed[0]?.unmatchedExplicitTag).toBe(true);

    // The downstream Apply-Sync pass must not resurrect a wrong match.
    const afterAuto = autoMatchSegments(assets, parsed);
    expect(afterAuto[0]?.assetId).toBeUndefined();
  });

  it('proves the gate is load-bearing: same segment WITHOUT the flag WOULD be fuzzy-matched', () => {
    const assets = [makeAsset({ id: 'a1', name: 'university.jpg' })];
    // No unmatchedExplicitTag flag → the legitimate fuzzy fallback still runs.
    const untagged = makeSegment({ id: 's1', text: 'Three months ago at university.' });
    const matched = autoMatchSegments(assets, [untagged]);
    expect(matched[0]?.assetId).toBe('a1'); // fuzzy matching is NOT globally removed

    // Flip the flag on the identical segment → fuzzy fallback is gated off.
    const gated = makeSegment({ id: 's1', text: 'Three months ago at university.', unmatchedExplicitTag: true });
    const notMatched = autoMatchSegments(assets, [gated]);
    expect(notMatched[0]?.assetId).toBeUndefined();
  });

  it('a genuinely untagged (empty []) scene is still context-matched, never flagged', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'university.jpg' })];
    const parsed = await parseProjectData(
      'A story about university life.',
      '[]\nA story about university life.',
      assets,
      10,
    );
    expect(parsed[0]?.unmatchedExplicitTag).toBeUndefined();
    expect(parsed[0]?.assetId).toBe('a1'); // context fallback legitimately fires
  });
});

describe('contiguousWordMatch — explicit-tag fallback tier (unit)', () => {
  it('matches a tag whose tokens are a contiguous prefix block of a longer filename (THE key case)', () => {
    expect(contiguousWordMatch('year_2003', 'year_2003_2342368767')).toBe(true);
    expect(contiguousWordMatch('year_2003', 'year_2003_2342368767.jpg')).toBe(true); // extension-agnostic
  });

  it('matches a contiguous block in the middle and at the end of a filename', () => {
    expect(contiguousWordMatch('age_24', '002_age_24')).toBe(true);       // suffix block
    expect(contiguousWordMatch('age_24', '002_age_24_final')).toBe(true); // interior block
  });

  it('does NOT match tokens in the wrong order (order + adjacency required)', () => {
    expect(contiguousWordMatch('year_2003', '2003_year')).toBe(false);
    expect(contiguousWordMatch('year_2003', '2003_year_2342368767')).toBe(false);
  });

  it('does NOT match a non-adjacent (gap-allowing) subsequence', () => {
    expect(contiguousWordMatch('year_2003', 'year_of_2003')).toBe(false); // 'of' breaks adjacency
  });

  it('returns false for an empty / punctuation-only / extension-only tag', () => {
    expect(contiguousWordMatch('', 'year_2003.jpg')).toBe(false);
    expect(contiguousWordMatch('   ', 'year_2003.jpg')).toBe(false);
    expect(contiguousWordMatch('.jpg', 'year_2003.jpg')).toBe(false); // strips to empty stem
  });

  it('matches a single-token tag on whole-token equality, not substring', () => {
    expect(contiguousWordMatch('beach', 'beach_sunset')).toBe(true);
    expect(contiguousWordMatch('beach', 'my_beach_day')).toBe(true);
    expect(contiguousWordMatch('beach', 'beaches_wide')).toBe(false); // 'beaches' !== 'beach'
  });

  it('does NOT match when the tag is longer than the asset token run', () => {
    expect(contiguousWordMatch('year_2003_extra_more', 'year_2003')).toBe(false);
  });

  it('is caller-visible as 2+ matches when two assets share the contiguous block (ambiguity)', () => {
    const assets = [
      makeAsset({ id: 'a1', name: 'beach_sunset.jpg' }),
      makeAsset({ id: 'a2', name: 'my_beach_day.jpg' }),
    ];
    const wordMatches = assets.filter(a => contiguousWordMatch('beach', a.name));
    expect(wordMatches).toHaveLength(2); // caller must treat this as ambiguous → unmatched
  });
});

describe('contiguous-word fallback — parseProjectData ladder integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves an explicit tag via a UNIQUE contiguous word match when exact match fails', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'year_2003_2342368767.jpg' })];
    const parsed = await parseProjectData(
      'Line one.',
      '[year_2003]\nLine one.',
      assets,
      10,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.assetId).toBe('a1');
    expect(parsed[0]?.unmatchedExplicitTag).toBeUndefined();
  });

  it('leaves an ambiguous (2+ candidate) tag UNMATCHED and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const assets = [
      makeAsset({ id: 'a1', name: 'beach_sunset.jpg' }),
      makeAsset({ id: 'a2', name: 'my_beach_day.jpg' }),
    ];
    const parsed = await parseProjectData('Line one.', '[beach]\nLine one.', assets, 10);
    expect(parsed[0]?.assetId).toBeUndefined();
    expect(parsed[0]?.unmatchedExplicitTag).toBe(true);
    const ambigWarn = warn.mock.calls.find(c => String(c[0]).includes('ambiguously word-matches'));
    expect(ambigWarn, 'ambiguity warn should fire').toBeTruthy();
    expect(String(ambigWarn?.[0])).toContain('beach_sunset.jpg');
    expect(String(ambigWarn?.[0])).toContain('my_beach_day.jpg');
  });

  it('exact match still wins over a contiguous candidate (exact tier runs first)', async () => {
    // a1 is an EXACT stem match for [year_2003]; a2 is only a contiguous match.
    // The exact tier runs first and assigns a1, so the contiguous tier never runs.
    const assets = [
      makeAsset({ id: 'a1', name: 'year_2003.jpg' }),
      makeAsset({ id: 'a2', name: 'year_2003_2342368767.jpg' }),
    ];
    const parsed = await parseProjectData('Line one.', '[year_2003]\nLine one.', assets, 10);
    expect(parsed[0]?.assetId).toBe('a1');
    expect(parsed[0]?.unmatchedExplicitTag).toBeUndefined();
  });
});

// ===========================================================================
// Parser fix: a tag's description may follow it INLINE on the same line
// (e.g. "[missing1] This is a test missing segment.") — not only on a
// subsequent line. The old block-splitting logic assumed the tag always
// occupied its own line (`lines[0]` = tag, `lines.slice(1)` = description),
// so an inline description was swallowed into the "tag" and lost, silently
// falling back to slicing the voiceover script for text instead. TAG_REGEX
// itself was never the problem — digit/hyphen/underscore tag names were
// already recognized correctly; only the inline-text case was broken.
// ===========================================================================
describe('parseProjectData — inline tag+text on the same line (parser fix)', () => {
  it('extracts a digit-suffixed tag ([missing1]) and its inline description text correctly', async () => {
    const segments = await parseProjectData('', '[missing1] This is a test missing segment.', [], 10);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('This is a test missing segment.');
  });

  it('extracts a fully-numeric-suffixed tag ([tag123]) and its inline description text correctly', async () => {
    const segments = await parseProjectData('', '[tag123] Some inline description text.', [], 10);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Some inline description text.');
  });

  it('extracts a hyphenated tag ([my-tag]) inline and matches a hyphenated asset filename', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'my-tag.jpg' })];
    const segments = await parseProjectData('', '[my-tag] Inline text for a hyphenated tag.', assets, 10);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Inline text for a hyphenated tag.');
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('extracts an underscored tag ([my_tag]) inline and matches an underscored asset filename', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'my_tag.jpg' })];
    const segments = await parseProjectData('', '[my_tag] Inline text for an underscored tag.', assets, 10);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Inline text for an underscored tag.');
    expect(segments[0]?.assetId).toBe('a1');
  });

  it('still parses pure-letter tags ([cafe], [time]) with inline text — no regression', async () => {
    const segments = await parseProjectData(
      '',
      '[cafe] We meet at the café every morning.\n[time] The meeting starts at ten thirty sharp.',
      [],
      10,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('We meet at the café every morning.');
    expect(segments[1]?.text).toBe('The meeting starts at ten thirty sharp.');
  });

  it('produces 6 correctly-ordered, correctly-texted segments from the full repro scene doc (all tags inline, one paragraph)', async () => {
    const sceneDoc =
      '[cafe] We meet at the café every morning. [time] The meeting starts at ten thirty sharp. ' +
      "[late] Please don't be late, the team is waiting. [missing1] This is a test missing segment. " +
      '[missing2] This is a test missing segment 2 [team] Our team must cooperate to finish on time.';
    const segments = await parseProjectData('', sceneDoc, [], 30);
    expect(segments).toHaveLength(6);
    expect(segments.map(s => s.text)).toEqual([
      'We meet at the café every morning.',
      'The meeting starts at ten thirty sharp.',
      "Please don't be late, the team is waiting.",
      'This is a test missing segment.',
      'This is a test missing segment 2',
      'Our team must cooperate to finish on time.',
    ]);
  });

  it('produces the same 6 segments when only missing1/missing2 are inline and the rest are newline-separated (the originally-reported mix)', async () => {
    const sceneDoc =
      '[cafe]\nWe meet at the café every morning.\n' +
      '[time]\nThe meeting starts at ten thirty sharp.\n' +
      "[late]\nPlease don't be late, the team is waiting.\n" +
      '[missing1] This is a test missing segment.\n' +
      '[missing2] This is a test missing segment 2\n' +
      '[team]\nOur team must cooperate to finish on time.';
    const segments = await parseProjectData('', sceneDoc, [], 30);
    expect(segments).toHaveLength(6);
    expect(segments.map(s => s.text)).toEqual([
      'We meet at the café every morning.',
      'The meeting starts at ten thirty sharp.',
      "Please don't be late, the team is waiting.",
      'This is a test missing segment.',
      'This is a test missing segment 2',
      'Our team must cooperate to finish on time.',
    ]);
  });
});

// ===========================================================================
// R4-1 end-to-end (was R12): the parser fix above is what makes this scenario
// possible — before it, missing1/missing2 parsed to EMPTY text segments. With
// the parser fix in place they parse to 2 real, non-empty, unmatched scenes in
// the middle. Round 4 (R4-1) reversed R12's abort: instead of erroring, the two
// unmatched scenes are SKIPPED and the timeline is built from the 4 matched
// scenes only.
// ===========================================================================
describe('R4-1 end-to-end — parsed missing1/missing2 segments are SKIPPED, not aborted', () => {
  it('scene doc with 2 consecutive uncovered segments in the middle proceeds and skips them', async () => {
    const sceneDoc =
      '[cafe] alpha bravo charlie.\n' +
      '[time] delta echo foxtrot.\n' +
      '[late] golf hotel india.\n' +
      '[missing1] This is a test missing segment.\n' +
      '[missing2] This is a test missing segment 2\n' +
      '[team] juliet kilo lima.';
    const segments = await parseProjectData('', sceneDoc, [], 30);
    expect(segments).toHaveLength(6);
    expect(segments.map(s => s.text)).toEqual([
      'alpha bravo charlie.',
      'delta echo foxtrot.',
      'golf hotel india.',
      'This is a test missing segment.',
      'This is a test missing segment 2',
      'juliet kilo lima.',
    ]);

    // The audio genuinely never speaks the missing1/missing2 text — every
    // other segment's words are present in the transcript.
    const tokens = [
      ...wordTokens('alpha bravo charlie', 0, 0.5),
      ...wordTokens('delta echo foxtrot', 2.0, 0.5),
      ...wordTokens('golf hotel india', 4.0, 0.5),
      ...wordTokens('juliet kilo lima', 6.0, 0.5),
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.text)).toEqual([
      'alpha bravo charlie.',
      'delta echo foxtrot.',
      'golf hotel india.',
      'juliet kilo lima.',
    ]);
    expect(skipped.map(r => r.segmentIndex)).toEqual([3, 4]);
    expect(skipped.map(r => r.segmentText)).toEqual([
      'This is a test missing segment.',
      'This is a test missing segment 2',
    ]);
  });
});
