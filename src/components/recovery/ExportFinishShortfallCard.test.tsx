// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ExportFinishShortfallCard } from './ExportFinishShortfallCard';
import { FINISH_SHORTFALL_COPY } from '../../services/exportFailure/exportFailureCopy';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExportFinishShortfallCard', () => {
  it('renders expected, produced, and shortfall from props without subtracting them', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ExportFinishShortfallCard
          expectedFrames={100}
          producedFrames={90}
          shortfallFrames={7}
        />,
      );
    });
    expect(container.querySelector('[data-testid="export-finish-shortfall-title"]')?.textContent)
      .toBe(FINISH_SHORTFALL_COPY.title);
    expect(container.querySelector('[data-testid="export-shortfall-expected"]')?.textContent).toBe('100');
    expect(container.querySelector('[data-testid="export-shortfall-produced"]')?.textContent).toBe('90');
    // 7, not 10 — the view must not compute expected - produced.
    expect(container.querySelector('[data-testid="export-shortfall-missing"]')?.textContent).toBe('7');
  });
});
