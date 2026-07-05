/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Snap-back fix (docs/webcodecs-architecture-plan.md, Phase A3 entry's
 * "residual issue 1"). `useWebCodecsPreview.ts`'s `computeDisplayedSegment`
 * correctly holds the intra-segment animation transform on the OUTGOING
 * segment's own frozen end-state while content catch-up is pending, but the
 * instant it releases, the segment (and therefore the animation formula
 * feeding PreviewStage.tsx's `getAnimationWrapperProps`) snaps directly to
 * the incoming segment — a hard, one-frame transform discontinuity. This
 * was invisible before Phase A1 (the old Framer wall-clock keyframes never
 * read `timeInSegment` at all); A1's conversion of 10 animation types to
 * pure functions of `timeInSegment` is what exposed it.
 *
 * `blendWrapperProps` is the fix's core: given the "from" pose's computed
 * wrapper props (the frozen outgoing segment's own `getAnimationWrapperProps`
 * output) and the "to" pose's (the live incoming segment's), it produces a
 * single wrapper-props object whose transform/opacity/filter fields are
 * numerically interpolated between the two — a real interpolation of the
 * VALUE the animation renders, not an opacity mask laid over the jump.
 * Deliberately NOT part of `canvasAnimations.ts` (the shared preview/export
 * animation-math module) — export has no equivalent discontinuity to fix
 * (`segmentEncoder.ts` renders every frame directly from the correct
 * segment/time with no async decode-catch-up gate), so this is a
 * preview-only concern.
 *
 * Every `AnimationType` case in `getAnimationWrapperProps` returns at most
 * these CSS fields, so that's the closed set this module parses/blends:
 *   - `transform`, composed of some subset of `translate(Npx, Npx)` (GLITCH's
 *     two-arg form), `translateX(Npx)`, `translateY(Npx)`, `scale(N)`,
 *     `rotate(Ndeg)`, `skewX(Ndeg)` — space-separated, e.g. KEN_BURNS's
 *     `scale(s) translateX(x)`.
 *   - `transformOrigin` — a fixed string ('center center'), never blended,
 *     just carried through (prefers the "to" side, falling back to "from").
 *   - `opacity` (NEON_FLICKER only) and `filter: blur(Npx)` (GLITCH only,
 *     conditionally) — numeric, straightforward lerp.
 * A component missing on one side defaults to that CSS property's identity
 * value on that side (e.g. `scale(1)`, `translateY(0px)`, `opacity: 1`) so
 * blending FROM a segment using one animation type TOWARD a segment using a
 * completely different one (or `AnimationType.NONE`) still produces a
 * sensible, continuous "settle" rather than a parse failure or NaN.
 *
 * Accepted caveat: components are always re-serialized in a fixed canonical
 * order (`translate`, `translateX`, `translateY`, `scale`, `rotate`,
 * `skewX`), which can differ from a given case's own original order (e.g.
 * KEN_BURNS writes `scale(...) translateX(...)`, canonical order swaps
 * that). CSS transform composition order matters for compound transforms,
 * so this is a cosmetic difference in stacking order during the ~120ms
 * blend window specifically — negligible in practice, and moot outside the
 * blend window entirely, since callers only invoke this function while a
 * blend is actually in progress (see `computeBlendProgress` in
 * `useWebCodecsPreview.ts`) and use the "to" pose's own untouched output
 * once it completes.
 */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function extractNum(re: RegExp, s: string | undefined): number | null {
  if (!s) return null;
  const m = re.exec(s);
  return m ? parseFloat(m[1] ?? '0') : null;
}

function extractTranslatePair(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(s);
  return m ? [parseFloat(m[1] ?? '0'), parseFloat(m[2] ?? '0')] : null;
}

