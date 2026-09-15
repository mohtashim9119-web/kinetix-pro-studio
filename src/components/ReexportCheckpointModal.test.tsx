// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ReexportCheckpointModal } from './ReexportCheckpointModal';

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

describe('ReexportCheckpointModal', () => {
  it('renders exactly two buttons — Resume Session (primary) and Start Fresh (secondary)', async () => {
    let resumeCount = 0;
    let freshCount = 0;
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ReexportCheckpointModal
          secondsAlreadyRendered={30}
          secondsTotal={120}
          onResumeSession={() => { resumeCount += 1; }}
          onStartFresh={() => { freshCount += 1; }}
        />,
      );
    });
    const resume = container.querySelector<HTMLButtonElement>('[data-testid="reexport-resume-session"]');
    const fresh = container.querySelector<HTMLButtonElement>('[data-testid="reexport-start-fresh"]');
    expect(resume).not.toBeNull();
    expect(fresh).not.toBeNull();
    expect(resume!.className).toMatch(/bg-\[#F27D26\]/);
    expect(resume!.className).toMatch(/text-white/);

    await act(async () => { resume!.click(); });
    expect(resumeCount).toBe(1);
    expect(freshCount).toBe(0);

    await act(async () => { fresh!.click(); });
    expect(freshCount).toBe(1);
    expect(resumeCount).toBe(1);
  });

  it('shows the already-rendered progress figures passed in', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ReexportCheckpointModal
          secondsAlreadyRendered={90}
          secondsTotal={180}
          onResumeSession={() => {}}
          onStartFresh={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-testid="reexport-checkpoint-progress"]')?.textContent)
      .toBe('1:30 of 3:00 already rendered');
  });
});
