/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const PEXELS_KEY = import.meta.env.VITE_PEXELS_API_KEY;
const PIXABAY_KEY = import.meta.env.VITE_PIXABAY_API_KEY;

export interface StockResult {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
  type: 'video' | 'image';
  provider: 'pexels' | 'pixabay';
}

export async function searchPexels(query: string, type: 'video' | 'image' = 'video'): Promise<StockResult[]> {
  if (!PEXELS_KEY) {
    console.warn("PEXELS_API_KEY is missing in environment variables.");
    return [];
  }
  try {
    const endpoint = type === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
    const response = await fetch(`${endpoint}?query=${encodeURIComponent(query)}&per_page=15`, {
      headers: {
        Authorization: PEXELS_KEY
      }
    });
    const data = await response.json();
    
    if (type === 'video') {
      return (data.videos || []).map((v: any) => ({
        id: `pexels-v-${v.id}`,
        name: `Pexels Video ${v.id}`,
        url: v.video_files.find((f: any) => f.quality === 'hd') ?.link || v.video_files[0]?.link,
        thumbnail: v.image,
        type: 'video',
        provider: 'pexels'
      }));
    } else {
      return (data.photos || []).map((p: any) => ({
        id: `pexels-p-${p.id}`,
        name: `Pexels Image ${p.id}`,
        url: p.src.large2x,
        thumbnail: p.src.medium,
        type: 'image',
        provider: 'pexels'
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
    const data = await response.json();
    
    if (type === 'video') {
      return (data.hits || []).map((v: any) => ({
        id: `pixabay-v-${v.id}`,
        name: `Pixabay Video ${v.id}`,
        url: v.videos.medium.url,
        thumbnail: `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
        type: 'video',
        provider: 'pixabay'
      }));
    } else {
      return (data.hits || []).map((p: any) => ({
        id: `pixabay-p-${p.id}`,
        name: `Pixabay Image ${p.id}`,
        url: p.largeImageURL,
        thumbnail: p.previewURL,
        type: 'image',
        provider: 'pixabay'
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
