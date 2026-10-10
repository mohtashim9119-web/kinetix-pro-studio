/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The export cancel path tears the ffmpeg session down fire-and-forget (the
// cancel button is synchronous). In a bulk queue the NEXT row's start must not
// overlap that teardown: it would race the old session's kill/destroy against
// the new export's own ffmpeg. Every teardown registers here; the next start
// awaits the latch before launching. Module-level, like the engine's
// `activeFfmpeg` it protects.

let pending: Promise<void> = Promise.resolve();

/** Registers an in-flight teardown. Never rejects into the latch. */
export function trackExportTeardown(teardown: Promise<unknown>): void {
  const settled = teardown.then(() => undefined, () => undefined);
  pending = Promise.all([pending, settled]).then(() => undefined);
}

/** Resolves once every teardown registered so far has settled. */
export function awaitExportTeardown(): Promise<void> {
  return pending;
}
