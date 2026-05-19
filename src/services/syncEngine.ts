/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Asset, VideoSegment } from '../types';

export const isFuzzyMatch = (search: string, target: string): boolean => {
  if (!search || !target) return false;
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');

  if (t === s) return true;
  if (t.includes(s) || s.includes(t)) return true;

  const sWords = s.split(/[\s_\-]+/).filter(w => w.length > 2);
  const tWords = t.split(/[\s_\-]+/).filter(w => w.length > 2);

  let matches = 0;
  for (const word of sWords) {
    if (tWords.some(tw => tw.includes(word) || word.includes(tw))) {
      matches++;
    }
  }
  return matches >= 2;
};

export const findAssetByContext = (text: string, assets: Asset[]): Asset | null => {
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 3);
  for (const asset of assets) {
    const assetName = asset.name.toLowerCase();
    if (words.some(word => assetName.includes(word))) return asset;
  }
  return null;
};

export const autoMatchSegments = (assets: Asset[], segments: VideoSegment[]): VideoSegment[] =>
  segments.map(s => {
    if (s.assetId) return s;

    const bracketMatch = (s.heading + s.text).match(/\[(.*?):?\s*(.*?)\]/);
    if (bracketMatch) {
      const name = (bracketMatch[2] ?? '').trim();
      const asset = assets.find(a => isFuzzyMatch(name, a.name));
      if (asset) return { ...s, assetId: asset.id };
    }

    const contextAsset = findAssetByContext(s.heading + ' ' + s.text, assets);
    if (contextAsset) return { ...s, assetId: contextAsset.id };

    return s;
  });