function styleOf(props: Record<string, unknown>): Record<string, unknown> {
  const style = props.style;
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

function transformOf(style: Record<string, unknown>): string | undefined {
  return typeof style.transform === 'string' ? style.transform : undefined;
}

/**
 * Blends the wrapper props returned by two `getAnimationWrapperProps` calls
 * — see this file's header for the exact contract. `t` is the blend
 * progress (0 = fully `from`, 1 = fully `to`), expected to be produced by
 * `computeBlendProgress` (currentTime-driven, not a wall clock).
 */
export function blendWrapperProps(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  t: number,
): Record<string, unknown> {
  const fromStyle = styleOf(from);
  const toStyle = styleOf(to);
  const fromTransform = transformOf(fromStyle);
  const toTransform = transformOf(toStyle);

  const parts: string[] = [];

  const fromTranslate = extractTranslatePair(fromTransform);
  const toTranslate = extractTranslatePair(toTransform);
  if (fromTranslate || toTranslate) {
    const [fx, fy] = fromTranslate ?? [0, 0];
    const [tx, ty] = toTranslate ?? [0, 0];
    parts.push(`translate(${lerp(fx, tx, t)}px, ${lerp(fy, ty, t)}px)`);
  }

  const fromTX = extractNum(/translateX\(([-\d.]+)px\)/, fromTransform);
  const toTX = extractNum(/translateX\(([-\d.]+)px\)/, toTransform);
  if (fromTX !== null || toTX !== null) {
    parts.push(`translateX(${lerp(fromTX ?? 0, toTX ?? 0, t)}px)`);
  }

  const fromTY = extractNum(/translateY\(([-\d.]+)px\)/, fromTransform);
  const toTY = extractNum(/translateY\(([-\d.]+)px\)/, toTransform);
  if (fromTY !== null || toTY !== null) {
    parts.push(`translateY(${lerp(fromTY ?? 0, toTY ?? 0, t)}px)`);
  }

  const fromScale = extractNum(/scale\(([-\d.]+)\)/, fromTransform);
  const toScale = extractNum(/scale\(([-\d.]+)\)/, toTransform);
  if (fromScale !== null || toScale !== null) {
    parts.push(`scale(${lerp(fromScale ?? 1, toScale ?? 1, t)})`);
  }

  const fromRotate = extractNum(/rotate\(([-\d.]+)deg\)/, fromTransform);
  const toRotate = extractNum(/rotate\(([-\d.]+)deg\)/, toTransform);
  if (fromRotate !== null || toRotate !== null) {
    parts.push(`rotate(${lerp(fromRotate ?? 0, toRotate ?? 0, t)}deg)`);
  }

  const fromSkew = extractNum(/skewX\(([-\d.]+)deg\)/, fromTransform);
  const toSkew = extractNum(/skewX\(([-\d.]+)deg\)/, toTransform);
  if (fromSkew !== null || toSkew !== null) {
    parts.push(`skewX(${lerp(fromSkew ?? 0, toSkew ?? 0, t)}deg)`);
  }

  const style: Record<string, unknown> = {};
  if (parts.length > 0) style.transform = parts.join(' ');

  const transformOrigin = toStyle.transformOrigin ?? fromStyle.transformOrigin;
  if (transformOrigin !== undefined) style.transformOrigin = transformOrigin;

  const fromOpacity = typeof fromStyle.opacity === 'number' ? fromStyle.opacity : null;
  const toOpacity = typeof toStyle.opacity === 'number' ? toStyle.opacity : null;
  if (fromOpacity !== null || toOpacity !== null) {
    style.opacity = lerp(fromOpacity ?? 1, toOpacity ?? 1, t);
  }

  const fromBlur = extractNum(/blur\(([\d.]+)px\)/, typeof fromStyle.filter === 'string' ? fromStyle.filter : undefined);
  const toBlur = extractNum(/blur\(([\d.]+)px\)/, typeof toStyle.filter === 'string' ? toStyle.filter : undefined);
  if (fromBlur !== null || toBlur !== null) {
    style.filter = `blur(${lerp(fromBlur ?? 0, toBlur ?? 0, t)}px)`;
  }

  return Object.keys(style).length > 0 ? { style } : {};
}
