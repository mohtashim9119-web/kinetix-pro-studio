/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Media workflow Units 1-2 — the two 'media-match' findings' wording.

import { describe, it, expect } from 'vitest';
import { buildMediaMatchEntry, buildMediaNameCollisionEntry } from './syncLog';

describe('media-match findings', () => {
  it('rename collision names the file, the count, and that matching uses the oldest', () => {
    const e = buildMediaNameCollisionEntry('run', '001_intro.png', 2, 5);
    expect(e.type).toBe('media-match');
    expect(e.severity).toBe('warning');
    expect(e.message).toBe('2 files named "001_intro.png" — matching uses the oldest; rename to disambiguate.');
  });

  it('match summary: all matched is info', () => {
    const e = buildMediaMatchEntry('run', { matched: 3, unmatched: [], ambiguous: [] }, 5);
    expect(e.type).toBe('media-match');
    expect(e.severity).toBe('info');
    expect(e.message).toBe('Match media to scenes: 3 scenes matched · 0 unmatched.');
  });

  it('match summary names every unmatched scene and each same-name ambiguity', () => {
    const e = buildMediaMatchEntry('run', {
      matched: 1,
      unmatched: ['005_need_a_car', 'S7'],
      ambiguous: [{ name: '001_intro', count: 2 }],
    }, 5);
    expect(e.severity).toBe('warning');
    expect(e.message).toBe(
      'Match media to scenes: 1 scene matched · 2 unmatched (kept their current media): 005_need_a_car, S7. ' +
      '2 files named "001_intro" — matching used the oldest; rename to disambiguate.',
    );
  });
});
