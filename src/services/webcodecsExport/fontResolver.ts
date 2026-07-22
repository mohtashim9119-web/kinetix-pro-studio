/**
 * Resolves the concrete woff2 URLs behind the Google Fonts CSS `@import` in
 * `src/index.css` (same URL, fetched here instead of loaded by the browser),
 * then fetches the actual font BYTES on the main thread — so the WebCodecs
 * export worker (which has no `document`/`document.fonts`, and whose own
 * `fetch` to fonts.gstatic.com fails with a NetworkError on real WKWebView —
 * confirmed empirically, see `resolveFontBytes`'s own doc comment) can build
 * real `FontFace` objects from raw bytes instead of falling back to whatever
 * system font Canvas2D resolves.
 */

import type { FontConfig } from './textRenderer';

/** A parsed `@font-face` entry — family/url/weight/style, no bytes yet.
 *  Kept as its own internal type (distinct from `FontConfig`, which now
 *  carries `bytes` instead of `url`) so `parseFontFaceCss`'s pure parsing
 *  contract doesn't change shape just because the worker-facing type moved
 *  to bytes. */
interface ParsedFontFace {
  family: string;
  url: string;
  weight?: string;
  style?: string;
}

// Must stay byte-identical to the @import URL in src/index.css:1 — this is
// the SAME stylesheet the preview path loads into document.fonts, just
// fetched directly since a worker has no document to load an @import into.
const GOOGLE_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Anton&family=Space+Grotesk:wght@300..700&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Outfit:wght@100..900&family=Bebas+Neue&family=Montserrat:wght@100..900&family=Oswald:wght@200..700&family=Roboto:wght@100..900&family=Poppins:wght@100..900&family=Lato:wght@100..900&family=Open+Sans:wght@300..800&family=Raleway:wght@100..900&family=Nunito:wght@200..1000&family=Ubuntu:wght@300..700&family=Merriweather:wght@300..900&family=Lora:ital,wght@0,400..700;1,400..700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Dancing+Script:wght@400..700&family=Pacifico&family=Shadows+Into+Light&family=Indie+Flower&family=Amatic+SC:wght@400;700&family=Caveat:wght@400..700&family=Satisfy&family=Courgette&family=Righteous&family=Lobster&family=Fredoka+One&family=Luckiest+Guy&family=Permanent+Marker&family=Special+Elite&family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&family=Cinzel:wght@400..900&family=Marcellus&family=Alumni+Sans+Collegiate+One&family=Bungee&family=Monoton&family=Press+Start+2P&family=Staatliches&family=Teko:wght@300..700&family=Kanit:wght@100..900&family=Heebo:wght@100..900&family=Arimo:wght@400..700&family=Titillium+Web:wght@200..900&family=Exo+2:wght@100..900&family=Fira+Sans:wght@100..900&family=Josefin+Sans:wght@100..700&family=Quicksand:wght@300..700&family=Varela+Round&display=swap";

/**
 * Pure parser: Google's CSS2 response is a flat list of `@font-face` blocks
 * (one per family/weight/subset combination). Regex over DOMParser — the
 * response also carries `unicode-range` lists and multiple `src` formats
 * that a strict CSS parser has no reason to choke on, but keeping this
 * dependency-free and forgiving matters more than spec-correctness here: a
 * block we fail to parse just means that family falls back to a system font
 * (non-fatal), never a crash.
 */
export function parseFontFaceCss(css: string): ParsedFontFace[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const configs: ParsedFontFace[] = [];

  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(noComments)) !== null) {
    const block = blockMatch[1] ?? '';

    const familyMatch = /font-family:\s*['"]?([^'";]+?)['"]?\s*;/.exec(block);
    if (!familyMatch) continue;
    const family = familyMatch[1]!.trim();
    if (!family) continue;

    const srcMatch = /src:\s*([^;]+);/.exec(block);
    if (!srcMatch) continue;
    const srcValue = srcMatch[1]!;

    // Prefer a woff2 url() — FontFace/self.fonts loads it directly, no
    // format negotiation needed. Fall back to whichever url() appears first
    // if no format('woff2') entry is present.
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/g;
    let urlMatch: RegExpExecArray | null;
    let woff2Url: string | null = null;
    let firstUrl: string | null = null;
    while ((urlMatch = urlRe.exec(srcValue)) !== null) {
      const url = urlMatch[1]!.trim();
      const format = (urlMatch[2] ?? '').toLowerCase();
      if (!firstUrl) firstUrl = url;
      if (format.includes('woff2')) {
        woff2Url = url;
        break;
      }
    }
    const url = woff2Url ?? firstUrl;
    if (!url) continue;

    const weightMatch = /font-weight:\s*([^;]+);/.exec(block);
    const styleMatch = /font-style:\s*([^;]+);/.exec(block);

    const config: ParsedFontFace = { family, url };
    if (weightMatch) config.weight = weightMatch[1]!.trim();
    if (styleMatch) config.style = styleMatch[1]!.trim();
    configs.push(config);
  }

  return configs;
}

