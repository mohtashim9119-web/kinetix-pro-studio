/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Binds parsed Layer-2 blocks to MAIN segments and vault assets. Pure.
 * Tag -> segment: normalized exact match on the segment's tag, else a UNIQUE
 * contiguous-word match of the tag inside segment text (ambiguous = unmatched;
 * never guess). Clip: body name via `pickAssetByName` over video/image assets;
 * no name -> an UNBOUND spot (honest [NO CLIP]; bound later via the row
 * dropdown or the wand — never guessed, never dropped). A named clip that
 * matches nothing keeps the spot unbound, records `clipName` for the wand, and
 * reports `spot-clip-unmatched`.
 */

import type { Asset, Spot, VideoSegment } from '../../types';
import { contiguousWordMatch, isExactFilenameMatch } from '../syncEngine';
import { pickAssetByName } from '../pickAssetByName';
import type { SpotDocBlock } from './parseSpotDoc';
import type { SpotFinding } from './spotFinding';

/** FNV-1a 32-bit, hex — a small stable hash for content-derived spot ids. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface BindSpotDocOptions {
  now: number;
  newId?: () => string;
}

export function bindSpotDoc(
  blocks: readonly SpotDocBlock[],
  segments: readonly VideoSegment[],
  assets: readonly Asset[],
  opts: BindSpotDocOptions,
): { spots: Spot[]; findings: SpotFinding[] } {
  const seen = new Map<string, number>();
  // Content-derived by default (tag + clip name + occurrence) so the SAME doc always
  // yields the SAME ids across reopen — overrides stamped on a spot stay attached.
  const contentId = (b: SpotDocBlock): string => {
    const key = `${b.tag}\u0001${b.body}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `sp-${fnv1a(`${key}\u0001${n}`)}`;
  };
  const candidates = assets.filter(a => a.type === 'video' || a.type === 'image');
  const spots: Spot[] = [];
  const findings: SpotFinding[] = [];

  for (const block of blocks) {
    let segment = segments.find(s => s.tag && isExactFilenameMatch(block.tag, s.tag));
    if (!segment) {
      const words = segments.filter(s => contiguousWordMatch(block.tag, s.text));
      if (words.length === 1) segment = words[0];
    }
    if (!segment) {
      findings.push({
        kind: 'spot-segment-unmatched',
        blockIndex: block.index,
        message: `[${block.tag}]: No scene found for block ${block.index + 1}.`,
      });
      continue;
    }

    let assetId: string | undefined;
    if (block.body) {
      assetId = pickAssetByName(block.body, candidates).asset?.id;
      if (!assetId) {
        findings.push({
          kind: 'spot-clip-unmatched',
          blockIndex: block.index,
          message: `[${block.tag}]: No asset named "${block.body}" found for block ${block.index + 1}.`,
        });
      }
    }

    spots.push({
      id: opts.newId ? opts.newId() : contentId(block),
      ...(assetId ? { assetId } : {}),
      ...(block.body ? { clipName: block.body } : {}),
      anchorSegmentId: segment.id,
      offsetSec: 0,
      source: 'doc',
      boundAt: opts.now,
    });
  }
  return { spots, findings };
}
