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
import { resolveSpotRect, type PctRect } from './spotGeometry';

export interface SpotLayout {
  /** The project's default box (R7 cascade level 2); absent -> built-in left half. */
  projectDefault?: PctRect;
}

export const IMAGE_SPOT_SEC = 3;

export interface ResolveSpotsResult {
  /** Sorted by startSec; what export consumes as `spotRenderSpecs`. */
  specs: SpotRenderSpec[];
  findings: SpotFinding[];
  /** spotId -> absolute start from a LIVE anchor, for the caller to persist
   *  as `Spot.lastKnownStartSec`. */
  lastKnown: Record<string, number>;
  /** spotId -> final placement (after clamp/overlap); absent = not rendered. */
  bySpot: Record<string, { startSec: number; durSec: number; rect: PctRect }>;
  /** Placement of spots with no usable clip (unbound, or clip deleted/offline) so
   *  the preview can show a [NO CLIP] tile with the timing kept. Never exported. */
  noClip: Record<string, { startSec: number; durSec: number; rect: PctRect }>;
  /** Spots whose anchor segment no longer exists. */
  needsReview: string[];
}

function labelOf(segments: readonly VideoSegment[], anchorId: string): string {
  const i = segments.findIndex(s => s.id === anchorId);
  if (i < 0) return 'Spot';
  const tag = segments[i]!.tag;
  return tag ? `[${tag}]` : `Scene ${i + 1}`;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function resolveSpots(
  spots: readonly Spot[],
  segments: readonly VideoSegment[],
  assets: readonly Asset[],
  voiceoverDur: number,
  layout: SpotLayout = {},
): ResolveSpotsResult {
  const findings: SpotFinding[] = [];
  const lastKnown: Record<string, number> = {};
  const needsReview: string[] = [];
  const noClip: Record<string, { startSec: number; durSec: number; rect: PctRect }> = {};
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
    const ghost = () => {
      if (startSec !== undefined) noClip[spot.id] = { startSec, durSec: spot.durOverrideSec ?? IMAGE_SPOT_SEC, rect: resolveSpotRect(spot, layout.projectDefault) };
    };
    if (!spot.assetId) { ghost(); return; }
    const asset = assets.find(a => a.id === spot.assetId);
    if (!asset || asset.unresolved) {
      findings.push({
        kind: 'spot-clip-missing',
        spotId: spot.id,
        message: `${labelOf(segments, spot.anchorSegmentId)}: Spot clip is ${asset ? 'offline' : 'no longer in the vault'} — skipped.`,
      });
      ghost();
      return;
    }
    let durSec = spot.durOverrideSec;
    if (durSec === undefined) {
      if (asset.type === 'video') {
        if (asset.duration === undefined) {
          findings.push({
            kind: 'spot-clip-missing',
            spotId: spot.id,
            message: `${labelOf(segments, spot.anchorSegmentId)}: Length of "${asset.name}" is unknown — skipped.`,
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
        message: `${labelOf(segments, l.spot.anchorSegmentId)}: Spot ${l.startSec >= voiceoverDur ? 'starts after the voiceover — skipped' : 'runs past the voiceover — trimmed'}.`,
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
        message: `${labelOf(segments, cur.spot.anchorSegmentId)}: Spot overlaps the next spot — the later one wins.`,
      });
      cur.durSec = r3(next.startSec - cur.startSec);
      if (cur.durSec <= 0) continue;
    }
    out.push(cur);
  }

  const rectOf = (l: (typeof out)[number]): PctRect => resolveSpotRect(l.spot, layout.projectDefault);
  const specs: SpotRenderSpec[] = out.map(l => {
    const rect = rectOf(l);
    return { assetId: l.spot.assetId!, startSec: l.startSec, durSec: r3(l.durSec), ...rect };
  });
  const bySpot: Record<string, { startSec: number; durSec: number; rect: PctRect }> = {};
  out.forEach(l => { bySpot[l.spotId] = { startSec: l.startSec, durSec: r3(l.durSec), rect: rectOf(l) }; });
  return { specs, findings, lastKnown, bySpot, noClip, needsReview };
}
