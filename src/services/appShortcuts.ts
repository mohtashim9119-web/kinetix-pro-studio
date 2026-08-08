/**
 * App-level keyboard shortcuts: reload, and the developer-tools toggle
 * (2026-08-08, owner request).
 *
 * Pure resolver, and a deliberate sibling of `undoShortcut.ts` rather than a
 * second style of doing the same job — the two are composed in `App.tsx`'s one
 * `keydown` handler and must not disagree about who owns a chord. Their key sets
 * are disjoint (`z`/`y` here vs `r`/`i`/`F5`/`F12`), and one test below asserts
 * that rather than leaving it to inspection.
 *
 * WHY THESE ARE NOT SUPPRESSED BY A FOCUSED TEXT FIELD, unlike undo/redo.
 * `Cmd+R` and `F12` are *application* actions, not text operations — there is no
 * "reload this text field" for them to shadow, and a user who presses Cmd+R while
 * a name field happens to have focus means "reload". The undo/redo resolver
 * yields to text fields precisely because `Cmd+Z` DOES have a text meaning.
 */

/** Same minimal event shape `undoShortcut.ts` uses. */
export interface AppShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface AppShortcutContext {
  /**
   * An export is in flight.
   *
   * A reload during an export destroys minutes of unrecoverable work: the render
   * dies with the page, the ffmpeg sidecar is left mid-run, and the session temp
   * dir is orphaned. So the reload is REFUSED rather than performed
   * (`'reload-blocked'`), and the caller tells the user to cancel the export
   * first. This is the one place this module declines to do exactly what the key
   * says, and it is called out in `App.tsx` at the call site as well as here.
   *
   * Devtools are unaffected — opening the inspector during an export is
   * harmless and occasionally exactly what someone wants.
   */
  exporting: boolean;
}

export type AppShortcutAction =
  | 'reload'
  | 'reload-blocked'
  | 'devtools'
  | 'ignore';

/**
 * Resolves one keydown against the app-shortcut table.
 *
 * | Chord                              | Action   |
 * |------------------------------------|----------|
 * | `Cmd+R` / `Ctrl+R` / `F5`          | reload   |
 * | `Cmd+Alt+I` / `Ctrl+Shift+I` / `F12` | devtools |
 *
 * Both platforms' bindings are accepted on both platforms — the modifier is
 * `metaKey || ctrlKey`, matching `undoShortcut.ts` and the rest of this app's
 * keydown branches, rather than a platform sniff. `F5`/`F12` carry no modifier
 * requirement, which is what users of those keys expect.
 *
 * `Cmd+Shift+R` (hard reload) is accepted as a plain reload: a webview has no
 * distinct cache-bypassing reload worth modelling, and swallowing the chord
 * silently would be worse than treating it as the reload the user asked for.
 */
export function resolveAppShortcut(
  e: AppShortcutKeyEvent,
  ctx: AppShortcutContext,
): AppShortcutAction {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();

  // ---- Developer tools -------------------------------------------------
  // Checked BEFORE reload: nothing overlaps today, but `i` and `r` sharing a
  // modifier makes the ordering worth being deliberate about rather than
  // incidental.
  if (e.key === 'F12') return 'devtools';
  // macOS: Cmd+Alt+I. Windows/Linux: Ctrl+Shift+I. Accept either combination on
  // either platform; requiring BOTH alt and shift would match neither.
  if (mod && k === 'i' && (e.altKey || e.shiftKey)) return 'devtools';

  // ---- Reload ----------------------------------------------------------
  if (e.key === 'F5' || (mod && k === 'r' && !e.altKey)) {
    return ctx.exporting ? 'reload-blocked' : 'reload';
  }

  return 'ignore';
}
