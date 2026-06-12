/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const PEXELS_KEY = import.meta.env.VITE_PEXELS_API_KEY as string | undefined;
const PIXABAY_KEY = import.meta.env.VITE_PIXABAY_API_KEY as string | undefined;

export interface StockResult {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
  type: 'video' | 'image';
  provider: 'pexels' | 'pixabay' | 'coverr' | 'mixkit';
}

export type StockSearchResult =
  | { status: 'ok'; results: StockResult[] }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

// Pexels API response shapes
interface PexelsVideoFile { link: string; quality: string; }
interface PexelsVideo { id: number; video_files: PexelsVideoFile[]; image: string; }
interface PexelsPhoto { id: number; src: { large2x: string; medium: string; }; }
interface PexelsVideoResponse { videos: PexelsVideo[]; }
interface PexelsPhotoResponse { photos: PexelsPhoto[]; }

// Pixabay API response shapes
interface PixabayVideoHit { id: number; videos: { medium: { url: string; }; }; picture_id: string; }
interface PixabayPhotoHit { id: number; largeImageURL: string; previewURL: string; }
interface PixabayResponse<T> { hits: T[]; }

// Retries the fetch on HTTP 429 with exponential back-off (1s → 2s → 4s).
// All other status codes and network errors are returned/thrown immediately.
async function fetchWithRetry(url: string, init?: RequestInit, maxAttempts = 3): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, init);
    if (response.status !== 429 || ++attempt >= maxAttempts) return response;
    await new Promise<void>(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
  }
}

