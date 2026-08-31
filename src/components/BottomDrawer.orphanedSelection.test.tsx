// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 ws2-28, Commit 1 — pins the actual defect traced in
// `split-text-diagnosis.md` (session ws2-28): the drawer used to be an
// AnimatePresence mount/unmount (`{(s || h) && <motion.div exit={...}>...`).
// When `segment` went from a real object to `null` (its target split or
// deleted out from under it — Commit 2's redirect closes the two callers
// that used to cause this, but the render-level bug is independent of WHY
// `segment` became null), AnimatePresence held the LAST COMMITTED render on
// screen for the whole exit transition, so `SegmentControls`'s "Overlay
// text" input kept showing a DIFFERENT, stale segment's text — not the live
// `segment` prop, not blank. Measured directly against the real app (React's
// own committed fiber props) in the diagnosis session: still stale 3+
// seconds after the transition should have settled, and reproduced even on
// a plain manual close, not just split/delete.
//
// This test does not need real timers or a real animation to catch that
// regression: BottomDrawer.tsx's restructured `motion.div` is now ALWAYS
// mounted (nothing to hold "mid-exit"), and its content is gated on `segment
// live, evaluated fresh every render — so the assertion below is just "does
// the DOM reflect the prop I just passed," which is true immediately, with
// no animation to wait out.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { BottomDrawer } from './BottomDrawer';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

function makeSegment(id: string, text: string): VideoSegment {
  return {
    id,
    text,
    order: 0,
    startTime: 0,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
  };
}

const globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']> = {
  color: '#ffffff',
  backgroundColor: 'transparent',
  fontFamily: 'sans-serif',
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => { root!.unmount(); });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function overlayTextValue(): string | null {
  const input = container!.querySelector<HTMLInputElement>('input[aria-label="Overlay text"]');
  return input ? input.value : null;
}

function renderDrawer(segment: VideoSegment | null, segmentIndex: number): void {
  if (!root) {
    root = createRoot(container!);
  }
  act(() => {
    root!.render(
      <BottomDrawer
        segment={segment}
        segmentIndex={segmentIndex}
        assets={[]}
        globalOverlayConfig={globalOverlayConfig}
        onClose={() => {}}
        onUpdateSegment={() => {}}
        onUpdateSegmentOverlay={() => {}}
        onOpenStockSearch={() => {}}
        onToggleLock={() => {}}
      />,
    );
  });
}

describe('BottomDrawer — never renders a segment absent from the live prop', () => {
  it('shows the real segment\'s own text when open', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    renderDrawer(makeSegment('slice-2', 'the older'), 1);
    expect(overlayTextValue()).toBe('the older');
  });

  it('goes BLANK (no Overlay text input at all) rather than freezing on stale text when the selection is cleared to null — the exact ws2-28 mechanism, reproduced without needing the animation to settle', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    renderDrawer(makeSegment('slice-3', 'watching the older hunters differently.'), 2);
    expect(overlayTextValue()).toBe('watching the older hunters differently.');

    // This is the exact transition that used to leave SegmentControls
    // rendering slice 3's text forever: segment -> null, same component
    // instance, same render tree.
    renderDrawer(null, -1);

    // Must NOT still show slice 3's text (the diagnosed bug) — the input
    // must not exist at all (Commit 1's chosen outcome: blank, not stale).
    expect(overlayTextValue()).toBeNull();
  });

  it('switching directly between two different real segments (no null in between) shows the NEW segment\'s own text immediately — this already worked before Commit 1 and must keep working', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    renderDrawer(makeSegment('slice-a', 'first segment text'), 0);
    expect(overlayTextValue()).toBe('first segment text');

    renderDrawer(makeSegment('slice-b', 'second segment text'), 1);
    expect(overlayTextValue()).toBe('second segment text');
  });

  it('a scripted sequence including a null in the middle never shows text belonging to any segment other than the one just passed', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    const script: Array<{ segment: VideoSegment | null; index: number }> = [
      { segment: makeSegment('s1', 'You'), index: 0 },
      { segment: makeSegment('s2', 'start'), index: 1 },
      { segment: null, index: -1 }, // orphaned — e.g. the deleted slice was selected
      { segment: makeSegment('s2', 'start'), index: 1 }, // re-selected after redirect
      { segment: null, index: -1 },
      { segment: makeSegment('s3', 'watching the older hunters differently.'), index: 2 },
    ];

    for (const step of script) {
      renderDrawer(step.segment, step.index);
      expect(overlayTextValue()).toBe(step.segment ? step.segment.text : null);
    }
  });
});
