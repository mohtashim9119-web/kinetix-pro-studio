/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * D8 (Round 28) — a thin, best-effort door into the native
 * `kinetix-diagnostic.log` (Rust's `export_log_event` command,
 * `ffmpeg.rs`) for the WHOLE export lifecycle: init, encoder config,
 * frame-loop progress pulses, watchdog updates, cancellations, disk-full
 * events, and session cleanup/teardown. Before this, the file was written
 * only by two narrow commands (`ffmpeg_log_disk_preflight`,
 * `ffmpeg_retain_session_for_resume`) — an operator's field report could
 * name a failure phase this file said nothing about.
 *
 * NOT a session-scoped method (unlike `TauriFfmpeg.logDiskPreflight`) —
 * export-init and cancellation both happen before/without a live ffmpeg
 * session in scope, so this is a free function taking whatever identifying
 * fields the call site already has.
 *
 * No-op outside Tauri (`npm run dev` has no IPC bridge) and NEVER throws —
 * same posture as `TauriFfmpeg.logDiskPreflight`: a logging failure must
 * never affect the export it is describing. Callers should not `await`
 * this on any path where a log delay would matter (fire-and-forget is the
 * intended use — see each call site).
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

export type ExportLogLevel = 'info' | 'warn' | 'error';

/** Every phase name a call site in this codebase uses today. Not an
 *  exhaustive enum enforced by the native side (`phase` is an opaque
 *  string there, same "TS owns the shape" posture as `failure_kind`) —
 *  typed here only so call sites can't typo a phase name. */
export type ExportLogPhase =
  | 'init'
  | 'encoder-config'
  | 'progress'
  | 'watchdog'
  | 'cancelled'
  | 'disk-full'
  | 'session-cleanup';

export function logExportEvent(phase: ExportLogPhase, detail: string, level: ExportLogLevel = 'info'): void {
  if (!isTauri()) return;
  void invoke('export_log_event', { phase, detail, level }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[ws3-export-log] native export-lifecycle logging failed (non-fatal):', err);
  });
}
