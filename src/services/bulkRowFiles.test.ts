/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk UI rebuild U4 — a row's files: replace or delete each one, replace-all
// or delete-all. Every file is staged under ITS row's project id (the 1.2.2
// owner rule): nothing done to one row ever reaches another.

import { describe, it, expect } from 'vitest';
import { BulkRowStore, type BulkRowDeps } from './bulkRows';
import { classifyAndIngestBundleZip } from './bundleIngest';
import type { StagedFiles } from '../components/DropZonePanel';

function fakeDeps(): { deps: BulkRowDeps; staged: Map<string, StagedFiles>; writes: string[] } {
  const staged = new Map<string, StagedFiles>();
  const writes: string[] = [];
  const deps: BulkRowDeps = {
    loadStaged: async id => staged.get(id) ?? null,
    writeStaged: async (id, _prev, next) => { writes.push(id); staged.set(id, next); },
    createProject: async () => true,
    purge: async id => { writes.push(id); staged.delete(id); },
    removeBundleAsset: async () => {},
    hashAudio: async () => 'h',
    probeDuration: async () => 1,
    cloudActive: () => false,
    stageAudio: async () => ({}),
    ingestBundle: classifyAndIngestBundleZip,
  };
  return { deps, staged, writes };
}
const four = (tag: string): File[] => [
  new File([`script ${tag}`], `script-${tag}.txt`), new File(['[a] x\n[b] y\n[c] z'], `scene-${tag}.txt`),
  new File([`vo ${tag}`], `vo-${tag}.wav`), new File(['i'], `img-${tag}.png`),
];
const names = (s: BulkRowStore, i: number): string[] => s.snapshot()[i]!.files.map(f => f.name);

describe('bulk row files', () => {
  it('replacing ONE file swaps it in its own slot and leaves the rest', async () => {
    const { deps, staged } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [id] = store.createDrafts(2);
    await store.addFiles(id!, four('a'));
    // A plain line of text would classify as a script; replacing the SCENE slot keeps it there.
    await store.replaceFile(id!, 'scene', new File(['[x] new'], 'scene-new.txt'));
    expect(names(store, 0)).toEqual(['script-a.txt', 'scene-new.txt', 'vo-a.wav', 'img-a.png']);
    expect(await staged.get(id!)!.sceneFile!.file.text()).toBe('[x] new');
    await store.replaceFile(id!, 'voiceover', new File(['vo2'], 'vo-new.wav'));
    expect(names(store, 0)).toContain('vo-new.wav');
    expect(names(store, 0)).not.toContain('vo-a.wav');
    const media = store.snapshot()[0]!.files.find(f => f.kind === 'media')!;
    await store.replaceFile(id!, media.id, new File(['j'], 'img-new.png'));
    expect(names(store, 0)).toEqual(['script-a.txt', 'scene-new.txt', 'vo-new.wav', 'img-new.png']);
  });

  it('replace-all swaps every file for the new set; delete-all empties the row and keeps its name', async () => {
    const { deps } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [id] = store.createDrafts(2);
    store.setTypedName(id!, 'Keep');
    await store.addFiles(id!, four('a'));
    await store.replaceAll(id!, four('b'));
    expect(names(store, 0)).toEqual(['script-b.txt', 'scene-b.txt', 'vo-b.wav', 'img-b.png']);
    await store.clearFiles(id!);
    expect(store.snapshot()[0]!.files).toEqual([]);
    expect(store.snapshot()[0]!.typedName).toBe('Keep');
  });

  it('nothing leaks between projects: every write is stamped with its own row id, and row B never sees row A\'s files', async () => {
    const { deps, staged, writes } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [a, b] = store.createDrafts(2);
    await store.addFiles(a!, four('a'));
    await store.addFiles(b!, four('b'));
    writes.length = 0;
    await store.replaceFile(a!, 'script', new File(['s2'], 'script-a2.txt'));
    await store.replaceAll(a!, four('a3'));
    await store.clearFiles(a!);
    expect(new Set(writes)).toEqual(new Set([a]));
    expect(names(store, 1)).toEqual(['script-b.txt', 'scene-b.txt', 'vo-b.wav', 'img-b.png']);
    expect(await staged.get(b!)!.scriptFile!.file.text()).toBe('script b');
  });

  it('F2: replace/delete stay allowed after Build Timeline until the first successful finish', async () => {
    const { deps, staged } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [id] = store.createDrafts(1);
    await store.addFiles(id!, four('a'));
    store.setTypedName(id!, 'Harbour');
    await store.buildReady();
    expect(store.snapshot()[0]!.built).toBe(true);
    expect(store.snapshot()[0]!.sealed).toBe(false);
    await store.replaceFile(id!, 'script', new File(['new script'], 'script-new.txt'));
    expect(names(store, 0)[0]).toBe('script-new.txt');
    expect(await staged.get(id!)!.scriptFile!.file.text()).toBe('new script');
    await store.removeFile(id!, 'voiceover');
    expect(store.snapshot()[0]!.slots.voiceover).toBe(false);
  });

  it('F2: a successfully finished row is sealed — replace/delete become no-ops', async () => {
    const { deps, staged } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [id] = store.createDrafts(1);
    await store.addFiles(id!, four('a'));
    store.setTypedName(id!, 'Harbour');
    await store.buildReady();
    store.syncBuilt([{ id: id!, name: 'Harbour', phase: 'done' }]);
    expect(store.snapshot()[0]!.sealed).toBe(true);
    const before = names(store, 0);
    await store.replaceFile(id!, 'script', new File(['nope'], 'x.txt'));
    await store.removeFile(id!, 'voiceover');
    expect(names(store, 0)).toEqual(before);
    expect(await staged.get(id!)!.scriptFile!.file.text()).toBe('script a');
  });

  it('a cancelled row is not sealed: replace/delete still work', async () => {
    const { deps, staged } = fakeDeps();
    const store = new BulkRowStore(deps);
    const [id] = store.createDrafts(1);
    await store.addFiles(id!, four('a'));
    store.setTypedName(id!, 'Harbour');
    await store.buildReady();
    store.syncBuilt([{ id: id!, name: 'Harbour', phase: 'cancelled' }]);
    expect(store.snapshot()[0]!.sealed).toBe(false);
    await store.replaceFile(id!, 'script', new File(['new script'], 'script-new.txt'));
    expect(names(store, 0)[0]).toBe('script-new.txt');
    expect(await staged.get(id!)!.scriptFile!.file.text()).toBe('new script');
  });
});
