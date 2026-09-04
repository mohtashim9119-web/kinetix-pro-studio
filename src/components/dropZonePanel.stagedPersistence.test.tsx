// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2-50 — staged slots survive DASHBOARD NAVIGATION and RELOAD, behaviourally.
//
// WHY THIS FILE IS A REAL MOUNT AND NOT A SOURCE SCAN. The other WS2-50 guards
// are scans, and they say so; this claim is the one where a scan would be
// worthless. "Survives navigation" is exactly a statement about unmount and
// remount — the thing a scan cannot observe — and the defect being prevented
// (DropZonePanel's staged state is `useState` local to a component that
// unmounts on App.tsx's `showDashboard` ternary) is invisible in the source of
// either file taken alone.
//
// A dashboard round trip and a page reload are the SAME event to this
// component: both destroy its React state and rebuild it from nothing. So one
// unmount/remount cycle tests both, and the reload half additionally drops the
// module-level caches, which a fresh store read covers by construction.
//
// WHAT THIS FILE CANNOT SEE, STATED SO ITS GREEN TICK DOES NOT OVERCLAIM.
// Under `jsdom`, `fake-indexeddb`'s structured clone reduces a `Blob` to a
// plain `{}` — measured directly, not assumed: a round-tripped value comes back
// with `constructor.name === 'Object'`, `instanceof Blob === false`, and no
// `.text()`. Under the repo's default plain-node environment the same store
// round-trips real `Blob` content, so BYTE-level fidelity is asserted in
// `stagedFilesPersist.test.ts` (node) and this file asserts only the WIRING:
// which slot comes back, under what name, with what `lastModified`, how many
// rows exist, and that projects stay separate. Neither file alone covers the
// feature; say which one you are reading.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { DropZonePanel, type StagedFiles } from './DropZonePanel';
import { TransitionType } from '../types';
import { countStagedFiles, deleteAllStagedForProject, getStagedFilesForProject } from '../services/stagedFilesStore';
import { ALL_PERSISTED_SLOTS, planStagedReconcile, toStoredRow } from '../services/stagedFilesPersist';
import { putStagedFile } from '../services/stagedFilesStore';

// React 19 requires this to be set before `act` will drive effects rather than
// warning and running them out of band.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DropZonePanelProps = ComponentProps<typeof DropZonePanel>;

function makeProps(overrides: Partial<DropZonePanelProps> = {}): DropZonePanelProps {
  const noop = () => {};
  return {
    projectId: 'staged-persistence-project',
    segments: [], headings: [], assets: [],
    onUndo: noop, onRedo: noop, canUndo: false, canRedo: false,
    voiceoverId: undefined, script: '',
    persistedScript: '', persistedScriptName: '', persistedScriptUpdatedAt: undefined,
    persistedSceneDetails: '', persistedSceneDetailsName: '', persistedSceneDetailsUpdatedAt: undefined,
    persistedVoiceoverName: '', persistedAssetCount: 0, isSynced: true,
    onClearScript: noop, onClearSceneDetails: noop,
    onDeleteAsset: noop, onDeleteAllAssets: noop, onDeleteVoiceover: noop,
    onApplySync: noop, onStagedFilesChange: noop, stagedFilesClearSignal: 0,
    onVoiceoverStaged: noop, onVoiceoverUnstaged: noop, applySyncDisabled: false,
    onVoiceoverRestored: () => true,
    onSegmentClick: noop, onToggleLock: noop, onLockAll: noop, onUnlockAll: noop,
    allLocked: false, onOpenReviewMapping: noop, onInsertHeading: noop,
    selectedSegmentId: undefined, currentSegmentId: undefined,
    selectedSegmentIds: new Set(), onToggleSegmentSelect: noop,
    onSelectAllSegments: noop, onClearSegmentSelection: noop, onApplyEffect: noop,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: 'none', globalOverlayFilter: 'none',
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    currentTransition: 'none', currentAnimation: 'none', currentOverlayFilter: 'none',
    currentOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    onTransitionChange: noop, onTransitionDurationChange: noop, onApplyTransitionToAll: noop,
    onAnimationChange: noop, onApplyAnimationToAll: noop, onFilterChange: noop,
    onApplyFilterToAll: noop, onOverlayConfigChange: noop,
    onApplyTransitionPreset: noop, onApplyAnimationPreset: noop,
    onApplyOverlayFilterPreset: noop, onApplyOverlayConfigPreset: noop,
    onBackToProjects: noop, projectName: 'Test Project', onRename: noop,
    activeLeftTab: 'files', onActiveLeftTabChange: noop, isPlaying: false,
    ...overrides,
  };
}

/** Mounts the panel and returns the last staged state it published, plus an
 *  unmount handle — this is App.tsx's `showDashboard` flip, in miniature. */
