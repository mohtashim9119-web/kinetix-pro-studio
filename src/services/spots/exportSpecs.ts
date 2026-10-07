/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the export payload field `spotRenderSpecs` at export kickoff from the
 * project's spots, via THE resolver (`resolveSpots`) — the export lane never
 * recomputes timing. Entries without a usable clip are already dropped by the
 * resolver (`spot-clip-missing`); `skipped` counts EVERY spot that did not make
 * it into the specs (unbound, missing clip, past voiceover, anchorless) so the
 * summary is honest. A project with no specs gets NO request — the export takes
 * today's byte-identical path.
 */

import type { Project, SpotRenderSpec } from '../../types';
import { resolveSpots } from './resolveSpots';
import type { SpotFinding } from './spotFinding';

export interface ExportSpotPayload {
  specs: SpotRenderSpec[];
  findings: SpotFinding[];
  skipped: number;
  summary?: string;
  /** Pass to `startExport(request)`; undefined when there is nothing to render. */
  request?: { spotRenderSpecs: SpotRenderSpec[] };
}

export function buildExportSpotPayload(project: Pick<Project, 'spots' | 'segments' | 'assets'>): ExportSpotPayload {
  const spots = project.spots ?? [];
  if (spots.length === 0) return { specs: [], findings: [], skipped: 0 };
  const end = project.segments.reduce((m, s) => Math.max(m, s.startTime + s.duration), 0);
  const { specs, findings } = resolveSpots(spots, project.segments, project.assets, end);
  const skipped = spots.length - specs.length;
  return {
    specs,
    findings,
    skipped,
    ...(skipped > 0 ? { summary: `${skipped} spot${skipped === 1 ? '' : 's'} skipped` } : {}),
    ...(specs.length > 0 ? { request: { spotRenderSpecs: specs } } : {}),
  };
}
