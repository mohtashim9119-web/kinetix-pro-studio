/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 3 U9 — every File in a drop, folders included. `DataTransfer.files`
 * lists a dropped folder as a single empty pseudo-file, so a folder dragged
 * onto the Media block imported nothing. `webkitGetAsEntry` (Chromium/WebKit —
 * Tauri's webview) walks directories; where it is unavailable (jsdom, older
 * engines) the flat `files` list is returned unchanged. Entries are read in
 * order; macOS metadata is filtered downstream by the ingest doors.
 */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>(resolve => entry.file!(resolve, () => resolve(null)));
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns at most ~100 per call; loop until it returns empty.
    for (;;) {
      const batch = await new Promise<FsEntry[]>(resolve => reader.readEntries(resolve, () => resolve([])));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map(i => (typeof i.webkitGetAsEntry === 'function' ? (i.webkitGetAsEntry() as FsEntry | null) : null));
  if (items.length === 0 || entries.some(e => e === null) || !entries.some(e => e?.isDirectory)) {
    return Array.from(dataTransfer.files ?? []);
  }
  const out: File[] = [];
  for (const entry of entries) if (entry) await walk(entry, out);
  return out;
}
