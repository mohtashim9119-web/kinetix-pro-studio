/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — a bulk row's staged files ARE the editor's staged rows: what
// the modal writes, a restart (or the project's own DropZone) restores
// byte-for-byte, and the delete contract still holds (no orphans).

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { StagedFiles } from '../components/DropZonePanel';
import { writeStagedDiff } from './bulkRows';
import { loadStagedFromStore } from './stagedFilesPersist';
import { countStagedFiles } from './stagedFilesStore';

const EMPTY: StagedFiles = { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] };
const sf = (name: string, body: string, key: string) => ({ file: new File([body], name), key });

describe('bulk row persistence', () => {
  it('rows survive a restart byte-for-byte and re-writing a slot leaves no orphan', async () => {
    const id = crypto.randomUUID();
    const first: StagedFiles = {
      scriptFile: sf('s.txt', 'script', 'k1'), sceneFile: sf('c.txt', '[a] x', 'k2'),
      voiceoverFile: sf('v.wav', 'audio-1', 'k3'), assetFiles: [sf('m.png', 'img', 'k4')], zipFiles: [],
    };
    await writeStagedDiff(id, EMPTY, first);
    expect(await countStagedFiles(id)).toBe(4);
    const restored = (await loadStagedFromStore(id))!;
    expect(await restored.voiceoverFile!.file.text()).toBe('audio-1');
    expect(await restored.scriptFile!.file.text()).toBe('script');
    expect(restored.assetFiles).toHaveLength(1);

    // A second drop replaces the voiceover: still four rows.
    const second: StagedFiles = { ...restored, voiceoverFile: sf('v2.wav', 'audio-2', 'k5') };
    await writeStagedDiff(id, restored, second);
    expect(await countStagedFiles(id)).toBe(4);
    expect(await (await loadStagedFromStore(id))!.voiceoverFile!.file.text()).toBe('audio-2');
  });
});
