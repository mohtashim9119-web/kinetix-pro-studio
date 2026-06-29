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

export const TRANSITIONS: EffectOption[] = [
  { label: 'Hard Cut',           value: 'hard-cut' },
  { label: 'Cross Dissolve',     value: 'cross-dissolve' },
  { label: 'Dip to Black',       value: 'dip-black' },
  { label: 'Dip to White',       value: 'dip-white' },
  { label: 'Wipe',               value: 'wipe' },
  { label: 'Slide / Push',       value: 'slide-push' },
  { label: 'Glitch / RGB Split', value: 'glitch-rgb' },
  { label: 'Whip Pan',           value: 'whip-pan' },
  { label: 'Zoom',               value: 'zoom' },
  { label: 'Light Leak',         value: 'light-leak' },
];

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

export const OVERLAYS: EffectOption[] = [
  { label: 'None',              value: 'none' },
  // procedural — selectable now
  { label: 'Letterbox',         value: 'letterbox' },
  { label: 'Vignette',          value: 'vignette' },
  { label: 'CRT / Scanlines',   value: 'crt-scanlines' },
  { label: 'Viewfinder',        value: 'viewfinder' },
  // asset-backed — disabled until media uploaded (Step 8)
  { label: 'Film Grain',            value: 'film-grain',  disabled: true },
  { label: 'Light Leaks',           value: 'light-leaks', disabled: true },
  { label: 'Film Damage',           value: 'film-damage', disabled: true },
  { label: 'Atmospheric Particles', value: 'particles',   disabled: true },
  { label: 'Weather (Rain/Fog/Snow)', value: 'weather',   disabled: true },
  { label: 'Fire / Embers',         value: 'fire-embers', disabled: true },
];

/** Slug -> label lookup. Returns undefined if value is undefined or has no match. */
export function labelOf(opts: EffectOption[], value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return opts.find((o) => o.value === value)?.label;
}
