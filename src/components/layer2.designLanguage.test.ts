/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R9 — source-scan pins (same convention as overlayLayers.test.ts and the
// App-wiring scans): Layer 2 speaks the app's design language. These pin the ALIGNMENT
// (existing components + --kx tokens) and the ABSENCE of bespoke styling; they do not
// assert behavior (the Layer-2 behavior tests are untouched).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, rel), 'utf-8');
const panel = read('Layer2Panel.tsx');
const layer = read('SpotLayer.tsx');
const timeline = read('Timeline.tsx');
const laneSrc = timeline.slice(timeline.indexOf('data-spot-lane'), timeline.indexOf('Segment track (unchanged internals'));
const css = read('../index.css');

describe('Layer 2 — no bespoke palette, no raw z-[N]', () => {
  it.each([['Layer2Panel', panel], ['SpotLayer', layer], ['Timeline Layer-2 lane', laneSrc]])('%s uses no off-token Tailwind colors', (_n, src) => {
    expect(src).not.toMatch(/\b(text|bg|border)-(red|amber|yellow|blue|zinc|slate|green)-\d/);
  });
  it.each([['Layer2Panel', panel], ['SpotLayer', layer], ['Timeline Layer-2 lane', laneSrc]])('%s writes no raw z-[N]', (_n, src) => {
    expect(src).not.toMatch(/z-\[\d+\]/);
  });
});

describe('Layer 2 — aligned to existing components', () => {
  it('delete uses the EXISTING ConfirmDialog (the asset-delete confirm), with the same copy tone', () => {
    expect(panel).toContain("import { ConfirmDialog } from './ConfirmDialog'");
    expect(panel).toContain('Delete this spot?');
  });
  it('media search matches MediaBlock\'s search control (Search icon, surface-2 field, "Search media…")', () => {
    expect(panel).toContain('Search media…');
    expect(panel).toMatch(/<Search size=\{12\}/);
    expect(panel).toContain('bg-[var(--kx-surface-2)] rounded-lg px-2 py-1');
  });
  it('rows use the panel row pattern: rounded-[13px] surface + line border, accent-soft when selected', () => {
    expect(panel).toContain('rounded-[13px]');
    expect(panel).toContain('bg-[var(--kx-surface)]');
    expect(panel).toContain('border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)]');
    expect(panel).toContain('hover:border-[var(--kx-line-2)]');
  });
  it('findings use the panel\'s notice-box shape and the --kx semantic tokens', () => {
    expect(panel).toContain('rounded-[9px]');
    expect(panel).toContain('var(--kx-warning)');
    expect(panel).toContain('var(--kx-danger)');
  });
  it('geometry row uses tabular figures', () => {
    expect(panel).toMatch(/tabular-nums/);
  });
  it('timeline blocks use the SEGMENT card pattern (80px lane, rounded-lg, idle/hover/active fills, w-2 edge handles)', () => {
    expect(laneSrc).toContain('h-20');
    expect(laneSrc).toContain('rounded-lg border');
    expect(laneSrc).toContain('bg-[#151515] border-[#F27D26]');
    expect(laneSrc).toContain('bg-[#080808] border-[#1A1A1A] hover:bg-[#0C0C0C]');
    expect(laneSrc).toContain('w-2');
    expect(laneSrc).toContain('cursor-col-resize');
  });
  it('[NO CLIP] is an honest-empty tile (kx-art-empty), never blank', () => {
    expect(layer).toContain('kx-art-empty');
    expect(laneSrc).toContain('kx-art-empty');
  });
  it('the token-built kx-art-empty variant exists and uses only --kx tokens', () => {
    const block = css.slice(css.indexOf('.kx-art-empty {'), css.indexOf('}', css.indexOf('.kx-art-empty {')));
    expect(block).toContain('var(--kx-faint)');
    expect(block).toContain('var(--kx-surface-2)');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
  it('selection ring on the preview box derives from the accent token', () => {
    expect(layer).toContain('var(--kx-accent-line)');
  });
});
