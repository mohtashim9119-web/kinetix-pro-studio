/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { findMediaIssues, type MediaIssues } from './exportFailure/missingMediaMessage';
import type { Asset, VideoSegment } from '../types';

export const BULK_EXPORT_OFFLINE = 'Blocked — offline media';
export const BULK_EXPORT_SOFT_FLAG = 'will export with black frames / may fail';

export type BulkExportPreflight =
  | { kind: 'block'; message: typeof BULK_EXPORT_OFFLINE; issues: MediaIssues }
  | { kind: 'include'; flags: string[]; issues: MediaIssues };

/** Same media check as the Export button (`findMediaIssues`). Offline blocks
 *  the row; missing/damaged media is a visible flag and still included. */
export function preflightBulkExport(
  segments: readonly VideoSegment[],
  assets: readonly Asset[],
): BulkExportPreflight {
  const issues = findMediaIssues(segments, assets);
  if (issues.offline.length > 0) {
    return { kind: 'block', message: BULK_EXPORT_OFFLINE, issues };
  }
  const flags: string[] = [];
  if (issues.none.length > 0 || issues.corrupt.length > 0) flags.push(BULK_EXPORT_SOFT_FLAG);
  return { kind: 'include', flags, issues };
}
