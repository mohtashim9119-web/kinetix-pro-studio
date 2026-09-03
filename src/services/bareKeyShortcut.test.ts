/**
 * Bare-key shortcut resolution tests (WS2 T4.2).
 *
 * THE SUPPRESSION BLOCK IS ASSERTED ONE KEY AT A TIME, ON PURPOSE. A single
 * broad "no bare key acts while a modal is open" assertion would stay green if
 * the guard were restored for five keys and dropped for the sixth — one test
 * covering for the rest is exactly the failure this file is written to avoid.
 * Each key therefore gets its own `it`, naming its own key, and each was probed
 * by reverting the guard for that key alone (see the session report) to confirm
 * it fails on its own key and not by proxy.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveBareKeyAction,
  type BareKeyAction,
  type BareKeyContext,
  type BareKeyEvent,
} from './bareKeyShortcut';
import { resolveShortcutAction } from './undoShortcut';
import { resolveAppShortcut } from './appShortcuts';

const ev = (over: Partial<BareKeyEvent> = {}): BareKeyEvent => ({
  key: 'x', code: 'KeyX', ...over,
});

const ctx = (over: Partial<BareKeyContext> = {}): BareKeyContext => ({
  isTextEntry: false, suppressed: false, ...over,
});

/** The six keys this chain owns, each with the event that produces it. */
const KEYS: ReadonlyArray<{ name: string; event: BareKeyEvent; action: BareKeyAction }> = [
  { name: 'Space', event: ev({ key: ' ', code: 'Space' }), action: 'toggle-play' },
  { name: '+', event: ev({ key: '+', code: 'Equal' }), action: 'slider-up' },
  { name: '-', event: ev({ key: '-', code: 'Minus' }), action: 'slider-down' },
  { name: 'ArrowRight', event: ev({ key: 'ArrowRight', code: 'ArrowRight' }), action: 'speed-up' },
  { name: 'ArrowLeft', event: ev({ key: 'ArrowLeft', code: 'ArrowLeft' }), action: 'speed-down' },
  { name: 'F', event: ev({ key: 'f', code: 'KeyF' }), action: 'toggle-fullscreen' },
];

describe('each key still does its job when nothing is suppressing it', () => {
  for (const { name, event, action } of KEYS) {
    it(`${name} resolves to ${action}`, () => {
      expect(resolveBareKeyAction(event, ctx())).toBe(action);
    });
  }

  it('the aliases the inline chain carried are preserved', () => {
    expect(resolveBareKeyAction(ev({ key: '=', code: 'Equal' }), ctx())).toBe('slider-up');
    expect(resolveBareKeyAction(ev({ key: '_', code: 'Minus' }), ctx())).toBe('slider-down');
    expect(resolveBareKeyAction(ev({ key: 'F', code: 'KeyF' }), ctx())).toBe('toggle-fullscreen');
  });
});

// ---------------------------------------------------------------------------
// THE FIX. One `it` per key — see this file's header for why they are not
// collapsed into a loop-free single assertion over the whole set.
// ---------------------------------------------------------------------------
describe('WS2 T4.2 — a modal owning the keyboard makes each key inert', () => {
  it('Space does not toggle playback behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: ' ', code: 'Space' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('+ does not move the slider behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: '+', code: 'Equal' }), ctx({ suppressed: true })))
      .toBe('ignore');
    expect(resolveBareKeyAction(ev({ key: '=', code: 'Equal' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('- does not move the slider behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: '-', code: 'Minus' }), ctx({ suppressed: true })))
      .toBe('ignore');
    expect(resolveBareKeyAction(ev({ key: '_', code: 'Minus' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('ArrowRight does not move the speed ladder behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: 'ArrowRight', code: 'ArrowRight' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('ArrowLeft does not move the speed ladder behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: 'ArrowLeft', code: 'ArrowLeft' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('F does not throw the preview fullscreen behind a modal', () => {
    expect(resolveBareKeyAction(ev({ key: 'f', code: 'KeyF' }), ctx({ suppressed: true })))
      .toBe('ignore');
    expect(resolveBareKeyAction(ev({ key: 'F', code: 'KeyF' }), ctx({ suppressed: true })))
      .toBe('ignore');
  });

  it('suppression is decided independently of focus — a non-text element is the real case', () => {
    // The T4.1 leak was precisely this combination: a modal up, focus on one of
    // its toggle buttons, so `isTextEntry` is FALSE and the old guard passed.
    for (const { name, event } of KEYS) {
      expect(resolveBareKeyAction(event, ctx({ suppressed: true, isTextEntry: false })), name)
        .toBe('ignore');
    }
  });
});

describe('the pre-existing text-entry guard is unchanged', () => {
  for (const { name, event } of KEYS) {
    it(`${name} stays inert while a text field has focus`, () => {
      expect(resolveBareKeyAction(event, ctx({ isTextEntry: true }))).toBe('ignore');
    });
  }
});

describe('this resolver claims nothing it does not own', () => {
  it('an unrelated key is ignored', () => {
    expect(resolveBareKeyAction(ev(), ctx())).toBe('ignore');
    expect(resolveBareKeyAction(ev({ key: 's', code: 'KeyS' }), ctx())).toBe('ignore');
    expect(resolveBareKeyAction(ev({ key: 'd', code: 'KeyD' }), ctx())).toBe('ignore');
  });

  it('its key set is disjoint from the other two resolvers composed in the same handler', () => {
    // Same guard `appShortcuts.test.ts` keeps against undoShortcut: three
    // resolvers share one keydown handler, so a chord added to any of them
    // could silently shadow another and nothing else would notice.
    for (const { name, event } of KEYS) {
      expect(
        resolveShortcutAction(
          { key: event.key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
          { isTextEntry: false, suppressed: false, dragging: false },
        ),
        name,
      ).toBe('ignore');
      expect(
        resolveAppShortcut(
          { key: event.key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
          { exporting: false },
        ),
        name,
      ).toBe('ignore');
    }
  });
});
