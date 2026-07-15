import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  ANIMATIONS,
  ANIMATIONS_VISIBLE,
  OVERLAYS,
  OVERLAYS_VISIBLE,
  TRANSITION_NONE,
  ANIMATION_NONE,
  OVERLAY_NONE,
  labelOf,
} from './effectsOptions';

/**
 * Pure data-module tests, mock-free — same discipline as compositeParams.test.ts.
 *
 * These pin the post-cutover Effects-tab contract, which is easy to break by
 * accident: the picker offers a strict SUBSET of a catalog that stays complete.
 * A well-meaning "remove the unused options" cleanup would delete working
 * features and silently blank out the labels of already-saved segments.
 */

const values = (opts: { value: string }[]) => opts.map((o) => o.value);

describe('TRANSITIONS — the off-state is labelled "None" but keeps the hard-cut slug', () => {
  it('offers exactly the 4 GL-implemented transitions plus the off-state', () => {
    expect(values(TRANSITIONS)).toEqual([
      'hard-cut', 'cross-dissolve', 'dip-black', 'dip-white', 'light-leak',
    ]);
  });

  it('labels the off-state "None" — matching the ANIMATIONS/OVERLAYS off-states', () => {
    expect(TRANSITIONS[0]!.label).toBe('None');
  });

  it('the off-state VALUE is still the hard-cut sentinel — the rename is label-only', () => {
    // Load-bearing: transitionResolver.ts treats a stored 'hard-cut' as "no slug
    // chosen", and App.tsx's legacy-twin reset depends on the same sentinel.
    // Renaming the value would silently change how every saved segment resolves.
    expect(TRANSITIONS[0]!.value).toBe('hard-cut');
    expect(TRANSITIONS[0]!.value).toBe(TRANSITION_NONE);
  });
});

describe('ANIMATIONS — picker is a subset of a catalog that stays complete', () => {
  it('the dropdown offers ONLY None + the two GL zooms', () => {
    expect(values(ANIMATIONS_VISIBLE)).toEqual([ANIMATION_NONE, 'zoom-in', 'zoom-out']);
  });

  it('every visible option exists in the full catalog', () => {
    const catalog = new Set(values(ANIMATIONS));
    for (const v of values(ANIMATIONS_VISIBLE)) expect(catalog.has(v)).toBe(true);
  });

  // The point of the whole hide-don't-delete design. These 5 are FILTERS
  // reserved for a future Filters tab, plus ken-burns; all are fully
  // implemented in preview (PreviewStage's getClipEffectStyle /
  // getAnimationWrapperProps) AND export (frameRenderer's
  // resolveClipEffectFilter + the duotone pixel op / canvasAnimations).
  // Deleting any of them from the catalog breaks working segments.
  it.each(['color-grade', 'gaussian-blur', 'duotone', 'sepia', 'invert', 'ken-burns'])(
    'keeps the hidden-but-implemented slug "%s" in the catalog (reserved, not retired)',
    (slug) => {
      expect(values(ANIMATIONS)).toContain(slug);
    },
  );

  it.each(['color-grade', 'gaussian-blur', 'duotone', 'sepia', 'invert', 'ken-burns'])(
    'hides "%s" from the dropdown',
    (slug) => {
      expect(values(ANIMATIONS_VISIBLE)).not.toContain(slug);
    },
  );

  // The leave-as-is contract: a segment saved before the cut still renders its
  // effect, so BottomDrawer's pill and EffectsPanel's preset rows must still be
  // able to name it. labelOf is given the full catalog for exactly this reason.
  it('still resolves the label of a hidden slug — a grandfathered segment keeps its name', () => {
    expect(labelOf(ANIMATIONS, 'sepia')).toBe('Sepia / Vintage');
    expect(labelOf(ANIMATIONS, 'ken-burns')).toBe('Ken Burns');
  });

  it('a *_VISIBLE subset canNOT name a hidden slug — which is why callers must pass the catalog', () => {
    expect(labelOf(ANIMATIONS_VISIBLE, 'sepia')).toBeUndefined();
  });
});

describe('OVERLAYS — Coming Soon, off-state only', () => {
  it('the dropdown offers ONLY the off-state', () => {
    expect(values(OVERLAYS_VISIBLE)).toEqual([OVERLAY_NONE]);
  });

  it('keeps the full catalog for label lookups', () => {
    // No overlay slug has a renderer on either path, so nothing here is load-
    // bearing for output — but a saved effectOverlay should still name itself
    // in BottomDrawer's pill rather than vanish.
    expect(labelOf(OVERLAYS, 'vignette')).toBe('Vignette');
    expect(values(OVERLAYS).length).toBeGreaterThan(values(OVERLAYS_VISIBLE).length);
  });
});
