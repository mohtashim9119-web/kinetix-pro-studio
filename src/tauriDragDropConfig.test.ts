/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The window MUST have `dragDropEnabled: false`.
//
// OLD BUG (found by reading wry 0.55's macOS `drag_drop.rs` and tauri-runtime-
// wry's handler): with Tauri's native drag-drop handler enabled (the default),
// the handler returns `true` for every drag, and wry then never forwards the
// drag to WebKit — the page receives NO HTML5 dragenter/dragover/drop at all.
// Every HTML5 drop target in the app was dead in the real window while its
// jsdom tests (which fabricate DragEvents) stayed green: Media tile -> timeline
// segment, Finder files onto the Files-tab slots, folder drops. The app never
// uses Tauri's own drag-drop events, so turning the handler off loses nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('tauri.conf.json — HTML5 drag and drop must reach the page', () => {
  const conf = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf-8')) as {
    app: { windows: { dragDropEnabled?: boolean }[] };
  };

  it('every window sets dragDropEnabled: false', () => {
    expect(conf.app.windows.length).toBeGreaterThan(0);
    for (const w of conf.app.windows) expect(w.dragDropEnabled).toBe(false);
  });

  it('the frontend does not depend on Tauri\'s native drag-drop events', () => {
    const files = ['App.tsx', 'components/DropZonePanel.tsx', 'components/PreviewStage.tsx'];
    for (const f of files) {
      const src = readFileSync(resolve(import.meta.dirname, f), 'utf-8');
      expect(src, f).not.toMatch(/onDragDropEvent|tauri:\/\/drag-drop/);
    }
  });
});
