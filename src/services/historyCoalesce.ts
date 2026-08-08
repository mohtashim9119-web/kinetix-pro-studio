/**
 * Gesture coalescing for undo history (Phase 3, 2026-08-08).
 *
 * Owner ruling, design §3.2: ONE history entry per gesture. A slider drag emits
 * many `setProject` calls and must cost one undo press, not thirty.
 *
 * The gesture's END is defined by the control's own natural boundary rather than
 * by one idle timer for everything:
 *
 *  | Control class | Entry closes on                        |
 *  |---------------|----------------------------------------|
 *  | slider        | `pointerup`                            |
 *  | text field    | `blur`, or 500 ms idle, whichever first |
 *  | discrete      | immediately (no coalescing)            |
 *
 * A slider's release is a FACT; an idle timer is a guess, and a slow deliberate
 * drag crossing that timer would split into two entries. Text fields have no
 * release event, so there the timer is unavoidable.
 *
 * THE SUBTLETY THAT MAKES THIS MORE THAN A FLAG — and the reason `graceMs`
 * exists. `EffectsPanel`'s grade sliders debounce their `setProject` at 120 ms,
 * so the LAST write of a slider gesture lands up to 120 ms AFTER the pointer is
 * already up. Closing the key hard on `pointerup` would push that trailing write
 * as its own second entry — producing exactly one spurious one-write entry per
 * slider gesture, which is the bug this module exists to prevent. So a released
 * key stays claimable for a short grace period, and only then closes.
 *
 * Pure and time-injected (`nowMs` is a parameter, never `Date.now()` inside), so
 * every window boundary is asserted at an exact millisecond instead of with a
 * sleeping test.
 */

/** Idle window for a text field, per the owner's ruling. */
export const TEXT_IDLE_MS = 500;

/**
 * How long a slider key stays claimable after `pointerup`.
 *
 * Must exceed `EffectsPanel`'s 120 ms grade debounce, or that gesture's trailing
 * write opens a second entry. 250 ms is that 120 ms plus room for a slow frame,
 * and is still far below any plausible gap between two deliberate gestures.
 * CHOSEN, not tuned against a real hand — same honesty as the auto-scroll ramp
 * constants.
 */
export const SLIDER_RELEASE_GRACE_MS = 250;

export type CoalesceClass = 'slider' | 'text' | 'discrete';

/** The currently-open gesture, if any. */
export interface OpenGesture {
  /** `(control, target)` — e.g. `grade:brightness:<segmentId>`. */
  key: string;
  kind: CoalesceClass;
  /** `nowMs` of the most recent write absorbed into this gesture. */
  lastWriteMs: number;
  /** Set when the pointer was released; starts the grace period. */
  releasedAtMs?: number;
}

/**
 * What the caller should do with a write.
 *
 *  - `'push'` — open a new entry (this write starts a gesture, or is discrete).
 *  - `'replace'` — absorb into the open entry; the stored PRE-gesture state is
 *    kept and only the label/anchor are refreshed (`history.ts`'s `replaceEntry`).
 */
export type CoalesceDecision = 'push' | 'replace';

export interface CoalesceResult {
  decision: CoalesceDecision;
  /** The gesture state to carry forward. `null` closes it. */
  open: OpenGesture | null;
}

/**
 * Decides how one write should be recorded.
 *
 * `key` is `undefined` for a discrete action — a button, a toggle, a drag commit,
 * Apply Sync. Those always push and always close any open gesture, which is what
 * stops an unrelated click from being swallowed into a slider's entry.
 */
export function coalesceWrite(args: {
  open: OpenGesture | null;
  key?: string;
  kind?: CoalesceClass;
  nowMs: number;
}): CoalesceResult {
  const { open, key, kind = 'discrete', nowMs } = args;

  // Discrete: never coalesced, and closes whatever was open.
  if (!key || kind === 'discrete') {
    return { decision: 'push', open: null };
  }

  if (open && open.key === key && !isExpired(open, nowMs)) {
    // Same gesture, still live. Absorb.
    return {
      decision: 'replace',
      open: { ...open, lastWriteMs: nowMs },
    };
  }

  // A DIFFERENT key, or the same key after its window closed, starts a new
  // entry. Keying on the target as well as the control is what makes "drag
  // brightness on segment 5, then on segment 9" two entries rather than one.
  return {
    decision: 'push',
    open: { key, kind, lastWriteMs: nowMs },
  };
}

/** True once an open gesture can no longer absorb writes. */
export function isExpired(open: OpenGesture, nowMs: number): boolean {
  if (open.kind === 'slider') {
    // A slider is bounded by its release, not by idleness — a user may hold the
    // handle still for a long time mid-gesture and that is still one gesture.
    if (open.releasedAtMs === undefined) return false;
    return nowMs - open.releasedAtMs > SLIDER_RELEASE_GRACE_MS;
  }
  // Text: idle-bounded.
  return nowMs - open.lastWriteMs > TEXT_IDLE_MS;
}

/**
 * Records that the pointer was released, starting a slider's grace period.
 *
 * A no-op for a text gesture (no pointer involved) and when nothing is open.
 * Deliberately does NOT close the gesture immediately — see `graceMs` in this
 * file's header for the trailing-debounced-write problem that would cause.
 */
export function notePointerUp(
  open: OpenGesture | null,
  nowMs: number,
): OpenGesture | null {
  if (!open || open.kind !== 'slider') return open;
  if (open.releasedAtMs !== undefined) return open;
  return { ...open, releasedAtMs: nowMs };
}

/**
 * Closes an open gesture unconditionally — a text field's `blur`, or any moment
 * the caller knows the gesture is over (the active segment changed, a modal
 * opened, the project switched).
 */
export function closeGesture(): OpenGesture | null {
  return null;
}
