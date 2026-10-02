/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const MEDIA_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const MEDIA_AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const MEDIA_IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const ZIP_MAX_ENTRIES = 5000;
const ZIP_MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;

function detectMediaType(filename: string): 'video' | 'audio' | 'image' | undefined {
  if (MEDIA_VIDEO_EXT.test(filename)) return 'video';
  if (MEDIA_AUDIO_EXT.test(filename)) return 'audio';
  if (MEDIA_IMAGE_EXT.test(filename)) return 'image';
  return undefined;
}

function isMacOSMetadataPath(p: string): boolean {
  const base = p.split('/').pop() ?? p;
  return base === '.DS_Store' || base.startsWith('._') || p.includes('__MACOSX/');
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const workerScope = self as unknown as {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (e: MessageEvent<unknown>) => {
  void (async () => {
    const { id, kind, bytes, zip } = e.data as { id: number; kind: string; bytes?: ArrayBuffer; zip?: Blob };
    try {
      if (kind === 'hash') {
        if (!bytes) throw new Error('hash: missing bytes');
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        workerScope.postMessage({ id, kind: 'hash', hex: toHex(digest) });
        return;
      }
      if (kind === 'zipWalk') {
        const source: Blob | ArrayBuffer | undefined = zip ?? bytes;
        if (!source) throw new Error('zipWalk: missing zip');
        const { default: JSZipModule } = await import('jszip');
        const content = await new JSZipModule().loadAsync(source);
        const files = Object.keys(content.files)
          .map(k => content.files[k]!)
          .filter(f => !f.dir && !isMacOSMetadataPath(f.name));
        if (files.length > ZIP_MAX_ENTRIES) {
          throw new Error(`This zip has ${files.length} files, more than the ${ZIP_MAX_ENTRIES}-file limit.`);
        }
        const entries: { name: string; bytes: Uint8Array; type: string }[] = [];
        const nestedZipNames: string[] = [];
        let unsupportedSkipped = 0;
        let unsafeRejected = 0;
        let totalBytes = 0;
        const transfer: Transferable[] = [];
        for (const fileData of files) {
          if (fileData.unsafeOriginalName !== undefined && fileData.unsafeOriginalName !== fileData.name) {
            unsafeRejected += 1;
            continue;
          }
          const filename = fileData.name;
          const name = filename.split('/').pop() || filename;
          if (/\.zip$/i.test(name)) {
            nestedZipNames.push(filename);
            continue;
          }
          const type = detectMediaType(filename);
          if (type === undefined) {
            unsupportedSkipped += 1;
            continue;
          }
          const buf = await fileData.async('uint8array');
          totalBytes += buf.byteLength;
          if (buf.byteLength > ZIP_MAX_ENTRY_BYTES) {
            throw new Error(`"${name}" is larger than the ${ZIP_MAX_ENTRY_BYTES}-byte per-file limit.`);
          }
          if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
            throw new Error(`This zip's total size exceeds the ${ZIP_MAX_TOTAL_BYTES}-byte limit.`);
          }
          const copy = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
            ? buf
            : buf.slice();
          entries.push({ name, bytes: copy, type });
          transfer.push(copy.buffer);
        }
        workerScope.postMessage(
          { id, kind: 'zipWalk', entries, meta: { unsupportedSkipped, unsafeRejected, nestedZipNames } },
          transfer,
        );
        return;
      }
      throw new Error(`unknown ingestWorker kind ${kind}`);
    } catch (err) {
      workerScope.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
