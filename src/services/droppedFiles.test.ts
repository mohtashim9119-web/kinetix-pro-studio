/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { collectDroppedFiles } from './droppedFiles';

const file = (n: string) => new File(['x'], n);
const fileEntry = (f: File) => ({ isFile: true, isDirectory: false, name: f.name, file: (ok: (f: File) => void) => ok(f) });
function dirEntry(name: string, children: unknown[]) {
  let served = false;
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => ({
      readEntries: (ok: (e: unknown[]) => void) => { if (served) ok([]); else { served = true; ok(children); } },
    }),
  };
}
const dt = (entries: unknown[], files: File[] = []) => ({
  files,
  items: entries.map(e => ({ webkitGetAsEntry: () => e })),
}) as unknown as DataTransfer;

describe('collectDroppedFiles', () => {
  it('walks a dropped folder (nested) into its files, alongside loose files and zips', async () => {
    const a = file('a.png'); const b = file('b.mp4'); const z = file('p.zip'); const c = file('c.jpg');
    const out = await collectDroppedFiles(dt([
      fileEntry(a), dirEntry('shots', [fileEntry(b), dirEntry('deep', [fileEntry(c)])]), fileEntry(z),
    ]));
    expect(out.map(f => f.name)).toEqual(['a.png', 'b.mp4', 'c.jpg', 'p.zip']);
  });

  it('OLD BUG: flat `files` lists a folder as an empty pseudo-file — no directory walk, no contents', async () => {
    const pseudo = file('shots');
    const out = await collectDroppedFiles({ files: [pseudo], items: [] } as unknown as DataTransfer);
    expect(out).toEqual([pseudo]); // fallback path unchanged when entries are unavailable
  });

  it('with no directories among the items, the flat file list is used as-is', async () => {
    const a = file('a.png');
    expect(await collectDroppedFiles(dt([fileEntry(a)], [a]))).toEqual([a]);
  });
});
