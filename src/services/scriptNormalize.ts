/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whitespace/line-ending collapse ONLY (final-shape-mapping row B2) — the
 * normalization a script/scene-details text goes through before being
 * hashed into the sync spine (`spine.ts`).
 *
 * Deliberately narrower than `textNormalize.ts`'s `canonicalize` (lowercase
 * + apostrophe/contraction folding + punctuation strip + digit-to-word
 * expansion — built for the ALIGNER, not a change-detector) and narrower
 * even than that file's lighter `canonicalizeForFilename` (which also folds
 * smart quotes/dashes and strips zero-width characters). B2's own risk note
 * is explicit: over-normalizing — e.g. stripping punctuation — would make a
 * real script change look free. This collapses ONLY whitespace runs
 * (including line-ending differences, so a re-save under a different OS or
 * editor is recognized as "nothing changed") after NFC-normalizing the
 * Unicode form (two byte-different encodings of the same character are the
 * same content, not an edit). Any actual word, punctuation, or character
 * change still changes the hash.
 */
export function normalizeScriptForHash(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}
