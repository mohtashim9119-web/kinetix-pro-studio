/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2-50 — the staged-slot delete contract, and the byte-level roundtrip the
// restore depends on.
//
// WHAT IS BEING PROTECTED. Two claims, and they fail in different directions:
//
//   1. Persisted rows for a project equal its currently staged slots — no
//      fewer (the slot would not restore) and NO MORE (an orphan). Orphans are
//      the reason this file leans on row counts rather than on "does the slot
//      come back": a leak is invisible to a restore assertion, and WS2-49's
//      audit exists because one went unnoticed for weeks.
//   2. A restored `File` is byte-identical AND identity-identical to the one
//      staged. `getFileIdentity` (`syncEngine.ts:383`) is
//      `${name}|${size}|${lastModified}`, so dropping `lastModified` produces a
//      file that reads correct, restores correct, and silently invalidates the
//      cached transcript for audio that was already transcribed.
//
// The counts below are asserted against the real store, not the plan, so a
// planner that emits a correct plan the writer then bungles still goes red.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { StagedFile, StagedFiles } from '../components/DropZonePanel';
import {
  TEXT_SLOTS,
  ALL_PERSISTED_SLOTS,
  planStagedReconcile,
  canAdoptRestoredVoiceover,
  stagedVoiceoverNeedsExplicitTranscribe,
  enumerateStagedSlots,
  restoreStagedFiles,
  slotKeyFor,
  toStoredRow,
  isStagedEmpty,
  type StagedSlotKind,
} from './stagedFilesPersist';
import {
  putStagedFile,
  deleteStagedFile,
  deleteAllStagedForProject,
  getStagedFilesForProject,
  countStagedFiles,
} from './stagedFilesStore';

const ALL_SLOTS: readonly StagedSlotKind[] = ['script', 'scene', 'voiceover', 'asset', 'zip'];

const EMPTY: StagedFiles = {
  scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [],
};

let keyCounter = 0;
function sf(name: string, body = `contents of ${name}`, lastModified = 1_700_000_000_000): StagedFile {
  keyCounter += 1;
  return {
    file: new File([body], name, { type: 'text/plain', lastModified }),
    key: `key-${keyCounter}`,
  };
}

let projectCounter = 0;
/** IDBFactory has no "delete all databases", so every test gets its own
 *  project id namespace rather than resetting the DB — the same convention
 *  `waveformStore.test.ts` uses. */
function freshProject(): string {
  projectCounter += 1;
  return `staged-project-${projectCounter}`;
}

/** Applies a reconcile plan exactly as `DropZonePanel.updateStaged` does. */
async function applyPlan(
  projectId: string,
  prev: StagedFiles,
  next: StagedFiles,
  enabled: readonly StagedSlotKind[] = ALL_PERSISTED_SLOTS,
): Promise<void> {
  const plan = planStagedReconcile(prev, next, enabled);
  for (const slotKey of plan.remove) await deleteStagedFile(projectId, slotKey);
  for (const entry of plan.write) await putStagedFile(await toStoredRow(projectId, entry));
}

// ---------------------------------------------------------------------------
// The delete contract
// ---------------------------------------------------------------------------

