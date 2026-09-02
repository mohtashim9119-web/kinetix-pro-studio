/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// New Project Defaults (WS2 T4.1) — the machine-global seeds the New Project
// modal pre-fills from. Stored in `kinetix:ui:v1` alongside the WebCodecs
// toggle, for the same reason it lives there: these are per-MACHINE
// preferences, not project state, and `uiStateStore.ts` is already the one
// per-machine store this app has. No new key, no new serializer.
//
// WHAT A DEFAULT IS AND IS NOT, because the distinction is the whole design.
// A value here is a SEED for the New Project modal's initial field values —
// nothing more. It is read once, when that modal opens. It is never consulted
// again for the life of a project, never written back onto a project, and
// changing it never reaches a project that already exists. That is what makes
// it safe to be machine-global: a global that only ever seeds a form cannot
// reach backward into existing work, which is precisely the failure that made
// the old per-machine FA toggle unshippable (WS1 Session F, finding F6; see
// `faGate.ts`'s module header).
//
// THE LANGUAGE DEFAULT IS THE ONE THAT NEEDS CARE. `AUTO_DETECT` is not a
// language code and is not written anywhere: a new project created under it
// carries NO `language` field at all. That absence is load-bearing —
// `resolveFaLanguage` is `language ?? detectedLanguage`, and `useWhisper.ts`
// writes a detection only into an EMPTY `language`, so any seeded code
// (including `'en'`) permanently shadows Whisper detection for every project
// created afterwards. `languageDefaultDrift.test.ts` locks the absence at the
// `makeDefaultProject` end; `appDefaultsSurface.test.ts` locks this end.
// ---------------------------------------------------------------------------

import { readUiState, patchUiState } from './uiStateStore';
import { DEFAULT_ASPECT_RATIO, DEFAULT_RESOLUTION_TIER } from './resolutionConfig';
import { FA_PROJECT_DEFAULT_ON } from './faGate';
import { SUPPORTED_LANGUAGE_CODES } from '../constants';
import type { AspectRatio, ResolutionTier } from '../types';

/** The "no language override" choice. Deliberately not a whisper code, so it
 *  cannot collide with one; `ProjectSettingsModal` uses the same sentinel
 *  string for the same meaning. Choosing it writes nothing. */
export const AUTO_DETECT = 'auto';

const KEY_ASPECT = 'defaultAspectRatio';
const KEY_TIER = 'defaultResolutionTier';
const KEY_LANGUAGE = 'defaultLanguage';
const KEY_FA = 'defaultFaHighPrecisionSync';
const KEY_OVERLAY = 'defaultTextOverlay';

/**
 * What a brand-new project's high-precision-sync switch is seeded with when
 * the user has never set a New Project Default.
 *
 * SHIPPED OFF, and the reason is a capability fact rather than a preference
 * (owner instruction, WS2 T4.1). `fa-inference` is not in `Cargo.toml`'s
 * default feature set, so a default build's `fa_align` returns
 * `not_implemented` for every run and falls back to Whisper timing — see
 * `docs/work-in-progress.md` §5's `[DEFERRED · BLOCKS T4.1 CLOSE]` entry. A
 * default of ON would promise precision the shipped binary cannot deliver.
 *
 * Separate from `faGate.ts`'s `FA_PROJECT_DEFAULT_ON`, which is the READ-TIME
 * fallback for a project that has no stored preference, and stays that. This
 * one only seeds a form field. They agree today and are not required to: when
 * the deferred entry closes, this can flip without touching the semantics of
 * an absent `Project.faHighPrecisionSync`.
 */
export const NEW_PROJECT_FA_DEFAULT_ON = false;

/** Seed for the per-segment text-overlay default. Mirrors the `showOverlay:
 *  false` every segment is constructed with today (`App.tsx`). */
export const NEW_PROJECT_TEXT_OVERLAY_DEFAULT_ON = false;

export interface NewProjectDefaults {
  aspectRatio: AspectRatio;
  resolutionTier: ResolutionTier;
  /** A supported whisper code, or `AUTO_DETECT` — never an empty string. */
  language: string;
  faHighPrecisionSync: boolean;
  textOverlay: boolean;
}

const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
const RESOLUTION_TIERS: readonly ResolutionTier[] = ['720p', '1080p'];

/**
 * Reads the stored defaults, falling back per-field. Every field is validated
 * against its own legal set rather than merely type-checked: `kinetix:ui:v1`
 * is a shared JSON blob that other writers touch, and a stale or hand-edited
 * `'4K'` must resolve to a real tier instead of reaching `resolveDimensions`
 * as a key that does not exist there. Never throws.
 */
export function readNewProjectDefaults(): NewProjectDefaults {
  let ui: Record<string, unknown> = {};
  try { ui = readUiState(); } catch { /* unreadable store — all fallbacks */ }

  const aspect = ui[KEY_ASPECT];
  const tier = ui[KEY_TIER];
  const language = ui[KEY_LANGUAGE];
  const fa = ui[KEY_FA];
  const overlay = ui[KEY_OVERLAY];

  return {
    aspectRatio: ASPECT_RATIOS.includes(aspect as AspectRatio)
      ? (aspect as AspectRatio)
      : DEFAULT_ASPECT_RATIO,
    resolutionTier: RESOLUTION_TIERS.includes(tier as ResolutionTier)
      ? (tier as ResolutionTier)
      : DEFAULT_RESOLUTION_TIER,
    language:
      language === AUTO_DETECT || SUPPORTED_LANGUAGE_CODES.includes(language as string)
        ? (language as string)
        : AUTO_DETECT,
    faHighPrecisionSync: typeof fa === 'boolean' ? fa : NEW_PROJECT_FA_DEFAULT_ON,
    textOverlay: typeof overlay === 'boolean' ? overlay : NEW_PROJECT_TEXT_OVERLAY_DEFAULT_ON,
  };
}

/** Writes all five at once — App Settings commits them together on Save. */
export function writeNewProjectDefaults(next: NewProjectDefaults): void {
  patchUiState({
    [KEY_ASPECT]: next.aspectRatio,
    [KEY_TIER]: next.resolutionTier,
    [KEY_LANGUAGE]: next.language,
    [KEY_FA]: next.faHighPrecisionSync,
    [KEY_OVERLAY]: next.textOverlay,
  });
}

/**
 * The five constants a fresh install resolves to, as a value — so a test can
 * assert the shipped defaults without restating five literals of its own, and
 * so `FA_PROJECT_DEFAULT_ON` has one place that observes it agreeing with
 * `NEW_PROJECT_FA_DEFAULT_ON` rather than a comment claiming they do.
 */
export const SHIPPED_NEW_PROJECT_DEFAULTS: NewProjectDefaults = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  resolutionTier: DEFAULT_RESOLUTION_TIER,
  language: AUTO_DETECT,
  faHighPrecisionSync: NEW_PROJECT_FA_DEFAULT_ON,
  textOverlay: NEW_PROJECT_TEXT_OVERLAY_DEFAULT_ON,
};

/** Kept honest by `appDefaults.test.ts`: the seed and the read-time fallback
 *  are separate constants that happen to agree today. This re-exports the
 *  gate's value so the test observes both without importing two modules. */
export { FA_PROJECT_DEFAULT_ON };
