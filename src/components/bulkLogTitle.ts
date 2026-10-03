/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Last-row log titles: a short fitted head when the full line would overflow.
// Short lines stay as-is. Full text is for the existing status popover.

const MAX = 28;

export function shortLogTitle(text: string, maxChars: number = MAX): { title: string; truncated: boolean } {
  const t = text.trim();
  if (t.length <= maxChars) return { title: t, truncated: false };

  if (/^paused\b/i.test(t)) return { title: 'Paused — inference', truncated: true };
  if (/^failed\b/i.test(t)) return { title: 'Failed — Retry', truncated: true };
  if (/^cancelled\b/i.test(t)) return { title: 'Cancelled', truncated: true };
  if (/upload failed/i.test(t)) return { title: 'Upload failed', truncated: true };
  if (/^adding\b/i.test(t)) return { title: 'Adding files', truncated: true };
  if (/voiceover/i.test(t) && /upload/i.test(t)) return { title: 'Voiceover uploaded', truncated: true };
  if (/^ready\b/i.test(t)) return { title: 'Ready', truncated: true };

  return { title: t, truncated: false };
}