describe('WS2-50 — staged-slot delete contract', () => {
  it('staging a slot writes exactly one row', async () => {
    const p = freshProject();
    await applyPlan(p, EMPTY, { ...EMPTY, scriptFile: sf('script.txt') });
    expect(await countStagedFiles(p)).toBe(1);
  });

  it('REPLACING a file in a slot leaves no orphan', async () => {
    // The singleton slots address by kind, so the replacement overwrites the
    // same compound key. A key scheme that addressed by React key instead
    // would leave the predecessor row behind here, and the slot would still
    // restore correctly — which is exactly why this asserts the COUNT.
    const p = freshProject();
    const first = { ...EMPTY, scriptFile: sf('script.txt', 'v1') };
    const second = { ...EMPTY, scriptFile: sf('script.txt', 'v2') };
    await applyPlan(p, EMPTY, first);
    await applyPlan(p, first, second);
    expect(await countStagedFiles(p)).toBe(1);
    const rows = await getStagedFilesForProject(p);
    expect(await rows[0]!.blob.text()).toBe('v2');
  });

  it('CLEARING a slot leaves no orphan', async () => {
    const p = freshProject();
    const staged = { ...EMPTY, scriptFile: sf('script.txt'), sceneFile: sf('scene.txt') };
    await applyPlan(p, EMPTY, staged);
    expect(await countStagedFiles(p)).toBe(2);
    const cleared = { ...staged, scriptFile: null };
    await applyPlan(p, staged, cleared);
    expect(await countStagedFiles(p)).toBe(1);
    expect((await getStagedFilesForProject(p))[0]!.slotKey).toBe('scene');
  });

  it('APPLYING sync (staged → empty) leaves no orphan', async () => {
    const p = freshProject();
    const staged = { ...EMPTY, scriptFile: sf('a.txt'), sceneFile: sf('b.txt') };
    await applyPlan(p, EMPTY, staged);
    await applyPlan(p, staged, EMPTY); // triggerSync's updateStaged(() => EMPTY_STAGED)
    expect(await countStagedFiles(p)).toBe(0);
  });

  it('DISCARDING (clear-all) leaves no orphan across every slot kind', async () => {
    const p = freshProject();
    const staged: StagedFiles = {
      scriptFile: sf('s.txt'),
      sceneFile: sf('d.txt'),
      voiceoverFile: sf('vo.mp3'),
      assetFiles: [sf('a.png'), sf('b.png')],
      zipFiles: [sf('z.zip')],
    };
    await applyPlan(p, EMPTY, staged, ALL_SLOTS);
    expect(await countStagedFiles(p)).toBe(6);
    await applyPlan(p, staged, EMPTY, ALL_SLOTS);
    expect(await countStagedFiles(p)).toBe(0);
  });

  it('removing ONE staged asset deletes only that row', async () => {
    const p = freshProject();
    const a = sf('a.png');
    const b = sf('b.png');
    const both = { ...EMPTY, assetFiles: [a, b] };
    const one = { ...EMPTY, assetFiles: [b] };
    await applyPlan(p, EMPTY, both, ALL_SLOTS);
    await applyPlan(p, both, one, ALL_SLOTS);
    const rows = await getStagedFilesForProject(p);
    expect(rows.map(r => r.name)).toEqual(['b.png']);
  });

  it('deleting a project removes every staged row it owned', async () => {
    const p = freshProject();
    const other = freshProject();
    await applyPlan(p, EMPTY, { ...EMPTY, scriptFile: sf('s.txt'), sceneFile: sf('d.txt') });
    await applyPlan(other, EMPTY, { ...EMPTY, scriptFile: sf('s.txt') });
    await deleteAllStagedForProject(p);
    expect(await countStagedFiles(p)).toBe(0);
    // A sibling project's rows are untouched — the delete is scoped, not a purge.
    expect(await countStagedFiles(other)).toBe(1);
  });

  it('an unchanged slot is not rewritten', async () => {
    // Guards against a reconciler that rewrites every slot on every keystroke-
    // sized update: staging an asset must not re-serialise the script blob.
    const script = sf('script.txt');
    const before = { ...EMPTY, scriptFile: script };
    const after = { ...EMPTY, scriptFile: script, assetFiles: [sf('a.png')] };
    const plan = planStagedReconcile(before, after, ALL_SLOTS);
    expect(plan.write.map(w => w.slotKey)).toEqual([`asset:${after.assetFiles[0]!.key}`]);
    expect(plan.remove).toEqual([]);
  });

  it('a plan never writes a slot absent from the next state', async () => {
    // The processZipFile shape, stated as an assertion: membership is decided
    // BEFORE the write, so every written slotKey must be present in `next`.
    const prev: StagedFiles = { ...EMPTY, scriptFile: sf('old.txt'), assetFiles: [sf('gone.png')] };
    const next: StagedFiles = { ...EMPTY, scriptFile: sf('new.txt') };
    const plan = planStagedReconcile(prev, next, ALL_SLOTS);
    const nextKeys = new Set(enumerateStagedSlots(next, ALL_SLOTS).map(e => e.slotKey));
    for (const w of plan.write) expect(nextKeys.has(w.slotKey)).toBe(true);
    expect(plan.remove).toContain(`asset:${prev.assetFiles[0]!.key}`);
  });

  it('TEXT_SLOTS restricts persistence to script and scene', async () => {
    // The enabled-set mechanism itself, asserted rather than assumed — it is
    // what let WS2-50 ship the text slots before paying the blob slots' cost.
    const p = freshProject();
    const staged: StagedFiles = {
      scriptFile: sf('s.txt'), sceneFile: null,
      voiceoverFile: sf('vo.mp3'), assetFiles: [sf('a.png')], zipFiles: [sf('z.zip')],
    };
    await applyPlan(p, EMPTY, staged, TEXT_SLOTS);
    const rows = await getStagedFilesForProject(p);
    expect(rows.map(r => r.slotKey)).toEqual(['script']);
  });

  it('ALL_PERSISTED_SLOTS covers every slot the panel can hold', async () => {
    // Commit 3's scope. A slot missing from this set silently does not persist,
    // which looks exactly like a slot that persists and fails to restore.
    const p = freshProject();
    const staged: StagedFiles = {
      scriptFile: sf('s.txt'), sceneFile: sf('d.txt'), voiceoverFile: sf('vo.mp3'),
      assetFiles: [sf('a.png')], zipFiles: [sf('z.zip')],
    };
    await applyPlan(p, EMPTY, staged, ALL_PERSISTED_SLOTS);
    const rows = await getStagedFilesForProject(p);
    expect(rows.map(r => r.slotKey).sort()).toEqual(
      ['asset:' + staged.assetFiles[0]!.key, 'scene', 'script', 'voiceover', 'zip:' + staged.zipFiles[0]!.key].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Roundtrip
// ---------------------------------------------------------------------------

describe('WS2-50 — staged-slot restore roundtrip', () => {
  it('restores byte-identical content', async () => {
    const p = freshProject();
    const staged = { ...EMPTY, scriptFile: sf('script.txt', 'line one\nline two') };
    await applyPlan(p, EMPTY, staged);
    const restored = restoreStagedFiles(await getStagedFilesForProject(p));
    expect(restored.scriptFile).not.toBeNull();
    expect(await restored.scriptFile!.file.text()).toBe('line one\nline two');
  });

  it('preserves name, size and lastModified — the transcription cache key', async () => {
    // `getFileIdentity` is `${name}|${size}|${lastModified}`. A restore that
    // drops lastModified takes Date.now(), changes the identity, and forces a
    // re-transcription of audio that was already transcribed.
    const p = freshProject();
    const original = sf('voice.mp3', 'AUDIOBYTES', 1_699_000_000_123);
    await applyPlan(p, EMPTY, { ...EMPTY, scriptFile: original });
    const restored = restoreStagedFiles(await getStagedFilesForProject(p)).scriptFile!;
    const identity = (f: File): string => `${f.name}|${f.size}|${f.lastModified}`;
    expect(identity(restored.file)).toBe(identity(original.file));
  });

  it('preserves the React key so a restored row keeps its identity', async () => {
    const p = freshProject();
    const original = sf('script.txt');
    await applyPlan(p, EMPTY, { ...EMPTY, scriptFile: original });
    const restored = restoreStagedFiles(await getStagedFilesForProject(p)).scriptFile!;
    expect(restored.key).toBe(original.key);
  });

  it('restores each slot kind into its own field', () => {
    const rows = [
      { projectId: 'x', slotKey: 'script', key: 'k1', name: 's.txt', mimeType: 'text/plain', lastModified: 1, size: 1, blob: new Blob(['a']), stagedAt: 1 },
      { projectId: 'x', slotKey: 'scene', key: 'k2', name: 'd.txt', mimeType: 'text/plain', lastModified: 1, size: 1, blob: new Blob(['b']), stagedAt: 2 },
      { projectId: 'x', slotKey: 'voiceover', key: 'k3', name: 'v.mp3', mimeType: 'audio/mpeg', lastModified: 1, size: 1, blob: new Blob(['c']), stagedAt: 3 },
      { projectId: 'x', slotKey: 'asset:k4', key: 'k4', name: 'a.png', mimeType: 'image/png', lastModified: 1, size: 1, blob: new Blob(['d']), stagedAt: 4 },
      { projectId: 'x', slotKey: 'zip:k5', key: 'k5', name: 'z.zip', mimeType: 'application/zip', lastModified: 1, size: 1, blob: new Blob(['e']), stagedAt: 5 },
    ];
    const restored = restoreStagedFiles(rows);
    expect(restored.scriptFile?.file.name).toBe('s.txt');
    expect(restored.sceneFile?.file.name).toBe('d.txt');
    expect(restored.voiceoverFile?.file.name).toBe('v.mp3');
    expect(restored.assetFiles.map(f => f.file.name)).toEqual(['a.png']);
    expect(restored.zipFiles.map(f => f.file.name)).toEqual(['z.zip']);
  });

  it('restores multi-file slots in staging order, not index-scan order', () => {
    const rows = [
      { projectId: 'x', slotKey: 'asset:kb', key: 'kb', name: 'second.png', mimeType: 'image/png', lastModified: 1, size: 1, blob: new Blob(['b']), stagedAt: 200 },
      { projectId: 'x', slotKey: 'asset:ka', key: 'ka', name: 'first.png', mimeType: 'image/png', lastModified: 1, size: 1, blob: new Blob(['a']), stagedAt: 100 },
    ];
    expect(restoreStagedFiles(rows).assetFiles.map(f => f.file.name)).toEqual(['first.png', 'second.png']);
  });

  it('a restore of nothing is an empty staged state', () => {
    expect(isStagedEmpty(restoreStagedFiles([]))).toBe(true);
  });

  it('singleton slots address by kind; multi-file slots by React key', () => {
    const f = sf('x');
    expect(slotKeyFor('script', f)).toBe('script');
    expect(slotKeyFor('scene', f)).toBe('scene');
    expect(slotKeyFor('voiceover', f)).toBe('voiceover');
    expect(slotKeyFor('asset', f)).toBe(`asset:${f.key}`);
    expect(slotKeyFor('zip', f)).toBe(`zip:${f.key}`);
  });
});


// ---------------------------------------------------------------------------
// Call sites
//
// Every test above exercises the FUNCTIONS. A destructive probe earlier this
// session (WS2-50 P12) showed what that misses: dropping an argument at a call
// site left an entire suite of pure-function tests green, because they
// exercise the predicate and never the caller. The same gap applies to a
// delete that is correct and simply never invoked, so the two call sites that
// cannot be reached from a unit test are scanned here.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(resolve(HERE, '..', 'components', 'DropZonePanel.tsx'), 'utf-8');
const DASHBOARD_SRC = readFileSync(resolve(HERE, '..', 'components', 'ProjectDashboard.tsx'), 'utf-8');
const APP_SRC = readFileSync(resolve(HERE, '..', 'App.tsx'), 'utf-8');

describe('WS2-50 — the delete contract is actually invoked', () => {
  it('updateStaged reconciles persistence at the single choke point', () => {
    const start = PANEL_SRC.indexOf('const updateStaged = (updater: (prev: StagedFiles) => StagedFiles) => {');
    expect(start, 'updateStaged not found — this guard has lost its target').toBeGreaterThan(-1);
    const body = PANEL_SRC.slice(start, PANEL_SRC.indexOf('\n  };', start));
    expect(
      body,
      'updateStaged no longer reconciles persistence. It is the ONE place every staged mutation ' +
        'passes through; without the call here, replace/clear/apply/discard each leak a row.',
    ).toContain('reconcileStagedPersistence(prev, next);');
    expect(body, 'the reconcile no longer receives the previous state, so it cannot compute deletes')
      .toContain('const prev = stagedRef.current;');
  });

  it('the reconciler performs deletes, not only writes', () => {
    expect(
      PANEL_SRC,
      'the reconciler stopped calling deleteStagedFile — every replaced or cleared slot now ' +
        'leaves an orphan row behind.',
    ).toContain('await deleteStagedFile(owner, slotKey)');
  });

  it('the staged store never crosses the Tauri IPC bridge', () => {
    // CLAUDE.md §4: base64-encoding a file-sized blob to reach Rust inflates
    // memory ~5-8x across the JS heap and the WKWebView bridge. `tauriFfmpeg.ts`
    // already violates this in `probeAudioDuration`/`probeVideoFps` (filed,
    // unowned, out of scope) and this feature must not become the second
    // instance. IndexedDB stores a Blob by structured clone inside the webview:
    // no `invoke`, no base64, no Rust. Asserted structurally rather than timed,
    // because a timing number cannot prove the absence of a call.
    const storeSrc = readFileSync(resolve(HERE, 'stagedFilesStore.ts'), 'utf-8');
    const persistSrc = readFileSync(resolve(HERE, 'stagedFilesPersist.ts'), 'utf-8');
    for (const [name, src] of [['stagedFilesStore.ts', storeSrc], ['stagedFilesPersist.ts', persistSrc]] as const) {
      for (const banned of ['invoke(', 'bytesToBase64', '@tauri-apps', 'btoa(']) {
        expect(
          src.includes(banned),
          `${name} references ${banned} — staged blobs must reach storage by structured clone, ` +
            'not by base64 over the IPC bridge.',
        ).toBe(false);
      }
    }
  });

  it('deleting a project deletes its staged rows', () => {
    expect(
      DASHBOARD_SRC,
      'ProjectDashboard no longer clears staged rows on delete — they outlive the only thing ' +
        'that could ever restore them.',
    ).toContain('await deleteAllStagedForProject(id);');
  });
});

describe('WS2-50 — a restored voiceover never starts a transcription', () => {
  /** `handleVoiceoverRestored`'s body. */
  function restoredBody(): string {
    const marker = 'const handleVoiceoverRestored = useCallback((file: File): boolean => {';
    const start = APP_SRC.indexOf(marker);
    expect(start, 'handleVoiceoverRestored not found — this guard has lost its target')
      .toBeGreaterThan(-1);
    const rest = APP_SRC.slice(start + marker.length);
    return rest.slice(0, rest.indexOf('\n  },'));
  }

  // The predicate itself is a pure function, tested behaviourally below, so
  // this scan only has to prove App.tsx DELEGATES to it. That split exists
  // because destructive probes C2 and C3 each deleted one clause from the
  // former inline `if` and a scan-based guard stayed GREEN — the clause's text
  // was still present in the declaration above it. A scan cannot tell a
  // disjunction from either of its halves.
  it('App.tsx delegates the decision to the shared predicate', () => {
    const body = restoredBody();
    expect(
      body,
      'handleVoiceoverRestored no longer calls canAdoptRestoredVoiceover — the gate has been ' +
        'reinlined, where a source scan cannot see a missing clause.',
    ).toContain('canAdoptRestoredVoiceover({');
    expect(body, 'the gate no longer refuses anything').toContain('if (!adoptable) return false;');
  });

  describe('canAdoptRestoredVoiceover — the full truth table', () => {
    const ID = 'vo.m4a|31354992|1784882086000';

    it('adopts only when the file matches AND tokens are cached', () => {
      expect(canAdoptRestoredVoiceover({
        fileIdentity: ID, lastTranscribedFileIdentity: ID, cachedTokenCount: 4618,
      })).toBe(true);
    });

    it('refuses a DIFFERENT file even with tokens cached', () => {
      // Adopting here would bind one audio file to another file's tokens.
      expect(canAdoptRestoredVoiceover({
        fileIdentity: ID, lastTranscribedFileIdentity: 'other.m4a|1|1', cachedTokenCount: 4618,
      })).toBe(false);
    });

    it('refuses the SAME file when no tokens are cached', () => {
      // handleVoiceoverStaged would have nothing to skip the transcription
      // with, so whisper-cli launches on app load.
      expect(canAdoptRestoredVoiceover({
        fileIdentity: ID, lastTranscribedFileIdentity: ID, cachedTokenCount: 0,
      })).toBe(false);
    });

    it('refuses when nothing was ever transcribed', () => {
      expect(canAdoptRestoredVoiceover({
        fileIdentity: ID, lastTranscribedFileIdentity: undefined, cachedTokenCount: 0,
      })).toBe(false);
      // And an undefined identity must never be treated as a wildcard match.
      expect(canAdoptRestoredVoiceover({
        fileIdentity: ID, lastTranscribedFileIdentity: undefined, cachedTokenCount: 4618,
      })).toBe(false);
    });
  });

  it('the refusal path is reachable before any adoption', () => {
    // Ordering matters: the guard must return BEFORE handleVoiceoverStaged is
    // called, not after it.
    const body = restoredBody();
    const refuse = body.indexOf('if (!adoptable) return false;');
    const adopt = body.indexOf('handleVoiceoverStaged(file);');
    expect(refuse, 'no refusal in handleVoiceoverRestored').toBeGreaterThan(-1);
    expect(adopt, 'handleVoiceoverRestored never adopts').toBeGreaterThan(-1);
    expect(
      refuse < adopt,
      'handleVoiceoverStaged is called before the refusal gate — the destructive branch runs ' +
        'on app load regardless of what the gate then decides.',
    ).toBe(true);
  });

  it('the panel keeps the slot and row when adoption is refused', () => {
    expect(
      PANEL_SRC,
      'a refused voiceover is cleared from the restored slot — the user cannot see it after reload.',
    ).not.toContain('restored.voiceoverFile = null;');
    expect(
      PANEL_SRC,
      'a refused voiceover row is deleted — the staged bytes are lost on reload.',
    ).not.toContain("void deleteStagedFile(projectId, 'voiceover');");
    expect(
      PANEL_SRC,
      'the explicit transcribe affordance is missing from the voiceover slot.',
    ).toContain('data-testid="voiceover-transcribe-restored"');
  });

  describe('stagedVoiceoverNeedsExplicitTranscribe', () => {
    const ID = 'vo.m4a|31354992|1784882086000';

    it('is true for a staged untranscribed voiceover with no pending job', () => {
      expect(stagedVoiceoverNeedsExplicitTranscribe({
        hasStagedVoiceover: true,
        hasPendingVoiceover: false,
        fileIdentity: ID,
        lastTranscribedFileIdentity: undefined,
        cachedTokenCount: 0,
      })).toBe(true);
    });

    it('is false when the safe auto-adopt path applies', () => {
      expect(stagedVoiceoverNeedsExplicitTranscribe({
        hasStagedVoiceover: true,
        hasPendingVoiceover: false,
        fileIdentity: ID,
        lastTranscribedFileIdentity: ID,
        cachedTokenCount: 4618,
      })).toBe(false);
    });

    it('is false once staging has already minted a pending voiceover', () => {
      expect(stagedVoiceoverNeedsExplicitTranscribe({
        hasStagedVoiceover: true,
        hasPendingVoiceover: true,
        fileIdentity: ID,
        lastTranscribedFileIdentity: undefined,
        cachedTokenCount: 0,
      })).toBe(false);
    });
  });
});
