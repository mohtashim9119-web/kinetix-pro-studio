// ---------------------------------------------------------------------------
// Pure Rust port of torchaudio v2.2.2's CTC forced-alignment Viterbi DP.
//
// Ported line-by-line from `src/libtorchaudio/forced_align/cpu/compute.cpp`
// (the `forced_align_impl` template) and `merge_tokens` from
// `src/torchaudio/functional/_alignment.py`, both read directly from the
// pinned 2.2.2 tag before writing anything here. No inference runtime, no
// model, no I/O, no async, no third-party crate: this takes an emission
// matrix (produced elsewhere, by whatever acoustic model) and target token
// ids as plain input and returns the forced alignment. Do NOT wire this into
// Apply Sync or any `src/` caller — this is the DP only, established ahead
// of a future native inference engine the same way `fa.rs` establishes the
// IPC command surface ahead of one.
//
// Structure, confirmed against the reference before porting:
//   - expanded label sequence S = 2L + 1 (blank/label/blank/label/.../blank)
//   - a rolling two-row alpha buffer (`alphas[t%2]`), not a full T x S table
//   - a full T x S int8 backpointer table (kept int8 here too — see
//     `forced_align`'s doc comment for the measured 30s-window allocation)
//   - R = count of immediately-repeated adjacent target labels, forcing
//     T >= L + R (`AlignError::TooManyRepeats` below)
//   - the "skip a blank" transition (`x2`, jumping from state i-2 to i) is
//     disallowed exactly when target[i/2] == target[i/2 - 1] — i.e. exactly
//     where a real blank frame is mandatory between two identical adjacent
//     labels
//
// Fixture-diff tests (bottom of this file) assert this port is frame-for-
// frame identical to real torchaudio 2.2.2 output on `scripts/fixtures/
// fa-emission-*.json` (captured from the real MMS_FA model, not synthetic).
// ---------------------------------------------------------------------------

use std::fmt;

/// A forced token span with its own frame-index start/end — the output of
/// [`merge_tokens`]. Time bounds are in the emission's own frame axis
/// (`start` inclusive, `end` exclusive), matching `TokenSpan` in
/// `torchaudio.functional._alignment`.
// Not yet called from any `src/` caller (see module header) — `#[allow(dead_code)]`
// throughout this file mirrors `fa.rs`'s own precedent for a proven-but-unwired
// boundary, not a signal of unfinished work. Exercised directly by the tests below.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub struct TokenSpan {
    pub token: i64,
    pub start: usize,
    pub end: usize,
    pub score: f32,
}

#[allow(dead_code)]
impl TokenSpan {
    pub fn len(&self) -> usize {
        self.end - self.start
    }
    pub fn is_empty(&self) -> bool {
        self.end == self.start
    }
}

/// The result of [`forced_align`]: one label per input frame, and that
/// label's own log-probability at that frame (gathered from the emission
/// matrix along the winning path — not a cumulative/alpha score).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub struct AlignOutput {
    pub path: Vec<i64>,
    pub scores: Vec<f32>,
}

/// Typed failure modes for [`forced_align`]. Never panics on either of
/// these — both are ordinary, expected inputs to guard against, not bugs.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlignError {
    /// torchaudio's own precondition, from `forced_align`'s docstring:
    /// `T >= L + R`, where `R` is the number of immediately-repeated
    /// adjacent target labels (the docstring's own example: in `"aabbc"`,
    /// `R == 2`). `input_length`/`target_length`/`num_repeats` name T/L/R
    /// respectively, mirroring the reference's own `TORCH_CHECK` message.
    TooManyRepeats {
        input_length: usize,
        target_length: usize,
        num_repeats: usize,
    },
    /// `targets` must have at least one token. Not a real torchaudio
    /// precondition — the reference C++ has no explicit guard here, and at
    /// L=0 (S=1) its own final-state selection reads `alphas[idx1][S - 2]`,
    /// i.e. index `-1`, which is undefined behaviour it happens never to hit
    /// in practice (every real forced-alignment caller has a non-empty
    /// target). Guarded explicitly here instead of replicating that latent
    /// out-of-bounds read.
    EmptyTargets,
}

