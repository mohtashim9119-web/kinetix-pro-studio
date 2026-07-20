/* ============================================================
   Kinetix Pro Studio — Effects option source (single source of truth)
   Step 2 of the Effects Tab Rebuild: DATA ONLY.
   Dropdowns, randomize pools, and presets all read from these arrays.
   No option here is functional yet — renderer wiring lands in Step 8.
   ============================================================ */

export interface EffectOption {
  label: string;
  value: string;
  /** Asset-backed overlays are visible but unselectable until media is supplied (Step 8). */
  disabled?: boolean;
}

export const TRANSITION_NONE = 'hard-cut';
export const ANIMATION_NONE = 'none';
export const OVERLAY_NONE = 'none';

/**
 * The transition set the app offers — restricted at the WebGL2 Phase 5
 * cutover (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Section 6) to exactly the slugs
 * the GL effects engine implements (compositeParams.ts's GL_TRANSITION_SLUGS),
 * plus the hard-cut sentinel.
 *
 * Five slugs were retired here — wipe, slide-push, glitch-rgb, whip-pan, zoom.
 * They were only ever rendered in preview by the CSS/Canvas2D snapshot path
 * (useTransitionPreview.ts) that Phase 5 deletes; the GL engine never
 * implemented them, so keeping them selectable would have shown a hard cut in
 * preview while export still rendered the real effect. See RETIRED_TRANSITIONS
 * in services/transitionResolver.ts for how already-saved projects using them
 * are resolved.
 */
export const TRANSITIONS: EffectOption[] = [
  // 'hard-cut' is the off-state sentinel (TRANSITION_NONE). Labelled "None" to
  // match the ANIMATIONS/OVERLAYS off-states; the slug is deliberately NOT
  // renamed, because it is persisted on segments and is load-bearing in
  // transitionResolver.ts (a stored 'hard-cut' means "no slug chosen") and in
  // App.tsx's legacy-twin reset. Label-only change.
  { label: 'None',               value: 'hard-cut' },
  { label: 'Cross Dissolve',     value: 'cross-dissolve' },
  { label: 'Dip to Black',       value: 'dip-black' },
  { label: 'Dip to White',       value: 'dip-white' },
  { label: 'Light Leak',         value: 'light-leak' },
];

/**
 * FULL animation/clip-effect catalog — every slug the renderers implement.
 *
 * This is the LABEL LOOKUP source (labelOf), deliberately kept complete: a
 * segment saved with any of these still renders it, so its name must still
 * resolve for BottomDrawer's effect pills and EffectsPanel's preset rows. What
 * the dropdown OFFERS is ANIMATIONS_VISIBLE below — a strict subset.
 *
 * Nothing here is retired and nothing folds (contrast TRANSITIONS above, whose
 * retired slugs are remapped in transitionResolver.ts). Those transitions were
 * BROKEN post-cutover — preview showed a hard cut while export rendered the
 * real effect — so folding repaired a divergence. Every slug below renders
 * identically in preview AND export today, so hiding one from the picker costs
 * nothing and folding would only destroy working content.
 *
 * TODO(filters-tab): 'color-grade', 'gaussian-blur', 'duotone', 'sepia' and
 * 'invert' are FILTERS, not animations — they share this dropdown only for
 * historical reasons. They are RESERVED for a future dedicated "Filters" tab
 * and are fully implemented on both paths right now; do not delete them.
 *   - preview: PreviewStage.tsx's getClipEffectStyle
 *   - export:  frameRenderer.ts's resolveClipEffectFilter, plus the 'duotone'
 *              pixel op in renderSegmentFrame
 * 'ken-burns' is a real animation, hidden alongside them; its code is shared
 * with the zoom math (canvasAnimations.ts / getAnimationWrapperProps) and must
 * likewise stay.
 */
export const ANIMATIONS: EffectOption[] = [
  { label: 'None',              value: 'none' },
  { label: 'Color Correction & Grading', value: 'color-grade' },
  { label: 'Zoom In',           value: 'zoom-in' },
  { label: 'Zoom Out',          value: 'zoom-out' },
  { label: 'Ken Burns',         value: 'ken-burns' },
  { label: 'Gaussian Blur',     value: 'gaussian-blur' },
  { label: 'Duotone / Color Wash', value: 'duotone' },
  { label: 'Sepia / Vintage',   value: 'sepia' },
  { label: 'Invert Colors',     value: 'invert' },
];

/**
 * What the ANIMATIONS dropdown actually offers: the off-state plus the two
 * zoom slugs the WebGL2 engine implements (compositeParams.ts's
 * resolveEffectiveAnimation). Everything else in the catalog above is hidden
 * from the picker — see that comment for why each is hidden rather than
 * deleted, and why existing segments are left alone.
 */
export const ANIMATIONS_VISIBLE: EffectOption[] = ANIMATIONS.filter((o) =>
  o.value === ANIMATION_NONE || o.value === 'zoom-in' || o.value === 'zoom-out',
);

/**
 * FULL overlay catalog — label-lookup source, same role as ANIMATIONS above.
 *
 * NOTE: none of these are implemented. `VideoSegment.effectOverlay` is written
 * by App.tsx's apply handler and read ONLY by BottomDrawer's display pill —
 * there is no renderer for it on either path, so selecting Letterbox/Vignette/
 * CRT/Viewfinder has never done anything in preview or export. That is why the
 * OVERLAYS section is now presented as "Coming Soon" and made non-interactive
 * (EffectsPanel.tsx), and why hiding these costs nothing: there is no behaviour
 * to preserve and nothing to fold.
 */
export const OVERLAYS: EffectOption[] = [
  { label: 'None',              value: 'none' },
  // procedural
  { label: 'Letterbox',         value: 'letterbox' },
  { label: 'Vignette',          value: 'vignette' },
  { label: 'CRT / Scanlines',   value: 'crt-scanlines' },
  { label: 'Viewfinder',        value: 'viewfinder' },
  // asset-backed
  { label: 'Film Grain',            value: 'film-grain',  disabled: true },
  { label: 'Light Leaks',           value: 'light-leaks', disabled: true },
  { label: 'Film Damage',           value: 'film-damage', disabled: true },
  { label: 'Atmospheric Particles', value: 'particles',   disabled: true },
  { label: 'Weather (Rain/Fog/Snow)', value: 'weather',   disabled: true },
  { label: 'Fire / Embers',         value: 'fire-embers', disabled: true },
];

/** What the (disabled) OVERLAYS dropdown offers: the off-state only. */
export const OVERLAYS_VISIBLE: EffectOption[] = OVERLAYS.filter((o) => o.value === OVERLAY_NONE);

/** Slug -> label lookup. Returns undefined if value is undefined or has no match.
 *  Always pass a FULL catalog (TRANSITIONS/ANIMATIONS/OVERLAYS), never a
 *  *_VISIBLE subset — a segment can legitimately hold a hidden slug, and its
 *  name should still resolve. */
export function labelOf(opts: EffectOption[], value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return opts.find((o) => o.value === value)?.label;
}
