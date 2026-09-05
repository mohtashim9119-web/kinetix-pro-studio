// ---------------------------------------------------------------------------
// Permanent production stage timing for a forced-alignment run.
//
// SHIPPED, unconditionally: not `#[cfg(test)]`, not behind a Cargo feature.
// A real Apply Sync run reports where its wall clock went, on the same
// `Channel<FaEvent>` it already reports progress and results on, so a
// performance regression is visible from the running app rather than only
// from a hand-instrumented dev harness.
//
// WHY A SEPARATE MODULE. Two of the three things this file owns want to be
// unit-testable with no `AppHandle`, no async runtime, no ONNX model, and
// no `fa-inference` feature: the no-allocation accumulator the chunk loop
// drives, and the aggregate arithmetic (count/total/mean/max) that turns a
// run's accumulators into the DTO the frontend receives. Keeping them here
// rather than inside `fa.rs`/`fa_onnx.rs` is what makes both directly
// reachable from a plain `cargo test` with the feature OFF — the same
// "pure core, thin wrapper" split `fa.rs` already applies to
// `fa_model_candidate_paths` vs `fa_model_path`.
//
// ALLOCATION DISCIPLINE (the load-bearing constraint). [`StageAccumulator`]
// and [`FaChunkAccumulators`] are `Copy`, hold only `u64`/`u32` scalars, and
// their `record` method performs no allocation, no locking, no formatting and
// no syscall beyond the two `Instant::now()` reads its caller already made.
// This is what lets the chunk loop in `fa_onnx::align_chunked_timed` measure
// three stages per chunk without a `Vec` push, a `HashMap` insert, or a
// channel send inside the loop — a per-chunk EVENT would flood the IPC
// channel on a 1400-second corpus (~200+ chunks), and a per-chunk `Vec`
// would allocate inside the exact loop this instrumentation exists to
// measure. Aggregation to `count`/`total`/`mean`/`max` happens ONCE, after
// the loop, in [`FaChunkAggregate::from_accumulators`].
//
// NANOSECONDS IN, MILLISECONDS OUT. Everything accumulates in whole `u64`
// nanoseconds (exact integer addition, no floating-point drift across a
// few hundred additions) and converts to `f64` milliseconds exactly once,
// at the IPC boundary — the same "apply the boundary conversion once, at
// the boundary" rule `fa.rs::word_span_to_dto` already follows for
// `exp(score)`.
// ---------------------------------------------------------------------------

use std::time::Duration;

/// Nanoseconds -> milliseconds, applied once at the IPC boundary.
#[inline]
fn ms(nanos: u64) -> f64 {
    nanos as f64 / 1_000_000.0
}

/// A running count/total/max over one repeated stage, with no heap behind it.
///
/// `saturating_add` rather than `+`: a `u64` nanosecond total overflows after
/// ~584 years, so this can never actually saturate on a real run — it is here
/// so that a pathological/synthetic input cannot turn a telemetry counter into
/// a panic in a release build's debug-assertions-off arithmetic. Telemetry
/// must never be able to fail the run it is measuring.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StageAccumulator {
    pub count: u32,
    pub total_nanos: u64,
    pub max_nanos: u64,
}

impl StageAccumulator {
    /// The whole hot path. Called once per chunk per stage; allocates nothing.
    #[inline]
    pub fn record(&mut self, elapsed: Duration) {
        // `as_nanos` is u128; a `u64` truncation would only bite past ~584
        // years, but clamp rather than wrap so the invariant "max <= total"
        // below cannot be violated by a cast.
        let nanos = u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX);
        self.count = self.count.saturating_add(1);
        self.total_nanos = self.total_nanos.saturating_add(nanos);
        if nanos > self.max_nanos {
            self.max_nanos = nanos;
        }
    }

    /// Integer mean, truncating. Zero for an empty accumulator — a run that
    /// executed no chunks reports a mean of 0, never a division by zero and
    /// never a NaN reaching the frontend.
    #[inline]
    pub fn mean_nanos(&self) -> u64 {
        if self.count == 0 {
            0
        } else {
            self.total_nanos / self.count as u64
        }
    }
}

