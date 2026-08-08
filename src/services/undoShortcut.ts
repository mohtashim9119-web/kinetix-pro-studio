/**
 * Undo/redo keyboard-shortcut resolution (Phase 2, 2026-08-08).
 *
 * Design: `docs/decisions/2026-08-08-undo-redo-design.md` §7.
 *
 * Pure, so the part of this feature with the most conditions — which chord means
 * undo, which means redo, and when the app must stand down and let something
 * else have the key — can be swept exhaustively by unit test instead of being
 * inspected by eye inside `App.tsx`'s ~120-line `keydown` handler.
 *
 * PLATFORM STATUS, MEASURED. Verified 2026-08-08 in the real Tauri/WKWebView
 * shell (`npm run tauri:dev`), which the design doc flagged as this feature's
 * least-confident assumption after `pointercancel` cost four attempts to an
 * unmeasured platform guess:
 *
 *  - `Cmd+Z` and `Cmd+Shift+Z` BOTH reach a `window` keydown listener with
 *    `defaultPrevented === false`, in three states: nothing focused, a range
 *    slider clicked, and immediately after a fullscreen exit. So the
 *    `window`-listener design holds; no Tauri global shortcut or native menu
 *    accelerator is needed.
 *  - The macOS Edit menu DOES flash on both. That is why the caller's
 *    `preventDefault()` is load-bearing and not merely tidy: this app configures
 *    no menu, so Tauri's default one is live and its `Cmd+Z` is bound to the OS
 *    text responder, which would otherwise act alongside us.
 *  - `Cmd+Shift+Z` AND `Cmd+Y` both perform redo — confirmed by manual QA on
 *    macOS in a second pass. Retain both bindings. (The instrumented run had
 *    logged no `key=y` event, so this was briefly recorded here as unverified;
 *    the QA pass settled it.)
 *  - Text-field isolation confirmed by the same QA pass: `Cmd+Z` inside a field
 *    performs the field's own undo, not the project's.
 *  - STILL UNVERIFIED, and not claimed: Windows. `tauri.conf.json` bundles a
 *    Windows ffmpeg sidecar so it is a real target, but no Windows hardware has
 *    exercised this.
 */

/** The minimal shape of a `KeyboardEvent` this decision needs. */
export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutContext {
  /**
   * A text-entry element has focus. The event is then left ENTIRELY alone —
   * `'ignore'`, not `'suppress'` — so the OS's own text undo runs. Stealing
   * `Cmd+Z` inside a text field would make every field in the app feel broken.
   */
  isTextEntry: boolean;
  /**
   * Another surface legitimately owns the keyboard: one of the five modals with
   * their own keydown listeners, the DEV panel, or an export in flight.
   */
  suppressed: boolean;
  /** A drag gesture is live (`isResizingRef`). The gesture owns the timeline. */
  dragging: boolean;
}

/**
 * What the app should do with a keydown.
 *
 *  - `'undo'` / `'redo'` — handle it, and `preventDefault()`.
 *  - `'consume'` — this IS our chord, but we must not act on it right now (a
 *    modal is open, or a drag is live). Still `preventDefault()`, so the native
 *    Edit menu does not perform a text undo behind a modal the user is looking
 *    at. Distinguishing this from `'ignore'` is the whole reason this returns
 *    four values rather than three.
 *  - `'ignore'` — not our chord, or a text field owns it. Do NOT
 *    `preventDefault()`.
 */
export type ShortcutAction = 'undo' | 'redo' | 'consume' | 'ignore';

/**
 * Resolves one keydown.
 *
 * Chords, per design §7 — the modifier is `metaKey || ctrlKey` rather than a
 * platform sniff, so macOS and Windows share one code path:
 *
 *  | Chord                        | Action |
 *  |------------------------------|--------|
 *  | `Cmd/Ctrl+Z`                 | undo   |
 *  | `Cmd/Ctrl+Shift+Z`           | redo   |
 *  | `Cmd/Ctrl+Y`                 | redo   |
 *
 * `Ctrl+Y` is accepted unconditionally rather than gated on platform: it is the
 * Windows redo convention and is not a macOS system binding, so accepting it
 * everywhere costs nothing and avoids a platform branch.
 *
 * `Alt`/`Option` held is NOT our chord — `Cmd+Alt+Z` and friends are reserved by
 * other apps and by macOS text editing, and claiming them would be overreach.
 */
export function resolveShortcutAction(
  e: ShortcutKeyEvent,
  ctx: ShortcutContext,
): ShortcutAction {
  if (!(e.metaKey || e.ctrlKey)) return 'ignore';
  if (e.altKey) return 'ignore';
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return 'ignore';
  // Checked BEFORE `suppressed` on purpose: a text field inside a modal must
  // still get its own native undo, which `'consume'` would deny it.
  if (ctx.isTextEntry) return 'ignore';
  if (ctx.suppressed || ctx.dragging) return 'consume';
  return k === 'y' || e.shiftKey ? 'redo' : 'undo';
}
