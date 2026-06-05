/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strips RTF control codes from text read from a .rtf file (or a .txt file
 * saved by macOS TextEdit which embeds RTF inside a .txt extension).
 *
 * Strategy:
 *  1. Normalize \par / \pard into double newlines BEFORE removing control words
 *     so that scene-block boundaries survive as the \n\n that parseProjectData
 *     splits on.
 *  2. Remove unicode escapes, hex escapes, remaining control words, control
 *     symbols, and bare braces.
 *  3. Collapse runs of spaces/tabs within a line but leave newlines alone.
 *  4. Collapse 3+ consecutive newlines → exactly 2 (preserves scene boundary).
 *  5. Trim each line, drop empty or purely-numeric lines within a block.
 */
export function stripRtfIfNeeded(text: string): string {
  if (!text.trimStart().startsWith('{\\rtf')) return text;

  let s = text;

  // Step 1: iteratively remove innermost {} groups
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/\{[^{}]*\}/g, '');
  }

  // Step 2: paragraph breaks → double newline
  s = s.replace(/\\pard?\b\s*/g, '\n\n');
  s = s.replace(/\\line\b\s?/g, '\n');

  // Step 3: remove carriage returns
  s = s.replace(/\r/g, '');

  // Step 4: remove control words
  s = s.replace(/\\[a-zA-Z]+\-?\d*\s?/g, '');

  // Step 5: remove control symbols
  s = s.replace(/\\[^a-zA-Z\n]/g, '');

  // Step 6: remove lone backslashes
  s = s.replace(/\\/g, '');

  // Step 7: remove remaining braces
  s = s.replace(/[{}]/g, '');

  // Step 8: collapse spaces/tabs within lines
  s = s.replace(/[ \t]+/g, ' ');

  // Step 9: trim each line
  s = s.split('\n').map((l: string) => l.trim()).join('\n');

  // Step 10: max 2 consecutive newlines
  s = s.replace(/\n{3,}/g, '\n\n');

  // Step 11: filter blocks
  const blocks = s.split('\n\n');
  const cleaned = blocks
    .map((b: string) => b.trim())
    .filter((b: string) => {
      if (b.length === 0) return false;
      if (/\[(IMAGE|VIDEO|AUDIO):/i.test(b)) return true;
      if (/[a-zA-Z]{2,}.*[a-zA-Z]{2,}/.test(b)) return true;
      return false;
    });

  return cleaned.join('\n\n').trim();
}

/**
 * Determines whether a text file is a voiceover script or a scene-details file
 * by counting bracket asset tags. Requires pre-stripped (plain text) content.
 *
 * A file with ≥ 3 [IMAGE:] / [VIDEO:] / [AUDIO:] tags is almost certainly a
 * scene-details file; everything else is treated as a voiceover script.
 */
export function detectTextFileRole(
  strippedContent: string,
): 'script' | 'sceneDetails' {
  const bracketMatches = (
    strippedContent.match(/\[(IMAGE|VIDEO|AUDIO):/gi) ?? []
  ).length;
  return bracketMatches >= 3 ? 'sceneDetails' : 'script';
}
