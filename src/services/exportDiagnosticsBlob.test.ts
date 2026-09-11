/**
 * WS3 Tier 1 item 4 — the permanent fix for "a field exists on
 * `ExportLivenessSnapshot`/`ExportAppendLedger`, is populated at the emit
 * site, and never reaches the operator's Copy-diagnostics blob."
 *
 * This has happened twice before (`phaseLogTail`, then the flush fields) for
 * the same reason each time: the blob is built from `ExportError` +
 * `ExportLivenessSnapshot` alone (see both interfaces' own doc comments), so
 * a field can be collected, capped, and merged all the way up to the worker
 * boundary and still never leave it if the LAST hop — this file's
 * `buildExportDiagnosticsBlob`, formerly inline in App.tsx's click handler —
 * doesn't carry it.
 *
 * The completeness test below is deliberately generic rather than a
 * hardcoded per-field list: it builds an `ExportLivenessSnapshot` fixture
 * with every field set to a distinct, greppable sentinel value, and asserts
 * every one of those sentinels appears in the blob's JSON serialization. A
 * FUTURE field added to either interface and left unplumbed reproduces
 * exactly the historical bug shape and fails this test the same way the two
 * historical instances would have, without anyone having to remember to add
 * a new named assertion.
 */
import { describe, it, expect } from 'vitest';
import { buildExportDiagnosticsBlob } from './exportDiagnosticsBlob';
import type { ExportAppendLedger, ExportError, ExportLivenessSnapshot, ExportPhaseLogTailEntry } from './exportPipeline';

const SENTINEL_PHASE_LOG_ENTRY: ExportPhaseLogTailEntry = {
  atMs: 123456,
  phase: 'SENTINEL_PHASE_TAIL_PHASE',
  pieceIndex: 777,
  framesEncoded: 888,
  kind: 'SENTINEL_PHASE_TAIL_KIND',
};

/** Every `ExportAppendLedger` field set to a value that cannot collide with
 *  any other field in this fixture (distinct numbers, distinct strings). */
const SENTINEL_APPEND_LEDGER: ExportAppendLedger = {
  chunksAppended: 111111,
  ipcCalls: 222222,
  bytesAppended: 333333,
  queueDepthChunks: 444444,
  queueDepthBytes: 555555,
  msSinceLastAppendCompleted: 666666,
  chunksAppendedDuringFlush: 777777,
  bytesAppendedDuringFlush: 888888,
  doneReceived: true,
  msSinceDone: 999999,
  appendInFlight: true,
  discardedAtFinish: { chunks: 121212, bytes: 343434 },
};

const SENTINEL_LIVENESS: ExportLivenessSnapshot = {
  lastPhase: 'SENTINEL_LAST_PHASE',
  msSinceLastPhaseChange: 100001,
  pieceIndex: 100002,
  framesEncoded: 100003,
  maxSilentMs: 100004,
  phaseLogTail: [SENTINEL_PHASE_LOG_ENTRY],
  failureVia: 'SENTINEL_FAILURE_VIA',
  encoderSessions: 100005,
  encoderSessionIndex: 100006,
  appendLedger: SENTINEL_APPEND_LEDGER,
};

const SENTINEL_ERROR: ExportError = {
  kind: 'concat',
  message: 'SENTINEL_ERROR_MESSAGE',
  cause: 'SENTINEL_ERROR_CAUSE',
  liveness: SENTINEL_LIVENESS,
};

const PROJECT_META = {
  segmentCount: 42,
  hasVoiceover: true,
  exportResolution: '1080p' as const,
  exportFps: 30 as const,
  ts: '2026-01-01T00:00:00.000Z',
};

/**
 * Every primitive leaf value reachable from `value`, as its JSON
 * representation — the same granularity `JSON.stringify` would serialize.
 * Skips object/array containers themselves (a leaf's presence already
 * implies its container's shape reached the output somewhere) AND skips
 * booleans deliberately: a boolean's JSON form is one of only two possible
 * strings, so `true`/`false` can never be a distinctive sentinel — a boolean
 * leaf dropped from the blob would still register as "found" by coincidence
 * against an unrelated `true`/`false` elsewhere in the payload (this
 * repo's own "symmetric fixture" caution, CLAUDE.md §4 Testing: a check that
 * cannot fail on the exact defect it claims to catch is not a check on that
 * defect). The two boolean ledger fields (`doneReceived`, `appendInFlight`)
 * are covered instead by the explicit named assertions below.
 */
function collectLeafValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'boolean') return out;
  if (value === null || typeof value !== 'object') {
    out.push(JSON.stringify(value));
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    collectLeafValues(v, out);
  }
  return out;
}

describe('buildExportDiagnosticsBlob — no field defined on the emit-site snapshot is dropped', () => {
  it('every ExportLivenessSnapshot/ExportAppendLedger leaf value survives into the serialized blob', () => {
    const blob = buildExportDiagnosticsBlob(SENTINEL_ERROR, PROJECT_META) as Record<string, unknown>;
    // Deliberately exclude `blob.error` before scanning: `error: err` is a
    // wholesale, unconditional copy of the INPUT — it will always contain
    // the original `SENTINEL_LIVENESS` untouched no matter what the rest of
    // this function does, so scanning the full blob including `error` can
    // never observe a regression in `buildExportDiagnosticsBlob`'s own
    // logic (its `liveness`/flattened-field construction) — it would only
    // ever observe a regression in how `ExportError.liveness` was built at
    // the THROW site, which is a different bug class already guarded by
    // `finish`'s central stamping in exportPipelineWebCodecs.ts. Excluding
    // it here is what makes this test's own destructive probe (see the
    // round log) actually exercise the code this file owns.
    const { error: _omitted, ...blobWithoutRedundantErrorCopy } = blob;
    const serialized = JSON.stringify(blobWithoutRedundantErrorCopy);

    const expectedLeaves = collectLeafValues(SENTINEL_LIVENESS);
    // Sanity on the fixture itself — if this is small, the test is vacuous.
    expect(expectedLeaves.length).toBeGreaterThanOrEqual(13);
    // Sanity on DISTINCTNESS — a fixture with two leaves sharing a JSON
    // representation reproduces the exact boolean-collision hole this
    // function's own doc comment describes, silently, for whichever field
    // collided. Every remaining (non-boolean) sentinel must be unique.
    expect(new Set(expectedLeaves).size).toBe(expectedLeaves.length);

    const missing = expectedLeaves.filter((leaf) => !serialized.includes(leaf));
    expect(missing).toEqual([]);
  });

  it('the two boolean ledger fields (unreachable by the generic sentinel scan) survive explicitly', () => {
    const blob = buildExportDiagnosticsBlob(SENTINEL_ERROR, PROJECT_META) as {
      liveness: ExportLivenessSnapshot | null;
      appendLedger: ExportAppendLedger | null;
    };
    expect(blob.liveness?.appendLedger?.doneReceived).toBe(true);
    expect(blob.liveness?.appendLedger?.appendInFlight).toBe(true);
    expect(blob.appendLedger?.doneReceived).toBe(true);
    expect(blob.appendLedger?.appendInFlight).toBe(true);
  });

  it('NOT DETERMINED #5 is falsifiable from the blob alone: doneReceived + msSinceDone + queueDepthChunks read together, no inference required', () => {
    const blob = buildExportDiagnosticsBlob(SENTINEL_ERROR, PROJECT_META) as {
      liveness: ExportLivenessSnapshot | null;
      appendLedger: ExportAppendLedger | null;
    };
    // Both the nested full snapshot AND the flattened top-level convenience
    // copy must agree — an operator reading either one gets the real answer.
    expect(blob.liveness?.appendLedger?.doneReceived).toBe(true);
    expect(blob.liveness?.appendLedger?.msSinceDone).toBe(999999);
    expect(blob.appendLedger?.doneReceived).toBe(true);
    expect(blob.appendLedger?.msSinceDone).toBe(999999);
    expect(blob.appendLedger?.queueDepthChunks).toBe(444444);
  });

  it('a liveness-less ExportError still produces a well-formed blob (all liveness-derived fields null, not throwing)', () => {
    const err: ExportError = { kind: 'cancelled', message: 'no liveness recorded' };
    const blob = buildExportDiagnosticsBlob(err, PROJECT_META) as Record<string, unknown>;
    expect(blob.liveness).toBeNull();
    expect(blob.appendLedger).toBeNull();
    expect(blob.phaseLogTail).toBeNull();
    expect(() => JSON.stringify(blob)).not.toThrow();
  });
});
