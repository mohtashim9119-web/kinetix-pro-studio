// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The Bulk Sync tab's batch signal reads progress as a ring and a red dot
// with a count when any row failed. (The group header that also used them is
// gone with the group UI — dashboard revamp.)

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';
import { FailedDot, ProgressRing } from './BulkProgress';

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
});
