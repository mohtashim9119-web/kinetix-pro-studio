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

// ===========================================================================
// WS5 Feature 2 (decision 13a extension, item A) — speaker-label stripping.
//
// Same conservative philosophy as the stage-direction grammar above: the
// uppercase-only rule is the whole safety argument, so the "preserved" cases
// carry as much weight as the "stripped" ones.
// ===========================================================================
describe('stripStageDirections — speaker labels are stripped', () => {
  it('strips a simple NARRATOR: label and keeps the dialogue', () => {
    expect(stripStageDirections('NARRATOR: hello world')).toBe('hello world');
  });

  it('strips a numbered VOICE 2: label', () => {
    expect(stripStageDirections('VOICE 2: I disagree')).toBe('I disagree');
  });

  it('strips a SPEAKER: label', () => {
    expect(stripStageDirections('SPEAKER: welcome')).toBe('welcome');
  });

  it('strips a multi-word label', () => {
    expect(stripStageDirections('OFF SCREEN VOICE: over here')).toBe('over here');
  });

  it('strips a label that is alone on its line', () => {
    expect(stripStageDirections('NARRATOR:')).toBe('');
  });

  it('tolerates a space before the colon', () => {
    expect(stripStageDirections('NARRATOR : hello')).toBe('hello');
  });

  it('composes with the parenthetical strip (label first, then parenthetical)', () => {
    expect(stripStageDirections('NARRATOR: (whispering) hello')).toBe('hello');
  });

  it('preserves a line-start [tag] anchor while stripping the label after it', () => {
    expect(stripStageDirections('[scene 1] NARRATOR: hello')).toBe('[scene 1] hello');
  });

  it('strips a label on each line independently', () => {
    expect(stripStageDirections('NARRATOR: first\nVOICE 2: second'))
      .toBe('first\nsecond');
  });
});

describe('stripStageDirections — speaker-label lookalikes are preserved', () => {
  it('does not strip a lowercase prose lead-in', () => {
    expect(stripStageDirections('narrator: hello')).toBe('narrator: hello');
  });

  it('does not strip lowercase "note:" / "hint:" prose', () => {
    expect(stripStageDirections('note: remember this')).toBe('note: remember this');
    expect(stripStageDirections('hint: look closer')).toBe('hint: look closer');
  });

  it('does not strip a mixed-case lead-in', () => {
    expect(stripStageDirections('Narrator: hello')).toBe('Narrator: hello');
  });

  it('leaves an uppercase line with no colon alone', () => {
    expect(stripStageDirections('NARRATOR SPEAKS NOW')).toBe('NARRATOR SPEAKS NOW');
  });

  it('leaves a colon that is not at the head of the line alone', () => {
    expect(stripStageDirections('he said THIS: out loud')).toBe('he said THIS: out loud');
  });

  it('does not strip a single-letter label (needs 2+ characters)', () => {
    expect(stripStageDirections('A: hello')).toBe('A: hello');
  });

  it('regression: INT. scene headers still strip (label rule did not shadow them)', () => {
    expect(stripStageDirections('INT. KITCHEN - DAY')).toBe('');
  });

  it('regression: CUT TO: is still a transition line, not a speaker label', () => {
    expect(stripStageDirections('CUT TO:')).toBe('');
    expect(stripStageDirections('CUT TO: KITCHEN')).toBe('');
  });

  it('regression: a line-start ALL-CAPS bracket anchor is still preserved', () => {
    expect(stripStageDirections('[CLOSE UP] hello')).toBe('[CLOSE UP] hello');
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

  it('drops a speaker label before tokenizing (WS5)', () => {
    expect(canonicalizeSceneDoc('NARRATOR: the price is $5'))
      .toEqual(['the', 'price', 'is', 'five', 'dollars']);
  });

  it('drops a label and a parenthetical together (WS5)', () => {
    expect(canonicalizeSceneDoc('VOICE 2: (whispering) hello there'))
      .toEqual(['hello', 'there']);
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

// Phase 3c (sync-pipeline-v2-plan.md H.5/:3821-3839 scope addition) — qi
// bookkeeping fixes for es/fr/de/pt. Both are gated behind an explicit
// `languageCode` argument; omitting it (every pre-existing call site) must
// stay byte-identical to today's English behavior — the frozen alignment
// baseline invariant (CLAUDE.md Testing section).
describe('canonicalize — languageCode omitted stays byte-identical (English baseline)', () => {
  it('still reads a comma as a thousands separator with no languageCode', () => {
    expect(canonicalize('2,500')).toEqual(['two', 'thousand', 'five', 'hundred']);
  });

  it('still reads a period as a decimal point with no languageCode', () => {
    expect(canonicalize('3.5')).toEqual(['three', 'point', 'five']);
  });

  it('still ASCII-folds a diacritic away with no languageCode', () => {
    expect(canonicalize('café')).toEqual(['caf']);
  });

  it('stays unchanged when languageCode is explicitly "en"', () => {
    expect(canonicalize('1.234,56 café', 'en')).toEqual(canonicalize('1.234,56 café'));
  });
});

describe('canonicalize — es/fr/de/pt invert the thousands/decimal separators', () => {
  it('drops a period thousands separator (German)', () => {
    expect(canonicalize('2.500', 'de')).toEqual(['two', 'thousand', 'five', 'hundred']);
  });

  it('reads a comma as the decimal mark (German)', () => {
    expect(canonicalize('3,5', 'de')).toEqual(['three', 'point', 'five']);
  });

  it('correctly parses a combined thousands+decimal number (Spanish)', () => {
    // "3.456,78" is English's "3,456.78" under the es/fr/de/pt convention.
    expect(canonicalize('3.456,78', 'es')).toEqual([
      'three', 'thousand', 'four', 'hundred', 'fifty', 'six', 'point', 'seven', 'eight',
    ]);
  });

  it('no longer mangles the combined case digit-by-digit (regression guard)', () => {
    // Prior (unfixed) behavior read the same string under English rules
    // (comma=thousands, period=decimal) as "three point four five six seven eight".
    expect(canonicalize('3.456,78', 'fr')).not.toEqual([
      'three', 'point', 'four', 'five', 'six', 'seven', 'eight',
    ]);
  });

  it('a plain integer with no separators is unaffected (Portuguese)', () => {
    expect(canonicalize('23', 'pt')).toEqual(canonicalize('23'));
  });
});

describe('canonicalize — es/fr/de/pt preserve native diacritics', () => {
  it('keeps an acute accent (Spanish)', () => {
    expect(canonicalize('café', 'es')).toEqual(['café']);
  });

  it('keeps an eñe (Spanish)', () => {
    expect(canonicalize('año', 'es')).toEqual(['año']);
  });

  it('keeps a cedilla (French)', () => {
    expect(canonicalize('garçon', 'fr')).toEqual(['garçon']);
  });

  it('keeps an umlaut and eszett (German)', () => {
    expect(canonicalize('straße größer', 'de')).toEqual(['straße', 'größer']);
  });

  it('keeps a tilde and cedilla (Portuguese)', () => {
    expect(canonicalize('não coração', 'pt')).toEqual(['não', 'coração']);
  });

  it('still strips genuine punctuation, not just ASCII punctuation', () => {
    expect(canonicalize('café, garçon!', 'fr')).toEqual(['café', 'garçon']);
  });

  it('canonicalizeSceneDoc also preserves diacritics when languageCode is passed', () => {
    expect(canonicalizeSceneDoc('café (aside)', 'fr')).toEqual(['café']);
  });
});
