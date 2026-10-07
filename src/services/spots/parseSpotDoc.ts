/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parses a Layer-2 doc: the same `[tag]` + text shape as the main scene doc
 * (a tag opens a block; its text may follow inline or on later lines). Anything
 * handed to the dedicated Layer-2 field IS layer 2 — no detection here, only
 * honest per-block errors. In a Layer-2 block the tag names the MAIN scene it
 * attaches to and the body optionally names the clip. No end time exists.
 */

export interface SpotDocBlock {
  index: number;
  tag: string;
  /** Clip name (joined body lines), '' when none. */
  body: string;
}

export interface SpotDocError {
  /** 0-based block index, or -1 for text before the first tag / a tagless doc. */
  index: number;
  reason: 'text-before-first-tag' | 'empty-tag' | 'no-tags';
  message: string;
}

export function parseSpotDoc(text: string): { blocks: SpotDocBlock[]; errors: SpotDocError[] } {
  const blocks: SpotDocBlock[] = [];
  const errors: SpotDocError[] = [];
  if (!/\[[^\]]*\]/.test(text)) {
    return {
      blocks,
      errors: [{ index: -1, reason: 'no-tags', message: 'No [tag] blocks found — a Layer-2 doc needs at least one [scene-tag].' }],
    };
  }
  const parts = text.split(/(?=\[[^\]]*\])/).filter(p => p.trim() !== '');
  let seen = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    const m = trimmed.match(/^\[([^\]]*)\]/);
    if (!m) {
      errors.push({
        index: -1,
        reason: 'text-before-first-tag',
        message: `Text before the first [tag] was ignored: "${trimmed.slice(0, 40)}"`,
      });
      continue;
    }
    const index = seen++;
    const tag = m[1]!.trim();
    if (!tag) {
      errors.push({ index, reason: 'empty-tag', message: `Block ${index + 1} has an empty [] tag — skipped.` });
      continue;
    }
    const body = trimmed
      .slice(m[0].length)
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .join(' ');
    blocks.push({ index, tag, body });
  }
  return { blocks, errors };
}
