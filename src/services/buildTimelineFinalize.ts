/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Post-alignment commit shared by editor and bulk: skip placeholders,
 *  autoMatch, effect carry-forward, lock restore. Timing rules R.11–R.15
 *  live in `buildTimelineFaRules.ts`. */

import type { Asset, Project, VideoSegment, SyncLogEntry } from '../types';
import { autoMatchSegments } from './syncEngine';
import { findPartitionViolations, PARTITION_EPSILON_SEC } from './timelinePartition';
import { makeSyncLogEntry } from './syncLog';

export interface DroppedLockRecord {
  reason: 'no-asset-id' | 'duplicate-asset-id' | 'out-of-bounds' | 'partition-conflict';
  oldText: string;
  segmentIndex?: number;
}

export function preserveEffectFields(
  committed: VideoSegment[],
  previousSegments: VideoSegment[],
): VideoSegment[] {
  const oldByAsset = new Map<string, VideoSegment>();
  const seenOld = new Set<string>();
  for (const seg of previousSegments) {
    if (!seg.assetId) continue;
    if (seenOld.has(seg.assetId)) {
      oldByAsset.delete(seg.assetId);
      continue;
    }
    seenOld.add(seg.assetId);
    oldByAsset.set(seg.assetId, seg);
  }
  const newCounts = new Map<string, number>();
  committed.forEach(seg => {
    if (seg.assetId) newCounts.set(seg.assetId, (newCounts.get(seg.assetId) ?? 0) + 1);
  });
  return committed.map(seg => {
    if (!seg.assetId || (newCounts.get(seg.assetId) ?? 0) > 1) return seg;
    const prev = oldByAsset.get(seg.assetId);
    if (!prev) return seg;
    return {
      ...seg,
      effectTransition: prev.effectTransition,
      effectTransitionDuration: prev.effectTransitionDuration,
      effectAnimation: prev.effectAnimation,
      effectAnimationDuration: prev.effectAnimationDuration,
      effectAnimationScaleRate: prev.effectAnimationScaleRate,
      effectOverlay: prev.effectOverlay,
      effectGrade: prev.effectGrade,
    };
  });
}

export function preserveSegmentLocks(
  committed: VideoSegment[],
  previousSegments: VideoSegment[],
  audioDuration: number,
): { segments: VideoSegment[]; dropped: DroppedLockRecord[] } {
  const lockedOld = previousSegments.filter(s => s.locked);
  if (lockedOld.length === 0) return { segments: committed, dropped: [] };

  const oldByAsset = new Map<string, VideoSegment>();
  const seenOld = new Set<string>();
  for (const seg of previousSegments) {
    if (!seg.assetId) continue;
    if (seenOld.has(seg.assetId)) {
      oldByAsset.delete(seg.assetId);
      continue;
    }
    seenOld.add(seg.assetId);
    oldByAsset.set(seg.assetId, seg);
  }
  const newCounts = new Map<string, number>();
  committed.forEach(seg => {
    if (seg.assetId) newCounts.set(seg.assetId, (newCounts.get(seg.assetId) ?? 0) + 1);
  });

  const dropped: DroppedLockRecord[] = [];
  const candidates = new Map<string, { startTime: number; duration: number; oldText: string }>();

  for (const oldSeg of lockedOld) {
    if (!oldSeg.assetId) {
      dropped.push({ reason: 'no-asset-id', oldText: oldSeg.text });
      continue;
    }
    if (!oldByAsset.has(oldSeg.assetId)) {
      dropped.push({ reason: 'duplicate-asset-id', oldText: oldSeg.text });
      continue;
    }
    const newCount = newCounts.get(oldSeg.assetId) ?? 0;
    if (newCount === 0) continue;
    if (newCount > 1) {
      dropped.push({ reason: 'duplicate-asset-id', oldText: oldSeg.text });
      continue;
    }
    const newSeg = committed.find(s => s.assetId === oldSeg.assetId)!;
    const end = oldSeg.startTime + oldSeg.duration;
    if (oldSeg.startTime < -PARTITION_EPSILON_SEC || end > audioDuration + PARTITION_EPSILON_SEC) {
      dropped.push({ reason: 'out-of-bounds', oldText: oldSeg.text, segmentIndex: committed.indexOf(newSeg) });
      continue;
    }
    candidates.set(newSeg.id, { startTime: oldSeg.startTime, duration: oldSeg.duration, oldText: oldSeg.text });
  }

  if (candidates.size === 0) return { segments: committed, dropped };

  const applyCandidates = (): VideoSegment[] =>
    committed.map(seg => {
      const c = candidates.get(seg.id);
      return c ? { ...seg, locked: true, startTime: c.startTime, duration: c.duration } : seg;
    });

  const maxIterations = candidates.size;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const attempt = applyCandidates();
    const violations = findPartitionViolations(attempt, audioDuration);
    if (violations.length === 0) return { segments: attempt, dropped };
    const v = violations[0]!;
    const laterSeg = attempt[v.index];
    const earlierSeg = v.index > 0 ? attempt[v.index - 1] : undefined;
    const toRevert = laterSeg && candidates.has(laterSeg.id)
      ? laterSeg
      : (earlierSeg && candidates.has(earlierSeg.id) ? earlierSeg : undefined);
    if (!toRevert) return { segments: committed, dropped };
    const revertedCandidate = candidates.get(toRevert.id)!;
    candidates.delete(toRevert.id);
    dropped.push({
      reason: 'partition-conflict',
      oldText: revertedCandidate.oldText,
      segmentIndex: committed.findIndex(s => s.id === toRevert.id),
    });
    if (candidates.size === 0) return { segments: committed, dropped };
  }
  return { segments: committed, dropped };
}

