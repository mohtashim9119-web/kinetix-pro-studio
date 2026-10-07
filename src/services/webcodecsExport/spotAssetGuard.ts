import type { Asset } from '../../types';
import type { SpotRenderSpec } from './spotRenderSpec';

/** Defense in depth: a spec whose asset is missing/unloadable is a typed failure. */
export function validateSpotAssets(
  assets: readonly Asset[],
  specs: readonly SpotRenderSpec[],
): string | null {
  if (specs.length === 0) return null;
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const spec of specs) {
    const asset = byId.get(spec.assetId);
    if (!asset?.url) {
      return `Spot asset "${spec.assetId}" is missing or unloadable`;
    }
    if (asset.type === 'audio') {
      return `Spot asset "${spec.assetId}" is audio — spot audio is never decoded`;
    }
  }
  return null;
}
