// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ExportResumeUnavailableCard } from './ExportResumeUnavailableCard';
import { RESUME_UNAVAILABLE_COPY } from '../../services/exportFailure/exportFailureCopy';

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

describe('ExportResumeUnavailableCard', () => {
  it('explains that the session could not be preserved, without naming a kind', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(<ExportResumeUnavailableCard />);
    });
    expect(container.querySelector('[data-testid="export-resume-unavailable-title"]')?.textContent)
      .toBe(RESUME_UNAVAILABLE_COPY.title);
    expect(container.querySelector('[data-testid="export-resume-unavailable-body"]')?.textContent)
      .toBe(RESUME_UNAVAILABLE_COPY.body);
    expect(container.textContent).not.toMatch(/disk_full|Windows|graphics card paused/i);
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
  });
});
