/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveZipImportVoiceoverId } from '../App';
import type { Asset } from '../types';

function audio(id: string, name: string): Asset {
  return { id, name, url: `blob:${id}`, type: 'audio' };
}

describe('resolveZipImportVoiceoverId — ZIP duplicate voiceover survivor', () => {
  it('returns the deduplicated survivor id when the zip audio was dropped by name collision', () => {
    const survivor = audio('survivor-id', 'vo.mp3');
    const dropped = audio('dropped-id', 'vo.mp3');
    const prevAssets = [survivor];
    const newAssets = [dropped];
    const allAssets = [...prevAssets]; // dedup removed dropped

    expect(resolveZipImportVoiceoverId(newAssets, allAssets, survivor.id)).toBe('survivor-id');
    expect(allAssets.some(a => a.id === 'dropped-id')).toBe(false);
  });

  it('returns the new zip audio id when it was not deduplicated away', () => {
    const fresh = audio('fresh-id', 'new-vo.mp3');
    const allAssets = [fresh];

    expect(resolveZipImportVoiceoverId([fresh], allAssets, undefined)).toBe('fresh-id');
  });

  it('keeps prev.voiceoverId when the zip contained no audio', () => {
    const survivor = audio('keep-me', 'vo.mp3');
    expect(resolveZipImportVoiceoverId([], [survivor], 'keep-me')).toBe('keep-me');
  });
});
