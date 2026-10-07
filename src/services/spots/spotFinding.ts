/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SyncLogFindingKind } from '../../types';

export type SpotFindingKind = Extract<
  SyncLogFindingKind,
  'spot-segment-unmatched' | 'spot-clip-unmatched' | 'spot-past-voiceover' | 'spot-overlap' | 'spot-clip-missing'
>;

/** A pure-layer finding; the caller decides whether to log it. */
export interface SpotFinding {
  kind: SpotFindingKind;
  message: string;
  /** Doc block index (binder findings) or spot id (resolver findings). */
  blockIndex?: number;
  spotId?: string;
}
