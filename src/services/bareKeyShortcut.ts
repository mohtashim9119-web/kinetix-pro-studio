/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The BARE-KEY shortcut chain — Space, `+`/`-`, arrows, `F` — as a pure
 * resolver (WS2 T4.2).
 *
 * WHY THIS FILE EXISTS. These six actions lived as an inline if/else chain in
 * `App.tsx`'s ~120-line `keydown` handler, each branch guarded by
 * `isTextEntryElement(document.activeElement)` and nothing else. That guard
 * asks what has FOCUS, not whether a modal owns the keyboard, so with any of
 * the eight suppressing surfaces up and focus on a non-text element — a toggle
 * button, which those modals are full of — every one of these keys still acted
 * behind the dialog the user was looking at: Space started playback, `F` threw
 * the preview fullscreen, the arrows moved the playback-speed ladder.
 *
 * WS2 T4.1 fixed exactly two keys, `S` and `D`, because those two are
 * DESTRUCTIVE (split and delete) and the rest merely surprising. That fix
 * carried an explicit scope note saying the chain was still leaking. This is
 * the rest of the chain, and it is a third sibling of `undoShortcut.ts` and
 * `appShortcuts.ts` rather than a fourth style of doing the same job: the four
 * resolvers are composed in one handler and their key sets must stay disjoint.
 *
 * `suppressed` is the SAME `shortcutsSuppressedRef` the undo/redo chords and
 * S/D already read — one predicate listing every modal flag, the DEV panel and
 * an export in flight — so there is one answer to "does another surface own
 * the keyboard right now", not six.
 *
 * WHY THE MODIFIER SETS ARE ASYMMETRIC, and deliberately preserved from the
 * inline chain rather than tidied: Space and `F` are matched bare, while
 * `+`/`-` and the arrows are matched WITHOUT a modifier test. Adding one to
 * the latter would change behaviour outside this fix's scope (a leak fix must
 * not quietly become a rebinding), so the asymmetry is carried across
 * unchanged and pinned by test.
 */

/** The minimal event shape, matching `undoShortcut.ts`/`appShortcuts.ts`. */
export interface BareKeyEvent {
  /** `KeyboardEvent.key`. */
  key: string;
  /** `KeyboardEvent.code` — Space is matched on `code`, as it was inline. */
  code: string;
}

export interface BareKeyContext {
  /** A text field, textarea or contenteditable has focus. */
  isTextEntry: boolean;
  /**
   * Another surface legitimately owns the keyboard: any of the modals, the DEV
   * panel, or an export in flight. This is the guard the whole chain was
   * missing.
   */
  suppressed: boolean;
}

export type BareKeyAction =
  | 'ignore'
  | 'toggle-play'
  | 'slider-up'
  | 'slider-down'
  | 'speed-up'
  | 'speed-down'
  | 'toggle-fullscreen';

/**
 * Resolves one bare keypress. Returns `'ignore'` for anything this chain does
 * not own, for a focused text field, and — the point of this module — for
 * every key while another surface is suppressing shortcuts.
 *
 * Order is irrelevant here (the key sets are disjoint); the two guards are
 * checked first so no branch below can be reached without them.
 */
export function resolveBareKeyAction(e: BareKeyEvent, ctx: BareKeyContext): BareKeyAction {
  if (ctx.suppressed) return 'ignore';
  if (ctx.isTextEntry) return 'ignore';

  if (e.code === 'Space') return 'toggle-play';
  if (e.key === '+' || e.key === '=') return 'slider-up';
  if (e.key === '-' || e.key === '_') return 'slider-down';
  if (e.key === 'ArrowRight') return 'speed-up';
  if (e.key === 'ArrowLeft') return 'speed-down';
  if (e.key === 'f' || e.key === 'F') return 'toggle-fullscreen';

  return 'ignore';
}
