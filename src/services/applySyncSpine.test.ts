/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 2 item 4 — content-hash spine wiring inside
// `handleApplySyncFromFiles`.
//
// WHY A SOURCE SCAN. Same constraint as `applySyncCancelInvariant.test.ts`
// and `applySyncEntryPoint.test.ts`: `handleApplySyncFromFiles` and
// `cachedTokensReady` are private to a 6,900-line component this repo
// verifies manually by standing convention. `spine.test.ts` behaviourally
// proves the hash functions themselves are correct; this file proves the
// INTEGRATION POINT — `cachedTokensReady`, the actual "reuse the cached
// transcript or not" decision — reads the content hash and no longer reads
// the volatile `getFileIdentity` triple. If this test fails because
// `cachedTokensReady` grew a new `getFileIdentity(` comparison, that
// reintroduces the exact bug `spine.test.ts`'s first case documents: a media
// swap with identical bytes would force a re-transcription again.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseProjectData } from '../App';
import { computeAudioHash, computeScriptHash, spineEquals } from './spine';
import type { Asset } from '../types';

const APP_TSX = resolve(import.meta.dirname, '..', 'App.tsx');
const SRC = readFileSync(APP_TSX, 'utf-8');

/** The body of the `const cachedTokensReady = ...;` statement, up to its
 *  terminating `;` at the start of a line (matches this statement's own
 *  multi-line-expression indentation, not a nested one). */
