// src/services/presetService.ts
// Global style preset library — persisted in localStorage, shared across all projects.

export type PresetCategory = 'transition' | 'animation' | 'overlayFilter' | 'overlayConfig';

export interface OverlayConfigPreset {
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: 'normal' | 'italic';
  textShadow?: string;
  animation?: string;
}

export interface StylePreset {
  id: string;
  name: string;
  category: PresetCategory;
  createdAt: number;
  builtIn?: boolean; // true = cannot be deleted
  value:
    | string // for transition, animation, overlayFilter categories
    | OverlayConfigPreset; // for overlayConfig category
}

const PRESETS_KEY = 'kinetix:stylePresets:v1';

// ── Built-in presets ─────────────────────────────────────────────────────────

const BUILT_IN_PRESETS: StylePreset[] = [
  // overlayConfig presets (the 3 existing hard-coded ones)
  {
    id: 'builtin-cyber',
    name: 'Cyber',
    category: 'overlayConfig',
    createdAt: 0,
    builtIn: true,
    value: {
      color: '#00FF00',
      backgroundColor: '#000000',
      fontFamily: 'Bangers',
      fontSize: 80,
      fontWeight: 900,
      animation: 'glitch',
    },
  },
  {
    id: 'builtin-retro',
    name: 'Retro',
    category: 'overlayConfig',
    createdAt: 0,
    builtIn: true,
    value: {
      color: '#FF00FF',
      backgroundColor: '#ffffff',
      fontFamily: 'Monoton',
      fontSize: 70,
      fontWeight: 900,
      animation: 'neon-flicker',
    },
  },
  {
    id: 'builtin-bold',
    name: 'Bold',
    category: 'overlayConfig',
    createdAt: 0,
    builtIn: true,
    value: {
      color: '#000000',
      backgroundColor: '#F27D26',
      fontFamily: 'Anton',
      fontSize: 90,
      fontWeight: 900,
      animation: 'slide-up',
    },
  },
];

// ── CRUD ─────────────────────────────────────────────────────────────────────

function loadRaw(): StylePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StylePreset[];
  } catch {
    return [];
  }
}

function saveRaw(presets: StylePreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // ignore storage errors
  }
}

/** Returns built-in presets first, then user-saved presets, filtered by category if provided */
export function loadPresets(category?: PresetCategory): StylePreset[] {
  const userPresets = loadRaw().filter(p => !category || p.category === category);
  const builtIns = BUILT_IN_PRESETS.filter(p => !category || p.category === category);
  return [...builtIns, ...userPresets];
}

/** Save a new user preset. Returns the saved preset with a generated id. */
export function savePreset(
  name: string,
  category: PresetCategory,
  value: StylePreset['value'],
): StylePreset {
  const preset: StylePreset = {
    id: crypto.randomUUID(),
    name,
    category,
    createdAt: Date.now(),
    value,
  };
  const existing = loadRaw();
  saveRaw([...existing, preset]);
  return preset;
}

/** Delete a user preset by id. Built-in presets cannot be deleted. */
export function deletePreset(id: string): void {
  const existing = loadRaw();
  saveRaw(existing.filter(p => p.id !== id));
}

/** Rename a user preset. Built-in presets cannot be renamed. */
export function renamePreset(id: string, name: string): void {
  const existing = loadRaw();
  saveRaw(existing.map(p => (p.id === id && !p.builtIn ? { ...p, name } : p)));
}
