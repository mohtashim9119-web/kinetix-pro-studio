/**
 * WS3 Round 10, STEP 1 — the conservative final-AU drop's CONFINEMENT, asserted
 * in one tree rather than by reading two branches side by side.
 *
 * The drop (`compute_truncate_cut_from_scanned` ->
 * `scanned_final_au_is_provably_complete` in `src-tauri/src/ffmpeg.rs`, JS twin
 * `truncateAnnexbToLastCompleteAu` -> `isFinalAccessUnitProvablyComplete` in
 * `annexbFrameCount.ts`) removes one picture when the final access unit cannot
 * be PROVEN complete. That is correct for salvage, where the tail is exactly
 * what is in question, and WRONG for an exact-offset resume, where the caller
 * supplies an authoritative byte offset that must be honoured verbatim.
 *
 * Round 9 asserted this by reading Cursor's Rust from a distance. These tests
 * assert it structurally, in the merged tree, in two independent ways:
 *
 *  1. SOURCE-LEVEL (the future-change guard): the drop predicate is reachable
 *     from `truncate_annexb_inner` and from nothing on the exact-offset path.
 *     A future edit that calls it from `truncate_annexb_to_offset_inner` — or
 *     that adds a second exact-offset entry point routed through the scanned
 *     cut — turns this red. This is the test the round asked for.
 *  2. BEHAVIOURAL (the JS twin, which shares the predicate): the twin drops a
 *     picture on a stream whose final AU is not provably complete, so the
 *     predicate really is live in the code these assertions read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSyntheticSingleSliceWithParamSets,
  buildSyntheticSingleSliceWithTrailingAud,
  countAnnexbAccessUnits,
  truncateAnnexbToLastCompleteAu,
} from './annexbFrameCount';

const RUST = readFileSync(
  resolve(__dirname, '../../../src-tauri/src/ffmpeg.rs'),
  'utf-8',
);

/** Body of a top-level `fn <name>(` … `\n}` block in ffmpeg.rs. */
function rustFnBody(name: string): string {
  const marker = `\nfn ${name}(`;
  const at = RUST.indexOf(marker);
  expect(at, `fn ${name} must exist in ffmpeg.rs`).toBeGreaterThan(-1);
  const end = RUST.indexOf('\n}\n', at);
  expect(end, `fn ${name} must terminate`).toBeGreaterThan(at);
  return RUST.slice(at, end);
}

describe('conservative final-AU drop — structural confinement', () => {
  it('the drop predicate is consulted only through compute_truncate_cut_from_scanned', () => {
    const callers = RUST.split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes('scanned_final_au_is_provably_complete'))
      .filter(({ line }) => !line.trimStart().startsWith('//'))
      .filter(({ line }) => !line.includes('fn scanned_final_au_is_provably_complete'));
    // Exactly one live call site, and it is inside the scanned-cut computation.
    expect(callers).toHaveLength(1);
    expect(rustFnBody('compute_truncate_cut_from_scanned')).toContain(
      'scanned_final_au_is_provably_complete',
    );
  });

  it('truncate_annexb_inner takes the scanned cut; truncate_annexb_to_offset_inner never does', () => {
    expect(rustFnBody('truncate_annexb_inner')).toContain('compute_truncate_cut_from_scanned');
    const exact = rustFnBody('truncate_annexb_to_offset_inner');
    expect(exact).not.toContain('compute_truncate_cut_from_scanned');
    expect(exact).not.toContain('scanned_final_au_is_provably_complete');
    // …and it honours the caller's offset verbatim.
    expect(exact).toContain('set_len(byte_offset)');
    expect(exact).toContain('kept_bytes: byte_offset');
  });

  it('the exact-offset Tauri command routes only to the exact-offset inner', () => {
    const cmd = RUST.slice(
      RUST.indexOf('pub fn ffmpeg_truncate_annexb_to_offset('),
      RUST.indexOf('fn truncate_annexb_inner('),
    );
    expect(cmd).toContain('truncate_annexb_to_offset_inner(');
    expect(cmd).not.toContain('truncate_annexb_inner(&full');
  });

  it('the drop predicate is live: the JS twin drops exactly one picture when the tail is unprovable', () => {
    // Param sets lead each picture, so the last picture's final NAL is its own
    // slice — nothing follows to prove the AU closed.
    const unprovable = buildSyntheticSingleSliceWithParamSets(4);
    expect(countAnnexbAccessUnits(unprovable).pictures).toBe(4);
    expect(truncateAnnexbToLastCompleteAu(unprovable).pictures).toBe(3);

    // A trailing AUD after every picture proves the final AU closed.
    const provable = buildSyntheticSingleSliceWithTrailingAud(4);
    expect(countAnnexbAccessUnits(provable).pictures).toBe(4);
    const kept = truncateAnnexbToLastCompleteAu(provable);
    expect(kept.pictures).toBe(4);
    expect(kept.bytesRemoved).toBe(0);
  });
});
