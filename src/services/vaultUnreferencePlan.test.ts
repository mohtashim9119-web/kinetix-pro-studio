/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { vaultHashesToUnreference } from './vaultUnreferencePlan';
import type { Asset } from '../types';

const a = (id: string, contentHash?: string, type: Asset['type'] = 'image'): Asset =>
  ({ id, name: `${id}.png`, url: '', type, contentHash });

describe('vaultHashesToUnreference', () => {
  it('delete-all: every removed asset\'s hash is released (the audio voiceover stays and keeps its own)', () => {
    const removed = [a('1', 'h1'), a('2', 'h2'), a('3', undefined)];
    const remaining = [a('vo', 'hv', 'audio')];
    expect(vaultHashesToUnreference(removed, remaining).sort()).toEqual(['h1', 'h2']);
  });

  it('TWIN CASE: a surviving asset with the same hash keeps the blob referenced', () => {
    expect(vaultHashesToUnreference([a('1', 'h1')], [a('2', 'h1')])).toEqual([]);
  });

  it('two removed twins release their shared hash once', () => {
    expect(vaultHashesToUnreference([a('1', 'h1'), a('2', 'h1')], [])).toEqual(['h1']);
  });
});

// App wiring (source scan, the repo's convention): BOTH delete handlers must
// release vault references. OLD BUG: handleDeleteAllAssets never called
// mediaVaultUnreference, so after "delete all" every blob stayed referenced
// and storage settings could never reclaim it.
describe('App wiring — media deletes release their vault references', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
  const body = (name: string): string => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start, name).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('}, []);', start));
  };

  it('handleDeleteAllAssets unreferences through the shared plan, after the native delete settles', () => {
    const b = body('handleDeleteAllAssets');
    expect(b).toContain('vaultHashesToUnreference(');
    expect(b).toContain('mediaVaultUnreference(');
    expect(b.indexOf('deleteAssetNative')).toBeLessThan(b.indexOf('mediaVaultUnreference('));
  });

  it('handleDeleteAsset uses the same plan (no divergent twin logic)', () => {
    const b = body('handleDeleteAsset');
    expect(b).toContain('vaultHashesToUnreference(');
    expect(b).toContain('mediaVaultUnreference(');
  });
});
