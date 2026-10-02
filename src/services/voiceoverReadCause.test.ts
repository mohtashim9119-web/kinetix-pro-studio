/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  classifyVoiceoverReadCause,
  voiceoverReadSkipFromError,
  voiceoverReadSkipReason,
} from './voiceoverReadCause';

describe('voiceoverReadCause', () => {
  it('does not relabel a blocked sidecar as a corrupt file', () => {
    const detail = 'sidecar: resolved exe \\\\?\\D:\\DATA\\Kinetix Installed\\app.exe is outside allowed install/dev roots';
    expect(classifyVoiceoverReadCause(detail)).toBe('sidecar-blocked');
    expect(voiceoverReadSkipFromError(new Error(detail))).toMatch(/^sidecar-blocked:/);
    expect(voiceoverReadSkipFromError(new Error(detail))).not.toMatch(/Couldn.t read the voiceover/);
  });

  it('keeps file-missing and decode-failed distinct', () => {
    expect(classifyVoiceoverReadCause('ENOENT: no such file')).toBe('file-missing');
    expect(classifyVoiceoverReadCause('Invalid data found when processing input')).toBe('decode-failed');
    expect(voiceoverReadSkipReason('file-missing')).toMatch(/^file-missing:/);
    expect(voiceoverReadSkipReason('decode-failed')).toMatch(/^decode-failed:/);
  });
});
