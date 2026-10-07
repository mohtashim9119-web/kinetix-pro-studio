/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U4 + R6 — static-markup coverage of the Layer-2 panel (same
// pattern as timeline.render.test.tsx: renderToStaticMarkup, no DOM library).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { Layer2Panel } from './Layer2Panel';
import type { Asset, Spot, VideoSegment } from '../types';

type Props = ComponentProps<typeof Layer2Panel>;
const noop = () => {};
const segs = [{ id: 's1', text: 'Hello there', tag: 'intro', startTime: 0, duration: 4 }] as unknown as VideoSegment[];
const assets: Asset[] = [{ id: 'v', name: 'avatar.mp4', url: '', type: 'video', duration: 4 }];
const LEFT = { xPct: 0, yPct: 0, wPct: 50, hPct: 100 };
const spot = (o: Partial<Spot> & { id: string }): Spot => ({
  anchorSegmentId: 's1', offsetSec: 0, source: 'doc', boundAt: 0, ...o,
});
function props(o: Partial<Props> = {}): Props {
  return {
    segments: segs, assets, spots: [], resolved: {}, pendingDoc: null, findings: [],
    onDropDoc: noop, onClearPending: noop, onPatchSpot: noop, onDeleteSpot: noop,
    onSelectSpot: noop, onResetSpotGeometry: noop, onCustomizeSpotGeometry: noop, onResetProjectDefault: noop,
    ...o,
  };
}
const render = (o?: Partial<Props>) => renderToStaticMarkup(<Layer2Panel {...props(o)} />);
const R = (o: Partial<{ startSec: number; durSec: number }> = {}) => ({ startSec: 0, durSec: 4, rect: LEFT, ...o });

describe('Layer2Panel', () => {
  it('shows its own dedicated drop field', () => {
    const html = render();
    expect(html).toContain('data-testid="layer2-dropfield"');
    expect(html).toContain('type="file"');
  });
  it('honest pre-build state: no timeline -> waiting for first Build Timeline; queued doc named', () => {
    const html = render({ segments: [], pendingDoc: { name: 'avatar-scenes.txt', errors: [] } });
    expect(html).toContain('Waiting for first Build Timeline');
    expect(html).toContain('avatar-scenes.txt');
  });
  it('surfaces honest per-block parse errors and bind findings', () => {
    const html = render({
      pendingDoc: { name: 'd.txt', errors: [{ index: 1, reason: 'empty-tag', message: 'Block 2 has an empty [] tag — skipped.' }] },
      findings: [{ kind: 'spot-clip-unmatched', message: '[intro]: No asset named "avatar01" found for block 1.' }],
    });
    expect(html).toContain('Block 2 has an empty [] tag');
    expect(html).toContain('[intro]: No asset named &quot;avatar01&quot; found for block 1.');
  });
  it('has NO default-clip picker and NO sprinkle anywhere', () => {
    const html = render({ assets: [...assets, { id: 'au', name: 'vo.mp3', url: '', type: 'audio' }] });
    for (const bad of ['layer2-default-asset', 'Default Layer-2 clip', 'Sprinkle', 'layer2-sprinkle']) expect(html).not.toContain(bad);
  });
});

describe('Layer2Panel block rows (R6)', () => {
  const rows = (o: Partial<Props> = {}) =>
    render({ spots: [spot({ id: 'a', assetId: 'v' }), spot({ id: 'b' })], resolved: { a: R(), b: R({ startSec: 0 }) }, ...o });

  it('(a) scene number + tag row', () => {
    expect(rows()).toContain('Scene 1 · intro');
  });
  it('(b) media row: selected clip name, or "Not set" for an unbound spot', () => {
    const html = rows();
    expect(html).toMatch(/data-testid="layer2-media-a"[^>]*>[^]*?avatar\.mp4/);
    expect(html).toMatch(/data-testid="layer2-media-b"[^>]*>[^]*?Not set/);
  });
  it('(c) geometry row: live display + active level badge', () => {
    const html = rows();
    expect(html).toContain('x 0% · y 0% · w 50% · h 100%');
    expect(html).toContain('data-level="default"');
    const custom = render({ spots: [spot({ id: 'a', assetId: 'v', geometry: { xPct: 72, yPct: 8, wPct: 24, hPct: 40 } })], resolved: { a: R({}) && { startSec: 0, durSec: 4, rect: { xPct: 72, yPct: 8, wPct: 24, hPct: 40 } } } });
    expect(custom).toContain('x 72% · y 8% · w 24% · h 40%');
    expect(custom).toContain('data-level="custom"');
    const proj = render({ spots: [spot({ id: 'a', assetId: 'v' })], resolved: { a: R() }, projectDefault: { xPct: 60, yPct: 5, wPct: 35, hPct: 50 } });
    expect(proj).toContain('data-level="project"');
  });
  it('(c) live drag: the row shows the dragging rect in realtime (project scope reaches non-custom rows)', () => {
    const live = { id: 'zzz', rect: { xPct: 11, yPct: 12, wPct: 13, hPct: 14 }, scope: 'project' as const };
    expect(rows({ liveRect: live })).toContain('x 11% · y 12% · w 13% · h 14%');
    const own = render({ spots: [spot({ id: 'a', assetId: 'v', geometry: LEFT })], resolved: { a: R() }, liveRect: live });
    expect(own).not.toContain('x 11%'); // a custom block ignores a project-scope drag
  });
  it('(d) bin icon per row; selected row is marked', () => {
    const html = rows({ selectedSpotId: 'a' });
    expect((html.match(/aria-label="Delete spot"/g) ?? []).length).toBe(2);
    expect(html.match(/data-testid="layer2-spot-a"[^>]*>/)?.[0]).toContain('data-selected="true"');
    expect(html.match(/data-testid="layer2-spot-b"[^>]*>/)?.[0]).not.toContain('data-selected="true"');
  });
  it('no corner picker any more', () => {
    expect(rows()).not.toContain('Top right');
  });
  it('project default control states the cascade; hints Alt-drag for one block', () => {
    const html = rows({ projectDefault: { xPct: 60, yPct: 5, wPct: 35, hPct: 50 } });
    expect(html).toContain('data-testid="layer2-project-default"');
    expect(html).toContain('x 60% · y 5% · w 35% · h 50%');
    expect(html).toMatch(/Alt/);
    expect(render({ spots: [spot({ id: 'a' })], resolved: { a: R() } })).toContain('Left half');
  });
  it('NO CLIP + needs-review flags still honest', () => {
    const html = render({ spots: [spot({ id: 'n', needsReview: true, lastKnownStartSec: 3 })], resolved: {} });
    expect(html).toContain('Not set');
    expect(html).toContain('Needs review');
  });
});
