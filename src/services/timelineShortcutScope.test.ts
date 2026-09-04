/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const APP_TSX = resolve(import.meta.dirname, '../App.tsx');

describe('WS2 — Timeline S/D shortcut scope', () => {
  const src = readFileSync(APP_TSX, 'utf-8');

  it('arms S/D only after pointerdown inside #timeline-scroll-area', () => {
    expect(src).toContain('timelineShortcutsArmedRef');
    expect(src).toContain("document.getElementById('timeline-scroll-area')?.contains(target)");
    expect(src).toContain("window.addEventListener('pointerdown', armFromPointerDown, true)");
  });

  it('S and D both require timelineShortcutsArmedRef alongside the existing guards', () => {
    const sBlock = src.slice(src.indexOf("(e.key === 's' || e.key === 'S')"));
    const dBlock = src.slice(src.indexOf("(e.key === 'd' || e.key === 'D')"));
    expect(sBlock).toContain('timelineShortcutsArmedRef.current');
    expect(dBlock).toContain('timelineShortcutsArmedRef.current');
    expect(sBlock).toContain('shortcutsSuppressedRef.current');
    expect(dBlock).toContain('shortcutsSuppressedRef.current');
  });
});
