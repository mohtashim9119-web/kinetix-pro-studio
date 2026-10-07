/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure Layer-2 resolver — the ONLY place a spot becomes absolute time.
 *   startSec = anchorSegment.startTime + offsetSec   (live anchor)
 *            = spot.lastKnownStartSec                (anchor deleted; flagged, never dropped)
 *   durSec   = durOverrideSec ?? (video ? asset.duration : IMAGE_SPOT_SEC)
 * Then: clamp at voiceover end (`spot-past-voiceover`), overlaps last-wins by
 * start order (`spot-overlap`, the earlier spot is truncated). A spot whose
 * asset is gone/offline, or a video of unknown length, is dropped from the
 * specs with `spot-clip-missing` (a length is never guessed). Unbound spots
 * (no assetId) render nothing and add no finding — binding already reported.
 */

import type { Asset, Spot, SpotRenderSpec, VideoSegment } from '../../types';
import type { SpotFinding } from './spotFinding';

export const IMAGE_SPOT_SEC = 3;

export interface ResolveSpotsResult {
  /** Sorted by startSec; what export consumes as `spotRenderSpecs`. */
  specs: SpotRenderSpec[];
  findings: SpotFinding[];
  /** spotId -> absolute start from a LIVE anchor, for the caller to persist
   *  as `Spot.lastKnownStartSec`. */
  lastKnown: Record<string, number>;
  /** Spots whose anchor segment no longer exists. */
  needsReview: string[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function resolveSpots(
  spots: readonly Spot[],
  segments: readonly VideoSegment[],
  assets: readonly Asset[],
  voiceoverDur: number,
): ResolveSpotsResult {
  const findings: SpotFinding[] = [];
  const lastKnown: Record<string, number> = {};
  const needsReview: string[] = [];
  const live: { spotId: string; spot: Spot; startSec: number; durSec: number; order: number }[] = [];

  spots.forEach((spot, order) => {
    const anchor = segments.find(s => s.id === spot.anchorSegmentId);
    let startSec: number | undefined;
    if (anchor) {
      startSec = r3(anchor.startTime + spot.offsetSec);
      lastKnown[spot.id] = startSec;
    } else {
      needsReview.push(spot.id);
      startSec = spot.lastKnownStartSec;
    }
    if (!spot.assetId) return;
    const asset = assets.find(a => a.id === spot.assetId);
    if (!asset || asset.unresolved) {
      findings.push({
        kind: 'spot-clip-missing',
        spotId: spot.id,
        message: `Layer 2 spot ${spot.id}: its clip is ${asset ? 'offline' : 'no longer in the vault'} — skipped.`,
      });
      return;
    }
    let durSec = spot.durOverrideSec;
    if (durSec === undefined) {
      if (asset.type === 'video') {
        if (asset.duration === undefined) {
          findings.push({
            kind: 'spot-clip-missing',
            spotId: spot.id,
            message: `Layer 2 spot ${spot.id}: the length of "${asset.name}" is unknown — skipped rather than guessed.`,
          });
          return;
        }
        durSec = asset.duration;
      } else {
        durSec = IMAGE_SPOT_SEC;
      }
    }
    if (startSec === undefined) return;
    live.push({ spotId: spot.id, spot, startSec, durSec, order });
  });

  // Clamp at the voiceover end.
  const clamped: typeof live = [];
  for (const l of live) {
    if (voiceoverDur > 0 && l.startSec + l.durSec > voiceoverDur) {
      findings.push({
        kind: 'spot-past-voiceover',
        spotId: l.spotId,
        message: `Layer 2 spot ${l.spotId} runs past the voiceover end (${r3(voiceoverDur)}s) and was ${l.startSec >= voiceoverDur ? 'dropped' : 'clamped'}.`,
      });
      if (l.startSec >= voiceoverDur) continue;
      l.durSec = r3(voiceoverDur - l.startSec);
    }
    clamped.push(l);
  }

  // Overlaps: last wins (start order, ties by list order); the earlier is truncated.
  clamped.sort((a, b) => a.startSec - b.startSec || a.order - b.order);
  const out: typeof live = [];
  for (let i = 0; i < clamped.length; i++) {
    const cur = clamped[i]!;
    const next = clamped[i + 1];
    if (next && cur.startSec + cur.durSec > next.startSec) {
      findings.push({
        kind: 'spot-overlap',
        spotId: cur.spotId,
        message: `Layer 2 spot ${cur.spotId} overlaps the next spot; the later one wins.`,
      });
      cur.durSec = r3(next.startSec - cur.startSec);
      if (cur.durSec <= 0) continue;
    }
    out.push(cur);
  }

  const specs: SpotRenderSpec[] = out.map(l => ({
    assetId: l.spot.assetId!,
    startSec: l.startSec,
    durSec: r3(l.durSec),
    corner: l.spot.corner,
    heightPct: l.spot.heightPct,
  }));
  return { specs, findings, lastKnown, needsReview };
}
