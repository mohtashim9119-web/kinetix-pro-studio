import { describe, it, expect } from 'vitest';
import { blendWrapperProps } from './animBlend';

describe('blendWrapperProps', () => {
  it('returns {} when both sides are empty (e.g. AnimationType.NONE on both ends)', () => {
    expect(blendWrapperProps({}, {}, 0.5)).toEqual({});
  });

  it('interpolates a single scale() component halfway between from and to', () => {
    const from = { style: { transform: 'scale(1.3)', transformOrigin: 'center center' } };
    const to = { style: { transform: 'scale(1.0)', transformOrigin: 'center center' } };
    const result = blendWrapperProps(from, to, 0.5);
    expect(result).toEqual({ style: { transform: 'scale(1.15)', transformOrigin: 'center center' } });
  });

  it('at t=0 matches the from pose\'s own numeric value exactly', () => {
    const from = { style: { transform: 'translateY(-30px)' } };
    const to = { style: { transform: 'translateY(0px)' } };
    const result = blendWrapperProps(from, to, 0);
    expect(result.style).toMatchObject({ transform: 'translateY(-30px)' });
  });

  it('at t=1 matches the to pose\'s own numeric value exactly', () => {
    const from = { style: { transform: 'translateY(-30px)' } };
    const to = { style: { transform: 'translateY(5px)' } };
    const result = blendWrapperProps(from, to, 1);
    expect(result.style).toMatchObject({ transform: 'translateY(5px)' });
  });

  it('defaults a component missing on the "to" side to its CSS identity (settles to no-transform)', () => {
    // BOUNCE (translateY) releasing into a segment with AnimationType.NONE (no transform at all).
    const from = { style: { transform: 'translateY(-12px)' } };
    const to = {};
    const result = blendWrapperProps(from, to, 0.5);
    expect(result.style).toMatchObject({ transform: 'translateY(-6px)' });
  });

  it('defaults a component missing on the "from" side to its CSS identity (grows in from rest)', () => {
    // Releasing from AnimationType.NONE into a segment using SKEW.
    const from = {};
    const to = { style: { transform: 'skewX(45deg)' } };
    const result = blendWrapperProps(from, to, 0.5);
    expect(result.style).toMatchObject({ transform: 'skewX(22.5deg)' });
  });

  it('blends two entirely different animation types by unioning their components', () => {
    // from = BOUNCE (translateY), to = SHAKE (translateX) — both components
    // should appear in the output, each independently interpolated toward
    // its own identity on the side that lacks it.
    const from = { style: { transform: 'translateY(-30px)' } };
    const to = { style: { transform: 'translateX(8px)' } };
    const result = blendWrapperProps(from, to, 0.5);
    // Canonical serialization order is translate/translateX/translateY/scale/rotate/skewX
    // (see this module's header comment on the accepted ordering caveat).
    expect(result.style).toMatchObject({ transform: 'translateX(4px) translateY(-15px)' });
  });

  it('parses and blends the GLITCH two-arg translate() form', () => {
    const from = { style: { transform: 'translate(-5px, 2px)' } };
    const to = { style: { transform: 'translate(3px, -1px)' } };
    const result = blendWrapperProps(from, to, 0.5);
    expect(result.style).toMatchObject({ transform: 'translate(-1px, 0.5px)' });
  });

  it('blends opacity (NEON_FLICKER) with identity default of 1 on the side lacking it', () => {
    const from = { style: { opacity: 0.3 } };
    const to = {};
    const result = blendWrapperProps(from, to, 0.5);
    const style = result.style as Record<string, unknown>;
    expect(style.opacity as number).toBeCloseTo(0.65, 9);
  });

  it('blends filter blur (GLITCH, conditional) with identity default of 0px', () => {
    const from = { style: { transform: 'translate(1px, 1px)', filter: 'blur(2px)' } };
    const to = { style: { transform: 'translate(1px, 1px)' } };
    const result = blendWrapperProps(from, to, 0.5);
    expect(result.style).toMatchObject({ filter: 'blur(1px)' });
  });

  it('prefers the "to" side\'s transformOrigin, falling back to "from" when "to" lacks it', () => {
    const from = { style: { transform: 'scale(1)', transformOrigin: 'center center' } };
    const toWithOrigin = { style: { transform: 'scale(1.1)', transformOrigin: 'top left' } };
    expect(blendWrapperProps(from, toWithOrigin, 0.5).style).toMatchObject({ transformOrigin: 'top left' });

    const toWithoutOrigin = { style: { opacity: 1 } };
    expect(blendWrapperProps(from, toWithoutOrigin, 0.5).style).toMatchObject({ transformOrigin: 'center center' });
  });

  it('omits transform entirely when neither side specifies any transform component', () => {
    const from = { style: { opacity: 0.5 } };
    const to = { style: { opacity: 1 } };
    const result = blendWrapperProps(from, to, 0.5);
    expect(result.style).not.toHaveProperty('transform');
    expect(result.style).toMatchObject({ opacity: 0.75 });
  });
});
