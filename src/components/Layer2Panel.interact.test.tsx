// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R6 — media dropdown + search, delete confirmation, row select.
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Layer2Panel, type Layer2PanelProps } from './Layer2Panel';
import type { Asset, Spot, VideoSegment } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const segs = [{ id: 's1', text: 'Hello', tag: 'intro', startTime: 0, duration: 4 }] as unknown as VideoSegment[];
const assets: Asset[] = [
  { id: 'v1', name: 'avatar01.mp4', url: '', type: 'video', duration: 4 },
  { id: 'i1', name: 'logo.png', url: '', type: 'image' },
  { id: 'i2', name: 'badge.png', url: '', type: 'image' },
  { id: 'au', name: 'voiceover.mp3', url: '', type: 'audio' },
];
const spot: Spot = { id: 'a', anchorSegmentId: 's1', offsetSec: 0, source: 'doc', boundAt: 0 };

function mount(over: Partial<Layer2PanelProps> = {}) {
  const props: Layer2PanelProps = {
    segments: segs, assets, spots: [spot], resolved: { a: { startSec: 0, durSec: 3, rect: { xPct: 0, yPct: 0, wPct: 50, hPct: 100 } } },
    pendingDoc: null, findings: [], onDropDoc: noop, onClearPending: noop, onPatchSpot: noop, onDeleteSpot: noop,
    onSelectSpot: noop, onResetSpotGeometry: noop, onCustomizeSpotGeometry: noop, onResetProjectDefault: noop,
    ...over,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<Layer2Panel {...props} />); });
  return container;
}
const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel);

describe('media dropdown + search', () => {
  it('opens from the media row; lists only vault video+image; search filters by name', async () => {
    const c = mount();
    await act(async () => { q(c, '[data-testid="layer2-media-a"]')!.click(); });
    const list = q(c, '[data-testid="layer2-media-menu-a"]')!;
    expect(list.textContent).toContain('avatar01.mp4');
    expect(list.textContent).toContain('logo.png');
    expect(list.textContent).not.toContain('voiceover.mp3');
    const input = q(c, '[data-testid="layer2-media-search-a"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'logo'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(list.textContent).toContain('logo.png');
    expect(list.textContent).not.toContain('badge.png');
  });
  it('empty search result says so honestly', async () => {
    const c = mount();
    await act(async () => { q(c, '[data-testid="layer2-media-a"]')!.click(); });
    const input = q(c, '[data-testid="layer2-media-search-a"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'zzz'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(q(c, '[data-testid="layer2-media-menu-a"]')!.textContent).toContain('No media matches');
  });
  it('click selects: binds assetId only — the doc\'s clipName (what the wand re-binds by) is untouched', async () => {
    const onPatchSpot = vi.fn();
    const c = mount({ onPatchSpot });
    await act(async () => { q(c, '[data-testid="layer2-media-a"]')!.click(); });
    await act(async () => { q(c, '[data-testid="layer2-media-option-i2"]')!.click(); });
    expect(onPatchSpot).toHaveBeenCalledWith('a', { assetId: 'i2' });
    expect(q(c, '[data-testid="layer2-media-menu-a"]')).toBeNull(); // closes
  });
  it('keyboard: ArrowDown + Enter selects; Escape closes without selecting', async () => {
    const onPatchSpot = vi.fn();
    const c = mount({ onPatchSpot });
    await act(async () => { q(c, '[data-testid="layer2-media-a"]')!.click(); });
    const input = q(c, '[data-testid="layer2-media-search-a"]')!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onPatchSpot).toHaveBeenCalledTimes(1);
    expect(onPatchSpot.mock.calls[0]![1]).toHaveProperty('assetId');
    const onPatch2 = vi.fn();
    const c2 = mount({ onPatchSpot: onPatch2 });
    await act(async () => { q(c2, '[data-testid="layer2-media-a"]')!.click(); });
    await act(async () => { q(c2, '[data-testid="layer2-media-search-a"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q(c2, '[data-testid="layer2-media-menu-a"]')).toBeNull();
    expect(onPatch2).not.toHaveBeenCalled();
  });
  it('outside click closes', async () => {
    const c = mount();
    await act(async () => { q(c, '[data-testid="layer2-media-a"]')!.click(); });
    expect(q(c, '[data-testid="layer2-media-menu-a"]')).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(q(c, '[data-testid="layer2-media-menu-a"]')).toBeNull();
  });
});

describe('delete confirmation + row select + geometry reset', () => {
  it('bin -> confirmation dialog; confirm deletes, cancel does not', async () => {
    const onDeleteSpot = vi.fn();
    const c = mount({ onDeleteSpot });
    await act(async () => { q(c, '[aria-label="Delete spot"]')!.click(); });
    expect(onDeleteSpot).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Delete this spot?');
    await act(async () => { (dialog.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLElement).click(); });
    expect(onDeleteSpot).toHaveBeenCalledWith('a');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('cancel leaves the spot', async () => {
    const onDeleteSpot = vi.fn();
    const c = mount({ onDeleteSpot });
    await act(async () => { q(c, '[aria-label="Delete spot"]')!.click(); });
    const cancel = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Cancel') as HTMLElement;
    await act(async () => { cancel.click(); });
    expect(onDeleteSpot).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('row click selects the spot (timeline block highlights)', async () => {
    const onSelectSpot = vi.fn();
    const c = mount({ onSelectSpot });
    await act(async () => { q(c, '[data-testid="layer2-spot-a"]')!.click(); });
    expect(onSelectSpot).toHaveBeenCalledWith('a');
  });
  it('custom block: "Reset to default" calls back; non-custom block offers "Customize"', async () => {
    const onReset = vi.fn();
    const custom = { ...spot, geometry: { xPct: 1, yPct: 2, wPct: 30, hPct: 40 } };
    const c = mount({ spots: [custom], onResetSpotGeometry: onReset });
    await act(async () => { Array.from(c.querySelectorAll('button')).find(b => b.textContent === 'Reset to default')!.click(); });
    expect(onReset).toHaveBeenCalledWith('a');
    const onCust = vi.fn();
    const c2 = mount({ onCustomizeSpotGeometry: onCust });
    await act(async () => { Array.from(c2.querySelectorAll('button')).find(b => b.textContent === 'Customize')!.click(); });
    expect(onCust).toHaveBeenCalledWith('a', { xPct: 0, yPct: 0, wPct: 50, hPct: 100 });
  });
});
