/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

import { relinkPickFolder } from './relinkNative';

beforeEach(() => invoke.mockReset().mockResolvedValue('/picked'));

describe('relinkPickFolder title', () => {
  it('passes the caller\'s dialog title to the native picker', async () => {
    await relinkPickFolder('Choose where exports are saved');
    expect(invoke).toHaveBeenCalledWith('relink_pick_folder', { title: 'Choose where exports are saved' });
  });
  it('relink callers pass none — the native default (original media) applies', async () => {
    await relinkPickFolder();
    expect(invoke).toHaveBeenCalledWith('relink_pick_folder', { title: null });
  });
});
