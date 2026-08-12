# Runtime unblock — `ort`/onnxruntime version deadlock RESOLVED, 2026-08-12

**Follow-up to `runtime-spike-2026-08-11.md`'s G4 finding.** That spike concluded the
`ort` Rust crate (2.0.0-rc.13) hard-requires onnxruntime ≥1.27, no onnxruntime
distribution exists for macOS x86_64 at any version ≥1.24, and therefore the only path
forward was a from-source onnxruntime build (ruling R-M). **That conclusion was
incomplete — the ≥1.27 requirement is a configurable Cargo feature default, not a hard
floor, and lowering it makes the existing onnxruntime-osx-x86_64-1.22.0 binary
(already sitting in the gitignored scratch dir from the prior spike) work end-to-end
through the real Rust `ort` binding.** No from-source build was needed; Step 3 did not
run.

Reused the prior spike's already-downloaded artifacts (`ort-spike` crate,
`onnxruntime-osx-x86_64-1.22.0/`, `wav2vec2-en.onnx`, `torch_input_raw.bin`,
`torch_logits.npy`) from `.work-phase4/spike-runtime/` — confirmed still gitignored via
`git check-ignore -v .work-phase4/spike-runtime/` before touching anything.
`src-tauri/Cargo.toml`, `Cargo.lock`, `src/`, and `src-tauri/src/` were not touched at
any point in this investigation.

---

## Step 1.1 — ort release history (crates.io)

`curl -s https://crates.io/api/v1/crates/ort/versions`

All `1.x` releases (1.13.0 through 1.16.3) are **yanked**. The only live line is
`2.0.0-rc.0` (2024-02-06) through `2.0.0-rc.13` (2026-07-28) — still no stable `2.0.0`.
`2.0.0-rc.13` is both the newest release and the version the prior spike already used;
there is no newer release to re-test.

## Step 1.1/1.4 — where the version floor actually lives

`ort-sys`'s `src/version.rs` (fetched via docs.rs source browser,
`https://docs.rs/crate/ort-sys/2.0.0-rc.13/source/src/version.rs`):

```rust
const V18: u32 = cfg!(feature = "api-18") as u32;
...
const V28: u32 = cfg!(feature = "api-28") as u32;

pub const ORT_API_VERSION: u32 = 17 // minimum version
    + V18 + V19 + V20 + V21 + V22 + V23 + V24 + V25 + V26 + V27 + V28; // each API also enables the one before it.
```

`ort`'s own `src/lib.rs`: `pub const MINOR_VERSION: u32 = ort_sys::ORT_API_VERSION;` —
this is exactly the number the error message means by "expected version >= '1.N.x'".
crates.io confirms the feature graph: `"api-27": ["ort-sys/api-27", "api-26"]` etc., each
cascading down to `api-18`, and **`default = [..., "api-27"]`**. That default is why the
spike's Cargo.toml (`features = ["ndarray", "load-dynamic"]`, defaults still on)
compiled with `MINOR_VERSION = 27` and rejected a 1.22.0 binary.

The runtime check itself, `ort`'s `src/lib.rs` (`load_dynamic::init`):

```rust
let lib_minor_version = version_string.split('.').nth(1)...;
match lib_minor_version.cmp(&MINOR_VERSION) {
    Ordering::Less => return Err(LoadError::BadVersion { .. }),   // hard fail
    Ordering::Greater => crate::info!("...may have compatibility issues..."), // log only, continues
    Ordering::Equal => {}
};
```

So the check is **`loaded_binary_minor >= MINOR_VERSION`**, not equality. Setting
`default-features = false` and enabling none of `api-18`..`api-28` leaves
`MINOR_VERSION = 17`, which any onnxruntime ≥1.17.x satisfies — including 1.22.0 and
1.23.2.

**Step 1.4 verdict: this is the supported, documented mechanism, not a hack or an env-var
bypass.** It's ort's own first-class Cargo feature system for declaring the minimum
ONNX Runtime C-API surface the calling code needs; omitting the higher `api-NN` features
simply declares "I don't need anything past API 17" truthfully, and the crate's own
`Ordering::Greater`-is-fine logic already treats a newer-than-required runtime as
acceptable by design. No separate "skip the assertion" env var or unsafe escape hatch
was needed or found.

