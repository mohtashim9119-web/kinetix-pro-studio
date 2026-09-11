/**
 * WS3 Round 14, STEP 5 (H2) — the CODEC profile ladder, deliberately kept
 * separate from `exportWorker.ts`'s `hardwareAcceleration` ladder.
 *
 * `avc1.640028` (H.264 High profile, level 4.0) is the production target,
 * but Chromium's software fallback (OpenH264) is commonly Baseline-profile
 * only. Before this round, EVERY rung of both `HARDWARE_LADDER` and
 * `SOFTWARE_ONLY_LADDER` (Rung 5a's failover ladder) probed the SAME fixed
 * codec string — so if software cannot honour High profile, `prefer-software`
 * fails identically whether it is tried as rung 3 of the normal ladder or as
 * the whole of the failover ladder, and Rung 5a's failover is a dead letter
 * on any device whose software encoder cannot reach the production profile.
 *
 * `exportWorker.ts`'s `createEncoder` owns the actual descent (codec outer,
 * hardwareAcceleration inner — see its own doc), because the descent needs a
 * real `isConfigSupported` + construct-and-configure probe, and that API
 * only exists where a `VideoEncoder` is reachable (the worker, and in
 * production a real browser main thread — but NOT this repo's node/vitest
 * test environment, which is why the probe is not duplicated on the main
 * thread: `exportPipelineWebCodecs.ts` instead learns the winning codec from
 * the worker's own diagnostics and pins it forward — see
 * `DriveGlRunDeps.pinnedCodec`'s doc). This module exists only to give both
 * sides ONE shared constant for the ladder itself, so they cannot drift.
 */

/** Descending profile/level. High@4.0 is the production target; Baseline@3.1
 *  is OpenH264's typical ceiling in Chromium/WebView2's software fallback —
 *  see `docs/ws3-export-architecture-ledger.md`'s H2 entry for the measured
 *  spike this choice is based on. */
export const EXPORT_CODEC_LADDER: readonly string[] = ['avc1.640028', 'avc1.42001f'];
