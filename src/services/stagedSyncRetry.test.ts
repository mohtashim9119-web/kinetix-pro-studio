// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { EMPTY_STAGED } from '../components/DropZonePanel';
import type { StagedFiles } from '../components/DropZonePanel';
import { ALL_PERSISTED_SLOTS, planStagedReconcile, toStoredRow } from './stagedFilesPersist';
import { deleteAllStagedForProject, putStagedFile } from './stagedFilesStore';
import { ensureStagedSnapshotReady, STAGED_NOT_READY_FOR_RETRY_MESSAGE } from './stagedSyncRetry';

const PROJECT = 'staged-retry-hydrate-project';

describe('ensureStagedSnapshotReady', () => {
  beforeEach(async () => {
    await deleteAllStagedForProject(PROJECT);
  });

  it('hydrates an empty snapshot from IDB before retry proceeds', async () => {
    const voiceover = new File(['AUDIO'], 'vo.m4a', { type: 'audio/mp4', lastModified: 99 });
    const next: StagedFiles = {
      ...EMPTY_STAGED,
      voiceoverFile: { file: voiceover, key: 'seed-vo' },
    };
    const plan = planStagedReconcile(EMPTY_STAGED, next, ALL_PERSISTED_SLOTS);
    for (const entry of plan.write) {
      await putStagedFile(await toStoredRow(PROJECT, entry));
    }

    let published: StagedFiles | undefined;
    const result = await ensureStagedSnapshotReady(PROJECT, EMPTY_STAGED, (snap) => {
      published = snap;
    });

    expect(result).toEqual({ ready: true });
    expect(published!.voiceoverFile!.file.name).toBe('vo.m4a');
  });

  it('surfaces a visible error when the snapshot is still empty after restore', async () => {
    const result = await ensureStagedSnapshotReady(PROJECT, EMPTY_STAGED, () => {});
    expect(result).toEqual({ ready: false, message: STAGED_NOT_READY_FOR_RETRY_MESSAGE });
  });
});