function mountPanel(props: Partial<DropZonePanelProps>): {
  root: Root;
  container: HTMLDivElement;
  published: () => StagedFiles | null;
  unmount: () => void;
} {
  let last: StagedFiles | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DropZonePanel
        {...makeProps({ ...props, onStagedFilesChange: (s: StagedFiles) => { last = s; } })}
      />,
    );
  });
  return {
    root,
    container,
    published: () => last,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

/** Lets the panel's async restore effect and its persist chain settle. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 25)); });
}

/** Drops a file onto a slot the way the user does, through the real handler. */
async function dropOnSlot(container: HTMLElement, slot: 'script' | 'scene', file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`#kx-file-${slot}`)
    ?? container.querySelector<HTMLInputElement>('input[type=file]');
  expect(input, `no file input found for the ${slot} slot`).not.toBeNull();
  Object.defineProperty(input!, 'files', { value: [file], configurable: true });
  await act(async () => {
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 25));
  });
}

const PROJECT = 'staged-persistence-project';

describe('WS2-50 — a staged slot survives a dashboard round trip and a reload', () => {
  beforeEach(async () => {
    await deleteAllStagedForProject(PROJECT);
  });

  it('the script slot comes back after unmount + remount', async () => {
    const first = mountPanel({ projectId: PROJECT });
    await settle();
    await dropOnSlot(first.container, 'script', new File(['SCRIPT BODY'], 'script.txt', {
      type: 'text/plain', lastModified: 1_700_000_000_000,
    }));
    const stagedBefore = first.published();
    expect(stagedBefore?.scriptFile?.file.name, 'the drop never reached staged state').toBe('script.txt');
    await settle();
    expect(await countStagedFiles(PROJECT)).toBe(1);

    // The dashboard flip: this component goes away entirely.
    first.unmount();

    const second = mountPanel({ projectId: PROJECT });
    await settle();
    const restored = second.published();
    expect(
      restored?.scriptFile?.file.name,
      'the script slot did not come back after a remount — this is the operator-reported ' +
        'defect: DropZonePanel’s staged state is local useState and the panel unmounts on the ' +
        'showDashboard ternary.',
    ).toBe('script.txt');
    // Bytes are NOT asserted here — see the header: jsdom's fake-indexeddb
    // clone drops Blob identity. `stagedFilesPersist.test.ts` asserts them.
    // The transcription cache key must survive the round trip, and does.
    expect(restored!.scriptFile!.file.lastModified).toBe(1_700_000_000_000);
    expect(restored!.scriptFile!.key).toBe(stagedBefore!.scriptFile!.key);
    second.unmount();
  });

  it('a remount neither duplicates nor REWRITES rows — restore is a read', async () => {
    // Row count alone cannot see this. The singleton slots address by kind, so
    // a restore that fed itself back through the reconciler would overwrite in
    // place and the count would stay 1 — a destructive probe (WS2-50 B10)
    // confirmed a count-only assertion stays green with the feedback loop
    // wired in. `stagedAt` is the observable that moves: a rewrite stamps a new
    // Date.now(), and on a large media blob that rewrite is the disk cost this
    // feature is not allowed to pay on every dashboard visit.
    const first = mountPanel({ projectId: PROJECT });
    await settle();
    await dropOnSlot(first.container, 'script', new File(['A'], 'script.txt', { type: 'text/plain' }));
    await settle();
    expect(await countStagedFiles(PROJECT)).toBe(1);
    const writtenAt = (await getStagedFilesForProject(PROJECT))[0]!.stagedAt;
    first.unmount();

    for (let i = 0; i < 3; i += 1) {
      const p = mountPanel({ projectId: PROJECT });
      await settle();
      p.unmount();
    }
    const rows = await getStagedFilesForProject(PROJECT);
    expect(
      rows.length,
      'remounting grew the row count — the restore is feeding itself back through the ' +
        'reconciler and every dashboard visit leaks a row.',
    ).toBe(1);
    expect(
      rows[0]!.stagedAt,
      'the restored row was rewritten on remount. The restore must be a pure read: feeding it ' +
        'back through the reconciler re-serialises every staged blob on every dashboard visit.',
    ).toBe(writtenAt);
  });

  it('a panel for a different project restores nothing', async () => {
    const first = mountPanel({ projectId: PROJECT });
    await settle();
    await dropOnSlot(first.container, 'script', new File(['A'], 'script.txt', { type: 'text/plain' }));
    await settle();
    first.unmount();

    const other = mountPanel({ projectId: 'a-different-project' });
    await settle();
    expect(other.published()?.scriptFile, 'staged slots leaked across projects').toBeFalsy();
    other.unmount();
    await deleteAllStagedForProject('a-different-project');
  });
});

