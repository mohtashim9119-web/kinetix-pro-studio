/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpotLayer } from './SpotLayer';
import type { Asset } from '../types';
import type { PreviewSpotItem } from '../services/spots/spotPreviewMath';

const assets: Asset[] = [
  { id: 'v', name: 'a.mp4', url: 'blob:v', type: 'video', duration: 4 },
  { id: 'i', name: 'i.png', url: 'blob:i', type: 'image' },
];
const rect = { xPct: 58.875, yPct: 2, wPct: 40, hPct: 40 };
const item = (o: Partial<PreviewSpotItem> & { id: string }): PreviewSpotItem => ({ startSec: 0, durSec: 3, rect, ...o });
const html = (items: PreviewSpotItem[], t: number, extra: Partial<Parameters<typeof SpotLayer>[0]> = {}) =>
  renderToStaticMarkup(<SpotLayer items={items} assets={assets} currentTime={t} isPlaying={false} {...extra} />);

describe('SpotLayer', () => {
  it('renders nothing outside any spot window', () => {
    expect(html([item({ id: 'a', assetId: 'v', startSec: 5, durSec: 4 })], 1)).toBe('');
  });
  it('active video spot: muted <video>, box at the resolved % rect, z slot, container-units layer', () => {
    const h = html([item({ id: 'a', assetId: 'v', durSec: 4 })], 1);
    expect(h).toContain('<video');
    expect(h).toContain('muted');
    expect(h).toContain('left:58.875%');
    expect(h).toContain('top:2%');
    expect(h).toContain('width:40%');
    expect(h).toContain('height:40%');
    expect(h).toContain('z-index:35');
    expect(h).toContain('container-type:size');
  });
  it('active image spot: <img>, no video element', () => {
    const h = html([item({ id: 'a', assetId: 'i' })], 1);
    expect(h).toContain('<img');
    expect(h).not.toContain('<video');
  });
  it('unbound or deleted-clip spot: [NO CLIP] tile at the SAME geometry', () => {
    const a = html([item({ id: 'a' })], 1);
    expect(a).toContain('NO CLIP');
    expect(a).toContain('left:58.875%');
    expect(html([item({ id: 'a', assetId: 'gone' })], 1)).toContain('NO CLIP');
  });
  it('editable: 8 resize handles + move cursor; read-only: none', () => {
    const e = html([item({ id: 'a', assetId: 'i' })], 1, { onCommitRect: () => {} });
    expect((e.match(/data-spot-handle=/g) ?? []).length).toBe(8);
    expect(e).toContain('cursor-move');
    expect(html([item({ id: 'a', assetId: 'i' })], 1)).not.toContain('data-spot-handle');
  });
  it('a live (dragging) rect overrides the resolved one for display', () => {
    const h = html([item({ id: 'a', assetId: 'i' })], 1, { liveRect: { id: 'a', rect: { xPct: 10, yPct: 11, wPct: 12, hPct: 13 } } });
    expect(h).toContain('left:10%');
    expect(h).toContain('height:13%');
  });
});
