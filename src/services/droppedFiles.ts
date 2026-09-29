/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — every File a drop carries, folders walked. A plain
// `dataTransfer.files` lists a dropped folder as one unreadable entry, so the
// entry API is used when the browser offers it. macOS metadata is left for the
// classifier's own filter.

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, fail: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    out.push(await new Promise<File>((ok, fail) => entry.file!(ok, fail)));
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

export async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = item.webkitGetAsEntry?.() as FsEntry | null | undefined;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Array.from(dt.files);
  const out: File[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}
