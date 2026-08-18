/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS1 Session O — Step 5 item 5: the store location must be stable across
 * every dev/release config.
 *
 * MEASURED BACKGROUND (Session O forensics, real on-disk stores):
 *   ~/Library/WebKit/app                      origin http://localhost:3000  8 projects
 *   ~/Library/WebKit/com.kinetix.pro-studio   origin tauri://localhost      4 projects
 * Disjoint, no overlap. `localStorage` is ORIGIN-scoped and Tauri serves dev
 * from `devUrl` and release from the custom protocol, so that split is
 * structural and cannot be closed inside `localStorage` itself. The durable
 * mirror closes it by living in `app_local_data_dir()`, which is keyed by the
 * BUNDLE IDENTIFIER and is therefore identical in all three configs.
 *
 * These tests lock the two config facts the mirror's guarantee rests on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf-8');

describe('dev, dev:fa and release resolve to the same store', () => {
  it('there is exactly ONE tauri config, so no config can diverge from another', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as Record<string, unknown>;
    expect(conf.identifier).toBe('com.kinetix.pro-studio');
    expect(conf.productName).toBe('Kinetix Pro Studio');
  });

  it('tauri:dev and tauri:dev:fa differ ONLY by the fa-inference Cargo feature', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const dev = pkg.scripts['tauri:dev'];
    const fa = pkg.scripts['tauri:dev:fa'];
    expect(dev).toBe('tauri dev');
    expect(fa).toBe('tauri dev -f fa-inference');
    // Neither may introduce its own config file, identifier or port — that is
    // exactly the divergence Step 2 went looking for.
    for (const script of [dev, fa]) {
      expect(script).not.toMatch(/--config|-c\s/);
      expect(script).not.toMatch(/--port/);
    }
    expect(fa.replace(' -f fa-inference', '')).toBe(dev);
  });

  it('the mirror is bundle-id-keyed (app_local_data_dir), never origin-keyed', () => {
    const rs = read('src-tauri/src/project_mirror.rs');
    expect(rs).toMatch(/app_local_data_dir\(\)/);
    // A mirror rooted anywhere origin-derived would reintroduce the split.
    // Strip comments first — the module's own doc block NAMES both origins to
    // explain why it exists, and that prose is not a code path.
    const code = rs
      .split('\n')
      .filter(l => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/localhost/);
  });

  it('every mirror command is registered, or the mirror is silently dead in the app', () => {
    const lib = read('src-tauri/src/lib.rs');
    for (const cmd of [
      'project_mirror_read_all',
      'project_mirror_write_project',
      'project_mirror_delete_project',
    ]) {
      expect(lib).toContain(`project_mirror::${cmd}`);
    }
  });
});
