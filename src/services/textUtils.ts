/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strips RTF control codes from text read from a .rtf file (or a .txt file
 * saved by macOS TextEdit which embeds RTF inside a .txt extension).
 *
 * Uses a character-walk parser instead of iterative regex group removal so
 * the outermost RTF brace pair is never consumed — the previous regex approach
 * matched `{[^{}]*}` across newlines and deleted all content in the final pass.
 */
export function stripRtfIfNeeded(text: string): string {
  if (!text.trimStart().startsWith('{\\rtf')) return text;

  // Step 1: protect bracket tags before any destructive operation
  const placeholders: string[] = [];
  let protected_ = text.replace(/\[(IMAGE|VIDEO|AUDIO):[^\]]*\]/gi, (match) => {
    placeholders.push(match);
    return `__BRACKET_${placeholders.length - 1}__`;
  });

  // Step 2: walk characters to remove RTF groups by depth
  // We keep only text-run content (chars outside groups or in plain-text positions)
  let result = '';
  let depth = 0;
  let i = 0;
  const len = protected_.length;

  while (i < len) {
    const ch = protected_[i];

    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }
    // RTF control word or symbol: \word or \<punctuation>
    if (ch === '\\') {
      i++;
      if (i >= len) break;
      const next = protected_[i]!;
      // control symbol (single non-alpha char)
      if (!/[a-zA-Z]/.test(next)) {
        // \n and \r are not RTF escapes, treat as literal
        if (next === '\n' || next === '\r') {
          // keep the newline
          result += '\n';
        }
        // all other control symbols: skip
        i++;
        continue;
      }
      // control word: \[a-zA-Z]+[-]?\d*
      let word = '';
      while (i < len && /[a-zA-Z]/.test(protected_[i]!)) {
        word += protected_[i++]!;
      }
      // optional numeric parameter
      if (i < len && (protected_[i]! === '-' || /\d/.test(protected_[i]!))) {
        while (i < len && /[\d-]/.test(protected_[i]!)) i++;
      }
      // optional trailing space (delimiter) — consume but do not emit
      if (i < len && protected_[i]! === ' ') i++;

      // convert paragraph/line breaks to newlines
      const lc = word.toLowerCase();
      if (lc === 'par' || lc === 'pard' || lc === 'sect') {
        result += '\n\n';
      } else if (lc === 'line' || lc === 'tab') {
        result += '\n';
      }
      // all other control words: skip
      continue;
    }

    // plain character — only emit if we're inside the outermost group (depth >= 1)
    if (depth >= 1) {
      result += ch;
    }
    i++;
  }

  // Step 3: restore bracket tags
  result = result.replace(/__BRACKET_(\d+)__/g, (_, idx) => placeholders[parseInt(idx, 10)] ?? '');

  // Step 4: normalize whitespace — collapse runs of spaces/tabs on each line
  result = result
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');

  // Step 5: collapse 3+ consecutive newlines to exactly two
  result = result.replace(/\n{3,}/g, '\n\n');

  // Step 6: remove lines that are only RTF noise (pure numbers, single chars, empty)
  const lines = result.split('\n').filter(line => {
    if (!line.trim()) return true; // keep blank lines (they separate blocks)
    if (/^\d+$/.test(line.trim())) return false; // pure numbers
    if (line.trim().length <= 1) return false; // single chars
    return true;
  });

  return lines.join('\n').trim();
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
