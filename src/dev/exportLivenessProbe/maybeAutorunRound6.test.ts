// @vitest-environment jsdom
/**
 * Round 6 autorun phase-gate regression test.
 *
 * `maybeAutorunRound6.ts` fires a self-invoking async IIFE on import that
 * reads `/_spike/ws3-autorun.json` and runs the equivalence/ceiling export
 * suites named by its `phase` field. An unrecognized (or absent) `phase`
 * previously fell through to `'all'`, which ran BOTH suites concurrently and
 * had them race over the module-level `lastWebCodecsRunDiagnostics`
 * singleton in `exportPipelineWebCodecs.ts`. This locks the fix: only a
 * phase this module explicitly recognizes may trigger a run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunEquiv = vi.fn(async () => ({ ok: true }));
const mockRunCeiling = vi.fn(async () => ({ ok: true }));
const mockPersist = vi.fn();

vi.mock('../../services/tauriFfmpeg', () => ({
  isTauri: () => true,
}));
vi.mock('./runRound6', () => ({
  runRound6Equivalence40s: mockRunEquiv,
  runRound6CeilingSuite: mockRunCeiling,
}));
vi.mock('./autorunFlag', () => ({
  persistLivenessReport: mockPersist,
}));

function mockAutorunFlag(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    })),
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.resetModules();
  mockRunEquiv.mockClear();
  mockRunCeiling.mockClear();
  mockPersist.mockClear();
  sessionStorage.clear();
});

describe('maybeAutorunRound6 phase gate', () => {
  it('runs the matching suite for a known phase', async () => {
    mockAutorunFlag({ run: true, phase: 'ceiling' });
    await import('./maybeAutorunRound6');
    await flush();
    expect(mockRunCeiling).toHaveBeenCalledTimes(1);
    expect(mockRunEquiv).not.toHaveBeenCalled();
  });

  it('does not run for an unrecognized phase', async () => {
    mockAutorunFlag({ run: true, phase: 'bogus' });
    await import('./maybeAutorunRound6');
    await flush();
    expect(mockRunEquiv).not.toHaveBeenCalled();
    expect(mockRunCeiling).not.toHaveBeenCalled();
  });

  it('does not run when phase is absent', async () => {
    mockAutorunFlag({ run: true });
    await import('./maybeAutorunRound6');
    await flush();
    expect(mockRunEquiv).not.toHaveBeenCalled();
    expect(mockRunCeiling).not.toHaveBeenCalled();
  });
});
