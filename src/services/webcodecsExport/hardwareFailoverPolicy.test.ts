/**
 * WS3 Round 9 — Rung 5a. See `exportPipelineWebCodecs.ts`'s own doc comment
 * above `decideHardwareFailoverDisposition` for why this is a SEPARATE
 * bounded resource from `decideBoundedRerenderDisposition`
 * (`boundedRerenderPolicy.test.ts`), consulted only once that policy has
 * already refused a same-rung rewind.
 */
import { describe, it, expect } from 'vitest';
import { decideHardwareFailoverDisposition } from './exportPipelineWebCodecs';

describe('decideHardwareFailoverDisposition', () => {
  it('grants the one-shot failover retry the first time it is asked', () => {
    expect(decideHardwareFailoverDisposition({ failoverUsed: false }).action).toBe('retry-software');
  });

  it('refuses a second failover attempt — one-shot, per export', () => {
    expect(decideHardwareFailoverDisposition({ failoverUsed: true }).action).toBe('abort');
  });

  it('takes only a boolean — the signature itself is the guarantee this cannot become a counter', () => {
    const params = Object.keys(decideHardwareFailoverDisposition({ failoverUsed: false }));
    expect(params.sort()).toEqual(['action']);
  });
});
