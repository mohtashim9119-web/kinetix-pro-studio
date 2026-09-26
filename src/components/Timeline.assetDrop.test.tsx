// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Media workflow Unit 3 — drag a Media block tile onto a timeline segment
// to assign it. The segment cards' own gestures are pointer-event based
// (dragSession/onResizeStart), with no HTML5 drag handlers, so this uses a
// DEDICATED dataTransfer type (ASSET_DRAG_MIME): a drag carrying anything
// else (files from Finder, text) is ignored — no highlight, no drop. The
// user's choice is authoritative: zero name logic on the drop path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ComponentProps } from 'react';
import { Timeline } from './Timeline';
import { ASSET_DRAG_MIME } from '../services/assetDragChannel';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

function makeSeg(id: string, startTime: number, duration: number, assetId?: string): VideoSegment {
  return { id, text: `seg-${id}`, order: 0, startTime, duration, assetId, transition: TransitionType.NONE, animation: AnimationType.NONE };
}

function props(overrides: Partial<ComponentProps<typeof Timeline>>): ComponentProps<typeof Timeline> {
  return {
    segments: [], assets: [], headings: [], currentSegmentId: undefined, currentTime: 0, isPlaying: false,
    isSynced: true, sliderT: 1, onPixelsPerSecondChange: () => {}, globalPlaybackSpeed: 1, resizingId: null,
    resizingType: null, voiceoverName: undefined, waveformSource: null, onTogglePlay: () => {}, onSeek: () => {},
    onResizeStart: () => {}, onSegmentUpdate: () => {}, onOpenStockSearch: () => {},
    ...overrides,
  };
}

/** jsdom has no DataTransfer/DragEvent — a minimal stand-in carrying the
 *  two things the handlers read: `types` and `getData`. */
function dragEvent(type: string, data: Record<string, string>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: { types: Object.keys(data), getData: (k: string) => data[k] ?? '', dropEffect: 'none' },
  });
  return e;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(onAssignAssetToSegment: (segmentId: string, assetId: string) => void): Promise<void> {
  root = createRoot(container);
  const segments = [makeSeg('s1', 0, 5, 'old'), makeSeg('s2', 5, 5)];
  await act(async () => {
    root.render(<Timeline {...props({ segments, onAssignAssetToSegment })} />);
  });
}
const card = (id: string) => container.querySelector<HTMLElement>(`[data-seg-id="${id}"]`)!;

describe('Timeline — drop a Media block tile on a segment (Unit 3)', () => {
  it('dragover with the asset channel highlights the segment and accepts the drop; drop assigns', async () => {
    const assign = vi.fn();
    await mount(assign);
    const over = dragEvent('dragover', { [ASSET_DRAG_MIME]: 'a7' });
    await act(async () => { card('s1').dispatchEvent(over); });
    expect(over.defaultPrevented, 'dragover must preventDefault to allow the drop').toBe(true);
    expect(card('s1').getAttribute('data-asset-drop-target')).toBe('true');

    await act(async () => { card('s1').dispatchEvent(dragEvent('drop', { [ASSET_DRAG_MIME]: 'a7' })); });
    expect(assign).toHaveBeenCalledWith('s1', 'a7');
    expect(card('s1').getAttribute('data-asset-drop-target')).toBeNull();
  });

  it('an empty (no-media) segment is a valid target too', async () => {
    const assign = vi.fn();
    await mount(assign);
    await act(async () => { card('s2').dispatchEvent(dragEvent('dragover', { [ASSET_DRAG_MIME]: 'a7' })); });
    await act(async () => { card('s2').dispatchEvent(dragEvent('drop', { [ASSET_DRAG_MIME]: 'a7' })); });
    expect(assign).toHaveBeenCalledWith('s2', 'a7');
  });

  it('dragleave clears the highlight', async () => {
    await mount(vi.fn());
    await act(async () => { card('s1').dispatchEvent(dragEvent('dragover', { [ASSET_DRAG_MIME]: 'a7' })); });
    await act(async () => { card('s1').dispatchEvent(dragEvent('dragleave', { [ASSET_DRAG_MIME]: 'a7' })); });
    expect(card('s1').getAttribute('data-asset-drop-target')).toBeNull();
  });

  it('a drag WITHOUT the asset channel (e.g. Finder files) is ignored — no highlight, no assign', async () => {
    const assign = vi.fn();
    await mount(assign);
    const over = dragEvent('dragover', { Files: '' });
    await act(async () => { card('s1').dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(false);
    expect(card('s1').getAttribute('data-asset-drop-target')).toBeNull();
    await act(async () => { card('s1').dispatchEvent(dragEvent('drop', { Files: '' })); });
    expect(assign).not.toHaveBeenCalled();
  });
});
