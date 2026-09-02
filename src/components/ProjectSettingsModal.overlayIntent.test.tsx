// @vitest-environment jsdom
//
// WS2 T4.1 (D4) — Project Settings must not cascade the text-overlay default
// on a Save the user made for some OTHER reason.
//
// THE DEFECT, as measured rather than as a principle. `handleSave` called
// `onSetAllOverlay(draftOverlayOn)` unconditionally, and that callback is a
// CASCADE: `App.tsx`'s `handleSetAllOverlay` maps every segment to the value
// it is handed. The draft seeds from `segments.every(s => s.showOverlay)`,
// which is `false` on any project whose per-segment overlay state is MIXED.
// So opening this modal on a mixed project to change the resolution tier and
// pressing Save silently turned EVERY segment's overlay off — from a control
// the user never touched, with no undo entry naming it.
//
// WHY THE ASSERTION IS ON THE SEGMENTS AND NOT ON THE SPY. Asserting only
// "the callback was not called" would pass against a future refactor that
// still calls it with a value that happens to match, and would fail against a
// harmless one that calls it with the identical value. The thing the user
// loses is per-segment state, so this file wires `onSetAllOverlay` to a
// reducer with the SAME body as `App.tsx:2287` and asserts on the resulting
// array. The spy is kept alongside it only to distinguish "wrote nothing"
// from "wrote the same thing".
//
// Same jsdom + react-dom/client + act pattern as ManageModelsModal.test.tsx
// (no @testing-library dependency in this repo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { AnimationType, TransitionType, type VideoSegment } from '../types';

let container: HTMLDivElement;
let root: Root;

function seg(id: string, showOverlay: boolean): VideoSegment {
  return {
    id,
    text: `segment ${id}`,
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    showOverlay,
  };
}

/** Byte-for-byte the cascade in `App.tsx`'s `handleSetAllOverlay` (:2287) —
 *  the real consequence of the callback, not a stand-in for it. */
function cascade(segments: VideoSegment[], value: boolean): VideoSegment[] {
  return segments.map((s) => ({ ...s, showOverlay: value }));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

interface Harness {
  /** Live segments, mutated by the cascade exactly as App's state would be. */
  segments: VideoSegment[];
  setAllOverlay: ReturnType<typeof vi.fn>;
  resolutionTierChange: ReturnType<typeof vi.fn>;
  click: (label: string) => Promise<void>;
  selectTier: (tier: string) => Promise<void>;
  toggleOverlay: () => Promise<void>;
}

async function renderModal(initialSegments: VideoSegment[]): Promise<Harness> {
  const state = { segments: initialSegments };
  const setAllOverlay = vi.fn((v: boolean) => {
    state.segments = cascade(state.segments, v);
  });
  const resolutionTierChange = vi.fn();

  root = createRoot(container);
  await act(async () => {
    root.render(
      <ProjectSettingsModal
        segments={initialSegments}
        aspectRatio="16:9"
        resolutionTier="1080p"
        onResolutionTierChange={resolutionTierChange}
        onSetAllOverlay={setAllOverlay}
        language={undefined}
        onLanguageChange={() => {}}
        faEnabled={false}
        onFaEnabledChange={() => {}}
        onOpenAppSettings={() => {}}
        onClose={() => {}}
      />,
    );
  });

  const click = async (label: string): Promise<void> => {
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    );
    expect(btn, `no button labelled "${label}"`).toBeTruthy();
    await act(async () => { btn!.click(); });
  };

  const selectTier = async (tier: string): Promise<void> => {
    const select = container.querySelector('select') as HTMLSelectElement | null;
    expect(select, 'resolution tier <select> not found').toBeTruthy();
    await act(async () => {
      select!.value = tier;
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  const toggleOverlay = async (): Promise<void> => {
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('overlay text on all segments'),
    );
    expect(btn, 'overlay toggle not found').toBeTruthy();
    await act(async () => { btn!.click(); });
  };

  return {
    get segments() { return state.segments; },
    setAllOverlay,
    resolutionTierChange,
    click,
    selectTier,
    toggleOverlay,
  } as Harness;
}

describe('WS2 T4.1 (D4) — the overlay cascade must not fire on an untouched control', () => {
  it('MIXED project: saving only a resolution-tier change moves no segment', async () => {
    // The discriminating case. `every()` is false here, so the draft seeds
    // `false` while segment `a` is genuinely `true` — the seed cannot
    // round-trip this project, and re-writing it is destructive, not a no-op.
    const before = [seg('a', true), seg('b', false), seg('c', true)];
    const h = await renderModal(before);

    await h.selectTier('720p');
    await h.click('Save');

    expect(h.resolutionTierChange).toHaveBeenCalledWith('720p');
    expect(h.setAllOverlay).not.toHaveBeenCalled();
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, false, true]);
  });

  it('MIXED project: saving with no edits at all moves no segment', async () => {
    const h = await renderModal([seg('a', true), seg('b', false)]);
    await h.click('Save');
    expect(h.setAllOverlay).not.toHaveBeenCalled();
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, false]);
  });

  it('ALL-ON project: saving only a tier change leaves every overlay on', async () => {
    const h = await renderModal([seg('a', true), seg('b', true)]);
    await h.selectTier('720p');
    await h.click('Save');
    expect(h.setAllOverlay).not.toHaveBeenCalled();
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, true]);
  });

  it('a GENUINE overlay change still cascades — the gate is not a mute button', async () => {
    const h = await renderModal([seg('a', true), seg('b', false)]);
    await h.toggleOverlay(); // false (the mixed seed) -> true
    await h.click('Save');
    expect(h.setAllOverlay).toHaveBeenCalledWith(true);
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, true]);
  });

  it('a genuine change turning overlays OFF cascades too', async () => {
    const h = await renderModal([seg('a', true), seg('b', true)]);
    await h.toggleOverlay(); // true (the all-on seed) -> false
    await h.click('Save');
    expect(h.setAllOverlay).toHaveBeenCalledWith(false);
    expect(h.segments.map((s) => s.showOverlay)).toEqual([false, false]);
  });

  it('toggling to a new value and back writes nothing — intent, not interaction', async () => {
    const h = await renderModal([seg('a', true), seg('b', true)]);
    await h.toggleOverlay();
    await h.toggleOverlay();
    await h.click('Save');
    expect(h.setAllOverlay).not.toHaveBeenCalled();
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, true]);
  });

  it('Cancel never cascades, even after a real overlay change', async () => {
    const h = await renderModal([seg('a', true), seg('b', false)]);
    await h.toggleOverlay();
    await h.click('Cancel');
    expect(h.setAllOverlay).not.toHaveBeenCalled();
    expect(h.segments.map((s) => s.showOverlay)).toEqual([true, false]);
  });
});
