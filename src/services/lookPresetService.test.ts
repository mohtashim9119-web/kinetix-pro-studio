import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLookPresets,
  saveLookPreset,
  resolvePresetScaleRate,
  type LookPreset,
} from './lookPresetService';

/**
 * Combined-look preset persistence + zoom-rate application. The repo's default
 * vitest environment is `node` (no jsdom), so a minimal Map-backed localStorage
 * stub stands in — enough to exercise the JSON round-trip and the additive,
 * un-versioned `scaleRate` field.
 */

const LOOK_PRESETS_KEY = 'kinetix:lookPresets:v1';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function basePreset(overrides: Partial<LookPreset> = {}): LookPreset {
  return {
    id: crypto.randomUUID(),
    name: 'Look',
    transition: 'cross-dissolve',
    transitionDur: 0.5,
    animation: 'zoom-in',
    animationDur: 1.0,
    overlay: 'none',
    ...overrides,
  };
}

describe('lookPresetService — scaleRate persistence round-trip', () => {
  beforeEach(() => installLocalStorage());

  it('saves and reloads a preset WITH a scaleRate intact', () => {
    const preset = basePreset({ animation: 'zoom-in', scaleRate: 0.042 });
    saveLookPreset(preset);
    const [loaded] = loadLookPresets();
    expect(loaded).toBeDefined();
    expect(loaded!.scaleRate).toBe(0.042);
    expect(loaded!.animation).toBe('zoom-in');
  });

  it('a preset saved without a scaleRate reloads with scaleRate undefined (non-zoom look)', () => {
    const preset = basePreset({ animation: 'none' });
    delete (preset as { scaleRate?: number }).scaleRate;
    saveLookPreset(preset);
    const [loaded] = loadLookPresets();
    expect(loaded!.scaleRate).toBeUndefined();
  });

  it('OLD stored presets (JSON written before scaleRate existed) load without crashing, field undefined', () => {
    // Simulate a pre-migration payload: exactly the old shape, no scaleRate key.
    const legacy = [{
      id: 'legacy-1',
      name: 'Old Look',
      transition: 'fade',
      transitionDur: 0.4,
      animation: 'zoom-out',
      animationDur: 2,
      overlay: 'none',
    }];
    localStorage.setItem(LOOK_PRESETS_KEY, JSON.stringify(legacy));
    const loaded = loadLookPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('legacy-1');
    expect(loaded[0]!.scaleRate).toBeUndefined();
  });
});

describe('resolvePresetScaleRate — apply preset rate onto a segment', () => {
  it('returns undefined for a preset with no scaleRate (segment keeps its current/default rate)', () => {
    expect(resolvePresetScaleRate({ scaleRate: undefined }, 5)).toBeUndefined();
  });

  it('returns the preset rate unchanged on a short segment (under its cap)', () => {
    expect(resolvePresetScaleRate({ scaleRate: 0.05 }, 5)).toBe(0.05);
  });

  it('caps the preset rate to the segment max on a long segment', () => {
    // 30s segment: max ~0.033 → a 0.05 preset rate is pulled down.
    expect(resolvePresetScaleRate({ scaleRate: 0.05 }, 30)).toBeCloseTo(0.033, 10);
  });

  it('applies the SAME preset differently per segment length (mixed-duration apply-to-all)', () => {
    const preset = { scaleRate: 0.06 };
    expect(resolvePresetScaleRate(preset, 4)).toBeCloseTo(0.06, 10);   // short → unchanged
    expect(resolvePresetScaleRate(preset, 90)).toBeCloseTo(0.011, 10); // long → capped
  });
});