/// The three per-chunk stages, accumulated together so the chunk loop threads
/// ONE `&mut` rather than three. `Copy`, scalar-only — see this module's
/// allocation-discipline note.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FaChunkAccumulators {
    /// `run_forward_pass_with_session` — the ONNX forward pass.
    pub forward: StageAccumulator,
    /// `fa_viterbi::forced_align` — the CTC Viterbi DP.
    pub viterbi: StageAccumulator,
    /// `tokenize_for_alignment` — script text to vocab ids.
    pub tokenize: StageAccumulator,
}

/// Whether a run had to load the ONNX model, and what that cost.
///
/// `load_nanos` is meaningful only when `cache_hit` is false: a hit does not
/// call `load_session` at all, so there is no duration to report and the DTO
/// carries `null` rather than a misleading `0.0` that would average into a
/// dashboard as a real, very fast load.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ModelLoadReport {
    pub cache_hit: bool,
    pub load_nanos: u64,
}

/// Everything `fa_onnx`'s inference path measures, handed back to `fa.rs` by
/// `&mut` out-parameter rather than in the return value — deliberately, so a
/// run that FAILS at chunk 40 of 200 still reports the 40 chunks it did
/// measure. Folding these into `Result::Ok` would discard exactly the
/// measurements a slow-then-failing run most needs to explain itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FaInferenceTimings {
    pub model: ModelLoadReport,
    pub chunks: FaChunkAccumulators,
}

/// The stages that run BEFORE `fa_align` is entered — measured by
/// `fa_dev::resolve_wav_and_align` (manifest verification, durable WAV) and
/// by `fa_stage_audio_raw` itself (raw-body staging, recorded against the
/// path it returns and claimed back here — see
/// `fa_dev::take_staging_duration` for why that hand-off is needed at all).
///
/// `staging_nanos` is an `Option` because it is genuinely unknown, not zero,
/// when the caller reached `fa_align_production` with a path this process
/// never staged (a hand-passed path, a devtools experiment, or a staging
/// record already evicted by a later call).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FaStagePrefix {
    pub staging_nanos: Option<u64>,
    pub durable_wav_nanos: u64,
    pub durable_wav_cache_hit: bool,
    pub manifest_verify_nanos: u64,
    pub manifest_digest_cache_hit: bool,
}

// ---------------------------------------------------------------------------
// IPC DTOs
// ---------------------------------------------------------------------------

/// Aggregated per-chunk timing — count, total, mean, max per stage.
///
/// This is the whole reason the chunk loop does not emit an event per chunk:
/// a 1400-second corpus plans 200+ chunks, and 200+ `Channel` sends carrying
/// three durations each is a flood the frontend has no use for. Four numbers
/// per stage answer every question a per-chunk stream would (is the forward
/// pass dominating? is one chunk pathological?) at a fixed, chunk-count-
/// independent payload size.
#[derive(serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaStageAggregate {
    pub count: u32,
    pub total_ms: f64,
    pub mean_ms: f64,
    pub max_ms: f64,
}

impl FaStageAggregate {
    pub fn from_accumulator(a: StageAccumulator) -> Self {
        FaStageAggregate {
            count: a.count,
            total_ms: ms(a.total_nanos),
            mean_ms: ms(a.mean_nanos()),
            max_ms: ms(a.max_nanos),
        }
    }
}

/// The three per-chunk stages, aggregated. `chunk_count` is stated once here
/// rather than trusted to be equal across the three: they ARE equal on every
/// path today (each chunk runs all three), but a future chunk that fails
/// tokenization would legitimately record a tokenize sample and no forward
/// sample, and a consumer should read the per-stage `count` for that rather
/// than infer it from a sibling stage.
#[derive(serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaChunkAggregate {
    pub chunk_count: u32,
    pub forward: FaStageAggregate,
    pub viterbi: FaStageAggregate,
    pub tokenize: FaStageAggregate,
}

