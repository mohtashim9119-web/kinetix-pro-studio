/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export's time-left and percent model. The engine reports 0–90 while it
// encodes, 93 while it muxes and packages, then 100. Two things used to stall:
//  - the ETA was frozen at the moment the run reached 5% (twenty times how long
//    that took), so a run slower or faster than its first seconds counted
//    down to "finishing…" and sat there;
//  - the mux tail (93 → 100) reports nothing in between, so the bar and the
//    clock stopped for as long as the mux took.
// Here the ETA is recomputed from the measured speed since 5%, and the mux tail
// is a bounded estimate (a fraction of how long encoding took, clamped) that
// the display moves through — never reaching 100 before the real 100.

/** Where the engine's own 0–90 encoding run ends. */
export const ENCODE_END_PCT = 90;
/** The engine's percent while it muxes and packages. */
export const MUX_PCT = 93;
/** The percent the modelled tail may creep toward (only the real 100 shows 100). */
export const MUX_TAIL_CEILING_PCT = 99;
export const MUX_TAIL_MIN_MS = 4_000;
export const MUX_TAIL_MAX_MS = 90_000;
/** Below this long since 5%, the measured speed is too noisy to trust yet. */
export const MIN_RATE_WINDOW_MS = 5_000;

export interface EtaLive {
  /** The engine's latest confirmed percent. */
  pct: number;
  /** Wall-clock ms when the engine first reported the mux stage. */
  muxAt?: number;
}

/** The bounded mux-tail estimate: the 90→100 share of the run, from how long
 *  encoding took, clamped so a tiny or enormous run never promises nonsense. */
export function muxTailMs(encodeMs: number): number {
  const share = (encodeMs * (100 - ENCODE_END_PCT)) / ENCODE_END_PCT;
  return Math.min(MUX_TAIL_MAX_MS, Math.max(MUX_TAIL_MIN_MS, share));
}

/**
 * Milliseconds left, or null before 5% (setup and warm-up skew early speed).
 * Without `live` it is the original frozen estimate. With it: the speed since
 * 5% (once there is a window to measure) projects the rest of the encode, plus
 * the bounded mux tail; during the mux the tail itself counts down.
 */
export function remainingMs(
  startedAt: number, reached5At: number | undefined, now: number, live?: EtaLive,
): number | null {
  if (reached5At === undefined) return null;
  const frozenTotal = (reached5At - startedAt) * 20;
  if (!live) return startedAt + frozenTotal - now;

  if (live.pct >= MUX_PCT && live.muxAt !== undefined) {
    const tail = muxTailMs(live.muxAt - startedAt);
    return tail - (now - live.muxAt);
  }

  const window = now - reached5At;
  const gained = live.pct - 5;
  let remainingEncode: number;
  if (window >= MIN_RATE_WINDOW_MS && gained > 0) {
    remainingEncode = (Math.max(0, ENCODE_END_PCT - live.pct) * window) / gained;
  } else {
    remainingEncode = Math.max(0, startedAt + frozenTotal - now - muxTailMs((reached5At - startedAt) * (ENCODE_END_PCT / 5)));
  }
  const encodeTotal = now - startedAt + remainingEncode;
  return remainingEncode + muxTailMs(encodeTotal);
}

/**
 * The percent the display should head for. Before the mux this is the engine's
 * own; during it the confirmed 93 would sit still, so the target eases along
 * the bounded tail estimate toward — never to — 99.
 */
export function displayTargetPct(startedAt: number, now: number, live: EtaLive): number {
  if (live.pct < MUX_PCT || live.pct >= 100 || live.muxAt === undefined) return live.pct;
  const tail = muxTailMs(live.muxAt - startedAt);
  const t = Math.min(1, Math.max(0, (now - live.muxAt) / tail));
  // Ease-out: most of the distance early, the last points arrive slowly.
  const eased = 1 - (1 - t) * (1 - t);
  return MUX_PCT + (MUX_TAIL_CEILING_PCT - 1 - MUX_PCT) * eased;
}
