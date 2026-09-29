/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One release version, four manifests. The installer's version comes from
// tauri.conf.json, the crate's from Cargo.toml (and the boot log), the npm
// package's from package.json, and the title bar must name it — a bump that misses one ships a build whose
// name disagrees with its own binary.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

describe('release version lockstep', () => {
  const npm = (JSON.parse(read('package.json')) as { version: string }).version;
  const lock = (JSON.parse(read('package-lock.json')) as { version: string; packages: { '': { version: string } } });
  const tauri = (JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string }).version;
  const cargo = /^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))![1]!;
  const cargoLock = /name = "app"\nversion = "([^"]+)"/.exec(read('src-tauri/Cargo.lock'))![1]!;

  it('package.json, package-lock.json, tauri.conf.json, Cargo.toml and Cargo.lock all agree', () => {
    expect([lock.version, lock.packages[''].version, tauri, cargo, cargoLock]).toEqual(Array(5).fill(npm));
  });
  it('the window title bar and the page title show the version', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { windows?: unknown; app: { windows: Array<{ title: string }> } };
    expect(conf.app.windows[0]!.title).toBe(`Kinetix Pro Studio v${npm}`);
    expect(read('index.html')).toContain(`<title>Kinetix Pro Studio v${npm}</title>`);
  });
  it('is a real semver', () => {
    expect(npm).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
