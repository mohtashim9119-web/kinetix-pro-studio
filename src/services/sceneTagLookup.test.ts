import { describe, it, expect } from 'vitest';
import { findExpectedFileNameForSegmentText } from './sceneTagLookup';

const sceneDetails = [
  '[001_child_seven.png]',
  'You are seven years old.',
  '[002_skin_shelter.png]',
  'You live inside a skin-covered shelter at the edge of a shallow valley.',
  '[IMAGE: 003_mother_fire.jpg]',
  'The fire your mother tends smells like pine resin and scorched bone.',
].join('\n');

describe('findExpectedFileNameForSegmentText', () => {
  it('recovers the bracket filename for a segment whose text matches one scene exactly', () => {
    expect(findExpectedFileNameForSegmentText(sceneDetails, 'You are seven years old.'))
      .toBe('001_child_seven.png');
  });

  it('strips the legacy IMAGE:/VIDEO: prefix from the tag', () => {
    expect(findExpectedFileNameForSegmentText(
      sceneDetails,
      'The fire your mother tends smells like pine resin and scorched bone.',
    )).toBe('003_mother_fire.jpg');
  });

  it('returns null when no scene description matches', () => {
    expect(findExpectedFileNameForSegmentText(sceneDetails, 'Something never in the script.')).toBeNull();
  });

  it('returns null when sceneDetails is empty', () => {
    expect(findExpectedFileNameForSegmentText('', 'You are seven years old.')).toBeNull();
  });

  it('returns null when two scenes share the same description (ambiguous)', () => {
    const dup = '[a.png]\nSame line.\n[b.png]\nSame line.';
    expect(findExpectedFileNameForSegmentText(dup, 'Same line.')).toBeNull();
  });
});
