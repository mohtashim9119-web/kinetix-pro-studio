/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseFontFaceCss } from './fontResolver';

describe('parseFontFaceCss', () => {
  it('extracts one config from a single @font-face rule', () => {
    const css = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
      }
    `;
    expect(parseFontFaceCss(css)).toEqual([
      {
        family: 'Inter',
        url: 'https://fonts.gstatic.com/s/inter/v1/inter-400.woff2',
        weight: '400',
        style: 'normal',
      },
    ]);
  });

  it('extracts all configs from multiple @font-face rules', () => {
    const css = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
      }
      @font-face {
        font-family: 'Anton';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/anton/v1/anton-400.woff2) format('woff2');
      }
      @font-face {
        font-family: 'Space Grotesk';
        font-style: normal;
        font-weight: 300;
        src: url(https://fonts.gstatic.com/s/spacegrotesk/v1/sg-300.woff2) format('woff2');
      }
    `;
    const result = parseFontFaceCss(css);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.family)).toEqual(['Inter', 'Anton', 'Space Grotesk']);
  });

  it('still parses a rule that includes unicode-range', () => {
    const css = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 100 900;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-latin.woff2) format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC;
      }
    `;
    expect(parseFontFaceCss(css)).toEqual([
      {
        family: 'Inter',
        url: 'https://fonts.gstatic.com/s/inter/v1/inter-latin.woff2',
        weight: '100 900',
        style: 'normal',
      },
    ]);
  });

  it('prefers the woff2 url when multiple src formats are listed', () => {
    const css = `
      @font-face {
        font-family: 'Roboto';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/roboto/v1/roboto-400.woff) format('woff'),
             url(https://fonts.gstatic.com/s/roboto/v1/roboto-400.woff2) format('woff2');
      }
    `;
    const result = parseFontFaceCss(css);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://fonts.gstatic.com/s/roboto/v1/roboto-400.woff2');
  });

  it('skips a rule missing font-family without crashing', () => {
    const css = `
      @font-face {
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/mystery/v1/mystery-400.woff2) format('woff2');
      }
    `;
    expect(parseFontFaceCss(css)).toEqual([]);
  });

  it('skips a rule missing a src url without crashing', () => {
    const css = `
      @font-face {
        font-family: 'Broken';
        font-style: normal;
        font-weight: 400;
      }
    `;
    expect(parseFontFaceCss(css)).toEqual([]);
  });

  it('returns an empty array for empty CSS', () => {
    expect(parseFontFaceCss('')).toEqual([]);
  });

  it('strips comments and still parses the rules around them', () => {
    const css = `
      /* latin-ext */
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-latin-ext.woff2) format('woff2');
        unicode-range: U+0100-024F;
      }
      /* latin */
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-latin.woff2) format('woff2');
        unicode-range: U+0000-00FF;
      }
    `;
    const result = parseFontFaceCss(css);
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe('https://fonts.gstatic.com/s/inter/v1/inter-latin-ext.woff2');
    expect(result[1]!.url).toBe('https://fonts.gstatic.com/s/inter/v1/inter-latin.woff2');
  });
});

// resolveFontBytes caches both the parsed CSS and fetched bytes at module
// scope (session-lifetime caches, by design — see fontResolver.ts's own doc
// comments), so each test below resets the module registry and re-imports
// fresh to get an isolated cache instead of leaking state between tests.
describe('resolveFontBytes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns [] and fetches nothing when usedFamilies is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { resolveFontBytes } = await import('./fontResolver');

    const result = await resolveFontBytes([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the CSS once, then fetches BYTES only for the requested families', async () => {
    const css = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
      }
      @font-face {
        font-family: 'Anton';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/anton/v1/anton-400.woff2) format('woff2');
      }
    `;
    const interBytes = new ArrayBuffer(4);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('fonts.googleapis.com')) {
        return { ok: true, status: 200, text: async () => css };
      }
      if (url.includes('inter-400.woff2')) {
        return { ok: true, status: 200, arrayBuffer: async () => interBytes };
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveFontBytes } = await import('./fontResolver');

    const result = await resolveFontBytes(['Inter']);

    expect(result).toEqual([{ family: 'Inter', bytes: interBytes, weight: '400', style: 'normal' }]);
    // CSS fetch + exactly one byte fetch — Anton's URL is never requested.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips a family whose byte fetch fails, without throwing', async () => {
    const css = `
      @font-face {
        font-family: 'Broken';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/broken/v1/broken-400.woff2) format('woff2');
      }
    `;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('fonts.googleapis.com')) {
        return { ok: true, status: 200, text: async () => css };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { resolveFontBytes } = await import('./fontResolver');

    const result = await resolveFontBytes(['Broken']);

    expect(result).toEqual([]);
  });

  it('returns [] and never requests bytes when the CSS fetch itself fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { resolveFontBytes } = await import('./fontResolver');

    const result = await resolveFontBytes(['Inter']);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches bytes by URL — a second call for an already-fetched family does not re-fetch', async () => {
    const css = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
      }
    `;
    const interBytes = new ArrayBuffer(4);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('fonts.googleapis.com')) {
        return { ok: true, status: 200, text: async () => css };
      }
      return { ok: true, status: 200, arrayBuffer: async () => interBytes };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveFontBytes } = await import('./fontResolver');

    await resolveFontBytes(['Inter']);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await resolveFontBytes(['Inter']);

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
