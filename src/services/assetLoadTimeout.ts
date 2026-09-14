/**
 * Bounded-time wrapper for asset resolution I/O (IndexedDB + native IPC).
 *
 * An unbounded wait on either store leaves the dashboard card spinner or the
 * cold-boot "Loading…" screen open forever — the Machine-1 recovery path
 * never mounts. Every caller that gates UX on asset bytes MUST use this (or
 * reject explicitly) so a stuck store resolves to "unresolved" rather than
 * an open promise.
 */

/** Long enough for a large library scan; short enough to never feel hung. */
export const ASSET_LOAD_TIMEOUT_MS = 30_000;

export class AssetLoadTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'AssetLoadTimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function withAssetLoadTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = ASSET_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AssetLoadTimeoutError(label, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
