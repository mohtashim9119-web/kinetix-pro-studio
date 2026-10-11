/**
 * `handleReexportStartFresh` force-destroyed the offered checkpoint session
 * with no claim check. C2 gave the Export-click auto-purge a live-claim skip
 * (`purgeCheckpointSession` in `exportReexportCheck.ts`); "Start fresh" from
 * the same modal must go through the same guard, or a session a run is using
 * right now has its files deleted under it. Source-scan of the real handler,
 * the convention `App.mediaVaultUnreference.test.ts` documents.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const app = readFileSync(resolve(import.meta.dirname, 'App.tsx'), 'utf-8');

function startFreshBody(): string {
  const start = app.indexOf('const handleReexportStartFresh = useCallback(');
  expect(start, 'handleReexportStartFresh definition missing').toBeGreaterThan(-1);
  const end = app.indexOf('const performReexportResume', start);
  expect(end, 'next handler marker missing').toBeGreaterThan(start);
  return app.slice(start, end);
}

describe('Re-export "Start fresh" never destroys a live-claimed session', () => {
  it('purges through the live-claim-guarded purgeCheckpointSession, reading the claim first', () => {
    const body = startFreshBody();
    expect(body).toContain("purgeCheckpointSession(sessionId, 'reexport-start-fresh', {");
    expect(body).toContain('readSessionClaim: (id) => TauriFfmpeg.readSessionClaim(id)');
  });

  it('App.tsx no longer carries its own unguarded reenter -> force-destroy purge', () => {
    expect(app).not.toMatch(/const purgeCheckpointSession = useCallback/);
    expect(app).toContain("import { findUsableCheckpoint, purgeCheckpointSession, resolveReexportCheckpoint");
  });
});
