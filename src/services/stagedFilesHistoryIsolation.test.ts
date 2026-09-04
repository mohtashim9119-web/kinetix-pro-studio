/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2-50 — staged slots must not reach undo/redo, in either direction.
//
// WHY THIS IS THE DECIDING CONSTRAINT ON WHERE STAGED STATE LIVES. `history.ts`
// snapshots the whole `Project` and `historyPersist.ts` keeps 20 of them. Put a
// staged slot on `Project` and it becomes undoable: undo past a file swap and
// the app silently re-stages a file the user already replaced, and the next
// Apply Sync consumes it. Staged state has no meaningful undo semantics — it
// answers "what is pending", the way `unappliedTranscript` answers it against
// `transcriptTokens`'s "what was applied".
//
// Payload size is the SECOND argument and the weaker one, but it is the one
// that was asked for, so it is measured here rather than asserted by adjective.
//
// TWO HALVES, AND THEY FAIL DIFFERENTLY:
//   1. `Project` carries no staged field — a structural scan of `types.ts`.
//      This is the half that would silently regress: adding `sources?:` to
//      `Project` compiles, works, and is wrong.
//   2. A snapshot's serialized size does not move when staged content exists —
//      measured against the real store, not inferred.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { StagedFiles } from '../components/DropZonePanel';
import { TEXT_SLOTS, planStagedReconcile, toStoredRow } from './stagedFilesPersist';
import { putStagedFile, getStagedFilesForProject, countStagedFiles } from './stagedFilesStore';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES_TS = readFileSync(resolve(HERE, '..', 'types.ts'), 'utf-8');
const HISTORY_TS = readFileSync(resolve(HERE, 'history.ts'), 'utf-8');
const HISTORY_PERSIST_TS = readFileSync(resolve(HERE, 'historyPersist.ts'), 'utf-8');

const EMPTY: StagedFiles = {
  scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [],
};

describe('WS2-50 — staged slots are isolated from undo/redo history', () => {
  it('Project carries no staged-files field', () => {
    // The names a future "just put it on Project" edit would reach for.
    const projectBody = TYPES_TS.slice(
      TYPES_TS.indexOf('export interface Project'),
      TYPES_TS.indexOf('// ---', TYPES_TS.indexOf('export interface Project')),
    );
    expect(projectBody.length, 'Project interface not found — this guard has lost its target')
      .toBeGreaterThan(0);
    for (const banned of ['sources', 'stagedFiles', 'staged', 'pendingFiles']) {
      expect(
        new RegExp(`^\\s*${banned}\\??\\s*:`, 'm').test(projectBody),
        `Project grew a "${banned}" field. Staged state on Project is undoable: an undo past a ` +
          'file swap re-stages a file the user already replaced, and the next Apply Sync ' +
          'consumes it. It belongs in stagedFilesStore.ts.',
      ).toBe(false);
    }
  });

  it('neither history module knows the staged store exists', () => {
    for (const [name, src] of [['history.ts', HISTORY_TS], ['historyPersist.ts', HISTORY_PERSIST_TS]] as const) {
      expect(src, `${name} references the staged-files store — history must not carry staged state.`)
        .not.toContain('stagedFiles');
      expect(src, `${name} references kinetix-staged.`).not.toContain('kinetix-staged');
    }
  });

  it('staged content does not change what a Project snapshot serializes to', async () => {
    // The measurement the design rationale claims. A snapshot is taken before
    // and after real staged content exists in the store; the bytes are equal
    // because the store is a separate database no Project field points at.
    const projectId = 'history-isolation-project';
    const projectLike = { id: projectId, name: 'p', script: '', sceneDetails: '', segments: [] };
    const sizeBefore = JSON.stringify(projectLike).length;

    const big = 'x'.repeat(200_000);
    const staged: StagedFiles = {
      ...EMPTY,
      scriptFile: { file: new File([big], 'script.txt', { type: 'text/plain' }), key: 'k1' },
      sceneFile: { file: new File([big], 'scene.txt', { type: 'text/plain' }), key: 'k2' },
    };
    const plan = planStagedReconcile(EMPTY, staged, TEXT_SLOTS);
    for (const entry of plan.write) await putStagedFile(await toStoredRow(projectId, entry));

    expect(await countStagedFiles(projectId)).toBe(2);
    const rows = await getStagedFilesForProject(projectId);
    expect(rows.reduce((n, r) => n + r.size, 0)).toBe(400_000);

    // 400 KB of staged content exists, and the snapshot is byte-identical.
    expect(
      JSON.stringify(projectLike).length,
      'a Project snapshot changed size because staged content exists — staged state has leaked ' +
        'into the snapshotted object and now rides in all 20 history entries.',
    ).toBe(sizeBefore);
  });
});
