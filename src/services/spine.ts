/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeScriptForHash } from './scriptNormalize';

/**
 * Content-hash spine (plan-v3 Wave 2 item 4 / final-shape-mapping row H3) —
 * the two-part cache key that replaces the volatile `name|size|lastModified`
 * triple (`syncEngine.ts`'s `getFileIdentity`, demoted to a fast pre-filter
 * only — see its own doc comment) as the AUTHORITATIVE answer to "has the
 * audio or script actually changed since the last sync". `audioHash` keys
 * the transcript; `audioHash + scriptHash` together key the alignment.
 *
 * Named `SyncSpine`, not `Spine`, to stay unambiguous next to
 * `whisperService.ts`'s unrelated `SpineNode` (the trusted-alignment-
 * confidence mechanism, WS2 Step 5 Bug 1) — same vocabulary, different
 * concept.
 */
export interface SyncSpine {
  audioHash: string;
  scriptHash: string;
  /** G2 close-out FIX 1 — which sync engine a fresh run would actually take
   *  (and, for FA, whether the pack was ready), from `faPreflight.ts`'s
   *  `computeSyncEngineKey`. Optional so a spine stamped before this field
   *  existed still round-trips; an absent value can only ever compare
   *  UNEQUAL to a freshly computed key (never silently treated as a match),
   *  which is this gate's existing safe default — see `spineEquals`. */
  engineKey?: string;
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 of a File's bytes, hex-encoded.
 *
 * Runs via the browser's native Web Crypto implementation
 * (`crypto.subtle.digest`), which computes off the JS main thread — A5's
 * stated risk ("hashing a 30-min file on the main thread would freeze the
 * UI — must hash in Rust or a worker") is satisfied without a new Tauri IPC
 * command or a hand-rolled Worker: `file.arrayBuffer()` reads the bytes into
 * memory once, the same cost `whisper_stage_audio_raw`'s raw-IPC-body send
 * already pays for this exact file one call later, and the digest itself
 * runs in the browser's native crypto backend, not in JS.
 */
export async function computeAudioHash(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/** SHA-256 of a UTF-8 string, hex-encoded. */
async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/**
 * The alignment half of the spine: `normalizeScriptForHash`-normalized
 * script + scene-details text, hashed together. Both feed
 * `parseProjectData` (scene tags/headings live inside `sceneDetails`, not in
 * a separate field — see `syncEngine.ts`'s heading-keyword strip), so either
 * changing invalidates the alignment. Length-prefixed before hashing (rather
 * than joined with a separator character) so `("ab", "c")` and `("a", "bc")`
 * can never collide — no character, printable or control, needs to be ruled
 * out of the normalized text.
 */
export async function computeScriptHash(scriptText: string, sceneText: string): Promise<string> {
  const normalizedScript = normalizeScriptForHash(scriptText);
  const normalizedScene = normalizeScriptForHash(sceneText);
  const normalized = `${normalizedScript.length}:${normalizedScript}|${normalizedScene}`;
  return hashText(normalized);
}

/** True only when audio, script, AND engine state all match — a partial
 *  match (e.g. the audio is the same but the script changed, or the engine
 *  toggle was flipped) is a real change, not a hit. `engineKey` compares by
 *  plain equality like the two hashes: an absent value (a spine stamped
 *  before FIX 1) can only ever mismatch a freshly computed key, never be
 *  treated as a match by omission. */
export function spineEquals(a: SyncSpine | null | undefined, b: SyncSpine | null | undefined): boolean {
  if (!a || !b) return false;
  return a.audioHash === b.audioHash && a.scriptHash === b.scriptHash && a.engineKey === b.engineKey;
}
