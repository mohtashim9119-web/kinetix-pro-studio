/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 Step 10 — a Tauri `invoke()` rejection is not always an `Error`. When a
// `#[tauri::command]` returns `Result<T, E>` and errors, the JS-side promise
// rejects with `E` deserialized from JSON — for a struct/enum `E` (e.g.
// `FaError { kind, message }`), that is a plain object, not an `Error`
// instance and not a string. The naive `err instanceof Error ? err.message :
// String(err)` pattern used across this codebase silently discards that
// object's own `message` field: `String({...})` reads as the literal text
// "[object Object]", which is exactly what reached the Sync Log's FA FALLBACK
// entry (`error: [object Object]`) once Windows' missing onnxruntime made
// `fa_align_production` reject with `Err(FaError)` before ever emitting a
// `Channel<FaEvent>` event.
// ---------------------------------------------------------------------------

/**
 * Extracts a human-readable message from an `unknown` caught from a Tauri
 * `invoke()` call (or anything else that can reject with a non-`Error`
 * value). Prefers, in order: an `Error`'s own message, a raw string, an
 * object's own `message` field (the shape every serde-serialized Tauri
 * command error in this codebase uses), then a JSON dump as a last resort —
 * never the bare `String(err)` that collapses a plain object to
 * "[object Object]".
 */
export function describeInvokeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string' &&
    (err as { message: string }).message.length > 0
  ) {
    return (err as { message: string }).message;
  }
  try {
    // JSON.stringify(undefined) returns the value undefined, not a string —
    // fall through to String() so this function's return type is upheld.
    const dumped = JSON.stringify(err);
    return dumped !== undefined ? dumped : String(err);
  } catch {
    return String(err);
  }
}
