/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpotLayer } from './SpotLayer';
import type { Asset } from '../types';

const assets: Asset[] = [
  { id: 'v', name: 'a.mp4', url: 'blob:v', type: 'video', duration: 4 },
  { id: 'i', name: 'i.png', url: 'blob:i', type: 'image' },
];
const base = { corner: 'top-right' as const, heightPct: 40 };
const html = (items: Parameters<typeof SpotLayer>[0]['items'], t: number) =>
  renderToStaticMarkup(<SpotLayer items={items} assets={assets} currentTime={t} isPlaying={false} />);

describe('SpotLayer', () => {
  it('renders nothing outside any spot window', () => {
    expect(html([{ id: 'a', assetId: 'v', startSec: 5, durSec: 4, ...base }], 1)).toBe('');
  });
  it('active video spot: muted <video>, top-right 40% box, z slot, container-units layer', () => {
    const h = html([{ id: 'a', assetId: 'v', startSec: 0, durSec: 4, ...base }], 1);
    expect(h).toContain('<video');
    expect(h).toContain('muted');
    expect(h).toContain('height:40cqh');
    expect(h).toContain('z-index:35');
    expect(h).toContain('container-type:size');
    expect(h).toContain('pointer-events-none');
  });
  it('active image spot: <img>, no video element', () => {
    const h = html([{ id: 'a', assetId: 'i', startSec: 0, durSec: 3, ...base }], 1);
    expect(h).toContain('<img');
    expect(h).not.toContain('<video');
  });
  it('unbound or deleted-clip spot: [NO CLIP] tile in place', () => {
    expect(html([{ id: 'a', startSec: 0, durSec: 3, ...base }], 1)).toContain('NO CLIP');
    expect(html([{ id: 'a', assetId: 'gone', startSec: 0, durSec: 3, ...base }], 1)).toContain('NO CLIP');
  });
});
