/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Distinguishes a blocked sidecar from a missing or unreadable voiceover. */
export type VoiceoverReadKind = 'sidecar-blocked' | 'file-missing' | 'decode-failed';

export function classifyVoiceoverReadCause(detail: string): VoiceoverReadKind {
  const t = detail.toLowerCase();
  if (
    t.includes('outside allowed install/dev roots')
    || t.includes('sidecar:')
    || t.includes('sidecar lookup')
    || t.includes('ffmpeg sidecar')
  ) {
    return 'sidecar-blocked';
  }
  if (
    t.includes('enoent')
    || t.includes('not found')
    || t.includes('no such file')
    || t.includes('the object can not be found')
  ) {
    return 'file-missing';
  }
  return 'decode-failed';
}

export function voiceoverReadSkipReason(kind: VoiceoverReadKind, detail?: string): string {
  const tail = detail?.trim() ? ` (${detail.trim()})` : '';
  if (kind === 'sidecar-blocked') {
    return `sidecar-blocked: ffmpeg could not run from this install path${tail}`;
  }
  if (kind === 'file-missing') {
    return `file-missing: the voiceover file could not be found${tail}`;
  }
  return `decode-failed: the voiceover could not be decoded${tail}`;
}

export function voiceoverReadSkipFromError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return voiceoverReadSkipReason(classifyVoiceoverReadCause(detail), detail);
}
