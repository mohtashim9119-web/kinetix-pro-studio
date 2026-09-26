/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finder/macOS filesystem noise that rides along in nearly every zip made on
 * a Mac (and in folders on non-HFS/APFS volumes): AppleDouble `._<name>`
 * resource-fork twins, `.DS_Store` view settings, and the `__MACOSX/` tree
 * Archive Utility writes. None of it is user content. Every ingest door
 * (bundle zip, media zip, loose files/folder, DropZonePanel drops) drops
 * these BEFORE classification — silently, never counted as unsupported:
 * they are noise, not findings.
 *
 * `path` may be a bare name or a slash-separated archive/relative path.
 */
export function isMacOSMetadataPath(path: string): boolean {
  const segments = path.split('/').filter(s => s.length > 0);
  if (segments.includes('__MACOSX')) return true;
  const base = segments[segments.length - 1] ?? '';
  return base.startsWith('._') || base === '.DS_Store';
}
