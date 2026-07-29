// WS4 Feature 1 (decision 13a) — stage-direction stripping.
//
// The grammar is deliberately conservative, so these tests are as much about
// what is NOT stripped as what is. Every "preserve" case below is a real thing
// a creator writes into a scene document: a [tag] anchor, an emphasised word,
// a lowercase bracket that is not a screenplay directive.
import { describe, it, expect } from 'vitest';
import {
  stripStageDirections,
  canonicalizeSceneDoc,
  canonicalize,
  canonicalizeForFilename,
} from './textNormalize';

describe('stripStageDirections — forms that are stripped', () => {
  it('strips a leading parenthetical', () => {
    expect(stripStageDirections('(whispering) hello')).toBe('hello');
  });

  it('strips a mid-sentence parenthetical and closes the gap', () => {
    expect(stripStageDirections('ten (seconds) pass')).toBe('ten pass');
  });

  it('strips a mid-line bracketed ALL-CAPS directive', () => {
    expect(stripStageDirections('line [CUT TO: KITCHEN] continued')).toBe('line continued');
  });

  it('strips a whole INT. scene-header line', () => {
    expect(stripStageDirections('INT. KITCHEN - DAY')).toBe('');
  });

  it('strips a whole EXT. scene-header line', () => {
    expect(stripStageDirections('EXT. PARKING LOT - NIGHT')).toBe('');
  });

  it('strips a FADE IN: transition line', () => {
    expect(stripStageDirections('FADE IN:')).toBe('');
  });

  it('strips the other named transition lines', () => {
    expect(stripStageDirections('FADE OUT:')).toBe('');
    expect(stripStageDirections('CUT TO:')).toBe('');
    expect(stripStageDirections('DISSOLVE TO:')).toBe('');
  });

  it('strips a transition line that carries trailing text', () => {
    expect(stripStageDirections('DISSOLVE TO: THE ROOFTOP')).toBe('');
  });

  it('strips a line left holding only colons', () => {
    expect(stripStageDirections('  :  ')).toBe('');
  });

  it('strips nested parentheticals inside-out', () => {
    expect(stripStageDirections('a (to camera (aside)) b')).toBe('a b');
  });

  it('strips a bracketed ALL-CAPS directive with no spoken text around it', () => {
    expect(stripStageDirections('word [CLOSE UP]')).toBe('word');
  });
});

describe('stripStageDirections — forms that are preserved', () => {
  it('preserves a [tag] anchor at line start', () => {
    expect(stripStageDirections('[scene 1] hello')).toBe('[scene 1] hello');
  });

  it('preserves an ALL-CAPS bracket at line start (it is an anchor position)', () => {
    expect(stripStageDirections('[CLOSE UP] hello')).toBe('[CLOSE UP] hello');
  });

  it('preserves a mid-line bracket that is not ALL-CAPS', () => {
    expect(stripStageDirections('line [scene 2] continued')).toBe('line [scene 2] continued');
  });

  it('preserves italic emphasis markers', () => {
    expect(stripStageDirections('*emphasis* preserved')).toBe('*emphasis* preserved');
  });

  it('preserves hyphenated words and smart punctuation', () => {
    expect(stripStageDirections('co-operate — it’s fine')).toBe('co-operate — it’s fine');
  });

  it('does not treat mixed-case prose as a scene header', () => {
    expect(stripStageDirections('Int. the story begins')).toBe('Int. the story begins');
    expect(stripStageDirections('We cut to: the next idea')).toBe('We cut to: the next idea');
  });

  it('leaves an unbalanced parenthesis alone rather than eating the rest', () => {
    expect(stripStageDirections('hello (world')).toBe('hello (world');
  });

  it('returns empty string unchanged', () => {
    expect(stripStageDirections('')).toBe('');
  });
});

describe('stripStageDirections — multi-line', () => {
  it('strips only the header line and keeps the spoken line', () => {
    expect(stripStageDirections('INT. KITCHEN - DAY\nHe pours the coffee slowly.'))
      .toBe('He pours the coffee slowly.');
  });

  it('strips a header and a transition around a spoken line', () => {
    const input = 'FADE IN:\nEXT. BEACH - DAY\nThe waves are loud today.\nCUT TO:';
    expect(stripStageDirections(input)).toBe('The waves are loud today.');
  });

  it('keeps each surviving line separate', () => {
    expect(stripStageDirections('first line (aside)\nsecond line'))
      .toBe('first line\nsecond line');
  });

  it('only line-start brackets on their OWN line count as anchors', () => {
    // The second line's bracket is at ITS line start, so it survives; the first
    // line's is mid-line and ALL-CAPS, so it goes.
    expect(stripStageDirections('a [WIDE SHOT] b\n[HERO] c')).toBe('a b\n[HERO] c');
  });
});

describe('canonicalizeSceneDoc', () => {
  it('strips directions and then tokenizes normally', () => {
    expect(canonicalizeSceneDoc('(whispering) the price is $5'))
      .toEqual(['the', 'price', 'is', 'five', 'dollars']);
  });

  it('returns no tokens for text that is entirely direction', () => {
    expect(canonicalizeSceneDoc('INT. KITCHEN - DAY')).toEqual([]);
  });

  it('agrees with canonicalize on text containing no directions', () => {
    const text = 'thirty-seven co-operate 2024 don’t';
    expect(canonicalizeSceneDoc(text)).toEqual(canonicalize(text));
  });
});

describe('existing normalizer semantics are unchanged by WS4', () => {
  it('canonicalize does NOT strip stage directions', () => {
    expect(canonicalize('(whispering) hello')).toEqual(['whispering', 'hello']);
  });

  it('canonicalizeForFilename still only folds Unicode hygiene', () => {
    expect(canonicalizeForFilename('Hero’s Shot.jpg')).toBe("Hero's Shot.jpg");
  });
});
