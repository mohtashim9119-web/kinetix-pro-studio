/**
 * Undo/redo shortcut resolution tests (Phase 2, 2026-08-08).
 *
 * The chord table and the four stand-down conditions are the part of this
 * feature with the most branches and the least visibility — inline in a
 * ~120-line `keydown` handler nobody re-reads. Swept exhaustively here.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveShortcutAction,
  type ShortcutContext,
  type ShortcutKeyEvent,
} from './undoShortcut';

const key = (over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
});

const ctx = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({
  isTextEntry: false, suppressed: false, dragging: false, ...over,
});

describe('chord table', () => {
  it('Cmd+Z and Ctrl+Z are undo', () => {
    expect(resolveShortcutAction(key({ metaKey: true }), ctx())).toBe('undo');
    expect(resolveShortcutAction(key({ ctrlKey: true }), ctx())).toBe('undo');
  });

  it('Cmd+Shift+Z and Ctrl+Shift+Z are redo', () => {
    expect(resolveShortcutAction(key({ metaKey: true, shiftKey: true }), ctx())).toBe('redo');
    expect(resolveShortcutAction(key({ ctrlKey: true, shiftKey: true }), ctx())).toBe('redo');
  });

  it('Ctrl+Y is redo, with or without shift, on either modifier', () => {
    // Accepted unconditionally rather than gated on platform: it is the Windows
    // convention and is not a macOS system binding.
    expect(resolveShortcutAction(key({ key: 'y', ctrlKey: true }), ctx())).toBe('redo');
    expect(resolveShortcutAction(key({ key: 'y', metaKey: true }), ctx())).toBe('redo');
    expect(resolveShortcutAction(key({ key: 'y', ctrlKey: true, shiftKey: true }), ctx())).toBe('redo');
  });

  it('case does not matter — a capital Z arrives when shift is held', () => {
    // This is not hypothetical: with Shift down the browser reports `key === 'Z'`,
    // so a case-sensitive comparison would break redo specifically.
    expect(resolveShortcutAction(key({ key: 'Z', metaKey: true, shiftKey: true }), ctx())).toBe('redo');
    expect(resolveShortcutAction(key({ key: 'Z', metaKey: true }), ctx())).toBe('undo');
    expect(resolveShortcutAction(key({ key: 'Y', ctrlKey: true }), ctx())).toBe('redo');
  });
});

describe('not our chord', () => {
  it('a bare z or y is ignored — no modifier, no claim', () => {
    expect(resolveShortcutAction(key(), ctx())).toBe('ignore');
    expect(resolveShortcutAction(key({ key: 'y' }), ctx())).toBe('ignore');
    expect(resolveShortcutAction(key({ shiftKey: true }), ctx())).toBe('ignore');
  });

  it('Alt/Option held is NOT our chord', () => {
    // Cmd+Alt+Z is reserved by other apps and by macOS text editing; claiming it
    // would be overreach.
    expect(resolveShortcutAction(key({ metaKey: true, altKey: true }), ctx())).toBe('ignore');
    expect(resolveShortcutAction(key({ ctrlKey: true, altKey: true, shiftKey: true }), ctx())).toBe('ignore');
  });

  it('other letters with the modifier are ignored, including neighbours of our own chords', () => {
    for (const k of ['a', 'x', 'c', 'v', 's', 'd', 'w']) {
      expect(resolveShortcutAction(key({ key: k, metaKey: true }), ctx())).toBe('ignore');
    }
    // Cmd+Shift+D is the DEV panel toggle and must keep working.
    expect(resolveShortcutAction(key({ key: 'd', metaKey: true, shiftKey: true }), ctx())).toBe('ignore');
  });
});

describe('stand-down conditions', () => {
  it('a focused text field yields ENTIRELY — ignore, not consume', () => {
    // Load-bearing distinction: 'ignore' means the caller does not
    // preventDefault, so the OS text responder performs its own undo. Returning
    // 'consume' here would swallow the key and make every text field feel broken.
    expect(resolveShortcutAction(key({ metaKey: true }), ctx({ isTextEntry: true }))).toBe('ignore');
    expect(resolveShortcutAction(key({ metaKey: true, shiftKey: true }), ctx({ isTextEntry: true }))).toBe('ignore');
    expect(resolveShortcutAction(key({ key: 'y', ctrlKey: true }), ctx({ isTextEntry: true }))).toBe('ignore');
  });

  it('a text field WINS over suppression — a field inside a modal keeps native undo', () => {
    expect(resolveShortcutAction(
      key({ metaKey: true }),
      ctx({ isTextEntry: true, suppressed: true }),
    )).toBe('ignore');
  });

  it('a modal / DEV panel / in-flight export consumes without acting', () => {
    // preventDefault still fires (the caller's contract for 'consume'), so the
    // native Edit menu cannot perform a text undo behind the open modal.
    expect(resolveShortcutAction(key({ metaKey: true }), ctx({ suppressed: true }))).toBe('consume');
    expect(resolveShortcutAction(key({ metaKey: true, shiftKey: true }), ctx({ suppressed: true }))).toBe('consume');
  });

  it('a live drag consumes without acting', () => {
    // The gesture owns the timeline until it resolves; an undo landing between
    // its direct DOM writes and its commit would leave the two disagreeing.
    expect(resolveShortcutAction(key({ metaKey: true }), ctx({ dragging: true }))).toBe('consume');
    expect(resolveShortcutAction(key({ key: 'y', ctrlKey: true }), ctx({ dragging: true }))).toBe('consume');
  });

  it('a non-chord is ignored even when every stand-down condition is set', () => {
    expect(resolveShortcutAction(
      key({ key: 'q', metaKey: true }),
      ctx({ isTextEntry: true, suppressed: true, dragging: true }),
    )).toBe('ignore');
  });
});

describe('exhaustive sweep — every combination is classified, and never wrongly', () => {
  it('sweeps key x meta x ctrl x shift x alt x 3 context flags with no surprises', () => {
    const keys = ['z', 'Z', 'y', 'Y', 'a', 'd'];
    const bools = [false, true];
    let undo = 0, redo = 0, consume = 0, ignore = 0;
    for (const k of keys)
      for (const meta of bools)
        for (const ctrl of bools)
          for (const shift of bools)
            for (const alt of bools)
              for (const isTextEntry of bools)
                for (const suppressed of bools)
                  for (const dragging of bools) {
                    const action = resolveShortcutAction(
                      { key: k, metaKey: meta, ctrlKey: ctrl, shiftKey: shift, altKey: alt },
                      { isTextEntry, suppressed, dragging },
                    );
                    const isOurKey = k.toLowerCase() === 'z' || k.toLowerCase() === 'y';
                    const hasMod = meta || ctrl;
                    if (action === 'undo' || action === 'redo') {
                      // Nothing may ACT unless it is genuinely our chord, with a
                      // modifier, no alt, and every stand-down condition clear.
                      expect(isOurKey && hasMod && !alt).toBe(true);
                      expect(isTextEntry || suppressed || dragging).toBe(false);
                      // And the undo/redo split must match the chord table.
                      const expectRedo = k.toLowerCase() === 'y' || shift;
                      expect(action).toBe(expectRedo ? 'redo' : 'undo');
                    }
                    if (action === 'consume') {
                      expect(isOurKey && hasMod && !alt).toBe(true);
                      expect(isTextEntry).toBe(false);
                      expect(suppressed || dragging).toBe(true);
                    }
                    if (action === 'ignore') {
                      expect(!isOurKey || !hasMod || alt || isTextEntry).toBe(true);
                    }
                    if (action === 'undo') undo++;
                    else if (action === 'redo') redo++;
                    else if (action === 'consume') consume++;
                    else ignore++;
                  }
    // Every bucket is genuinely reached, so the sweep is not vacuous.
    expect(undo).toBeGreaterThan(0);
    expect(redo).toBeGreaterThan(0);
    expect(consume).toBeGreaterThan(0);
    expect(ignore).toBeGreaterThan(0);
    expect(undo + redo + consume + ignore).toBe(
      keys.length * 2 ** 7,
    );
  });
});
