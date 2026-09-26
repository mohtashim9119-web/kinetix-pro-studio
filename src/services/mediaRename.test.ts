/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Media workflow Unit 1 — the project-record half of an inline rename (the
// vault-registry half is Rust's `media_vault::rename_display_name`, tested
// there). The renamed name IS the match key from now on, so a rename that
// lands on a name another asset already matches as is allowed but surfaced.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyAssetRename } from './mediaRename';
import type { Asset, Project } from '../types';

function project(assets: Asset[]): Project {
  return { id: 'p1', name: 'P', assets, segments: [], syncLog: [] } as unknown as Project;
}
const img = (id: string, name: string, addedAt: number): Asset => ({ id, name, url: '', type: 'image', addedAt });

describe('applyAssetRename', () => {
  it('renames only that asset record; everything else is untouched by reference', () => {
    const a = img('a1', 'wrong.png', 1);
    const b = img('a2', '002_other.png', 2);
    const before = project([a, b]);
    const { project: after, collision } = applyAssetRename(before, 'a1', '001_intro.png');
    expect(after.assets.find(x => x.id === 'a1')!.name).toBe('001_intro.png');
    expect(after.assets.find(x => x.id === 'a2')).toBe(b);
    expect(after.segments).toBe(before.segments);
    expect(collision).toBeUndefined();
  });

  it('a name another asset already matches as (extension/case-agnostic, same as matching) is allowed and reported', () => {
    const before = project([img('a1', 'wrong.png', 1), img('a2', '001_Intro.jpg', 2)]);
    const { project: after, collision } = applyAssetRename(before, 'a1', '001_intro.png');
    expect(after.assets.find(x => x.id === 'a1')!.name).toBe('001_intro.png');
    expect(collision).toEqual({ name: '001_intro.png', count: 2 });
  });

  it('an unknown asset id is a no-op', () => {
    const before = project([img('a1', 'x.png', 1)]);
    expect(applyAssetRename(before, 'nope', 'y.png').project).toBe(before);
  });
});

// App wiring — same source-scan approach as applySyncCancelInvariant.test.ts
// (App.tsx is verified manually by convention): the tile's rename reaches
// BOTH halves — the Asset record (applyAssetRename, persisted by autosave)
// and the vault registry (mediaVaultRename -> Rust media_vault_rename).
describe('App wiring — handleRenameAsset', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
  const start = src.indexOf('const handleRenameAsset = useCallback(');
  const body = src.slice(start, src.indexOf('}, []);', start));

  it('renames the record and the registry, and emits the collision finding', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('applyAssetRename(prev, assetId, newName)');
    expect(body).toContain('mediaVaultRename(asset.contentHash, newName)');
    expect(body).toContain('buildMediaNameCollisionEntry(');
    expect(src).toContain('onRenameAsset={handleRenameAsset}');
  });
});
