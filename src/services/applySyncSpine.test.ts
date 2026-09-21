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
    expect(SRC).toContain('lastSyncSpine: audioHash !== undefined ? { audioHash, scriptHash } : prev.lastSyncSpine');
  });
});