impl FaChunkAggregate {
    pub fn from_accumulators(a: FaChunkAccumulators) -> Self {
        FaChunkAggregate {
            // The forward pass is the one stage every completed chunk runs
            // exactly once, so its count IS the completed-chunk count.
            chunk_count: a.forward.count,
            forward: FaStageAggregate::from_accumulator(a.forward),
            viterbi: FaStageAggregate::from_accumulator(a.viterbi),
            tokenize: FaStageAggregate::from_accumulator(a.tokenize),
        }
    }
}

/// The `FaEvent::Timing` payload — one per run, emitted immediately before
/// the run's terminal `Done`/`Error`.
///
/// `totalMs` is honest wall clock for the whole run, NOT the sum of the
/// stages below it. The difference is real, unattributed time (WAV decode,
/// vocab load, sample slicing, word stitching, IPC) and showing it as a
/// residual is the point: a stage list that silently sums to the total
/// cannot reveal a cost nobody thought to instrument.
#[derive(serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaRunTiming {
    /// `null` when this process has no staging record for the input path —
    /// unknown, not zero. See [`FaStagePrefix::staging_nanos`].
    pub staging_ms: Option<f64>,
    pub durable_wav_ms: f64,
    pub durable_wav_cache_hit: bool,
    pub manifest_verify_ms: f64,
    /// `true` when `fa_dev`'s in-process digest memo answered, `false` when
    /// the full ~1.26 GiB stream hash ran.
    pub manifest_digest_cache_hit: bool,
    pub model_cache_hit: bool,
    /// `null` on a model-cache hit — no `load_session` call happened, so
    /// there is no load duration. See [`ModelLoadReport`].
    pub model_load_ms: Option<f64>,
    pub chunks: FaChunkAggregate,
    pub total_ms: f64,
}

