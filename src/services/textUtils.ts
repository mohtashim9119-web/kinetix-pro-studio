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

  // Step 1: normalize RTF paragraph breaks → double newlines
  s = s.replace(/\\pard?[^\\{}\r\n]*/g, '\n\n');

  // Step 2: remove unicode escapes  \u-12345?
  s = s.replace(/\\u-?\d+\??/g, ' ');

  // Step 3: remove hex char escapes  \'XX
  s = s.replace(/\\\'[0-9a-fA-F]{2}/g, ' ');

  // Step 4: remove all remaining control words  \wordOptionalDigits
  s = s.replace(/\\[a-zA-Z]+\-?\d*\s?/g, ' ');

  // Step 5: remove control symbols  \* \~ etc.
  s = s.replace(/\\[^a-zA-Z\r\n]/g, ' ');

  // Step 6: remove bare curly braces left after group removal
  s = s.replace(/[{}]/g, ' ');

  // Step 7: collapse runs of spaces/tabs within a line (leave newlines intact)
  s = s.replace(/[ \t]{2,}/g, ' ');

  // Step 8: collapse 3+ consecutive newlines → exactly 2
  s = s.replace(/\n{3,}/g, '\n\n');

  // Step 9: trim each line
  s = s.split('\n').map(l => l.trim()).join('\n');

  // Step 10: within each double-newline block, drop empty or purely-numeric lines
  s = s
    .split('\n\n')
    .map(block =>
      block
        .split('\n')
        .filter(l => l.length > 0 && !/^\d+$/.test(l))
        .join('\n'),
    )
    .filter(block => block.trim().length > 0)
    .join('\n\n');

  return s.trim();
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