function previewSegmentText(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= 40 ? t : `${t.slice(0, 37)}...`;
}

export function buildLockNotRestoredLogEntries(
  syncRunId: string,
  records: DroppedLockRecord[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return records.map(r => {
    const scene = r.segmentIndex !== undefined
      ? `Segment ${r.segmentIndex + 1}`
      : `A previously locked scene ("${previewSegmentText(r.oldText)}")`;
    let message: string;
    let fixHint: string;
    switch (r.reason) {
      case 'no-asset-id':
        message = `${scene}'s lock could not be restored after this sync — the locked scene had no asset reference to match against.`;
        fixHint = 'Point the scene at an asset, then re-lock it.';
        break;
      case 'duplicate-asset-id':
        message = `${scene}'s lock could not be restored after this sync — its asset is shared with another scene, so the match was ambiguous.`;
        fixHint = 'Make sure each scene points to a unique asset, then re-lock it.';
        break;
      case 'out-of-bounds':
        message = `${scene}'s saved lock position no longer fits the voiceover's new length — the lock was dropped.`;
        fixHint = 'Re-lock the segment once you are happy with its new position.';
        break;
      case 'partition-conflict':
        message = `${scene}'s saved lock position conflicts with a neighboring scene after this sync — the lock was dropped.`;
        fixHint = 'Re-lock the segment once you are happy with its new position.';
        break;
    }
    return makeSyncLogEntry(
      syncRunId,
      'lock-not-restored',
      message,
      { segmentIndex: r.segmentIndex, severity: 'warning', fixHint },
      timestamp,
    );
  });
}

export function matchEffectsAndLocks(
  segments: VideoSegment[],
  assets: Asset[],
  previousSegments: VideoSegment[],
  audioDuration: number,
): { segments: VideoSegment[]; droppedLocks: DroppedLockRecord[] } {
  const matched = preserveEffectFields(autoMatchSegments(assets, segments), previousSegments);
  const locked = preserveSegmentLocks(matched, previousSegments, audioDuration);
  return {
    segments: locked.segments,
    droppedLocks: locked.dropped,
  };
}

/** Stamp lock-drop log lines onto a project that already has the run log. */
export function withLockDropLog(
  project: Project,
  syncRunId: string,
  dropped: DroppedLockRecord[],
  at: number,
  append: (p: Project, entries: SyncLogEntry[]) => Project,
): Project {
  if (dropped.length === 0) return project;
  return append(project, buildLockNotRestoredLogEntries(syncRunId, dropped, at));
}