## Step 1.2/1.3 — empirical verification (not just source reading)

Reproduction, from `.work-phase4/spike-runtime/ort-spike/`:

`Cargo.toml` changed from:
```toml
ort = { version = "=2.0.0-rc.13", features = ["ndarray", "load-dynamic"] }
```
to:
```toml
ort = { version = "=2.0.0-rc.13", default-features = false, features = ["std", "ndarray", "load-dynamic"] }
```
(`std` is required directly since `default-features = false` drops it, though
`load-dynamic` itself also pulls `std` in transitively.)

```
export ORT_DYLIB_PATH="../onnxruntime-osx-x86_64-1.22.0/lib/libonnxruntime.dylib"
cargo build --release   # Finished in 5.53s, no errors, no api-NN feature enabled
./target/release/ort-spike
```

Output:
```
load_sec=3.319
inference_sec=0.111
emission_shape=[1, 49, 33]
first_5_logits=[6.1480265, -16.476856, -16.316925, -8.96989, 3.6397634]
dumped to ../ort_logits.bin + ../ort_logits_shape.json
```

No `BadVersion` error. Full session load, forward pass, and `f32` tensor extraction all
worked through the real Rust `ort` binding — confirming Step 1.3's API-surface
question directly (`Session::builder()`, `commit_from_file()`, `session.run()`,
`try_extract_tensor::<f32>()` are all available and functional at API version 17).

**Fidelity check against the torch reference** (`torch_logits.npy`, captured 2026-08-11,
same 1.0s/16kHz English clip used by G5):

```python
diff = np.abs(torch_logits - ort_logits)
# max_abs_diff      = 0.00026929379
# p95_abs_diff       = 6.351470947265616e-05
# argmax_mismatch    = 0 / 49
```

These numbers are consistent with G5's Python-`onnxruntime`-1.23.2 cross-check
(`max_abs_diff=0.000269, p95=0.0000635, 0/49 mismatches`) — but this run went through the
actual Rust `ort` crate end-to-end, the exact path G5 could not exercise on this
machine. **This closes G5's own caveat** ("inference from the shared C library, not
something this spike verified directly for the Rust binding path itself").

## Step 1.5 — correction: 1.22.0 is NOT the last x86_64-apple-darwin onnxruntime release

The prior spike's bisection (1.22.0 present, 1.26.0 absent) was directionally right but
imprecise. Full per-tag GitHub release-asset audit, 2026-08-12:

```
gh api repos/microsoft/onnxruntime/releases/tags/<tag> --jq '.assets[].name' | grep -i "osx.*x86_64\|osx.*universal"
```

| Tag | osx-x86_64 / osx-universal2 asset? |
|---|---|
| v1.22.1, v1.22.2 | none |
| **v1.23.0, v1.23.1, v1.23.2** | **yes** (both `osx-universal2` and `osx-x86_64`) |
| v1.24.1 – v1.29.0 (every tag checked) | none (arm64-only from here on) |

**The real last x86_64-apple-darwin release is v1.23.2, not v1.22.0** — one minor
version later than previously documented, and the drop happens between 1.23.2 and
1.24.1, not at 1.26.0. This doesn't change the feasibility verdict (1.23.2's minor
version 23 also clears the lowered floor of 17 with room to spare), but v1.23.2 is
the better pin going forward: newest available x86_64 build, not the one two point
releases behind it that the original spike happened to have already downloaded.

---

## Step 2 — optional-feature architecture (evaluated, NOT implemented)

Proposal: make FA inference an optional Cargo feature on the real `app` crate
(`src-tauri/Cargo.toml`), default OFF, with `ort` as an optional dependency gated
behind it.

- **2.1 — cargo check stays green/warning-free with the feature off.** Yes by
  construction: an optional dependency behind a default-off feature is simply absent
  from the default build graph; `cargo check` on this Intel Mac (or any machine) never
  touches `ort` unless someone passes `--features fa-inference`.
- **2.2 — shape of `fa.rs`.** `fa_align` (`src-tauri/src/fa.rs:267`) already returns a
  typed `FaError { kind: NotImplemented, .. }` unconditionally (`fa.rs:277-278`,
  R-D boundary work, no ML dependency). The optional-feature version would keep that as
  the `#[cfg(not(feature = "fa-inference"))]` arm and add a `#[cfg(feature =
  "fa-inference")]` arm calling into a real session — same command surface, same
  `FaEvent`/cancellation shapes already built, only the body of one function forks.
