/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U4 — static-markup coverage of the Layer-2 panel (same pattern
// as timeline.render.test.tsx: renderToStaticMarkup, no DOM library).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { Layer2Panel } from './Layer2Panel';
import type { Asset, Spot, VideoSegment } from '../types';

type Props = ComponentProps<typeof Layer2Panel>;
const noop = () => {};
const segs = [{ id: 's1', text: 'Hello there', tag: 'intro', startTime: 0, duration: 4 }] as unknown as VideoSegment[];
const assets: Asset[] = [{ id: 'v', name: 'avatar.mp4', url: '', type: 'video', duration: 4 }];
const spot = (o: Partial<Spot> & { id: string }): Spot => ({
  anchorSegmentId: 's1', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 0, ...o,
});
function props(o: Partial<Props> = {}): Props {
  return {
    segments: segs, assets, spots: [], resolved: {}, pendingDoc: null, findings: [],
    onDropDoc: noop, onClearPending: noop, onPatchSpot: noop, onDeleteSpot: noop, onAddManual: noop,
    onSetDefaultAsset: noop, onSprinkle: noop, ...o,
  };
}
const render = (o?: Partial<Props>) => renderToStaticMarkup(<Layer2Panel {...props(o)} />);

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
      findings: [{ kind: 'spot-segment-unmatched', message: 'Layer 2 block 3 [zzz] matched no scene' }],
    });
    expect(html).toContain('Block 2 has an empty [] tag');
    expect(html).toContain('matched no scene');
  });
  it('lists spots with scene, resolved time, NO CLIP tile, and needs-review flag', () => {
    const html = render({
      spots: [spot({ id: 'a', assetId: 'v' }), spot({ id: 'b', needsReview: true })],
      resolved: { a: { startSec: 0, durSec: 4 } },
    });
    expect(html).toContain('data-testid="layer2-spot-a"');
    expect(html).toContain('avatar.mp4');
    expect(html).toContain('NO CLIP');
    expect(html).toContain('Needs review');
  });
  it('has the default-asset picker (video/image only) and Sprinkle', () => {
    const html = render({ assets: [...assets, { id: 'au', name: 'vo.mp3', url: '', type: 'audio' }] });
    expect(html).toContain('data-testid="layer2-default-asset"');
    expect(html).not.toContain('vo.mp3');
    expect(html).toContain('Sprinkle');
  });
});
