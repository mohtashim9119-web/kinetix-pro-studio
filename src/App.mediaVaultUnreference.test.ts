/**
 * G6 Step 6 (dead-feature-gap fix) — proves `App.tsx`'s `handleDeleteAsset`
 * actually wires up `mediaVaultUnreference`, not just that the client
 * function exists in isolation. Wave 1's own lesson (see the media-vault
 * module doc comment) is that a registry-level test cannot see a missed
 * wire — this is a source-scan of the real handler body, the same pattern
 * `timingProvenance.test.ts` uses for its "Apply Sync commit" proof, chosen
 * over a full App.tsx mount because that handler sits inside a component
 * with hundreds of other dependencies a behavioral test would need to stub.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function handleDeleteAssetBody(): string {
  const app = readFileSync(resolve(import.meta.dirname, 'App.tsx'), 'utf-8');
  const start = app.indexOf('const handleDeleteAsset = useCallback((assetId: string) => {');
  expect(start, 'handleDeleteAsset definition missing').toBeGreaterThan(-1);
  // Bounded by the next handler's own definition rather than brace-counting —
  // fragile to reformatting either way, but this mirrors the existing
  // marker-to-marker slicing convention in timingProvenance.test.ts.
  const end = app.indexOf('const handleHighlightAssetUsage', start);
  expect(end, 'next handler marker missing').toBeGreaterThan(start);
  return app.slice(start, end);
}

describe('handleDeleteAsset wires up media-vault unreference (G6 Step 6)', () => {
  it('calls mediaVaultUnreference, gated on the asset actually carrying a contentHash', () => {
    const body = handleDeleteAssetBody();
    expect(body).toContain('mediaVaultUnreference(');
    expect(body).toContain('contentHash');
  });

  it('checks for a surviving twin (another asset with the same contentHash) before unreferencing', () => {
    const body = handleDeleteAssetBody();
    expect(body.toLowerCase()).toContain('twin');
    // The twin check must scan this project's OTHER assets by contentHash —
    // not just the deleted asset's own hash in isolation.
    expect(body).toMatch(/prev\.assets\.some\([^)]*a\.contentHash === contentHash/);
  });

  it('unreferences only AFTER the native delete settles, not fired in parallel with it', () => {
    const body = handleDeleteAssetBody();
    const deleteCallIdx = body.indexOf('deleteAssetNative(');
    const unrefIdx = body.indexOf('mediaVaultUnreference(');
    expect(deleteCallIdx).toBeGreaterThan(-1);
    expect(unrefIdx).toBeGreaterThan(-1);
    expect(unrefIdx).toBeGreaterThan(deleteCallIdx);
    // The unreference call must be inside a `.then(` continuation off the
    // native delete promise, not a separate fire-and-forget statement.
    const between = body.slice(deleteCallIdx, unrefIdx);
    expect(between).toContain('.then(');
  });

  it('imports mediaVaultUnreference from the mediaVaultClient service', () => {
    const app = readFileSync(resolve(import.meta.dirname, 'App.tsx'), 'utf-8');
    expect(app).toContain("from './services/mediaVaultClient'");
    const importLine = app.split('\n').find(l => l.includes('mediaVaultUnreference') && l.includes('import'));
    expect(importLine).toBeTruthy();
  });
});