impl FaRunTiming {
    /// Assembles the wire DTO from the two halves that measure it: the
    /// pre-`fa_align` stages and the inference stages.
    pub fn assemble(prefix: FaStagePrefix, inference: FaInferenceTimings, total_nanos: u64) -> Self {
        FaRunTiming {
            staging_ms: prefix.staging_nanos.map(ms),
            durable_wav_ms: ms(prefix.durable_wav_nanos),
            durable_wav_cache_hit: prefix.durable_wav_cache_hit,
            manifest_verify_ms: ms(prefix.manifest_verify_nanos),
            manifest_digest_cache_hit: prefix.manifest_digest_cache_hit,
            model_cache_hit: inference.model.cache_hit,
            model_load_ms: if inference.model.cache_hit {
                None
            } else {
                Some(ms(inference.model.load_nanos))
            },
            chunks: FaChunkAggregate::from_accumulators(inference.chunks),
            total_ms: ms(total_nanos),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(nanos: u64) -> Duration {
        Duration::from_nanos(nanos)
    }

    // -- accumulator arithmetic ----------------------------------------

    #[test]
    fn empty_accumulator_reports_zeroes_and_never_divides_by_zero() {
        let a = StageAccumulator::default();
        assert_eq!(a.count, 0);
        assert_eq!(a.total_nanos, 0);
        assert_eq!(a.max_nanos, 0);
        assert_eq!(a.mean_nanos(), 0, "an empty accumulator's mean must be 0, not a division by zero");
        let agg = FaStageAggregate::from_accumulator(a);
        assert!(agg.mean_ms.is_finite(), "an empty stage must not serialize a NaN to the frontend");
        assert_eq!(agg.mean_ms, 0.0);
    }

    #[test]
    fn accumulator_totals_means_and_max_are_arithmetically_correct() {
        let mut a = StageAccumulator::default();
        a.record(n(100));
        a.record(n(300));
        a.record(n(200));
        assert_eq!(a.count, 3);
        assert_eq!(a.total_nanos, 600, "total must be the exact integer sum");
        assert_eq!(a.max_nanos, 300, "max must be the largest sample, not the last");
        assert_eq!(a.mean_nanos(), 200, "600 / 3 == 200");
    }

    #[test]
    fn max_survives_a_later_smaller_sample() {
        // The regression this guards: `self.max_nanos = nanos` unconditionally
        // (i.e. "last", not "max") passes any test whose largest sample is
        // also its last one. The big sample here is deliberately in the
        // MIDDLE so that mistake cannot pass.
        let mut a = StageAccumulator::default();
        a.record(n(10));
        a.record(n(9_999));
        a.record(n(11));
        assert_eq!(a.max_nanos, 9_999);
    }

    #[test]
    fn mean_truncates_rather_than_rounding_and_stays_between_zero_and_max() {
        let mut a = StageAccumulator::default();
        a.record(n(1));
        a.record(n(2));
        assert_eq!(a.mean_nanos(), 1, "3 / 2 truncates to 1");
        assert!(a.mean_nanos() <= a.max_nanos, "mean can never exceed max");
        assert!(a.total_nanos >= a.max_nanos, "total can never be less than max");
    }

    #[test]
    fn record_saturates_instead_of_panicking_on_an_absurd_duration() {
        // Telemetry must never be able to fail the run it measures.
        let mut a = StageAccumulator::default();
        a.record(Duration::new(u64::MAX, 999_999_999));
        assert_eq!(a.max_nanos, u64::MAX);
        a.record(Duration::new(u64::MAX, 999_999_999));
        assert_eq!(a.total_nanos, u64::MAX, "a second absurd sample must saturate, not wrap to a small number");
        assert_eq!(a.count, 2);
    }

    // -- aggregate conversion ------------------------------------------

    #[test]
    fn nanoseconds_convert_to_milliseconds_once_at_the_boundary() {
        let mut a = StageAccumulator::default();
        a.record(n(1_500_000)); // 1.5 ms
        a.record(n(2_500_000)); // 2.5 ms
        let agg = FaStageAggregate::from_accumulator(a);
        assert_eq!(agg.count, 2);
        assert_eq!(agg.total_ms, 4.0);
        assert_eq!(agg.mean_ms, 2.0);
        assert_eq!(agg.max_ms, 2.5);
    }

    #[test]
    fn chunk_aggregate_reports_each_stage_separately_and_takes_its_count_from_the_forward_pass() {
        let mut acc = FaChunkAccumulators::default();
        for _ in 0..4 {
            acc.forward.record(n(10_000_000));
            acc.viterbi.record(n(2_000_000));
            acc.tokenize.record(n(500_000));
        }
        let agg = FaChunkAggregate::from_accumulators(acc);
        assert_eq!(agg.chunk_count, 4);
        assert_eq!(agg.forward.total_ms, 40.0);
        assert_eq!(agg.viterbi.total_ms, 8.0);
        assert_eq!(agg.tokenize.total_ms, 2.0);
        assert_eq!(agg.forward.mean_ms, 10.0);
        // The three stages must NOT be collapsed into one number — a
        // forward-pass-dominated run and a Viterbi-dominated run have to be
        // distinguishable from this payload alone.
        assert_ne!(agg.forward.total_ms, agg.viterbi.total_ms);
    }

    // -- assembled run DTO ---------------------------------------------

    #[test]
    fn assemble_populates_every_stage_on_a_full_cold_run() {
        let prefix = FaStagePrefix {
            staging_nanos: Some(120_000_000),
            durable_wav_nanos: 3_400_000_000,
            durable_wav_cache_hit: false,
            manifest_verify_nanos: 5_250_000_000,
            manifest_digest_cache_hit: false,
        };
        let mut inference = FaInferenceTimings {
            model: ModelLoadReport { cache_hit: false, load_nanos: 900_000_000 },
            chunks: FaChunkAccumulators::default(),
        };
        inference.chunks.forward.record(n(50_000_000));
        inference.chunks.viterbi.record(n(7_000_000));
        inference.chunks.tokenize.record(n(1_000_000));

        let t = FaRunTiming::assemble(prefix, inference, 10_000_000_000);

        assert_eq!(t.staging_ms, Some(120.0));
        assert_eq!(t.durable_wav_ms, 3400.0);
        assert!(!t.durable_wav_cache_hit);
        assert_eq!(t.manifest_verify_ms, 5250.0);
        assert!(!t.manifest_digest_cache_hit);
        assert!(!t.model_cache_hit);
        assert_eq!(t.model_load_ms, Some(900.0), "a cache MISS must report its load duration");
        assert_eq!(t.chunks.chunk_count, 1);
        assert_eq!(t.chunks.forward.total_ms, 50.0);
        assert_eq!(t.chunks.viterbi.total_ms, 7.0);
        assert_eq!(t.chunks.tokenize.total_ms, 1.0);
        assert_eq!(t.total_ms, 10_000.0);
    }

    #[test]
    fn model_cache_hit_reports_no_load_duration_rather_than_a_misleading_zero() {
        // A hit that reported `0.0 ms` would average into any dashboard as a
        // real, impossibly fast model load. It must be absent instead.
        let inference = FaInferenceTimings {
            model: ModelLoadReport { cache_hit: true, load_nanos: 0 },
            chunks: FaChunkAccumulators::default(),
        };
        let t = FaRunTiming::assemble(FaStagePrefix::default(), inference, 1_000_000);
        assert!(t.model_cache_hit);
        assert_eq!(t.model_load_ms, None);

        let json = serde_json::to_value(&t).unwrap();
        assert!(json["modelLoadMs"].is_null(), "a cache hit must serialize modelLoadMs as null");
        assert_eq!(json["modelCacheHit"], serde_json::json!(true));
    }

    #[test]
    fn cache_hit_and_cache_miss_model_load_paths_are_distinguishable_from_the_dto_alone() {
        let hit = FaRunTiming::assemble(
            FaStagePrefix::default(),
            FaInferenceTimings {
                model: ModelLoadReport { cache_hit: true, load_nanos: 0 },
                chunks: FaChunkAccumulators::default(),
            },
            1_000_000,
        );
        let miss = FaRunTiming::assemble(
            FaStagePrefix::default(),
            FaInferenceTimings {
                model: ModelLoadReport { cache_hit: false, load_nanos: 2_000_000_000 },
                chunks: FaChunkAccumulators::default(),
            },
            1_000_000,
        );
        assert_ne!(hit.model_cache_hit, miss.model_cache_hit);
        assert_ne!(hit.model_load_ms, miss.model_load_ms);
        assert_eq!(miss.model_load_ms, Some(2000.0));
    }

    #[test]
    fn unknown_staging_serializes_as_null_not_zero() {
        // "This process never staged that path" and "staging took no time at
        // all" are different facts and must not collapse to the same number.
        let t = FaRunTiming::assemble(FaStagePrefix::default(), FaInferenceTimings::default(), 0);
        assert_eq!(t.staging_ms, None);
        let json = serde_json::to_value(&t).unwrap();
        assert!(json["stagingMs"].is_null());
    }

    #[test]
    fn manifest_digest_cache_hit_is_carried_through_verbatim() {
        let prefix = FaStagePrefix {
            manifest_verify_nanos: 400_000,
            manifest_digest_cache_hit: true,
            ..Default::default()
        };
        let t = FaRunTiming::assemble(prefix, FaInferenceTimings::default(), 0);
        assert!(t.manifest_digest_cache_hit, "a memo hit must be distinguishable from a full 1.26 GiB hash");
        assert_eq!(t.manifest_verify_ms, 0.4);
    }

    #[test]
    fn total_is_wall_clock_and_is_not_forced_to_equal_the_sum_of_stages() {
        // The residual (WAV decode, vocab load, stitching, IPC) is meant to be
        // visible. A total silently recomputed as the sum of known stages
        // would hide every cost nobody thought to instrument.
        let mut inference = FaInferenceTimings::default();
        inference.chunks.forward.record(n(1_000_000));
        let t = FaRunTiming::assemble(FaStagePrefix::default(), inference, 9_000_000);
        assert_eq!(t.total_ms, 9.0);
        assert_eq!(t.chunks.forward.total_ms, 1.0);
        assert!(t.total_ms > t.chunks.forward.total_ms + t.durable_wav_ms + t.manifest_verify_ms);
    }

    #[test]
    fn every_dto_field_serializes_camel_case_matching_the_boundary_convention() {
        let t = FaRunTiming::assemble(
            FaStagePrefix { staging_nanos: Some(1), ..Default::default() },
            FaInferenceTimings::default(),
            1,
        );
        let json = serde_json::to_value(&t).unwrap();
        for key in [
            "stagingMs",
            "durableWavMs",
            "durableWavCacheHit",
            "manifestVerifyMs",
            "manifestDigestCacheHit",
            "modelCacheHit",
            "modelLoadMs",
            "chunks",
            "totalMs",
        ] {
            assert!(json.get(key).is_some(), "FaRunTiming must serialize a `{key}` field");
        }
        for key in ["chunkCount", "forward", "viterbi", "tokenize"] {
            assert!(json["chunks"].get(key).is_some(), "FaChunkAggregate must serialize a `{key}` field");
        }
        for key in ["count", "totalMs", "meanMs", "maxMs"] {
            assert!(json["chunks"]["forward"].get(key).is_some(), "FaStageAggregate must serialize a `{key}` field");
        }
    }

    // -- ORT session-option pin guard ----------------------------------
    //
    // WHY HERE, in the timing module's tests. This guard belongs to the
    // performance round that added everything else in this file, and it must
    // run in BOTH Cargo configurations — a test living inside `fa_onnx.rs`
    // is compiled only under `--features fa-inference`, so a plain
    // `cargo test` (the default build, and the one most likely to be run
    // casually) would not execute it at all. It reads the source text rather
    // than constructing a `Session`, so it needs no ONNX runtime, no model
    // file, and no `ORT_DYLIB_PATH`.
    //
    // WHAT IT PROTECTS. `fa_onnx::load_session`'s five pinned options are
    // load-bearing for BIT-EXACT output (`phase1_determinism::
    // pinned_session_is_byte_identical_173_and_v6`) and, for
    // `with_memory_pattern(false)`, for not reintroducing the Session AO
    // OOM. A future performance round is exactly the kind of work that would
    // be tempted to unpin threading for speed, and would do it in a commit
    // whose test suite stays green because the determinism test that would
    // catch it is `#[ignore]`d (it needs the real models and real corpus
    // audio). This turns that silent unpinning into a compile-suite failure
    // that names the option and the reason.

    /// The source of `fa_onnx.rs`, read at COMPILE time. `include_str!` is not
    /// affected by `#[cfg(feature = ...)]`, so this works in both configs.
    const FA_ONNX_SOURCE: &str = include_str!("fa_onnx.rs");

    /// Just `load_session`'s body — bounded so a matching string in a doc
    /// comment or a test helper elsewhere in this 7k-line file cannot satisfy
    /// the assertions below.
    fn load_session_body() -> &'static str {
        let start = FA_ONNX_SOURCE
            .find("pub fn load_session(model_path: &Path) -> Result<Session, FaOnnxError> {")
            .expect(
                "fa_onnx::load_session was renamed or its signature changed — this guard can no                  longer see the pinned ORT session options it exists to protect. Re-point it                  before assuming the pins are intact.",
            );
        let rest = &FA_ONNX_SOURCE[start..];
        let end = rest
            .find(".commit_from_file(model_path)")
            .expect("load_session no longer ends in commit_from_file — re-point this guard");
        &rest[..end]
    }

    #[test]
    fn ort_session_options_stay_pinned_exactly_as_the_determinism_work_left_them() {
        let body = load_session_body();
        for (call, why) in [
            ("with_intra_threads(1)", "single intra-op thread — pinned for run-to-run bit-exactness"),
            ("with_inter_threads(1)", "single inter-op thread — pinned for run-to-run bit-exactness"),
            ("with_parallel_execution(false)", "sequential execution — pinned for run-to-run bit-exactness"),
            ("with_deterministic_compute(true)", "the actual numeric-reproducibility knob (WS1 Session Y)"),
            ("with_memory_pattern(false)", "per-shape allocation-plan cache OFF (WS1 Session AO OOM fix)"),
        ] {
            assert!(
                body.contains(call),
                "fa_onnx::load_session no longer calls `{call}` — {why}. Changing it would break                  `phase1_determinism::pinned_session_is_byte_identical_173_and_v6`, which is                  `#[ignore]`d and therefore CANNOT catch this in a normal test run. If this change                  is deliberate, re-run that ignored test against the real corpora first."
            );
        }
    }

    #[test]
    fn ort_session_options_are_not_merely_mentioned_in_a_comment() {
        // Non-vacuity for the guard above: the five options must appear as
        // real builder calls in the chain, each on its own `.`-prefixed line,
        // not as prose in the doc comment that sits directly above them
        // discussing exactly these names.
        let body = load_session_body();
        let mut chained = 0;
        for line in body.lines() {
            let t = line.trim();
            if t.starts_with(".with_intra_threads(1)")
                || t.starts_with(".with_inter_threads(1)")
                || t.starts_with(".with_parallel_execution(false)")
                || t.starts_with(".with_deterministic_compute(true)")
                || t.starts_with(".with_memory_pattern(false)")
            {
                chained += 1;
            }
        }
        assert_eq!(
            chained, 5,
            "expected all five pinned options as chained builder calls in load_session, found {chained}"
        );
    }

    #[test]
    fn nothing_reintroduces_an_unpinned_session_builder_into_load_session() {
        // The other shape this can regress into: leaving the five calls in
        // place but adding a second, unpinned `Session::builder()` path
        // inside `load_session` itself.
        let body = load_session_body();
        assert_eq!(
            body.matches("Session::builder()").count(),
            1,
            "load_session must construct exactly one session builder — a second one would not              carry the pinned options above it"
        );
    }

    // -- overhead ------------------------------------------------------

    /// MEASURED, not asserted-by-argument: the per-sample cost of the two
    /// `Instant::now()` reads plus `record`. Printed so the overhead fraction
    /// in this round's report is a number this suite produced rather than an
    /// estimate. The assertion is deliberately loose (a CI machine under load
    /// can be slow); its job is to catch an accidental allocation/syscall
    /// creeping into `record`, which would move this by orders of magnitude,
    /// not to police a few nanoseconds.
    #[test]
    fn instrumentation_cost_per_sample_is_measured_and_negligible() {
        const N: u32 = 200_000;
        let mut acc = StageAccumulator::default();
        let start = std::time::Instant::now();
        for _ in 0..N {
            let t = std::time::Instant::now();
            acc.record(t.elapsed());
        }
        let elapsed = start.elapsed();
        let per_sample_nanos = elapsed.as_nanos() as f64 / N as f64;
        println!(
            "=== FA TIMING OVERHEAD (MEASURED) === {N} samples in {:?} => {per_sample_nanos:.1} ns per \
             (Instant::now + elapsed + record) pair",
            elapsed
        );
        assert_eq!(acc.count, N);
        assert!(
            per_sample_nanos < 2_000.0,
            "a timing sample costing {per_sample_nanos:.1} ns means `record` is no longer allocation-free"
        );
    }
}
