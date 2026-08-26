/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 Step 10 regression test — `fetchAndDetectSilences` must prefer an
// already-in-memory `asset.file` over re-fetching `asset.url` (a `blob:`
// object URL).
//
// The confirmed defect (`docs/history-2.md`, this session): a Windows
// WebView2 build's `fetch(asset.url)` rejected outright ("Failed to fetch")
// against a same-session `blob:` URL that the DOM's own `<video src>`
// consumption of the identical URL had no trouble with, while `App.tsx`'s
// `resolveVoiceoverDuration` — which already preferred `asset.file` — was
// unaffected. This is NOT a filesystem-path-resolution defect: `asset.url` is
// always an opaque `blob:<uuid>` object URL, never a filesystem path, so no
// drive-letter/backslash/UNC/non-ASCII-path input ever reaches this function
// — there is no path-resolution logic here to regression-test against those
// shapes (see this session's operator report for why that candidate class
// was checked and does not apply).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAndDetectSilences } from './useWhisper';
import type { Asset } from '../types';

vi.mock('../services/silenceDetector', () => ({
  detectSilences: vi.fn(async (blob: Blob) => ({
    status: 'ok' as const,
    silences: [],
    __receivedBlob: blob,
  })),
}));

import { detectSilences } from '../services/silenceDetector';

const audioAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'voiceover-1',
  name: 'voiceover.mp3',
  url: 'blob:http://tauri.localhost/00000000-0000-0000-0000-000000000000',
  type: 'audio',
  ...overrides,
});

describe('fetchAndDetectSilences', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('uses asset.file directly and never calls fetch when a File is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const file = new File(['fake-audio-bytes'], 'voiceover.mp3', { type: 'audio/mpeg' });
    const asset = audioAsset({ file });

    const result = await fetchAndDetectSilences(asset);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(detectSilences).toHaveBeenCalledWith(file);
  });

  it('falls back to fetch(asset.url) when asset.file is absent (post-reload asset)', async () => {
    const blob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => blob,
    } as Response);
    const asset = audioAsset(); // no .file

    const result = await fetchAndDetectSilences(asset);

    expect(fetchSpy).toHaveBeenCalledWith(asset.url);
    expect(result.status).toBe('ok');
    expect(detectSilences).toHaveBeenCalledWith(blob);
  });

  it('reports a structured error (not a throw) when fetch rejects and no asset.file exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const asset = audioAsset(); // no .file — this is the exact Windows failure mode

    const result = await fetchAndDetectSilences(asset);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorMessage).toBe('voiceover fetch failed: Failed to fetch');
    }
    expect(detectSilences).not.toHaveBeenCalled();
  });

  it('reports a structured error for a non-ok fetch response when no asset.file exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);
    const asset = audioAsset();

    const result = await fetchAndDetectSilences(asset);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorMessage).toBe('voiceover fetch failed: 404 Not Found');
    }
  });
});