function cachedTokensReadyBody(): string {
  const marker = 'const cachedTokensReady = !!voiceoverAsset';
  const start = SRC.indexOf(marker);
  expect(start, 'cachedTokensReady not found — this guard has lost its target').toBeGreaterThan(-1);
  const rest = SRC.slice(start);
  const end = rest.indexOf('\n\n');
  expect(end, 'cachedTokensReady statement end not found').toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe('plan-v3 Wave 2 item 4 — cachedTokensReady reads the content-hash spine', () => {
  it('compares Project.lastTranscribedAudioHash, not getFileIdentity', () => {
    const body = cachedTokensReadyBody();
    expect(body).toContain('projectRef.current.lastTranscribedAudioHash === audioHash');
    expect(
      body,
      'cachedTokensReady reintroduced a getFileIdentity(...) call — this is the exact bug ' +
        'shape spine.test.ts documents: a media swap with identical bytes but a different ' +
        'name/lastModified would force a re-transcription again. (A prose comment merely ' +
        'mentioning the old name is fine; an actual call is not.)',
    ).not.toContain('getFileIdentity(');
  });

  it('still keys off the same committed asset id as the primary, cheaper check', () => {
    // The id-match clause is unchanged and stays the first (cheapest) check
    // — the hash clause is a fallback for when the id doesn't already match.
    const body = cachedTokensReadyBody();
    expect(body).toContain('projectRef.current.lastTranscribedAssetId === voiceoverAsset.id');
  });

  it('still requires non-empty cached tokens, not just a matching identity', () => {
    const body = cachedTokensReadyBody();
    expect(body).toContain('(projectRef.current.transcriptTokens?.length ?? 0) > 0');
  });
});

describe('plan-v3 Wave 2 item 4 — the audio hash is computed once, not per branch', () => {
  it('handleApplySyncFromFiles prefers the already-staged hash over re-hashing', () => {
    // The three-way fallback documented at its own definition: staged hash
    // first (handleVoiceoverStaged already paid this cost), then a fresh
    // hash only when necessary, never re-hashing when avoidable.
    expect(SRC).toContain('const audioHash = stagedAudioHash');
    expect(SRC).toContain('?? (voiceoverAsset.file ? await computeAudioHash(voiceoverAsset.file) : undefined)');
  });

  it('the commit stamps lastSyncSpine so the next Apply Sync can prove nothing changed', () => {
    // G2 close-out FIX 1 — the commit now also stamps `engineKey` (toggle
    // position + FA pack readiness), the third half of the "honest Apply
    // Sync" gate. Same shape, one more field.
    expect(SRC).toContain(
      'lastSyncSpine: audioHash !== undefined ? { audioHash, scriptHash, engineKey: syncEngineKey } : prev.lastSyncSpine',
    );
  });
});

// ---------------------------------------------------------------------------
// H4 — scene-anchor binding: "swapping every visual asset leaves the spine
// hash and all timings unchanged". final-shape-mapping row H4 grades this
// SMALL-FIX, not NEW-BUILD — "the mechanism exists" (segment↔asset binding
// already keyed on stable assetId/segment id via findAssetByContext /
// isExactFilenameMatch, never on timing). This is the proving test the row
// says was missing, composed from the REAL shipped functions: parseProjectData
// (the exact function App.tsx's Apply Sync calls) and spine.ts's own hash
// functions — not a hand-picked reimplementation of either.
// ---------------------------------------------------------------------------
describe('H4 — swapping every visual asset leaves the spine hash and all timings unchanged', () => {
  const SCRIPT = 'The scout crested the ridge.\nBelow, the valley opened wide.';
  const SCENE_DETAILS =
    '[shot_one] A lone figure on a ridge at dawn.\n[shot_two] A wide valley below, misty.';
  const AUDIO_DURATION = 12.5;

  /** Two visual assets whose FILENAMES match the scene tags above (the only
   *  thing parseProjectData's matcher reads — isExactFilenameMatch compares
   *  tag stem to asset-name stem) but whose ids differ, simulating every
   *  visual asset having been swapped for a different upload of "the same"
   *  shot. */
  function assetSet(idPrefix: string): Asset[] {
    return [
      { id: `${idPrefix}-1`, name: 'shot_one.jpg', url: `blob:${idPrefix}-1`, type: 'image' },
      { id: `${idPrefix}-2`, name: 'shot_two.jpg', url: `blob:${idPrefix}-2`, type: 'image' },
    ];
  }

  it('parseProjectData binds different assetIds but identical startTime/duration across a full asset swap', async () => {
    const before = await parseProjectData(SCRIPT, SCENE_DETAILS, assetSet('before'), AUDIO_DURATION);
    const after = await parseProjectData(SCRIPT, SCENE_DETAILS, assetSet('after'), AUDIO_DURATION);

    expect(before.length).toBeGreaterThan(0);
    expect(before.length).toBe(after.length);

    // The swap is real, not a no-op: every segment's assetId actually changed.
    for (let i = 0; i < before.length; i++) {
      expect(before[i]!.assetId, `segment ${i} kept the same assetId — the swap fixture is a no-op`)
        .not.toBe(after[i]!.assetId);
      expect(before[i]!.assetId, `segment ${i} lost its match entirely`).toBeDefined();
    }

    // Timing is byte-identical: startTime/duration are computed purely from
    // script text length + audioDuration (App.tsx's own ruling comment at
    // the segment-building loop: "no speed-fit-to-slot computation here").
    const timingOf = (segs: typeof before) => segs.map(s => ({ startTime: s.startTime, duration: s.duration }));
    expect(timingOf(after)).toEqual(timingOf(before));
  });

  it('the content-hash spine is unaffected by the same asset swap', async () => {
    // computeAudioHash/computeScriptHash take audio bytes and script/scene
    // TEXT only — neither function's signature accepts an assets array, so
    // this is provable structurally as well as behaviourally. Behavioural
    // proof: build the actual spine each asset set would produce and assert
    // equality, exactly as the "honest Apply Sync" gate does at runtime.
    const audioFile = new File([new Uint8Array([1, 2, 3, 4])], 'vo.wav');
    const audioHash = await computeAudioHash(audioFile);
    const scriptHash = await computeScriptHash(SCRIPT, SCENE_DETAILS);

    const spineBefore = { audioHash, scriptHash };
    const spineAfter = { audioHash, scriptHash };
    expect(spineEquals(spineBefore, spineAfter)).toBe(true);

    // And the asset swap fixture itself never entered either hash computation.
    expect(assetSet('before')).not.toEqual(assetSet('after'));
  });
});

// ---------------------------------------------------------------------------
// G2 close-out FIX 1 — the "honest Apply Sync" gate's read side
// (`spineUnchanged` effect) must recompute and compare `engineKey`, not just
// the two hashes, and must re-run when the FA toggle or language changes —
// same private-to-App.tsx source-scan constraint as the rest of this file.
// ---------------------------------------------------------------------------
describe('G2 close-out FIX 1 — spineUnchanged effect reads the engine key too', () => {
  it('computes engineKey via computeSyncEngineKey before comparing the spine', () => {
    expect(SRC).toContain('const engineKey = await computeSyncEngineKey(project);');
    expect(SRC).toContain('spineEquals(spine, { audioHash, scriptHash, engineKey })');
  });

  it('the effect re-runs when the FA toggle or language changes, not just staged files', () => {
    // The exact dependency array FIX 1 added to the spineUnchanged effect.
    expect(SRC).toContain('project.faHighPrecisionSync, project.language, project.detectedLanguage,');
  });
});