impl fmt::Display for AlignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AlignError::TooManyRepeats { input_length, target_length, num_repeats } => write!(
                f,
                "targets length is too long for CTC. Found input length: {input_length}, \
                 target length: {target_length}, and number of repeats: {num_repeats}"
            ),
            AlignError::EmptyTargets => write!(f, "targets must contain at least one token"),
        }
    }
}

impl std::error::Error for AlignError {}

/// Counts immediately-repeated adjacent labels in `targets` — the `R` in
/// `T >= L + R`. Matches the reference's own loop (`compute.cpp:38-42`)
/// exactly: only ADJACENT equal pairs count (`"aabbc"` → 2, not 3).
#[allow(dead_code)]
fn count_repeats(targets: &[i64]) -> usize {
    targets.windows(2).filter(|pair| pair[0] == pair[1]).count()
}

/// Port of `forced_align_impl` (compute.cpp). `log_probs` is `T` rows of
/// `C` per-class log-probabilities (row `t` = frame `t`'s distribution).
/// `targets` is the target label sequence (length `L`, must not contain
/// `blank`, matching the reference's own precondition — not re-checked here
/// since every caller in this codebase controls both inputs together).
///
/// The backpointer table (`T x S` int8, `S = 2*targets.len() + 1`) is the
/// memory-dominant structure, as in the reference — kept as a single flat
/// `Vec<i8>` (one allocation, `T * S` bytes) rather than `T` separate row
/// allocations, which is the one structural deviation from the reference's
/// literal `torch::Tensor` shape; numerically nothing changes. For a
/// measured 30s window at this codebase's own captured ~49.7 fps
/// (`scripts/fixtures/fa-emission-*.json`'s `_provenance.frame_rate_fps`),
/// T ≈ 1491; at a representative L ≈ 453 (the target length implied by the
/// audit's own naive-formula 675,000-cell figure at T*L), S = 2*453+1 = 907,
/// giving T*S ≈ 1,352,337 bytes ≈ 1.29 MiB — confirming the audit's
/// corrected ~1.35M-cell figure (see `lattice_sizing_30s_window` below).
#[allow(dead_code)]
pub fn forced_align(
    log_probs: &[Vec<f32>],
    targets: &[i64],
    blank: i64,
) -> Result<AlignOutput, AlignError> {
    let t = log_probs.len();
    let l = targets.len();

    if l == 0 {
        return Err(AlignError::EmptyTargets);
    }

    let r = count_repeats(targets);
    if t < l + r {
        return Err(AlignError::TooManyRepeats { input_length: t, target_length: l, num_repeats: r });
    }

    let s = 2 * l + 1;
    const NEG_INF: f32 = f32::NEG_INFINITY;

    let label_idx = |i: usize| -> i64 {
        if i % 2 == 0 {
            blank
        } else {
            targets[i / 2]
        }
    };

    let mut alphas = [vec![NEG_INF; s], vec![NEG_INF; s]];
    // Flat T*S int8 backpointer table (see doc comment above for why flat,
    // not T separate rows). `back_ptr[tt * s + i]` mirrors the reference's
    // `backPtr_a[tt][i]`. -1 = never written (only cells the DP actually
    // reaches during the forward pass get a real 0/1/2).
    let mut back_ptr: Vec<i8> = vec![-1i8; t * s];

    let mut start: usize = if t > l + r { 0 } else { 1 };
    let mut end: usize = if s == 1 { 1 } else { 2 };

    for i in start..end {
        alphas[0][i] = log_probs[0][label_idx(i) as usize];
    }

    for tt in 1..t {
        if t - tt <= l + r {
            if start % 2 == 1 && targets[start / 2] != targets[start / 2 + 1] {
                start += 1;
            }
            start += 1;
        }
        if tt <= l + r {
            if end % 2 == 0 && end < 2 * l && targets[end / 2 - 1] != targets[end / 2] {
                end += 1;
            }
            end += 1;
        }

        let mut start_loop = start;
        let cur = tt % 2;
        let prev = (tt - 1) % 2;

        for slot in alphas[cur].iter_mut() {
            *slot = NEG_INF;
        }

        if start == 0 {
            alphas[cur][0] = alphas[prev][0] + log_probs[tt][blank as usize];
            back_ptr[tt * s] = 0;
            start_loop += 1;
        }

        for i in start_loop..end {
            let x0 = alphas[prev][i];
            let x1 = alphas[prev][i - 1];
            // In CTC, the optimal path may optionally skip a blank label.
            // x2 represents that skip, and is only reachable when the
            // current state is a label (not blank) that DIFFERS from the
            // preceding label — i.e. exactly where a real blank is NOT
            // mandatory. `i != 1` guards `targets[i/2 - 1]` from underflow.
            let x2 = if i % 2 != 0 && i != 1 && targets[i / 2] != targets[i / 2 - 1] {
                alphas[prev][i - 2]
            } else {
                NEG_INF
            };

            let (result, bp): (f32, i8) = if x2 > x1 && x2 > x0 {
                (x2, 2)
            } else if x1 > x0 && x1 > x2 {
                (x1, 1)
            } else {
                (x0, 0)
            };
            back_ptr[tt * s + i] = bp;
            alphas[cur][i] = result + log_probs[tt][label_idx(i) as usize];
        }
    }

    let idx1 = (t - 1) % 2;
    let mut ltr_idx = if alphas[idx1][s - 1] > alphas[idx1][s - 2] { s - 1 } else { s - 2 };

    let mut path = vec![0i64; t];
    for tt in (0..t).rev() {
        path[tt] = if ltr_idx % 2 == 0 { blank } else { targets[ltr_idx / 2] };
        // The reference performs this same subtraction unconditionally,
        // including at tt == 0, reading `backPtr[0][ltrIdx]` — a cell the
        // forward pass never writes (backpointers are only assigned for
        // tt >= 1), always -1 there. Its result at tt == 0 is provably never
        // read again (the loop ends), so the reference's own read is dead
        // code. Replicating it verbatim in Rust would underflow-panic on
        // unsigned `ltr_idx` (`ltr_idx -= (-1 as usize)`); skipping it here
        // changes nothing observable.
        if tt > 0 {
            ltr_idx -= back_ptr[tt * s + ltr_idx] as usize;
        }
    }

    let scores: Vec<f32> = (0..t).map(|tt| log_probs[tt][path[tt] as usize]).collect();

    Ok(AlignOutput { path, scores })
}