// ---------------------------------------------------------------------------
// WS2-50 Commit 3 — the voiceover slot is OFFERED to the app, never assumed.
//
// Adoption runs App.tsx's `handleVoiceoverStaged`, whose only non-destructive
// branch is the same-file-with-cached-tokens early return. Every other branch
// clears `transcriptTokens` and launches whisper-cli, which on app load is an
// unrequested transcription that destroys the cache the recovery banner
// depends on. So the panel asks, and a refusal must leave NOTHING behind — not
// a populated-looking slot, and not a row that would re-offer the same file on
// every future mount.
// ---------------------------------------------------------------------------

const VO_PROJECT = 'staged-voiceover-project';

/** Seeds the store directly, standing in for "the user staged this before the
 *  reload" without needing the panel's audio-detection path. */
async function seedStaged(projectId: string, files: Partial<{
  script: File; scene: File; voiceover: File; asset: File; zip: File;
}>): Promise<void> {
  let n = 0;
  const mk = (f: File) => ({ file: f, key: `seed-${(n += 1)}` });
  const next = {
    scriptFile: files.script ? mk(files.script) : null,
    sceneFile: files.scene ? mk(files.scene) : null,
    voiceoverFile: files.voiceover ? mk(files.voiceover) : null,
    assetFiles: files.asset ? [mk(files.asset)] : [],
    zipFiles: files.zip ? [mk(files.zip)] : [],
  };
  const plan = planStagedReconcile(
    { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] },
    next,
    ALL_PERSISTED_SLOTS,
  );
  for (const e of plan.write) await putStagedFile(await toStoredRow(projectId, e));
}

describe('WS2-50 — a restored voiceover is offered, and a refusal leaves nothing', () => {
  beforeEach(async () => { await deleteAllStagedForProject(VO_PROJECT); });

  it('an ADOPTED voiceover is restored into the slot', async () => {
    await seedStaged(VO_PROJECT, {
      voiceover: new File(['AUDIO'], 'vo.m4a', { type: 'audio/mp4', lastModified: 42 }),
    });
    const offered: string[] = [];
    const panel = mountPanel({
      projectId: VO_PROJECT,
      onVoiceoverRestored: (f: File) => { offered.push(f.name); return true; },
    });
    await settle();
    expect(offered, 'the panel never offered the restored voiceover to the app').toEqual(['vo.m4a']);
    expect(panel.published()?.voiceoverFile?.file.name).toBe('vo.m4a');
    expect(await countStagedFiles(VO_PROJECT)).toBe(1);
    panel.unmount();
  });

  it('a REFUSED voiceover leaves the slot empty AND deletes its row', async () => {
    // The row must go too. Leaving it would re-offer the same unusable file on
    // every future mount, and would keep bytes on disk for a slot the user is
    // never shown.
    await seedStaged(VO_PROJECT, {
      voiceover: new File(['AUDIO'], 'vo.m4a', { type: 'audio/mp4', lastModified: 42 }),
      script: new File(['S'], 'script.txt', { type: 'text/plain' }),
    });
    expect(await countStagedFiles(VO_PROJECT)).toBe(2);
    const panel = mountPanel({
      projectId: VO_PROJECT,
      onVoiceoverRestored: () => false,
    });
    await settle();
    expect(
      panel.published()?.voiceoverFile,
      'a refused voiceover was restored into the slot anyway — it would look staged and fail ' +
        'on use, or start an unrequested transcription.',
    ).toBeNull();
    // The other slots are unaffected: a refusal is scoped to the voiceover.
    expect(panel.published()?.scriptFile?.file.name).toBe('script.txt');
    const rows = await getStagedFilesForProject(VO_PROJECT);
    expect(
      rows.map(r => r.slotKey),
      'the refused voiceover row survived — it will be re-offered on every mount.',
    ).toEqual(['script']);
    panel.unmount();
  });

  it('media and zip slots restore alongside the text slots', async () => {
    await seedStaged(VO_PROJECT, {
      script: new File(['S'], 'script.txt', { type: 'text/plain' }),
      asset: new File(['IMG'], 'a.png', { type: 'image/png' }),
      zip: new File(['ZIP'], 'pack.zip', { type: 'application/zip' }),
    });
    const panel = mountPanel({ projectId: VO_PROJECT, onVoiceoverRestored: () => true });
    await settle();
    const p = panel.published();
    expect(p?.scriptFile?.file.name).toBe('script.txt');
    expect(p?.assetFiles.map(f => f.file.name)).toEqual(['a.png']);
    expect(p?.zipFiles.map(f => f.file.name)).toEqual(['pack.zip']);
    expect(await countStagedFiles(VO_PROJECT)).toBe(3);
    panel.unmount();
  });
});
