/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFaCapable,
  __resetFaCapabilityForTests,
  isFaEnabledForProject,
  isFaGateOpenForProject,
  shouldPersistFaChoice,
  resolveFaLanguage,
  FA_PROJECT_DEFAULT_ON,
  LEGACY_GLOBAL_FA_TOGGLE_KEY,
} from './faGate';
import { saveProject, loadProject } from './projectStore';
import type { Project, VideoSegment } from '../types';

// `saveProject`/`loadProject` (used only by the "G1 proof" describe block
// below, which stubs `window.__TAURI_INTERNALS__`) route through the OS
// store when `isTauri()` is true — fake that store with a Map so this file
// doesn't need a real Tauri IPC bridge.
let osBacking: Map<string, string>;
vi.mock('./projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => { osBacking.set(id, contents); return Promise.resolve(); },
  osStoreRead: (id: string) => Promise.resolve(osBacking.has(id) ? osBacking.get(id)! : null),
  osStoreDelete: (id: string) => { osBacking.delete(id); return Promise.resolve(); },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));

function installLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage);
}

describe('isFaCapable', () => {
  beforeEach(() => {
    __resetFaCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('returns false when window is unavailable (non-browser runtime)', () => {
    vi.stubGlobal('window', undefined);
    expect(isFaCapable()).toBe(false);
  });

  it('returns false when window exists but has no __TAURI_INTERNALS__ (plain `npm run dev`)', () => {
    vi.stubGlobal('window', {});
    expect(isFaCapable()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is present (tauri:dev / built app)', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaCapable()).toBe(true);
  });

  it('memoizes the result — a second call does not re-probe', () => {
    vi.stubGlobal('window', {});
    expect(isFaCapable()).toBe(false);
    // Change the stub after the first (memoized) call — if the function
    // re-probed, this would now see __TAURI_INTERNALS__ and return true.
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaCapable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WS1 Session G — the PER-PROJECT switch (owner ruling R-AK).
// ---------------------------------------------------------------------------

const proj = (fa?: boolean): Pick<Project, 'faHighPrecisionSync'> =>
  (fa === undefined ? {} : { faHighPrecisionSync: fa });

describe('isFaEnabledForProject — the tri-state', () => {
  it('DEFAULT OFF: a project with no stored preference is disabled (WS1 Session H value-only revert)', () => {
    // Was DEFAULT ON under owner ruling R-AK (WS1 Session G). WS1 Session H
    // flipped the VALUE only — see `FA_PROJECT_DEFAULT_ON`'s own doc comment
    // for the exact condition that flips it back.
    expect(FA_PROJECT_DEFAULT_ON).toBe(false);
    expect(isFaEnabledForProject(proj(undefined))).toBe(false);
  });

  it('EXPLICIT ON: a project that stored `true` is enabled — the default never overrides an explicit choice', () => {
    expect(isFaEnabledForProject(proj(true))).toBe(true);
  });

  it('EXPLICIT OFF: a project that stored `false` is disabled', () => {
    expect(isFaEnabledForProject(proj(false))).toBe(false);
  });

  it('a null/undefined project resolves to the default rather than throwing', () => {
    expect(isFaEnabledForProject(null)).toBe(false);
    expect(isFaEnabledForProject(undefined)).toBe(false);
  });

  it('is per-project: two projects in the same session disagree independently', () => {
    expect(isFaEnabledForProject(proj(false))).toBe(false);
    expect(isFaEnabledForProject(proj(undefined))).toBe(false);
    expect(isFaEnabledForProject(proj(true))).toBe(true);
  });

  it('is READ-ONLY — resolving a default never mutates the project object it was given', () => {
    const p: Pick<Project, 'faHighPrecisionSync'> = {};
    isFaEnabledForProject(p);
    isFaGateOpenForProject(p);
    // The absent key must stay absent: "no preference" is a durable state,
    // not something a read silently upgrades to an explicit choice.
    expect(Object.prototype.hasOwnProperty.call(p, 'faHighPrecisionSync')).toBe(false);
    expect(Object.keys(p)).toEqual([]);
  });
});

describe('isFaGateOpenForProject — capability AND the project switch', () => {
  beforeEach(() => {
    installLocalStorage();
    __resetFaCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('stays closed by default on a capable runtime for a project with no preference', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaGateOpenForProject(proj(undefined))).toBe(false);
  });

  it('opens on a capable runtime when the project explicitly opted IN', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaGateOpenForProject(proj(true))).toBe(true);
  });

  it('stays closed on an incapable runtime even when the project explicitly opted IN', () => {
    vi.stubGlobal('window', {});
    expect(isFaGateOpenForProject(proj(true))).toBe(false);
  });

  it('stays closed on a capable runtime when the project explicitly opted OUT', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaGateOpenForProject(proj(false))).toBe(false);
  });

  it('MODEL-PRESENT vs MODEL-ABSENT: the gate is deliberately model-independent', () => {
    // Model presence is NOT a gate input — `runForcedAlignmentForSync` owns
    // it, fail-clean (its own suite covers the ModelNotFound rejection at
    // `forcedAlignmentRun.test.ts`'s "returns null when invoke rejects"
    // case). This asserts the division of labour rather than restating it in
    // prose: nothing about a model can change this function's answer,
    // because a model is not one of its arguments.
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaGateOpenForProject.length).toBe(1); // the project — and only the project
    expect(isFaGateOpenForProject(proj(true))).toBe(true);
    // ...and with the gate open but no model, the SYNC still has a defined
    // outcome: FA returns null and the caller falls back to Whisper tokens.
    // That fallback is `App.tsx`'s single `faTokens ?? transcriptTokens`
    // branch, exercised end-to-end by forcedAlignmentRun.test.ts.
  });
});

describe('shouldPersistFaChoice — Project Settings only writes on an actual change', () => {
  it('does NOT write when the user leaves the control alone, at either resolved value', () => {
    // The exact scenario that made the retired global key meaningless: the
    // user opens Settings to change their resolution tier and hits Save. Not
    // default-value-dependent — this is `shouldPersistFaChoice`'s own
    // draft-equals-effective rule, exercised at both booleans.
    expect(shouldPersistFaChoice(true, true)).toBe(false);
  });

  it('does NOT write when an explicitly-OFF project is saved unchanged', () => {
    expect(shouldPersistFaChoice(false, false)).toBe(false);
  });

  it('writes when the user turns it OFF on a default-ON project', () => {
    expect(shouldPersistFaChoice(false, true)).toBe(true);
  });

  it('writes when the user turns it back ON', () => {
    expect(shouldPersistFaChoice(true, false)).toBe(true);
  });
});

describe('resolveFaLanguage — the auto-detect fix (WS1 Session M)', () => {
  it('prefers the sticky user choice when set', () => {
    expect(resolveFaLanguage({ language: 'es', detectedLanguage: 'en' })).toBe('es');
  });

  it('falls back to the detected language when the sticky choice is unset', () => {
    // The exact gap that sent auto-detect runs to an unsupported-language
    // fallback: Whisper detected the language, but the sticky field was
    // undefined, so the gate saw nothing. Now the detection feeds the gate.
    expect(resolveFaLanguage({ language: undefined, detectedLanguage: 'en' })).toBe('en');
  });

  it('returns undefined only when neither a choice nor a detection exists', () => {
    expect(resolveFaLanguage({ language: undefined, detectedLanguage: undefined })).toBeUndefined();
    expect(resolveFaLanguage(null)).toBeUndefined();
    expect(resolveFaLanguage(undefined)).toBeUndefined();
  });
});

describe('MIGRATION PATH — the retired per-machine global toggle', () => {
  beforeEach(() => {
    installLocalStorage();
    __resetFaCapabilityForTests();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('a legacy stored global `true` does NOT enable a project that never expressed a preference', () => {
    // The pre-change `ProjectSettingsModal.handleSave` wrote this key
    // UNCONDITIONALLY on every save, so a stored value is indistinguishable
    // from "this user once changed their resolution tier". Honouring it would
    // let an incidental Save silently override the current default.
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ [LEGACY_GLOBAL_FA_TOGGLE_KEY]: true }));
    expect(isFaGateOpenForProject(proj(undefined))).toBe(false);
  });

  it('a legacy stored global `false` also does not change the answer (it agrees with the current default anyway)', () => {
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ [LEGACY_GLOBAL_FA_TOGGLE_KEY]: false }));
    expect(isFaGateOpenForProject(proj(undefined))).toBe(false);
  });

  it('the legacy key is left in storage untouched — a read migration is not a destructive one', () => {
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ [LEGACY_GLOBAL_FA_TOGGLE_KEY]: true, other: 1 }));
    isFaGateOpenForProject(proj(undefined));
    isFaEnabledForProject(proj(false));
    const after = JSON.parse(localStorage.getItem('kinetix:ui:v1')!);
    expect(after).toEqual({ [LEGACY_GLOBAL_FA_TOGGLE_KEY]: true, other: 1 });
  });

  it('an explicit per-project OFF still wins over everything, legacy key present or not', () => {
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ [LEGACY_GLOBAL_FA_TOGGLE_KEY]: true }));
    expect(isFaGateOpenForProject(proj(false))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G1 PROOF — a project persisted BEFORE this change loads without retiming
// and without acquiring a stored preference. G1 ("any existing project would
// retime without explicit user action") fires if either half fails.
// ---------------------------------------------------------------------------

/** A project as it was serialised before `faHighPrecisionSync` existed: no
 *  such key anywhere, real segment timings, `anchorSource: 'whisper'`. */
function preChangeProjectJson(): string {
  const segments: VideoSegment[] = [
    { id: 's1', text: 'You are seven years old.', startTime: 0, duration: 5.64, transition: 'none', animation: 'none', order: 0, anchorSource: 'whisper' },
    { id: 's2', text: 'The night is not empty.', startTime: 5.64, duration: 4.11, transition: 'none', animation: 'none', order: 1, anchorSource: 'whisper' },
    { id: 's3', text: 'You listen.', startTime: 9.75, duration: 3.02, transition: 'none', animation: 'none', order: 2, anchorSource: 'whisper' },
  ] as unknown as VideoSegment[];
  return JSON.stringify({
    version: 2,
    savedAt: 1_750_000_000_000,
    project: {
      id: 'pre-change-1', name: 'Pre-change project', script: '', sceneDetails: '',
      segments, assets: [], language: 'en',
      globalTransition: 'none', globalTransitionDuration: 0.5, globalAnimation: 'none',
      globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
      confirmed: true,
    },
  });
}

describe('G1 proof — loading a pre-change project neither retimes nor acquires a preference', () => {
  beforeEach(async () => {
    installLocalStorage();
    __resetFaCapabilityForTests();
    osBacking = new Map();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    osBacking.set('pre-change-1', preChangeProjectJson());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('loads every segment timing BYTE-IDENTICALLY to what was stored — loading is not a retime', async () => {
    const before = JSON.parse(preChangeProjectJson()).project.segments;
    const loaded = await loadProject('pre-change-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.project.segments).toEqual(before);
    // Spelled out, because this is the claim G1 actually makes: every
    // startTime and duration survives the load unchanged.
    expect(loaded!.project.segments.map(s => [s.startTime, s.duration]))
      .toEqual([[0, 5.64], [5.64, 4.11], [9.75, 3.02]]);
    expect(loaded!.project.segments.every(s => s.anchorSource === 'whisper')).toBe(true);
  });

  it('does not acquire a stored `faHighPrecisionSync` on load — "no preference" survives', async () => {
    const loaded = (await loadProject('pre-change-1'))!;
    expect(Object.prototype.hasOwnProperty.call(loaded.project, 'faHighPrecisionSync')).toBe(false);
    expect(loaded.project.faHighPrecisionSync).toBeUndefined();
  });

  it('resolves to the (OFF) default WITHOUT writing it back — reading the gate is not a migration', async () => {
    const loaded = (await loadProject('pre-change-1'))!;
    expect(isFaGateOpenForProject(loaded.project)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded.project, 'faHighPrecisionSync')).toBe(false);
    // and nothing was persisted either
    const reloaded = (await loadProject('pre-change-1'))!;
    expect(Object.prototype.hasOwnProperty.call(reloaded.project, 'faHighPrecisionSync')).toBe(false);
  });

  it('survives a save/load round-trip still preference-free and still un-retimed', async () => {
    const loaded = (await loadProject('pre-change-1'))!;
    isFaGateOpenForProject(loaded.project);
    await saveProject(loaded.project);
    const again = (await loadProject('pre-change-1'))!;
    expect(Object.prototype.hasOwnProperty.call(again.project, 'faHighPrecisionSync')).toBe(false);
    expect(again.project.segments.map(s => [s.startTime, s.duration]))
      .toEqual([[0, 5.64], [5.64, 4.11], [9.75, 3.02]]);
  });

  it('an explicit OFF written by the user round-trips and is never overwritten by the default', async () => {
    const loaded = (await loadProject('pre-change-1'))!;
    await saveProject({ ...loaded.project, faHighPrecisionSync: false } as Project);
    const again = (await loadProject('pre-change-1'))!;
    expect(again.project.faHighPrecisionSync).toBe(false);
    expect(isFaGateOpenForProject(again.project)).toBe(false);
    // reading it again must not "repair" it towards the default
    isFaEnabledForProject(again.project);
    expect((await loadProject('pre-change-1'))!.project.faHighPrecisionSync).toBe(false);
  });
});
