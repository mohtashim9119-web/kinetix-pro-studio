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
  provider: 'pexels' | 'pixabay';
}

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

export async function searchPexels(query: string, type: 'video' | 'image' = 'video'): Promise<StockResult[]> {
  if (!PEXELS_KEY) {
    console.warn("PEXELS_API_KEY is missing in environment variables.");
    return [];
  }
  try {
    const endpoint = type === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
    const response = await fetch(`${endpoint}?query=${encodeURIComponent(query)}&per_page=15`, {
      headers: { Authorization: PEXELS_KEY }
    });
    if (!response.ok) return [];

    if (type === 'video') {
      const data = await response.json() as PexelsVideoResponse;
      return (data.videos ?? []).map(v => ({
        id: `pexels-v-${v.id}`,
        name: `Pexels Video ${v.id}`,
        url: v.video_files.find(f => f.quality === 'hd')?.link ?? v.video_files[0]?.link ?? '',
        thumbnail: v.image,
        type: 'video' as const,
        provider: 'pexels' as const,
      }));
    } else {
      const data = await response.json() as PexelsPhotoResponse;
      return (data.photos ?? []).map(p => ({
        id: `pexels-p-${p.id}`,
        name: `Pexels Image ${p.id}`,
        url: p.src.large2x,
        thumbnail: p.src.medium,
        type: 'image' as const,
        provider: 'pexels' as const,
      }));
    }
  } catch (err) {
    console.error("Pexels error:", err);
    return [];
  }
}

export async function searchPixabay(query: string, type: 'video' | 'image' = 'video'): Promise<StockResult[]> {
  if (!PIXABAY_KEY) return [];
  try {
    const endpoint = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
    const response = await fetch(`${endpoint}?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=15`);
    if (!response.ok) return [];

    if (type === 'video') {
      const data = await response.json() as PixabayResponse<PixabayVideoHit>;
      return (data.hits ?? []).map(v => ({
        id: `pixabay-v-${v.id}`,
        name: `Pixabay Video ${v.id}`,
        url: v.videos.medium.url,
        thumbnail: `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
        type: 'video' as const,
        provider: 'pixabay' as const,
      }));
    } else {
      const data = await response.json() as PixabayResponse<PixabayPhotoHit>;
      return (data.hits ?? []).map(p => ({
        id: `pixabay-p-${p.id}`,
        name: `Pixabay Image ${p.id}`,
        url: p.largeImageURL,
        thumbnail: p.previewURL,
        type: 'image' as const,
        provider: 'pixabay' as const,
      }));
    }
  } catch (err) {
    console.error("Pixabay error:", err);
    return [];
  }
}

export async function searchAllStock(query: string, type: 'video' | 'image' = 'video'): Promise<StockResult[]> {
  const [pexels, pixabay] = await Promise.all([
    searchPexels(query, type),
    searchPixabay(query, type)
  ]);
  return [...pexels, ...pixabay];
}
