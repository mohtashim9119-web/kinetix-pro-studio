/**
 * App-shortcut resolution tests — reload and devtools (2026-08-08).
 *
 * The last test is the one that earns its keep: it asserts this resolver and
 * `undoShortcut.ts`'s never both claim the same chord. They are composed in one
 * `keydown` handler, so a future chord added to either could silently shadow the
 * other, and nothing else in the suite would notice.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveAppShortcut,
  type AppShortcutContext,
  type AppShortcutKeyEvent,
} from './appShortcuts';
import { resolveShortcutAction } from './undoShortcut';

const key = (over: Partial<AppShortcutKeyEvent> = {}): AppShortcutKeyEvent => ({
  key: 'r', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
});

const ctx = (over: Partial<AppShortcutContext> = {}): AppShortcutContext => ({
  exporting: false, ...over,
});

describe('reload', () => {
  it('Cmd+R and Ctrl+R reload', () => {
    expect(resolveAppShortcut(key({ metaKey: true }), ctx())).toBe('reload');
    expect(resolveAppShortcut(key({ ctrlKey: true }), ctx())).toBe('reload');
  });

  it('F5 reloads with no modifier — that is what F5 users expect', () => {
    expect(resolveAppShortcut(key({ key: 'F5' }), ctx())).toBe('reload');
  });

  it('case does not matter', () => {
    expect(resolveAppShortcut(key({ key: 'R', metaKey: true }), ctx())).toBe('reload');
  });

  it('Cmd+Shift+R is accepted as a plain reload rather than swallowed', () => {
    // A webview has no distinct cache-bypassing reload worth modelling, and
    // consuming the chord silently would be worse than honouring the intent.
    expect(resolveAppShortcut(key({ metaKey: true, shiftKey: true }), ctx())).toBe('reload');
  });

  it('a bare r does NOT reload', () => {
    expect(resolveAppShortcut(key(), ctx())).toBe('ignore');
    expect(resolveAppShortcut(key({ shiftKey: true }), ctx())).toBe('ignore');
  });

  it('Cmd+Alt+R is not ours — alt is excluded from the reload chord', () => {
    expect(resolveAppShortcut(key({ metaKey: true, altKey: true }), ctx())).toBe('ignore');
  });
});

describe('reload is refused during an export', () => {
  it('Cmd+R while exporting is BLOCKED, not performed', () => {
    // A reload mid-export destroys unrecoverable work: the render dies with the
    // page, the ffmpeg sidecar is left mid-run, its temp dir orphaned.
    expect(resolveAppShortcut(key({ metaKey: true }), ctx({ exporting: true }))).toBe('reload-blocked');
    expect(resolveAppShortcut(key({ key: 'F5' }), ctx({ exporting: true }))).toBe('reload-blocked');
  });

  it('but the key is still CLAIMED, so the webview cannot reload behind us', () => {
    // 'reload-blocked' is distinct from 'ignore' precisely so the caller still
    // calls preventDefault. Collapsing them would let the native reload fire.
    expect(resolveAppShortcut(key({ metaKey: true }), ctx({ exporting: true }))).not.toBe('ignore');
  });

  it('devtools are NOT blocked during an export — opening the inspector is harmless', () => {
    expect(resolveAppShortcut(key({ key: 'F12' }), ctx({ exporting: true }))).toBe('devtools');
    expect(resolveAppShortcut(
      key({ key: 'i', metaKey: true, altKey: true }), ctx({ exporting: true }),
    )).toBe('devtools');
  });
});

describe('devtools', () => {
  it('F12 opens devtools with no modifier', () => {
    expect(resolveAppShortcut(key({ key: 'F12' }), ctx())).toBe('devtools');
  });

  it('macOS Cmd+Alt+I', () => {
    expect(resolveAppShortcut(key({ key: 'i', metaKey: true, altKey: true }), ctx())).toBe('devtools');
  });

  it('Windows/Linux Ctrl+Shift+I', () => {
    expect(resolveAppShortcut(key({ key: 'i', ctrlKey: true, shiftKey: true }), ctx())).toBe('devtools');
  });

  it('either combination works on either modifier — not gated on a platform sniff', () => {
    expect(resolveAppShortcut(key({ key: 'i', ctrlKey: true, altKey: true }), ctx())).toBe('devtools');
    expect(resolveAppShortcut(key({ key: 'i', metaKey: true, shiftKey: true }), ctx())).toBe('devtools');
  });

  it('Cmd+I alone is NOT devtools — it needs alt or shift', () => {
    // Requiring one of the two is what keeps a plain Cmd+I (italic, in any future
    // rich-text field) from opening the inspector.
    expect(resolveAppShortcut(key({ key: 'i', metaKey: true }), ctx())).toBe('ignore');
    expect(resolveAppShortcut(key({ key: 'i' }), ctx())).toBe('ignore');
  });
});

describe('nothing else is claimed', () => {
  it('unrelated keys and chords are ignored', () => {
    for (const k of ['a', 'z', 'y', 's', 'd', 'F1', 'F11', 'Enter', 'Escape', ' ']) {
      for (const mod of [{}, { metaKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
        const action = resolveAppShortcut(key({ key: k, ...mod }), ctx());
        expect(action).toBe('ignore');
      }
    }
  });

  it('Cmd+Shift+D (the DEV panel toggle) is not claimed', () => {
    expect(resolveAppShortcut(key({ key: 'd', metaKey: true, shiftKey: true }), ctx())).toBe('ignore');
  });
});

describe('no chord is claimed by BOTH resolvers', () => {
  it('sweeps every key x modifier combination across both, finding no overlap', () => {
    // These two are composed in one keydown handler. If a chord were ever
    // claimed by both, whichever ran first would silently shadow the other — and
    // no other test in the suite would see it.
    const keys = ['r', 'R', 'i', 'I', 'z', 'Z', 'y', 'Y', 'd', 's', 'F5', 'F12'];
    const bools = [false, true];
    let appClaims = 0;
    let undoClaims = 0;
    for (const k of keys)
      for (const metaKey of bools)
        for (const ctrlKey of bools)
          for (const shiftKey of bools)
            for (const altKey of bools) {
              const e = { key: k, metaKey, ctrlKey, shiftKey, altKey };
              const app = resolveAppShortcut(e, ctx());
              // Evaluated with every stand-down clear, which is the only state in
              // which the undo resolver actually claims a chord to act on.
              const undo = resolveShortcutAction(e, {
                isTextEntry: false, suppressed: false, dragging: false,
              });
              const appClaimed = app !== 'ignore';
              const undoClaimed = undo !== 'ignore';
              expect(appClaimed && undoClaimed).toBe(false);
              if (appClaimed) appClaims++;
              if (undoClaimed) undoClaims++;
            }
    // Both genuinely claim things, so the no-overlap result is not vacuous.
    expect(appClaims).toBeGreaterThan(0);
    expect(undoClaims).toBeGreaterThan(0);
  });
});
