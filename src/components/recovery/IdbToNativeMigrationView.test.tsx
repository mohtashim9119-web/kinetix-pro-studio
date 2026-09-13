// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  IdbToNativeMigrationView,
  type IdbToNativeMigrationStatus,
  type IdbToNativeMigrationViewProps,
} from './IdbToNativeMigrationView';
import { createRecoveryActionsFake } from './recoveryActionsFake';

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

async function renderView(
  over: Partial<IdbToNativeMigrationViewProps> & { status: IdbToNativeMigrationStatus },
): Promise<ReturnType<typeof createRecoveryActionsFake>> {
  const fake = createRecoveryActionsFake();
  const props: IdbToNativeMigrationViewProps = {
    total: 10,
    completed: 0,
    failed: 0,
    remaining: 10,
    failedAssets: [],
    resumable: false,
    onResume: fake.onResume,
    ...over,
  };
  root = createRoot(container);
  await act(async () => {
    root.render(<IdbToNativeMigrationView {...props} />);
  });
  return fake;
}

function counts(): { total: string; completed: string; failed: string; remaining: string } {
  return {
    total: container.querySelector('[data-testid="migration-total"]')?.textContent ?? '',
    completed: container.querySelector('[data-testid="migration-completed"]')?.textContent ?? '',
    failed: container.querySelector('[data-testid="migration-failed"]')?.textContent ?? '',
    remaining: container.querySelector('[data-testid="migration-remaining"]')?.textContent ?? '',
  };
}

describe('IdbToNativeMigrationView — four states from props', () => {
  it('in-progress: shows the counts as given and offers neither resume nor retry', async () => {
    await renderView({
      status: 'in-progress',
      total: 8,
      completed: 3,
      failed: 0,
      remaining: 5,
      resumable: false,
    });
    expect(container.querySelector('[data-testid="idb-native-migration"]')?.getAttribute('data-status'))
      .toBe('in-progress');
    expect(container.querySelector('[data-testid="migration-status-label"]')?.textContent)
      .toMatch(/Migrating assets/i);
    expect(counts()).toEqual({ total: '8', completed: '3', failed: '0', remaining: '5' });
    expect(container.querySelector('[data-testid="migration-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="migration-retry-failed"]')).toBeNull();
  });

  it('per-asset-failure: lists failed identities and fires the retry fake', async () => {
    const fake = createRecoveryActionsFake();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <IdbToNativeMigrationView
          status="per-asset-failure"
          total={4}
          completed={2}
          failed={2}
          remaining={0}
          failedAssets={[
            { id: 'a-fail-1', name: 'clip-one.mp4' },
            { id: 'a-fail-2', name: 'clip-two.mp4' },
          ]}
          resumable={false}
          onRetryFailed={fake.onRetryFailed}
        />,
      );
    });
    const rows = [...container.querySelectorAll('[data-testid="migration-failed-asset"]')];
    expect(rows.map((el) => el.getAttribute('data-asset-id'))).toEqual(['a-fail-1', 'a-fail-2']);
    expect(container.textContent).toMatch(/clip-one\.mp4/);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="migration-retry-failed"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    expect(fake.retryFailedCount).toBe(1);
  });

  it('partial: renders completed and remaining from props without recomputing them', async () => {
    await renderView({
      status: 'partial',
      total: 10,
      completed: 6,
      failed: 1,
      remaining: 99,
      failedAssets: [{ id: 'a-fail-1', name: 'stuck.mp4' }],
      resumable: false,
      onRetryFailed: () => {},
    });
    expect(container.querySelector('[data-testid="idb-native-migration"]')?.getAttribute('data-status'))
      .toBe('partial');
    expect(container.querySelector('[data-testid="migration-status-label"]')?.textContent)
      .toMatch(/partially complete/i);
    // remaining is 99, not total-completed-failed (3). The view must not "fix" it.
    expect(counts()).toEqual({ total: '10', completed: '6', failed: '1', remaining: '99' });
  });

  it('resumable: shows Resume from the resumable flag and fires the fake', async () => {
    const fake = await renderView({
      status: 'resumable',
      total: 10,
      completed: 4,
      failed: 0,
      remaining: 6,
      resumable: true,
    });
    expect(container.querySelector('[data-testid="idb-native-migration"]')?.getAttribute('data-resumable'))
      .toBe('true');
    const resume = container.querySelector<HTMLButtonElement>('[data-testid="migration-resume"]');
    expect(resume).not.toBeNull();
    await act(async () => { resume!.click(); });
    expect(fake.resumeCount).toBe(1);
  });

  it('does not infer resumable from leftover remaining counts', async () => {
    await renderView({
      status: 'in-progress',
      total: 10,
      completed: 4,
      failed: 0,
      remaining: 6,
      resumable: false,
    });
    expect(container.querySelector('[data-testid="migration-resume"]')).toBeNull();
  });
});
