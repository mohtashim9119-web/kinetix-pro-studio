// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MissingMediaExportWarning } from './MissingMediaExportWarning';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

describe('MissingMediaExportWarning', () => {
  it('shows the warning and two buttons; Add Media is orange, continue is grey; each fires its own callback', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onCancel = vi.fn();
    const onContinue = vi.fn();
    await act(async () => {
      root!.render(<MissingMediaExportWarning issues={{ none: [3, 7], offline: [], corrupt: [] }} onCancel={onCancel} onContinue={onContinue} />);
    });
    expect(container.textContent).toContain(
      'Segments 3, 7 have no media and will export as black frames, using slower export path. Add media or continue.',
    );
    const cancel = container.querySelector<HTMLButtonElement>('[data-testid="missing-media-cancel"]')!;
    const cont = container.querySelector<HTMLButtonElement>('[data-testid="missing-media-continue"]')!;
    expect(cancel.textContent).toBe('Add Media');
    expect(cancel.getAttribute('data-testid')).toBe('missing-media-cancel');
    expect(cont.textContent).toBe('Continue');
    expect(cancel.className).toContain('F27D26');
    expect(cont.className).not.toContain('F27D26');
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    act(() => cont.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