- **2.3 — real costs.** (a) A build configuration nobody's local `cargo check`/`cargo
  build` (used via `tauri:dev`) ever exercises by default — the feature-on path can
  silently rot between the rare times someone remembers to build it. (b) A second
  compile path, `ort`'s full dependency tree (`libloading`, `ndarray`, etc.) pulled in
  only conditionally, doubling the paths that "compiles clean" has to mean. (c) This
  project has no CI (confirmed: only a `build.yml` for release artifacts, no
  test/check-on-PR workflow) — nothing catches either path breaking except a human
  remembering to build both configurations before a release.
- **2.4 — interaction with R-N (deferred static-vs-dynamic packaging).** Direct: this
  investigation confirms **load-dynamic is the only viable macOS x86_64 path today**
  (no static onnxruntime lib is available prebuilt at any recent version for x86_64
  macOS — only the from-source route would produce one, and that's exactly what Step 1
  made unnecessary). So the optional-feature question and R-N's packaging question
  compound: feature-on would need to bundle the ~35.7 MiB onnxruntime dylib
  (`onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.dylib`, sized from the 1.22.0
  asset in `runtime-spike-2026-08-11.md`; 1.23.2 not yet re-measured) as a resource,
  `dlopen`'d in-process at runtime — same delivery shape as the ffmpeg/whisper-cli
  sidecars' binaries today, minus the subprocess boundary.

**Recommendation:** the optional-feature split is sound and low-risk to adopt *when
Task 5's inference work actually starts* — it keeps `cargo check` clean today without
requiring the runtime question to be re-litigated. Not implemented in this task per
scope (evaluate only).

## Step 3 — not run

Step 1 found a working combination; per the task's own stop condition, the from-source
build was not attempted.

---

## Reproducibility

Every command above is copy-pasteable as written. The one non-portable piece: the
`onnxruntime-osx-x86_64-1.22.0` dylib and `wav2vec2-en.onnx`/`torch_input_raw.bin`/
`torch_logits.npy` fixtures live only in the gitignored `.work-phase4/spike-runtime/`
scratch dir (same caveat as `runtime-spike-2026-08-11.md` — not preserved, would need
re-downloading/re-exporting to reproduce from scratch). The `ort-spike` Cargo.toml
feature-flag change itself is the portable, reusable finding regardless of which
onnxruntime tarball is on disk.

## Downstream implications for Task 5 scoping

1. **R-M's "from-source onnxruntime build" premise is no longer the only path** — the
   native-library-provisioning blocker it named is resolved via a Cargo feature
   selection, not a build-infra project. R-M itself is a recorded ruling in
   `project-state.md` and is not edited by this task (owner approval required,
   deferred to end-of-Task-5 doc pass per the process rule below).
2. **The onnxruntime pin should target v1.23.2**, not v1.22.0 (Step 1.5 correction) —
   newest available x86_64-apple-darwin asset.
3. **R-N (static-link vs. load-dynamic packaging) is now answerable, not just
   deferrable**: load-dynamic is the only real option on macOS x86_64 short of a
   from-source static build this investigation shows is unnecessary. Still an
   owner-facing packaging decision, not made here.
4. `ort`'s Cargo.toml shape for Task 5, when implementation starts:
   `ort = { version = "=2.0.0-rc.13", default-features = false, features = ["std",
   "ndarray", "load-dynamic"] }` — no `api-NN` feature, since nothing beyond
   `Session`/`run`/tensor-extraction (all available at API 17) is needed.

## Process rule (see also `docs/work-in-progress.md`)

During WS1 implementation work: only `docs/work-in-progress.md` and files under
`docs/ws1-sync-pipeline/` are written mid-task. `CLAUDE.md`, `docs/history.md`, and
`project-state.md` are batched to task completion and require explicit owner approval
before any edit — not touched at the end of a part, not touched at the end of a task
without that approval. The corresponding `project-state.md` ruling entry for this
finding is **deferred** to the end-of-Task-5 documentation pass.
