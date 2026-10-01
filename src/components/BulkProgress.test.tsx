// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk UI rebuild U2 — the drawer's group header (and, U6, the dashboard's
// bulk button) read progress the same way: a ring, "n/m done", and a red dot
// with a count when any row failed.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { BulkGroupHeader, FailedDot, ProgressRing } from './BulkProgress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = (el: React.ReactElement): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { createRoot(host).render(el); });
  return host;
};

describe('progress read-outs', () => {
  it('the ring fills in proportion to n/m', () => {
    const host = mount(<ProgressRing done={1} total={4} />);
    const ring = host.querySelector('[data-testid="bulk-ring"]')!;
    expect(ring.getAttribute('data-progress')).toBe('0.25');
    expect(ring.getAttribute('aria-label')).toBe('1 of 4 done');
  });

  it('the red dot appears only with failures and carries the count', () => {
    expect(mount(<FailedDot count={0} />).querySelector('[data-testid="bulk-failed-dot"]')).toBeNull();
    const dot = mount(<FailedDot count={2} />).querySelector('[data-testid="bulk-failed-dot"]')!;
    expect(dot.textContent).toBe('2');
    expect(dot.getAttribute('aria-label')).toBe('2 failed');
  });

  it('a group header shows the ring, "n/m done", the red dot and the collapse toggle', () => {
    const onToggle = vi.fn();
    const host = mount(
      <BulkGroupHeader
        group={{ id: 'g', name: 'Client A', collapsed: false, rowIds: ['a', 'b', 'c'] }}
        progress={{ done: 1, total: 3, failed: 1, running: true }}
        onToggle={onToggle}
      />,
    );
    const header = host.querySelector('[data-testid="bulk-group-g"]')!;
    expect(header.textContent).toContain('Client A');
    expect(header.querySelector('[data-testid="bulk-group-count-g"]')!.textContent).toBe('1/3 done');
    expect(header.querySelector('[data-testid="bulk-failed-dot"]')!.textContent).toBe('1');
    expect(header.querySelector('[data-testid="bulk-ring"]')).not.toBeNull();
    const toggle = header.querySelector('[data-testid="bulk-group-toggle-g"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => { toggle.click(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('no failures: no red dot in the header', () => {
    const host = mount(
      <BulkGroupHeader
        group={{ id: 'g', name: 'G', collapsed: true, rowIds: ['a', 'b'] }}
        progress={{ done: 2, total: 2, failed: 0, running: false }}
        onToggle={() => {}}
      />,
    );
    expect(host.querySelector('[data-testid="bulk-failed-dot"]')).toBeNull();
    expect((host.querySelector('[data-testid="bulk-group-toggle-g"]') as HTMLElement).getAttribute('aria-expanded')).toBe('false');
  });
});
