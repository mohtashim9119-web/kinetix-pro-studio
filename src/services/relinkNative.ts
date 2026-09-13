/**
 * Round 27 (Step 2) — native folder-pick support for the degraded-project
 * recovery screen. Two operations the WebView cannot do itself: open a
 * native "select folder" dialog, and enumerate that folder's media files
 * (with a best-effort ffmpeg duration probe). Both are no-ops outside
 * Tauri (`npm run dev` has no IPC bridge), so the folder-pick flow is only
 * live under `tauri:dev`/`tauri:build`.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** One candidate file from a folder pick — mirrors `relink.rs`'s `RelinkCandidateFile`. */
export interface RelinkCandidateFile {
  id: string;
  name: string;
  path: string;
  size: number;
  /** `'image' | 'video' | 'audio'`, or `null` for non-media (skipped by the caller). */
  mediaType: string | null;
  /** Probed duration in seconds; `null` for images / probe misses. */
  duration: number | null;
}

/** Opens a native folder dialog. Returns the chosen path, or `null` if cancelled. */
export async function relinkPickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('relink_pick_folder');
}

/** Lists the media files in `folderPath` with best-effort duration probes. */
export async function relinkListFolder(folderPath: string): Promise<RelinkCandidateFile[]> {
  if (!isTauri()) return [];
  return invoke<RelinkCandidateFile[]>('relink_list_folder', { folderPath });
}

/** Maps a media filename to a MIME type — mirrors `relink.rs`'s `infer_media_type`. */
export function inferMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}