let cachedParsedFaces: ParsedFontFace[] | null = null;
let parseInFlight: Promise<ParsedFontFace[]> | null = null;

/**
 * Fetches + parses the Google Fonts CSS once per session (cached after the
 * first call, success or failure) and returns the resulting `ParsedFontFace[]`
 * — family/url/weight/style, no bytes yet (see `resolveFontBytes`, the only
 * caller, for the byte-fetching step). Never throws: offline/network/parse
 * failures resolve to `[]`, which is exactly what an empty font list already
 * meant — the worker falls back to system fonts.
 *
 * No explicit User-Agent handling is needed: `fetch` cannot override the
 * `User-Agent` request header (a forbidden header name per the Fetch spec),
 * so the request carries the WebView's own real UA — which is a modern
 * WebKit/Chromium engine, so Google's CDN already serves woff2 by default.
 */
async function resolveParsedFontFaces(): Promise<ParsedFontFace[]> {
  if (cachedParsedFaces) return cachedParsedFaces;
  if (parseInFlight) return parseInFlight;

  parseInFlight = (async () => {
    try {
      const res = await fetch(GOOGLE_FONTS_CSS_URL);
      if (!res.ok) throw new Error(`Google Fonts CSS fetch failed with status ${res.status}`);
      const css = await res.text();
      cachedParsedFaces = parseFontFaceCss(css);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('fontResolver: failed to resolve export font configs, falling back to system fonts:', e);
      cachedParsedFaces = [];
    }
    return cachedParsedFaces;
  })();

  try {
    return await parseInFlight;
  } finally {
    parseInFlight = null;
  }
}

// Font BYTES, keyed by URL — a font file is shared byte-for-byte across every
// export that needs it this session, and across every GL piece within one
// export (the same `FontConfig[]` is posted, unchanged, to each GL piece's
// worker `init` message — see exportPipelineWebCodecs.ts), so caching by URL
// avoids re-fetching the same bytes over and over.
const bytesCache = new Map<string, ArrayBuffer>();

/**
 * Fetches font BYTES, on the MAIN THREAD, for exactly the family names in
 * `usedFamilies` — not all ~52 `FONT_FAMILIES`. This is the fix for a real
 * WKWebView bug: the export worker's own `fetch` to fonts.gstatic.com fails
 * with a NetworkError (confirmed via temporary diagnostic logging on a real
 * device — a Worker-context cross-origin font-fetch restriction), so
 * `FontFace(family, url(...)).load()` inside the worker always fails
 * non-fatally and silently falls back to a system font. The main thread's own
 * `fetch` to the same host works fine (confirmed the same way), so this
 * function does the network fetch here and hands the worker raw bytes
 * (`FontFace(family, bytes)` — no network access needed in the worker at
 * all; see `textRenderer.ts`'s `GLTextRenderer.init`).
 *
 * A family with no matching `@font-face` block, or whose byte fetch fails, is
 * skipped (never thrown) — the worker's own non-fatal per-font catch already
 * handles "no FontConfig for this family" by leaving Canvas2D to fall back to
 * a system font, exactly as before.
 */
export async function resolveFontBytes(usedFamilies: readonly string[]): Promise<FontConfig[]> {
  const wanted = new Set(usedFamilies.map((f) => f.trim()).filter((f) => f.length > 0));
  if (wanted.size === 0) return [];

  const parsedFaces = await resolveParsedFontFaces();
  const matching = parsedFaces.filter((f) => wanted.has(f.family));

  const results = await Promise.all(
    matching.map(async (face): Promise<FontConfig | null> => {
      try {
        let bytes = bytesCache.get(face.url);
        if (!bytes) {
          const res = await fetch(face.url);
          if (!res.ok) throw new Error(`font bytes fetch failed with status ${res.status}`);
          bytes = await res.arrayBuffer();
          bytesCache.set(face.url, bytes);
        }
        const config: FontConfig = { family: face.family, bytes };
        if (face.weight) config.weight = face.weight;
        if (face.style) config.style = face.style;
        return config;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`fontResolver: failed to fetch font bytes for "${face.family}" (${face.url}), skipping:`, e);
        return null;
      }
    }),
  );

  return results.filter((r): r is FontConfig => r !== null);
}