export async function searchPexels(query: string, type: 'video' | 'image' = 'video'): Promise<StockSearchResult> {
  if (!PEXELS_KEY) {
    console.warn('VITE_PEXELS_API_KEY not set — Pexels search disabled.');
    return { status: 'ok', results: [] };
  }
  try {
    const endpoint = type === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
    const response = await fetchWithRetry(
      `${endpoint}?query=${encodeURIComponent(query)}&per_page=15`,
      { headers: { Authorization: PEXELS_KEY } },
    );
    if (response.status === 429) return { status: 'rate_limited' };
    if (!response.ok) return { status: 'error', message: `Pexels HTTP ${response.status}` };

    if (type === 'video') {
      const data = await response.json() as PexelsVideoResponse;
      return {
        status: 'ok',
        results: (data.videos ?? []).map(v => ({
          id: `pexels-v-${v.id}`,
          name: `Pexels Video ${v.id}`,
          url: v.video_files.find(f => f.quality === 'hd')?.link ?? v.video_files[0]?.link ?? '',
          thumbnail: v.image,
          type: 'video' as const,
          provider: 'pexels' as const,
        })),
      };
    } else {
      const data = await response.json() as PexelsPhotoResponse;
      return {
        status: 'ok',
        results: (data.photos ?? []).map(p => ({
          id: `pexels-p-${p.id}`,
          name: `Pexels Image ${p.id}`,
          url: p.src.large2x,
          thumbnail: p.src.medium,
          type: 'image' as const,
          provider: 'pexels' as const,
        })),
      };
    }
  } catch (err) {
    console.error('Pexels network error:', err);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function searchPixabay(query: string, type: 'video' | 'image' = 'video'): Promise<StockSearchResult> {
  if (!PIXABAY_KEY) return { status: 'ok', results: [] };
  try {
    const endpoint = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
    const response = await fetchWithRetry(
      `${endpoint}?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=15`,
    );
    if (response.status === 429) return { status: 'rate_limited' };
    if (!response.ok) return { status: 'error', message: `Pixabay HTTP ${response.status}` };

    if (type === 'video') {
      const data = await response.json() as PixabayResponse<PixabayVideoHit>;
      return {
        status: 'ok',
        results: (data.hits ?? []).map(v => ({
          id: `pixabay-v-${v.id}`,
          name: `Pixabay Video ${v.id}`,
          url: v.videos.medium.url,
          thumbnail: `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
          type: 'video' as const,
          provider: 'pixabay' as const,
        })),
      };
    } else {
      const data = await response.json() as PixabayResponse<PixabayPhotoHit>;
      return {
        status: 'ok',
        results: (data.hits ?? []).map(p => ({
          id: `pixabay-p-${p.id}`,
          name: `Pixabay Image ${p.id}`,
          url: p.largeImageURL,
          thumbnail: p.previewURL,
          type: 'image' as const,
          provider: 'pixabay' as const,
        })),
      };
    }
  } catch (err) {
    console.error('Pixabay network error:', err);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Coverr ──────────────────────────────────────────────────────────────────
// Free, no API key required.
// Search endpoint: https://coverr.co/api/videos/search?query=<q>&per_page=20&page=1

interface CoverrVideo {
  id: string;
  title: string;
  coverr_url: string;           // direct MP4 download URL
  preview_url: string;          // thumbnail JPEG
}

interface CoverrResponse {
  hits: CoverrVideo[];
}

export async function searchCoverr(
  query: string,
  type: 'video' | 'image' = 'video',
): Promise<StockSearchResult> {
  // Coverr is video-only
  if (type === 'image') return { status: 'ok', results: [] };

  const url =
    `https://coverr.co/api/videos/search?query=${encodeURIComponent(query)}&per_page=20&page=1`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, {});
  } catch (err) {
    return { status: 'error', message: String(err) };
  }

  if (res.status === 429) return { status: 'rate_limited' };
  if (!res.ok) return { status: 'error', message: `Coverr HTTP ${res.status}` };

  let data: CoverrResponse;
  try {
    data = (await res.json()) as CoverrResponse;
  } catch {
    return { status: 'error', message: 'Coverr: invalid JSON response' };
  }

  const results: StockResult[] = (data.hits ?? []).map((v) => ({
    id: `coverr-${v.id}`,
    name: v.title,
    url: v.coverr_url,
    thumbnail: v.preview_url,
    type: 'video',
    provider: 'coverr',
  }));

  return { status: 'ok', results };
}

// ── Mixkit ───────────────────────────────────────────────────────────────────
// Free, no API key required.
// Search endpoint: https://mixkit.co/api/assets?vl=en&page=1&per_page=20&term=<q>&asset_type=footage

interface MixkitAsset {
  id: number;
  name: string;
  source_download: string;      // direct MP4 download URL
  image_small: string;          // thumbnail URL
}

interface MixkitResponse {
  assets: MixkitAsset[];
}

export async function searchMixkit(
  query: string,
  type: 'video' | 'image' = 'video',
): Promise<StockSearchResult> {
  // Mixkit is video-only (footage)
  if (type === 'image') return { status: 'ok', results: [] };

  const url =
    `https://mixkit.co/api/assets?vl=en&page=1&per_page=20&term=${encodeURIComponent(query)}&asset_type=footage`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, {});
  } catch (err) {
    return { status: 'error', message: String(err) };
  }

  if (res.status === 429) return { status: 'rate_limited' };
  if (!res.ok) return { status: 'error', message: `Mixkit HTTP ${res.status}` };

  let data: MixkitResponse;
  try {
    data = (await res.json()) as MixkitResponse;
  } catch {
    return { status: 'error', message: 'Mixkit: invalid JSON response' };
  }

  const results: StockResult[] = (data.assets ?? []).map((a) => ({
    id: `mixkit-${a.id}`,
    name: a.name,
    url: a.source_download,
    thumbnail: a.image_small,
    type: 'video',
    provider: 'mixkit',
  }));

  return { status: 'ok', results };
}

export async function searchAllStock(
  query: string,
  type: 'video' | 'image' = 'video',
): Promise<StockSearchResult> {
  const [pexels, pixabay, coverr, mixkit] = await Promise.all([
    searchPexels(query, type),
    searchPixabay(query, type),
    searchCoverr(query, type),
    searchMixkit(query, type),
  ]);

  const sources = [pexels, pixabay, coverr, mixkit];

  // Any rate limit short-circuits everything
  if (sources.some((s) => s.status === 'rate_limited')) {
    return { status: 'rate_limited' };
  }

  const allResults = sources
    .filter((s): s is { status: 'ok'; results: StockResult[] } => s.status === 'ok')
    .flatMap((s) => s.results);

  if (allResults.length === 0) {
    return { status: 'error', message: 'All stock providers returned errors.' };
  }

  return { status: 'ok', results: allResults };
}
