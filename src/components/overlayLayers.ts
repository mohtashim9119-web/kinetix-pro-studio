/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// THE OVERLAY SCALE — single source of truth for every app-level stacking
// value. No component writes a raw `z-[N]` for an overlay: it imports its
// class from `Z` below. The order is the contract (pinned by
// overlayLayers.test.ts, which also scans the source for strays):
//
//   editor content (≤ 60) < review panel < DASHBOARD PAGE < BULK DRAWER <
//   MODALS < app settings < relocation flow < popups < banners < blockers <
//   dialogs < fullscreen preview < dev panel
//
// Why the drawer sits exactly between the dashboard and the modals: it is a
// NON-modal side panel that must be visible and usable over the dashboard page
// (it was painted over at z-40 — invisible in the real window), yet every
// modal or dialog that can open over it must cover it. The dashboard paints
// its OWN delete-confirm dialog inside its stacking context, so the dashboard
// lifts itself to the modal layer while that dialog is open (see
// `ProjectDashboard`), which covers the drawer for the duration.
//
// Tailwind needs whole class names in source to generate them, so every entry
// carries its literal class string alongside its number; the test asserts the
// two agree.
// ---------------------------------------------------------------------------

/** Numeric layers, lowest to highest. */
export const Z_INDEX = {
  /** Floating controls inside the editor's preview stage — above the stage's
   *  own layers (≤ 50), below every app-level overlay. */
  editorControls: 60,
  reviewMapping: 150,
  dashboard: 200,
  drawer: 201,
  modal: 205,
  appSettings: 210,
  relocation: 220,
  popup: 300,
  banner: 400,
  blocker: 500,
  dialog: 600,
  previewFullscreen: 5000,
  devPanel: 9999,
} as const;

export type OverlayLayer = keyof typeof Z_INDEX;

/** Literal Tailwind classes, one per layer (whole strings so the generator sees them). */
export const Z = {
  editorControls: 'z-[60]',
  reviewMapping: 'z-[150]',
  dashboard: 'z-[200]',
  drawer: 'z-[201]',
  modal: 'z-[205]',
  appSettings: 'z-[210]',
  relocation: 'z-[220]',
  popup: 'z-[300]',
  banner: 'z-[400]',
  blocker: 'z-[500]',
  dialog: 'z-[600]',
  previewFullscreen: 'z-[5000]',
  devPanel: 'z-[9999]',
} as const satisfies Record<OverlayLayer, string>;