/// Port of `merge_tokens` (`_alignment.py`). Collapses `tokens` into
/// maximal constant-value runs, drops the `blank`-valued runs, and scores
/// each surviving run as the mean of `scores` over its own span — operating
/// directly on whatever `scores` it's given (this module always feeds it
/// [`forced_align`]'s raw per-frame log-probs, never an exponentiated
/// probability, matching the reference function's own docstring example
/// rather than the pipeline `Aligner` wrapper's convention of exponentiating
/// first).
///
/// Reference deviation: torch's version detects run boundaries via
/// `torch.diff` against a `-1` sentinel prepended/appended to `tokens`
/// (relying on no real token id ever being `-1`). This port uses
/// `Option<i64>` for that sentinel instead of a magic number — same
/// boundary detection, no assumption about the token id space.
#[allow(dead_code)]
pub fn merge_tokens(tokens: &[i64], scores: &[f32], blank: i64) -> Vec<TokenSpan> {
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut change_points = Vec::new();
    let mut prev: Option<i64> = None;
    for (i, &tok) in tokens.iter().enumerate() {
        if prev != Some(tok) {
            change_points.push(i);
        }
        prev = Some(tok);
    }
    change_points.push(tokens.len());

    let mut spans = Vec::new();
    for pair in change_points.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let token = tokens[start];
        if token == blank {
            continue;
        }
        let span_scores = &scores[start..end];
        let mean = span_scores.iter().sum::<f32>() / span_scores.len() as f32;
        spans.push(TokenSpan { token, start, end, score: mean });
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    // -- unit: hand-computable / reference-verified toy cases -----------
    //
    // Every expected value below was independently cross-checked against
    // real `torch.ops.torchaudio.forced_align` / `torchaudio.functional.
    // merge_tokens` output (torch/torchaudio 2.2.2) on the identical toy
    // input, not just hand-derived — eliminating arithmetic-mistake risk
    // in a case small enough to also verify by inspection (shown inline).

    #[test]
    fn two_symbol_vocab_hand_computable() {
        // blank=0, a=1 (C=2). target=[a]. T=2, uniform blank=-1.0/a=-2.0
        // every frame (blank strictly preferred throughout).
        //
        // By inspection: L=1, R=0, so T=2 > L+R=1 gives start=0 (a leading
        // blank state IS reachable). At t=0: alphas[0]=[blank@0, a@0] =
        // [-1.0, -2.0]. At t=1: state 1 (a) can arrive from state 0 (x1,
        // blank@t0=-1.0) or state 1 (x0, a@t0=-2.0); x1 wins (-1.0 > -2.0).
        // state 2 (trailing blank) is unreachable (only states 0,1 were
        // initialized). Final states compared are S-1=2 (unreached, -inf)
        // vs S-2=1 (-1.0 + a@t1 = -3.0) — state 1 wins. Traceback: state 1
        // at t=1 (label a) came via backptr=1 from state 0 at t=0 (label
        // blank). Path = [blank, a] = [0, 1].
        let log_probs = vec![vec![-1.0f32, -2.0], vec![-1.0, -2.0]];
        let result = forced_align(&log_probs, &[1], 0).unwrap();
        assert_eq!(result.path, vec![0, 1]);
        assert!(approx_eq(result.scores[0], -1.0));
        assert!(approx_eq(result.scores[1], -2.0));

        let spans = merge_tokens(&result.path, &result.scores, 0);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0], TokenSpan { token: 1, start: 1, end: 2, score: -2.0 });
    }

    #[test]
    fn t_exactly_equals_l_plus_r() {
        // target=[a,a] (one immediate repeat: L=2, R=1), T=3=L+R exactly —
        // zero slack, so the path is fully forced regardless of the actual
        // (finite) probability values: minimum-length CTC alignment is
        // always "label, mandatory-blank, label" for one adjacent repeat.
        let log_probs = vec![vec![-0.5f32, -0.7]; 3];
        let result = forced_align(&log_probs, &[1, 1], 0).unwrap();
        assert_eq!(result.path, vec![1, 0, 1]);
        assert!(approx_eq(result.scores[0], -0.7));
        assert!(approx_eq(result.scores[1], -0.5));
        assert!(approx_eq(result.scores[2], -0.7));

        let spans = merge_tokens(&result.path, &result.scores, 0);
        // Two SEPARATE spans of the same token id 1 — proof the DP was
        // forced through a real blank between the repeat, not merged.
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0], TokenSpan { token: 1, start: 0, end: 1, score: -0.7 });
        assert_eq!(spans[1], TokenSpan { token: 1, start: 2, end: 3, score: -0.7 });
    }

    #[test]
    fn aabbc_canonical_repeat_case_minimal_t() {
        // The docstring's own canonical example: target "aabbc" has R=2
        // (the two adjacent-repeat pairs "aa" and "bb"), so minimum
        // feasible T = L + R = 5 + 2 = 7. At that minimum, zero slack again
        // forces the unique minimal-length alignment: each label gets
        // exactly one frame, with a mandatory blank inserted only at each
        // of the two repeat boundaries, and no leading/trailing blank.
        // blank=0, a=1, b=2, c=3; uniform -1.0 log-prob per class per frame
        // (values don't matter here — see t_exactly_equals_l_plus_r above
        // for why T==L+R forces the path regardless of magnitude).
        let log_probs = vec![vec![-1.0f32, -1.0, -1.0, -1.0]; 7];
        let targets = [1i64, 1, 2, 2, 3];
        assert_eq!(count_repeats(&targets), 2);

        let result = forced_align(&log_probs, &targets, 0).unwrap();
        assert_eq!(result.path, vec![1, 0, 1, 2, 0, 2, 3]);

        let spans = merge_tokens(&result.path, &result.scores, 0);
        let tokens: Vec<i64> = spans.iter().map(|s| s.token).collect();
        assert_eq!(tokens, vec![1, 1, 2, 2, 3]);
        // Repeat pairs land as separate spans (mandatory blank between).
        assert_eq!(spans[0], TokenSpan { token: 1, start: 0, end: 1, score: -1.0 });
        assert_eq!(spans[1], TokenSpan { token: 1, start: 2, end: 3, score: -1.0 });
        assert_eq!(spans[2], TokenSpan { token: 2, start: 3, end: 4, score: -1.0 });
        assert_eq!(spans[3], TokenSpan { token: 2, start: 5, end: 6, score: -1.0 });
        assert_eq!(spans[4], TokenSpan { token: 3, start: 6, end: 7, score: -1.0 });
    }

    #[test]
    fn single_token_target() {
        // target=[a] only, T=5 with slack, blank dominant (-0.1) vs a
        // (-3.0) at every frame. Reference-verified: the DP places the
        // costly-but-mandatory 'a' at the very first frame, then blank for
        // the rest (path=[a,blank,blank,blank,blank]) — not the last frame,
        // confirming this isn't just "whichever end is cheaper" symmetry.
        let log_probs = vec![vec![-0.1f32, -3.0]; 5];
        let result = forced_align(&log_probs, &[1], 0).unwrap();
        assert_eq!(result.path, vec![1, 0, 0, 0, 0]);

        let spans = merge_tokens(&result.path, &result.scores, 0);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0], TokenSpan { token: 1, start: 0, end: 1, score: -3.0 });
    }

    #[test]
    fn all_blank_dominant_emissions_still_thread_the_target() {
        // Every frame overwhelmingly favors blank (-0.01 vs -5.0 for the
        // one real target token, T=4) — this is a FORCED alignment, not a
        // free decode, so the target must appear somewhere regardless of
        // how unlikely the model thinks it is. Reference-verified: 'a'
        // lands on the LAST frame here (the opposite end from
        // single_token_target's setup above, since the exact frame count
        // and repeat window differ) — the DP is not simply "always first"
        // or "always last", it's a real cost-minimizing choice.
        let log_probs = vec![vec![-0.01f32, -5.0]; 4];
        let result = forced_align(&log_probs, &[1], 0).unwrap();
        assert_eq!(result.path, vec![0, 0, 0, 1]);

        let spans = merge_tokens(&result.path, &result.scores, 0);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0], TokenSpan { token: 1, start: 3, end: 4, score: -5.0 });
    }

    #[test]
    fn t_less_than_l_plus_r_returns_typed_error_not_panic() {
        // target=[a,a]: L=2, R=1, minimum T=3. T=2 here is one short.
        let log_probs = vec![vec![-1.0f32, -1.0]; 2];
        let err = forced_align(&log_probs, &[1, 1], 0).unwrap_err();
        assert_eq!(err, AlignError::TooManyRepeats { input_length: 2, target_length: 2, num_repeats: 1 });
    }

    #[test]
    fn empty_targets_returns_typed_error_not_panic() {
        let log_probs = vec![vec![-1.0f32, -1.0]; 3];
        let err = forced_align(&log_probs, &[], 0).unwrap_err();
        assert_eq!(err, AlignError::EmptyTargets);
    }

    #[test]
    fn count_repeats_matches_docstring_aabbc_example() {
        // torchaudio's own docstring: `"aabbc"` has 2 repeats.
        assert_eq!(count_repeats(&[1, 1, 2, 2, 3]), 2);
        assert_eq!(count_repeats(&[1, 2, 3]), 0);
        assert_eq!(count_repeats(&[1]), 0);
        assert_eq!(count_repeats(&[]), 0);
    }

    // -- 2.3: empirical lattice sizing for a 30s window ------------------

    #[test]
    fn lattice_sizing_30s_window() {
        // fps measured across scripts/fixtures/fa-emission-*.json's own
        // captured MMS_FA runs: 49.615 / 49.823 / 49.841 -> ~49.7-49.8.
        // T for a 30s window at that rate:
        let fps = 49.7_f64;
        let t = (30.0 * fps).round() as usize;
        assert_eq!(t, 1491);

        // Representative dense-speech target length: L such that the
        // AUDIT's OWN naive (uncorrected) T*L formula lands at its cited
        // ~675,000-cell figure -- L = 675_000 / T, confirming the same L
        // the audit was implicitly assuming.
        let naive_cells = 675_000usize;
        let l = (naive_cells as f64 / t as f64).round() as usize;
        assert_eq!(l, 453);

        let s = 2 * l + 1;
        assert_eq!(s, 907);

        let corrected_cells = t * s;
        // Audit's corrected figure: "~1.35M cells".
        assert_eq!(corrected_cells, 1_352_337);
        assert!((corrected_cells as f64 - 1_350_000.0).abs() < 20_000.0);

        // Backpointer table is int8 (1 byte/cell) -- this module's actual
        // allocated type (see `forced_align`'s `back_ptr: Vec<i8>`).
        let backptr_bytes = corrected_cells; // 1 byte per i8 cell
        assert_eq!(backptr_bytes, 1_352_337);
        let mib = backptr_bytes as f64 / (1024.0 * 1024.0);
        assert!((mib - 1.29).abs() < 0.05);
    }

    // -- fixture diff: frame-for-frame identical to real torchaudio -----

    fn load_fixture(name: &str) -> serde_json::Value {
        let path = format!("{}/../scripts/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("failed to parse fixture {path}: {e}"))
    }

    fn run_fixture_diff(name: &str) {
        let v = load_fixture(name);
        let blank = v["blank_id"].as_i64().expect("blank_id");
        let target_ids: Vec<i64> = v["target_token_ids"]
            .as_array()
            .expect("target_token_ids")
            .iter()
            .map(|x| x.as_i64().unwrap())
            .collect();
        let emission: Vec<Vec<f32>> = v["emission_log_probs"]
            .as_array()
            .expect("emission_log_probs")
            .iter()
            .map(|row| row.as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect())
            .collect();
        let expected_path: Vec<i64> = v["expected_path"]
            .as_array()
            .expect("expected_path")
            .iter()
            .map(|x| x.as_i64().unwrap())
            .collect();
        let expected_scores: Vec<f32> = v["expected_per_frame_scores"]
            .as_array()
            .expect("expected_per_frame_scores")
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();

        let result = forced_align(&emission, &target_ids, blank)
            .unwrap_or_else(|e| panic!("fixture {name} should align, got error: {e}"));

        assert_eq!(result.path.len(), expected_path.len(), "fixture {name}: path length mismatch");
        for (i, (&got, &want)) in result.path.iter().zip(expected_path.iter()).enumerate() {
            assert_eq!(
                got, want,
                "fixture {name}: path diverges at frame {i}: got label {got}, want {want} \
                 (alpha-driven divergence — see forced_align's DP for how this frame's state \
                 was chosen)"
            );
        }
        for (i, (&got, &want)) in result.scores.iter().zip(expected_scores.iter()).enumerate() {
            assert!(
                (got - want).abs() < 1e-5,
                "fixture {name}: score diverges at frame {i}: got {got}, want {want}"
            );
        }

        let expected_spans = v["expected_merged_spans"].as_array().expect("expected_merged_spans");
        let spans = merge_tokens(&result.path, &result.scores, blank);
        assert_eq!(spans.len(), expected_spans.len(), "fixture {name}: merged span count mismatch");
        for (got, want) in spans.iter().zip(expected_spans.iter()) {
            assert_eq!(got.token, want["token"].as_i64().unwrap(), "fixture {name}: span token mismatch");
            assert_eq!(got.start, want["start"].as_i64().unwrap() as usize, "fixture {name}: span start mismatch");
            assert_eq!(got.end, want["end"].as_i64().unwrap() as usize, "fixture {name}: span end mismatch");
            let want_score = want["score"].as_f64().unwrap() as f32;
            assert!(
                (got.score - want_score).abs() < 1e-5,
                "fixture {name}: span score mismatch: got {}, want {want_score}",
                got.score
            );
        }
    }

    #[test]
    fn fixture_diff_en_deep_night() {
        run_fixture_diff("fa-emission-en-deep-night.json");
    }

    #[test]
    fn fixture_diff_en_mother_look() {
        run_fixture_diff("fa-emission-en-mother-look.json");
    }

    #[test]
    fn fixture_diff_es_resultan_inutiles() {
        run_fixture_diff("fa-emission-es-resultan-inutiles.json");
    }
}
