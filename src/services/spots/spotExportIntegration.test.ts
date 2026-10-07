/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots — INTEGRATION: app resolver -> export payload -> export lane's
// own contract (identity hash, quad layout, activity), and export-vs-preview
// parity on one fixture: two segments, one full-length video spot, one 3s image
// spot (+ a missing-clip spot that must be dropped with a finding).

import { describe, it, expect } from 'vitest';
import { buildExportSpotPayload } from './exportSpecs';
import {
  canonicalSpotRenderSpecs, hasSpotRenderWork, specActiveAt, spotQuadRect, spotBorderRect,
  SPOT_MARGIN_HEIGHT_FRAC, SPOT_BORDER_HEIGHT_FRAC, SPOT_LAYER_ORDER, type SpotRenderSpec as ExportSpec,
} from '../webcodecsExport/spotRenderSpec';
import { validateSpotAssets } from '../webcodecsExport/spotAssetGuard';
import { buildSourceTimelineHash, timelineIdentityFromProject } from '../webcodecsExport/exportCheckpoint';
import { activeSpotAt, spotBoxStyle, SPOT_MARGIN_PCT, SPOT_BORDER_PCT, SPOT_Z_INDEX, type PreviewSpotItem } from './spotPreviewMath';
import { resolveSpots } from './resolveSpots';
import { AnimationType, TransitionType, type Asset, type Project, type Spot, type SpotRenderSpec, type VideoSegment } from '../../types';

const seg = (id: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text: id, startTime, duration, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 }) as VideoSegment;
const assets: Asset[] = [
  { id: 'vid', name: 'avatar.mp4', url: 'blob:v', type: 'video', duration: 8 },
  { id: 'img', name: 'logo.png', url: 'blob:i', type: 'image' },
];
const spot = (o: Partial<Spot> & { id: string }): Spot => ({
  anchorSegmentId: 's1', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 0, ...o,
});
const project = (spots: Spot[]): Project => ({
  id: 'p', name: 'n', script: '', sceneDetails: '', segments: [seg('s1', 0, 30), seg('s2', 30, 30)],
  assets, spots, globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
  globalAnimation: AnimationType.NONE, globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Arial' },
}) as Project;

const SPOTS = [
  spot({ id: 'A', anchorSegmentId: 's1', assetId: 'vid' }),                 // full clip 0..8
  spot({ id: 'B', anchorSegmentId: 's2', assetId: 'img', corner: 'bottom-left' }), // 30..33
  spot({ id: 'M', anchorSegmentId: 's2', assetId: 'gone', offsetSec: 10 }), // missing clip
];

describe('buildExportSpotPayload', () => {
  const p = project(SPOTS);
  const r = buildExportSpotPayload(p);

  it('drops missing-clip entries at build, with a spot-clip-missing finding and an honest summary', () => {
    expect(r.specs).toEqual([
      { assetId: 'vid', startSec: 0, durSec: 8, corner: 'top-right', heightPct: 40 },
      { assetId: 'img', startSec: 30, durSec: 3, corner: 'bottom-left', heightPct: 40 },
    ]);
    expect(r.findings.map(f => f.kind)).toEqual(['spot-clip-missing']);
    expect(r.skipped).toBe(1);
    expect(r.summary).toBe('1 spot skipped');
  });
  it('plural summary; none skipped -> no summary', () => {
    expect(buildExportSpotPayload(project([spot({ id: 'U1' }), spot({ id: 'U2' })])).summary).toBe('2 spots skipped');
    expect(buildExportSpotPayload(project([SPOTS[0]!])).summary).toBeUndefined();
  });
  it('a project with no spots yields no payload field (zero-spec path stays byte-identical)', () => {
    const none = buildExportSpotPayload(project([]));
    expect(none.specs).toEqual([]);
    expect(none.request).toBeUndefined();
    expect(buildExportSpotPayload({ ...p, spots: undefined }).request).toBeUndefined();
    expect(r.request).toEqual({ spotRenderSpecs: r.specs });
  });
  it('payload passes the export lane\'s own asset guard (nothing missing survives the build)', () => {
    expect(validateSpotAssets(p.assets, r.specs)).toBeNull();
  });
});

