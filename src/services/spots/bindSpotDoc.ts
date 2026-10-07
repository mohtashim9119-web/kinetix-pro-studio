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
  const newId = opts.newId ?? (() => crypto.randomUUID());
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
      id: newId(),
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
