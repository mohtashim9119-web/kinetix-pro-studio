// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Bulk finish cross-write (v1.2.1, operator report): every bulk record ended
// with ROW 1's content. Bulk finish switches project → project INSIDE the
// editor, so this panel never unmounts between rows (only the dashboard
// unmounts it). Its restore effect then saw a non-empty staged set — the
// PREVIOUS project's files — and skipped the new project's own rows ("never
// clobber"), so Build Timeline read row 1's script, scene doc and voiceover
// for rows 2 and 3.
//
// The panel's staged state belongs to ONE project. A projectId change while
// mounted must publish that project's own rows and nothing of the previous one.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DropZonePanel, type StagedFiles } from './DropZonePanel';
import { makeProps } from './dropZonePanelTestProps';
import { deleteAllStagedForProject, getStagedFilesForProject, putStagedFile } from '../services/stagedFilesStore';
import { ALL_PERSISTED_SLOTS, planStagedReconcile, toStoredRow } from '../services/stagedFilesPersist';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'bulk-row-a';
const B = 'bulk-row-b';

async function seed(projectId: string, tag: string): Promise<void> {
  const next: StagedFiles = {
    scriptFile: { file: new File([`script ${tag}`], `script-${tag}.txt`, { type: 'text/plain' }), key: `s-${tag}` },
    sceneFile: { file: new File([`[Scene 1] ${tag}`], `scenes-${tag}.txt`, { type: 'text/plain' }), key: `c-${tag}` },
    voiceoverFile: { file: new File([`audio ${tag}`], `vo-${tag}.m4a`, { type: 'audio/mp4' }), key: `v-${tag}` },
    assetFiles: [],
    zipFiles: [],
  };
  const empty: StagedFiles = { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] };
  for (const e of planStagedReconcile(empty, next, ALL_PERSISTED_SLOTS).write) {
    await putStagedFile(await toStoredRow(projectId, e));
  }
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}

describe('bulk finish — the staged set follows the project, editor → editor', () => {
  beforeEach(async () => {
    await deleteAllStagedForProject(A);
    await deleteAllStagedForProject(B);
    await seed(A, 'A');
    await seed(B, 'B');
  });

  it('a projectId change while mounted publishes the NEW project’s own staged files', async () => {
    const published: StagedFiles[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (projectId: string) => root.render(
      <DropZonePanel {...makeProps({ projectId, onStagedFilesChange: (s: StagedFiles) => { published.push(s); } })} />,
    );

    act(() => { render(A); });
    await settle();
    expect(published.at(-1)?.scriptFile?.file.name).toBe('script-A.txt');

    // Bulk finish's switch: same mounted panel, new project.
    act(() => { render(B); });
    await settle();
    const last = published.at(-1)!;
    expect(
      [last.scriptFile?.file.name, last.sceneFile?.file.name, last.voiceoverFile?.file.name],
      'after an in-editor switch to B the panel still serves A’s staged files — Build Timeline ' +
        'for B reads A’s script, scene doc and voiceover (the bulk cross-write).',
    ).toEqual(['script-B.txt', 'scenes-B.txt', 'vo-B.m4a']);
    // And nothing of A ever leaks into B's persisted slots.
    const rowsB = await getStagedFilesForProject(B);
    expect(rowsB.map(r => r.name).sort()).toEqual(['scenes-B.txt', 'script-B.txt', 'vo-B.m4a']);

    act(() => { root.unmount(); });
    container.remove();
  });
});