describe('contract: resolver output is structurally the export lane SpotRenderSpec', () => {
  it('assignable both ways; canonical + hash are stable and change with an override', async () => {
    const specs: SpotRenderSpec[] = buildExportSpotPayload(project(SPOTS)).specs;
    const asExport: ExportSpec[] = specs;
    expect(hasSpotRenderWork(asExport)).toBe(true);
    const base = project(SPOTS);
    const dims = { fps: 30, width: 1920, height: 1080 };
    const h1 = await buildSourceTimelineHash(timelineIdentityFromProject(base, dims, { spotRenderSpecs: asExport }));
    const h1b = await buildSourceTimelineHash(timelineIdentityFromProject(base, dims, { spotRenderSpecs: [...asExport].reverse() }));
    expect(h1b).toBe(h1); // order-insensitive (canonical sort)
    const edited = buildExportSpotPayload(project([{ ...SPOTS[0]!, durOverrideSec: 5 }, SPOTS[1]!])).specs;
    const h2 = await buildSourceTimelineHash(timelineIdentityFromProject(base, dims, { spotRenderSpecs: edited }));
    expect(h2).not.toBe(h1); // an override edit invalidates resume
    expect(canonicalSpotRenderSpecs(asExport)[0]!.assetId).toBe('vid');
  });
});

describe('export vs preview parity', () => {
  const p = project(SPOTS);
  const res = resolveSpots(p.spots!, p.segments, p.assets, 60);
  const specs = buildExportSpotPayload(p).specs;
  // Preview items exactly as App builds them (bound specs only here; no ghosts in this fixture's rendered set).
  const items: PreviewSpotItem[] = (p.spots ?? []).flatMap(s => {
    const pl = res.bySpot[s.id];
    return pl ? [{ id: s.id, assetId: s.assetId, startSec: pl.startSec, durSec: pl.durSec, corner: s.corner, heightPct: s.heightPct }] : [];
  });

  it('same constants: margin, border, z below text (scene < spots < captions)', () => {
    expect(SPOT_MARGIN_PCT / 100).toBeCloseTo(SPOT_MARGIN_HEIGHT_FRAC, 10);
    expect(SPOT_BORDER_PCT / 100).toBeCloseTo(SPOT_BORDER_HEIGHT_FRAC, 10);
    expect([...SPOT_LAYER_ORDER]).toEqual(['scene', 'spots', 'captions']);
    expect(SPOT_Z_INDEX).toBeLessThan(40);
  });
  it('identical activity at every sampled time (0.25s grid + both edges)', () => {
    for (let t = 0; t <= 60; t += 0.25) {
      const preview = activeSpotAt(items, t);
      const exported = specs.filter(s => specActiveAt(s, t));
      expect(exported.length).toBe(preview ? 1 : 0);
      if (preview) expect([exported[0]!.startSec, exported[0]!.durSec]).toEqual([preview.startSec, preview.durSec]);
    }
  });
  it('identical box: preview CSS (cqh of frame) == export quad (fractions of frame height)', () => {
    const FRAME_H = 1080;
    const FRAME_W = 1920;
    for (const [spec, aspect, [nw, nh]] of [
      [specs[0]!, 16 / 9, [1920, 1080]],
      [specs[1]!, 4 / 3, [800, 600]],
    ] as const) {
      const q = spotQuadRect(spec, FRAME_W, FRAME_H, nw, nh);
      const css = spotBoxStyle(spec.corner, spec.heightPct, aspect);
      const cqh = (v: string) => (parseFloat(v) / 100) * FRAME_H;
      expect(cqh(css.height!)).toBeCloseTo(q.h, 6);
      expect(cqh(css.height!) * aspect).toBeCloseTo(q.w, 6);
      const margin = cqh(spec.corner.startsWith('top') ? css.top! : css.bottom!);
      expect(spec.corner.startsWith('top') ? q.y : FRAME_H - q.y - q.h).toBeCloseTo(margin, 6);
      const hMargin = cqh(spec.corner.endsWith('right') ? css.right! : css.left!);
      expect(spec.corner.endsWith('right') ? FRAME_W - q.x - q.w : q.x).toBeCloseTo(hMargin, 6);
      // border drawn OUTSIDE the quad by the same thickness
      expect(spotBorderRect(q, FRAME_H).w - q.w).toBeCloseTo(2 * (SPOT_BORDER_PCT / 100) * FRAME_H, 6);
    }
  });
});
