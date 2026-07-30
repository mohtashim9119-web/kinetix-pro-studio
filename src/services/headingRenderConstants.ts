/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Heading-layer rendering constants — shared by the preview DOM overlay
// (components/PreviewStage.tsx) and both export text renderers
// (services/webcodecsExport/textRenderer.ts, services/frameRenderer.ts) so
// the three call sites cannot drift on the numbers that keep a heading's
// on-screen size and rasterization quality consistent between what the
// editor shows and what the exported video contains.
// ---------------------------------------------------------------------------

/**
 * Reference frame height a heading's authored `fontSize` is calibrated
 * against — the same 1080-reference convention body captions already use
 * (`PreviewStage.tsx`'s `captionScale = stageHeight / 1080`,
 * `textRenderer.ts`'s `resolveBodyCaptionConfig`'s `refScale = frameH /
 * 1080`, `frameRenderer.ts`'s own `refScale`). Headings previously had no
 * such correction on either side: `fontSize` was used as literal pixels
 * against whichever surface happened to be rendering it — the live editor
 * panel's own (usually much smaller) CSS height in preview, the full export
 * frame height in export — so the same numeric value produced wildly
 * different proportions of the frame in each. Dividing by this constant on
 * both sides makes a heading occupy the same fraction of the frame in the
 * editor as it does in the exported video, at any panel size or export
 * resolution tier.
 */
export const HEADING_REFERENCE_HEIGHT = 1080;

/**
 * Supersample factor for the export heading text atlas
 * (`webcodecsExport/textRenderer.ts`'s `buildHeadingTextAtlas` and
 * `frameRenderer.ts`'s `drawHeadingLayerOverlay`): text is rasterized at
 * `HEADING_SUPERSAMPLE_FACTOR`x the frame's pixel dimensions, then drawn
 * back down to 1x frame size (GL: a LINEAR-filtered texture sample; legacy:
 * a `drawImage` downscale) — antialiasing the glyph edges instead of
 * leaving them at Canvas2D's native 1:1 rasterization, which is visibly
 * softer/blockier than the preview's OS-hinted DOM vector text once the two
 * are compared side by side. 2 is the standard supersampling factor for
 * text (matches common 2x Retina-class glyph rasterization); doubling both
 * axes is 4x the pixel/texture memory for this one texture, acceptable
 * since a heading atlas is a single texture per frame, not per-segment.
 */
export const HEADING_SUPERSAMPLE_FACTOR = 2;
