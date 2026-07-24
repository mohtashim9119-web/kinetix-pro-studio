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

  // Step 1: protect bracket tags before any destructive operation.
  // Bare-tag format: any `[...]` bracket is a real scene tag now (not just
  // the legacy [IMAGE:]/[VIDEO:]/[AUDIO:] keyword tags), so shield every
  // bracket from the RTF char-walk.
  const placeholders: string[] = [];
  let protected_ = text.replace(/\[[^\]\n]*\]/g, (match) => {
    placeholders.push(match);
    return `__BRACKET_${placeholders.length - 1}__`;
  });

  // Step 2: walk characters to remove RTF groups by depth
  // We keep only text-run content (chars outside groups or in plain-text positions)
  //
  // RTF nests non-document metadata (font table, color table, stylesheet,
  // document info, etc.) inside their own brace groups — "destination
  // groups" — which the generic `depth >= 1` check cannot distinguish from
  // the real document body. `skipDepth` tracks the depth at which a
  // destination group was entered; while non-null, no text (including
  // paragraph/line-break control words) is emitted, and it is cleared once
  // `depth` falls back below it (the group's matching closing brace).
  const DESTINATION_WORDS = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    'object',
    'fldinst',
    'data',
    'themedata',
    'colorschememapping',
  ]);

  let result = '';
  let depth = 0;
  let skipDepth: number | null = null;
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
      if (skipDepth !== null && depth < skipDepth) {
        skipDepth = null;
      }
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
        // \* marks the enclosing group as an optional/ignorable destination
        // (e.g. `{\*\generator ...}`) — skip its entire subtree.
        if (next === '*') {
          if (skipDepth === null) skipDepth = depth;
        } else if (next === '\n' || next === '\r') {
          // \n and \r are not RTF escapes, treat as literal — keep the newline
          if (skipDepth === null) result += '\n';
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

      const lc = word.toLowerCase();

      // destination control word — the group it opens (this control word's
      // own depth) must be skipped entirely, unless already inside a
      // skipped group.
      if (DESTINATION_WORDS.has(lc)) {
        if (skipDepth === null) skipDepth = depth;
        continue;
      }

      // convert paragraph/line breaks to newlines (never inside a skipped
      // destination group)
      if (skipDepth === null) {
        if (lc === 'par' || lc === 'pard' || lc === 'sect') {
          result += '\n\n';
        } else if (lc === 'line' || lc === 'tab') {
          result += '\n';
        }
      }
      // all other control words: skip
      continue;
    }

    // plain character — only emit if we're inside the outermost group
    // (depth >= 1) and not inside a skipped destination group
    if (depth >= 1 && skipDepth === null) {
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

  // Step 5b: remove everything before the first bracket tag. RTF font/color
  // table remnants leak as plain text before the first real scene block, and
  // under the bare-tag format the first tag may be a bare `[filename]` with
  // no IMAGE/VIDEO/AUDIO keyword — so slice at the first complete `[...]`
  // bracket pair, whatever kind of tag it is. This is the fix for the "RTF
  // header junk merged onto segment 1's tag line" bug.
  const firstTagIndex = result.search(/\[[^\]\n]*\]/);
  if (firstTagIndex > 0) {
    result = result.slice(firstTagIndex);
  }

  // Step 6: remove lines that are only RTF noise
  const lines = result.split('\n').filter(line => {
    if (!line.trim()) return true;
    if (/^\d+$/.test(line.trim())) return false;
    if (line.trim().length <= 1) return false;
    if (/^[;,.\s]+$/.test(line.trim())) return false;
    return true;
  });

  return lines.join('\n').trim();
}

/**
 * Determines whether a text file is a voiceover script or a scene-details file
 * by counting bracket asset tags. Requires pre-stripped (plain text) content.
 *
 * A file with ≥ 3 asset tags is almost certainly a scene-details file;
 * everything else is treated as a voiceover script.
 *
 * Under the bare-tag format an asset tag is any `[...]` bracket (bare
 * `[filename]` or the legacy `[IMAGE:]`/`[VIDEO:]`/`[AUDIO:]` keyword form).
 * `[HEADING:...]` tags count the same as any other bracket tag — headings are
 * no longer a distinct structural marker (Path B Decision 6); the keyword is
 * ignored and the remainder is treated as an ordinary asset tag.
 */
export function detectTextFileRole(
  strippedContent: string,
): 'script' | 'sceneDetails' {
  const bracketMatches = (strippedContent.match(/\[[^\]\n]*\]/g) ?? []).length;
  return bracketMatches >= 3 ? 'sceneDetails' : 'script';
}
