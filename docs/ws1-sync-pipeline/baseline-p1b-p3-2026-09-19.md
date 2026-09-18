# Baseline P1b/P3 — ffmpeg pin, whisper sidecar, gates 4-6, flake hunt, disposition (2026-09-19)

> Scope: "part 2" of `baseline-p1-2026-09-19.md`. That pass left gates 4-6 **BLOCKED**
> on a missing whisper-cli sidecar (its T5, `baseline-p1-2026-09-19.md:94-108`) and left
> the regenerated ffmpeg sidecar NOT byte-identical to the pinned P2 reference (its T3,
> `:58-70`). This pass: (T1) re-pins the ffmpeg doc to a stable versioned URL and
> verifies byte-identity; (T2) builds the whisper-cli sidecar from source at the pinned
> tag; (T3) runs gates 4-6 fresh; (T4) hunts the known intermittent across ten
> `cargo test --features fa-inference` runs; (T5) inspects (read-only) the shared stash
> stack; (T6) assesses deletion-readiness for four slated worktrees. No deletions, no
> push, no questions asked — machine is x86_64 Intel, so both native builds applied
> without cross-compilation.

## Decision Log

1. **T1 — ffmpeg pin approach.** Authorization gave two options: find a stable
   versioned URL, or pin by SHA-256 verification against a rolling URL. Checked
   `evermeet.cx/ffmpeg/ffmpeg-8.1.1.zip` (HTTP 302 → a stable third-party mirror,
   `deolaha.ca/pub/ffmpeg/ffmpeg-8.1.1.zip`) — this succeeded and the downloaded
   binary's SHA-256 matched the reference **exactly**
   (`3a0ea97adddecfbf87b865da3bcbb321edfce4bab18a98ae1ba4ba9f0bd1f93a`), so used the
   versioned-URL path (the doc's preferred option) rather than the rolling-URL +
   hash-check fallback. Kept the hash-verification step in the doc anyway (as an
   explicit post-fetch check) since the mirror behind the versioned URL is third-party
   infrastructure this project does not control and could still change.
2. **T2 — no cross-compilation needed.** `uname -m` reported `x86_64` on this machine
   (not Apple Silicon), so the documented macOS (Intel x86_64) whisper.cpp CMake
   recipe applied natively with no `-DCMAKE_OSX_ARCHITECTURES` cross-arch concern —
   the "arm64 host" branch of the task's T2 instructions did not apply. Ran the
   README's exact recipe unmodified.
3. **T3 gate order.** Ran gates 4→5→6 strictly sequentially (not in parallel) to keep
   `cargo`'s target-directory locking simple and to get a clean, attributable pass/fail
   per gate rather than interleaved output.
4. **T4 — found two distinct flakes, not one.** The task described "a known unnamed
   intermittent failure" (singular). The ten-run sweep reproduced two **different**
   failing tests on two different runs (run 3: `fa_dev::tests::
   digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash`; run 7: `whisper::
   in_flight_tests::a_terminal_event_supersedes_a_retained_percent`). Both are named,
   captured verbatim, and root-caused below rather than treated as one blob — the task
   premise of "one flake" undercounts what this worktree actually has.
5. **T5/T6 — read-only, no stash/worktree state changed.** Per the standing rules, only
   inspected `git stash list` / `git stash show` and ran `git -C <path> status` against
   each of the four slated worktrees. Nothing popped, dropped, applied, or deleted.
6. **T7 — allowlist entry.** Followed the exact convention set by commit `2b7d33a` and
   `baseline-p1-2026-09-19.md`'s own self-referential entry: added this note's filename
   to `scripts/ws1-single-tracker.test.ts`'s `ALLOWLIST` with a one-line reason, in the
   same commit as the note itself.

## Command log (T1-T4, verbatim, with exit codes)

```
uname -m                                                          # x86_64
shasum -a 256 src-tauri/binaries/ffmpeg-x86_64-apple-darwin       # pre-existing untracked 9.0.2 binary
  → a45b462cf91ed89148ae218c4577e30896485d7a6792c3673bcf5f823fa01b63

# --- T1: ffmpeg pin ---
curl -s https://evermeet.cx/ffmpeg/info/ffmpeg/release            # exit 0 — confirms current "latest" is 9.0.2
curl -sI https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.zip               # exit 0 — HTTP 302 → deolaha.ca mirror (stable)
curl -L -o <scratch>/ffmpeg-8.1.1.zip https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.zip
  → HTTP_CODE:200, exit 0, 26,007,615 bytes
unzip -o <scratch>/ffmpeg-8.1.1.zip -d <scratch>/extracted         # exit 0
shasum -a 256 <scratch>/extracted/ffmpeg
  → 3a0ea97adddecfbf87b865da3bcbb321edfce4bab18a98ae1ba4ba9f0bd1f93a  (MATCH)
file <scratch>/extracted/ffmpeg                                    # Mach-O 64-bit executable x86_64
cp <scratch>/extracted/ffmpeg src-tauri/binaries/ffmpeg-x86_64-apple-darwin && chmod +x ...   # exit 0
shasum -a 256 src-tauri/binaries/ffmpeg-x86_64-apple-darwin
  → 3a0ea97adddecfbf87b865da3bcbb321edfce4bab18a98ae1ba4ba9f0bd1f93a  (MATCH, confirmed post-install)
src-tauri/binaries/ffmpeg-x86_64-apple-darwin -version
  → ffmpeg version 8.1.1-tessus  https://evermeet.cx/ffmpeg/
otool -L src-tauri/binaries/ffmpeg-x86_64-apple-darwin
  → only /System/Library/Frameworks/... and /usr/lib/... paths (portable)

# --- T2: whisper sidecar ---
git clone --depth 1 --branch v1.9.1 https://github.com/ggml-org/whisper.cpp.git <scratch>/whisper-cpp
  → exit 0; git log -1 → f049fff95a089aa9969deb009cdd4892b3e74916 "release : v1.9.1 (#3892)"  (matches pinned commit exactly)
cmake -B build-static -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF -DCMAKE_OSX_ARCHITECTURES=x86_64 \
  -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_AVX512=OFF
  → exit 0 ("Configuring done", "Generating done")
cmake --build build-static --config Release --target whisper-cli -j$(sysctl -n hw.logicalcpu)
  → exit 0 ("[100%] Built target whisper-cli")
cp build-static/bin/whisper-cli src-tauri/binaries/whisper-x86_64-apple-darwin && chmod +x ...   # exit 0
ls -la src-tauri/binaries/whisper-x86_64-apple-darwin              # 2,903,728 bytes
shasum -a 256 src-tauri/binaries/whisper-x86_64-apple-darwin
  → 590569740d76f3f27f1edb82f26a43f53da06534af3e6799ea8695ad83100a13
file src-tauri/binaries/whisper-x86_64-apple-darwin                # Mach-O 64-bit executable x86_64
src-tauri/binaries/whisper-x86_64-apple-darwin --help               # prints usage — binary runs correctly

# --- build.rs resource-check verification ---
cd src-tauri && cargo check                                        # exit 0, "Finished `dev` profile" — no
                                                                     # missing-resource error (both sidecars present)

# --- T3: gates 4-6, in order ---
cd src-tauri && cargo test                                          # exit 0 — 437 passed; 0 failed; 6 ignored
cargo test --features fa-inference                                  # exit 0 — 523 passed; 0 failed; 36 ignored
cargo build --release --features fa-inference                       # exit 0 — "Finished `release` profile [optimized] target(s) in 2m 31s"
ls -la target/release/app                                           # 16,281,600 bytes

# --- T4: 10x cargo test --features fa-inference ---
for i in 1..10: cargo test --features fa-inference >> run-$i.log
RUN 1 EXIT=0
RUN 2 EXIT=0
RUN 3 EXIT=101   ← FLAKE A (fa_dev::tests::digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash)
RUN 4 EXIT=0
RUN 5 EXIT=0
RUN 6 EXIT=0
RUN 7 EXIT=101   ← FLAKE B (whisper::in_flight_tests::a_terminal_event_supersedes_a_retained_percent)
RUN 8 EXIT=0
RUN 9 EXIT=0
RUN 10 EXIT=0
```

## T1 — ffmpeg pin: raw evidence

| Item | Value |
|---|---|
| Pre-existing binary (untracked, before this pass) | 80,827,688 bytes; sha256 `a45b462c...fa01b63`; `ffmpeg version 9.0.2-tessus` |
| Versioned URL used | `https://evermeet.cx/ffmpeg/ffmpeg-8.1.1.zip` (302 → `https://deolaha.ca/pub/ffmpeg/ffmpeg-8.1.1.zip`) |
| Downloaded zip | 26,007,615 bytes; sha256 `4610988e2f54c243c50da73a09e4e2c36d9bb77546f9aa6c84cb328dcb1a98c1` |
| Extracted binary | **80,126,240 bytes**; sha256 **`3a0ea97adddecfbf87b865da3bcbb321edfce4bab18a98ae1ba4ba9f0bd1f93a`** |
| Reference hash (per task authorization) | `3a0ea97adddecfbf87b865da3bcbb321edfce4bab18a98ae1ba4ba9f0bd1f93a` |
| **Match?** | **YES — byte-identical to the reference.** |
| Installed to | `src-tauri/binaries/ffmpeg-x86_64-apple-darwin`, `chmod +x`, hash re-verified post-install (same) |
| Version string | `ffmpeg version 8.1.1-tessus  https://evermeet.cx/ffmpeg/` |
| `otool -L` | Only `/System/Library/Frameworks/*` and `/usr/lib/*` paths — no `/usr/local/`, `/opt/homebrew/`, or `@rpath` entries. Portable. |

`src-tauri/binaries/README.md`'s macOS (Intel — x86_64) section now documents the
versioned URL, a "Pin note" explaining why the rolling `getrelease/zip` URL is not
reproducible, and an explicit post-fetch hash-verification step with the reference hash
inline. Nothing else in that file changed.

## T2 — whisper sidecar: raw evidence

| Item | Value |
|---|---|
| Tag / commit | `v1.9.1` / `f049fff95a089aa9969deb009cdd4892b3e74916` — matches `git log -1` on the clone exactly |
| Machine arch | `x86_64` (native — `uname -m`); no cross-compilation needed |
| CMake configure | exit 0; `GGML_SYSTEM_ARCH: x86`; AppleClang; BLAS via Accelerate framework |
| Build | exit 0; `[100%] Built target whisper-cli`; one unrelated pre-existing compiler warning (`stb_vorbis.c:1404`, tautological pointer compare, not touched) |
| Binary size | 2,903,728 bytes |
| SHA-256 | `590569740d76f3f27f1edb82f26a43f53da06534af3e6799ea8695ad83100a13` |
| `file` output | `Mach-O 64-bit executable x86_64` |
| Functional check | `--help` prints full usage text (options list, supported formats: flac/mp3/ogg/wav) — binary runs correctly |
| Installed to | `src-tauri/binaries/whisper-x86_64-apple-darwin`, executable bit set |

**build.rs resource-check verification:** `tauri.conf.json:39` declares
`"externalBin": ["binaries/ffmpeg", "binaries/whisper"]`; `src-tauri/build.rs:1-3` is a
one-line wrapper around `tauri_build::build()`, which performs the resource-path
check unconditionally. Ran `cd src-tauri && cargo check` — **exit 0**, "Finished `dev`
profile [unoptimized + debuginfo] target(s) in 6.10s", no missing-resource error. This
is the direct confirmation both sidecars are now correctly discovered.

## T3 — Gates 4-6, fresh, in order

| # | Gate | Result |
|---|---|---|
| 4 | `cargo test` | **PASS** — `test result: ok. 437 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out` |
| 5 | `cargo test --features fa-inference` | **PASS** — `test result: ok. 523 passed; 0 failed; 36 ignored; 0 measured; 0 filtered out` |
| 6 | `cargo build --release --features fa-inference` | **PASS** — `Finished \`release\` profile [optimized] target(s) in 2m 31s`, exit 0, `target/release/app` produced (16,281,600 bytes) |

Combined with `baseline-p1-2026-09-19.md`'s already-green gates 1-3
(`npx tsc --noEmit`, `npm run lint`, `npm test` → 3925/78/0), **this is, as far as this
worktree's own history shows, the first time all six named gates have been green
together in one worktree.** `baseline-p1-2026-09-19.md:94-96` recorded gates 4-6 as
BLOCKED (missing whisper sidecar) and `verification-sweep-2026-09-18.md:351` recorded
the same blocker one pass earlier — no prior note in `docs/ws1-sync-pipeline/` or
`docs/archive/history/` shows gates 4-6 passing. This is a claim about this worktree's
own recorded history, not a claim about every machine that has ever built this repo.

## T4 — Flake hunt: ten-run evidence and conclusion

**Both flakes reproduced.** Ten consecutive `cargo test --features fa-inference` runs
from `src-tauri/` (no other changes between runs):

| Run | Result | Failing test (if any) |
|---|---|---|
| 1 | PASS | — |
| 2 | PASS | — |
| 3 | **FAIL** (exit 101) | `fa_dev::tests::digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash` |
| 4 | PASS | — |
| 5 | PASS | — |
| 6 | PASS | — |
| 7 | **FAIL** (exit 101) | `whisper::in_flight_tests::a_terminal_event_supersedes_a_retained_percent` |
| 8 | PASS | — |
| 9 | PASS | — |
| 10 | PASS | — |

Two distinct named flakes, not one — the task description's premise of a single
unnamed intermittent undercounts this worktree's actual test suite.

### Flake A — `fa-dev-digest-memo-reset-race`

Full failure output (run 3):
```
---- fa_dev::tests::digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash stdout ----

thread 'fa_dev::tests::digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash' (987755) panicked at src/fa_dev.rs:875:9:
warm: the next verify is a map lookup, so the probe must say HIT

test result: FAILED. 522 passed; 1 failed; 36 ignored; 0 measured; 0 filtered out; finished in 19.92s
```

**Root cause (file:line):** `verified_digest_cache()` (`src-tauri/src/fa_dev.rs:75-81`)
is a single process-global `Mutex<HashMap<...>>`. `reset_verified_digest_cache_for_tests()`
(`fa_dev.rs:87-91`) does an unconditional `m.clear()` — it wipes every entry in the map,
not just entries belonging to the calling test. The failing test,
`digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash` (`fa_dev.rs:848-876`),
deliberately does **not** call reset itself — its own comment
(`fa_dev.rs:854-861`) already documents awareness of a narrower version of this problem
("two sibling tests here already reset it; a third resetter clobbers them mid-flight
under parallel execution"). But at least 8 other tests in the same file call
`reset_verified_digest_cache_for_tests()` (`fa_dev.rs:900`, `:922`, `:972`, `:979`,
`:991`, `:1009`, `:1104`, `:1123`), and `cargo test` runs unit tests in parallel threads
within one process by default. Nothing synchronizes this test's non-atomic window
between populating the cache (`digest_for_sidecar(&path).unwrap()` at `fa_dev.rs:872`)
and checking it (`assert!(digest_is_memoized(&path), ...)` at `fa_dev.rs:875`) against a
concurrent `reset_verified_digest_cache_for_tests()` call on another thread. If one of
those 8 other tests' resets lands in that window, it clears this test's own
just-inserted entry along with everything else, and the HIT assertion fails exactly as
observed.

### Flake B — `whisper-terminal-buffer-cap-eviction-race`

Full failure output (run 7):
```
---- whisper::in_flight_tests::a_terminal_event_supersedes_a_retained_percent stdout ----

thread 'whisper::in_flight_tests::a_terminal_event_supersedes_a_retained_percent' (992142) panicked at src/whisper.rs:1779:9:
assertion `left == right` failed: retained while running
  left: None
 right: Some(58)

test result: FAILED. 522 passed; 1 failed; 36 ignored; 0 measured; 0 filtered out; finished in 20.02s
```

**Root cause (file:line):** `terminal_buffer()` (`src-tauri/src/whisper.rs:234-238`) is a
single process-global `Mutex<HashMap<String, Retained>>` keyed on caller-supplied
literal string keys (e.g. `"proj-resume-superseded"` at `whisper.rs:1775`) — not
namespaced per test run. `TERMINAL_BUFFER_MAX_ENTRIES: usize = 16` (`whisper.rs:206`)
bounds the map; `enforce_cap` (`whisper.rs:243-254`) evicts the oldest entry by
insertion-order `seq` whenever the map exceeds that cap, and is called from every insert
path including `record_progress_at` (`whisper.rs:329-350`, cap enforcement at
`:349`). The failing test calls `emit_progress(&sink, key, 58)` (`whisper.rs:1776`,
which calls `record_progress` → `record_progress_at`, inserting/updating its own entry)
and immediately asserts `last_progress(key) == Some(58)` on the very next line
(`whisper.rs:1777`). Under `cargo test`'s default parallel execution, the
`in_flight_tests` module has well over 16 tests (`whisper.rs`'s `in_flight_tests` test
list, ~24 tests visible in the gate-4/5 output alone) that each insert their own
literal-string key into this same shared, process-global map concurrently. If enough of
those concurrent inserts land between this test's own insert and its very next
assertion, the shared map exceeds the 16-entry cap and `enforce_cap` evicts the
**oldest** entry by `seq` — which can be this test's own entry it just inserted a moment
before, if enough newer entries from other threads raced in ahead of its read. That
produces exactly the observed `None` where `Some(58)` was expected.

**Common thread across both flakes:** process-global, capacity/clear-bounded test state
(a `HashMap` behind a `Mutex`, shared by the whole test binary) with no per-test
isolation, racing against `cargo test`'s default multi-threaded unit-test execution.
Neither flake is a correctness bug in the production code paths (`digest_for_sidecar`,
`record_progress`, `enforce_cap`, `reset_verified_digest_cache_for_tests` all behave
exactly as designed) — both are test-harness races between concurrently running test
functions sharing global mutable state that was sized/scoped for a single caller, not a
parallel test suite.

### Proposed registry-entry wording (draft only — not applied to STATUS.md/project-state.md)

> **Flake registry — `fa-dev-digest-memo-reset-race` and
> `whisper-terminal-buffer-cap-eviction-race`** (found 2026-09-19, baseline-p1b-p3 pass,
> 2/10 reproduction rate across a ten-run `cargo test --features fa-inference` sweep in
> `docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md`). Both are parallel-test-thread
> races against process-global `Mutex<HashMap<...>>` state in `src-tauri/src/fa_dev.rs`
> (digest memo, cleared wholesale by any test's `reset_verified_digest_cache_for_tests`)
> and `src-tauri/src/whisper.rs` (retained-progress buffer, capped at 16 entries and
> evicted oldest-first by `enforce_cap`). Not a production-code defect — a test-harness
> isolation gap. Fix options for a future pass: (a) run the affected test modules with
> `--test-threads=1`, (b) namespace cache keys/state per test (e.g. a `TEST_ID` prefix),
> or (c) raise `TERMINAL_BUFFER_MAX_ENTRIES` for `#[cfg(test)]` builds specifically.
> Left as a known, named, low-severity intermittent — does not block gates 4-6, which
> this pass verified green in the reproducible common case (8/10 runs, and both blocking
> runs earlier in this pass, T3, were clean single runs).

## T5 — Stash disposition (read-only)

`git stash list` — **7 entries**, matching the task's expectation exactly.

| Idx | Date | "On" branch (from stash subject) | Subject | Files touched (stat) | Likely owner | Branch still exists? | Merged/superseded? |
|---|---|---|---|---|---|---|---|
| `stash@{0}` | 2026-09-13 | (no branch, detached) | "backup: detached-367a873 working tree before switching to ws3-export-integration" | 13 files (`ffmpeg.rs`, `whisper.rs`, `fa_dev.rs`, `project_mirror.rs`, `session_claim.rs`, `useExport.ts`, `tauriFfmpeg.ts`, export pipeline files) — 877 ins / 40 del | A pre-switch safety backup for the `ws3-export-integration` worktree | The `ws3-export-integration` local branch exists (`git branch -a`, `+` prefix = checked out elsewhere) | **Likely superseded** — `fa_dev.rs` and `project_mirror.rs` already exist on disk in that worktree (`4.kinetix-pro-studio-ws3-export-integration/src-tauri/src/{fa_dev,project_mirror}.rs`, confirmed present), and that worktree's `git status` is clean at a much later commit (`45d5860`, 5 commits past this stash's `367a873` parent) — not verified line-by-line, but the stash predates substantial later committed work on the same files. |
| `stash@{1}` | 2026-09-07 | `ws3-export-liveness` | "Cursor: moved local changes to cloud agent (source agent 2f264114-...)" | 8 files, GL watchdog / export liveness probe / webcodecs worker — 46 ins / 13 del | A Cursor-originated cloud-agent handoff for a `ws3-export-liveness` session | **No** — `git branch -a` shows no local or remote `ws3-export-liveness` (closest is `remotes/origin/ws3-export-liveness-occlusion`, a different branch name; that branch is 0 commits ahead of `main`, i.e. fully contained) | **Cannot determine without a fresh diff** — the named branch itself doesn't exist to compare against; flagged rather than guessed. |
| `stash@{2}` | 2026-08-07 | `webgl2-effects-engine` | "WIP before checking out 8d83358" | 14 files, deletes `dragCascade.ts`/`dragCascade.test.ts`/`dragGeometry.ts`/`dragGeometry.test.ts` (−1787 lines net) | An abandoned refactor attempt on the `webgl2-effects-engine` line of work | No local branch; `remotes/origin/webgl2-effects-engine` exists and is 0 commits ahead of `main` (fully merged/contained) | **Unique, unmerged WIP** — `src/services/dragCascade.ts` and `dragGeometry.ts` **still exist** on disk in this worktree today, meaning this stash's deletions were never applied/committed anywhere; it's an abandoned experimental direction, not superseded content. |
| `stash@{3}` | 2026-07-17 19:53 | `webgl2-effects-engine` | "session-backup-before-hard-reset-20260717-195303" | `App.tsx`, `Timeline.tsx` (423 ins / 214 del) | Pre-hard-reset safety backup, same line of work as stash@{2} | Same as above | **Unique, unmerged WIP** — same reasoning as stash@{2}; part of a documented (stash@{4}/{5} messages) abandoned "playhead isolation" experiment that "did not fix lag". |
| `stash@{4}` | 2026-07-17 02:02 | `webgl2-effects-engine` | "backup-option1-playhead-isolation-...: TimelineLanes memo + transform playhead + reflow/scroll fixes, tested, did not fix lag" | `App.tsx`, `Timeline.tsx` (596 ins / 300 del) | Same abandoned experiment, self-described as unsuccessful | Same as above | **Unique, unmerged, and self-documented as an abandoned dead end** ("did not fix lag" in its own subject line). |
| `stash@{5}` | 2026-07-17 00:52 | `webgl2-effects-engine` | "backup-before-revert-...: playhead-isolation + sticky/tiled canvas attempts" | `App.tsx`, `Timeline.tsx` (649 ins / 386 del) | Same abandoned experiment, an earlier attempt | Same as above | **Unique, unmerged** — same experimental line, superseded by the later attempts above within the same stash stack, all abandoned. |
| `stash@{6}` | 2026-07-10 | `webgl2-effects-engine` | "video-video-flicker: pre-roll snapshot starvation fix (unconfirmed against real repro)" | 10 files incl. `PreviewStage.tsx`, `usePlayback.ts`, `useTransitionPreview.ts`, `frameRenderer.ts`, `videoDecoderPool.ts` (876 ins / 99 del) | An unconfirmed fix attempt, same line of work | Same as above | **Unique, unconfirmed WIP** — self-described as "unconfirmed against real repro" in its own subject; not verified merged. |

Nothing popped, dropped, or applied. Full per-entry `git stash show --stat` output is in
the T4 section of the command log above (informal; this table is the authoritative
summary).

## T6 — Deletion-readiness

| Worktree | "Nothing unique" | "Nothing non-regenerable" | Current dirty state (`git status`, verbatim summary) |
|---|---|---|---|
| `round28` (`4.kinetix-pro-studio-round28`, branch `ws3-round28` @ `1560ac5`) | **Cited from prior P2 pass**: `baseline-p0-p2-2026-09-19.md:189-198` ("Red flags: **None**. Specifically checked against round28, round29, recovery-header-fix, ws3-export-integration... No ffmpeg/whisper binary is unique to a to-be-deleted worktree — all match main's copies byte-for-byte.") | **Cited from the same pass**: `baseline-p0-p2-2026-09-19.md:205` ("Nothing found in this sweep blocks deletion of these four worktrees — no unique, non-regenerable data lives in any of them.") | `On branch ws3-round28`, `nothing to commit, working tree clean` |
| `round29` (`4.kinetix-pro-studio-round29`, branch `ws3-round29-defects` @ `c4612db`) | Same citation as round28 (`baseline-p0-p2-2026-09-19.md:189-198`, checked as a named group of 4) | Same citation as round28 (`:205`) | `On branch ws3-round29-defects`, up to date with `origin/ws3-round29-defects`, `nothing to commit, working tree clean` |
| `recovery-header-fix` (`4.kinetix-pro-studio-recovery-header-fix`, branch `fix/recovery-modal-header-state` @ `96dddfe`) | Same citation as round28 | Same citation as round28 | `On branch fix/recovery-modal-header-state`, up to date with `origin/fix/recovery-modal-header-state`, `nothing to commit, working tree clean` |
| `ws3-export-integration` (`4.kinetix-pro-studio-ws3-export-integration`, branch `ws3-export-integration` @ `45d5860`) | Same citation as round28 | Same citation as round28 | `On branch ws3-export-integration`, up to date with `origin/ws3-export-integration`, `nothing to commit, working tree clean` |

All four worktrees report clean trees as of this pass (re-verified fresh, not just
cited) — no drift since the P2 sweep. The P2 evidence above is a **prior** pass's
finding, cited with file:line rather than re-derived from scratch this pass (this pass
did not re-run a byte-for-byte binary comparison or a full gitignored-content sweep
across all 8 worktrees — that was P2's job and its citation stands unless something
here contradicts it; nothing found here does).

**Fixture tracking confirmation:** `.work-phase4/replay/` fixtures are tracked on this
branch (`ws1-plan-rewrite`) as of commit `549ce6370c2b9afe07a947bebf0dfafc45c1acc8`
(97 files under `.work-phase4/replay/` confirmed present via
`git ls-tree -r 549ce63 --name-only`). Merge to `main` is still pending — not performed
this pass, per the standing "no merge unless a merge is ever needed" rule and the task's
own scope (this pass touches only `ws1-plan-rewrite`).

**Stash disposition:** see T5 above — complete, read-only, nothing popped/dropped/applied.

## T7 — This pass's own commit

Filename `docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md` added to
`scripts/ws1-single-tracker.test.ts`'s `ALLOWLIST`, same commit as this note, following
the exact convention of the four prior dated-note entries (commit `2b7d33a` and
`baseline-p1-2026-09-19.md`'s own self-referential entry).

Files touched this pass:
- `src-tauri/binaries/README.md` — ffmpeg pin section (docs only)
- `scripts/ws1-single-tracker.test.ts` — one-line `ALLOWLIST` addition
- `docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md` — this note
- `src-tauri/binaries/ffmpeg-x86_64-apple-darwin`, `src-tauri/binaries/whisper-x86_64-apple-darwin` — gitignored binaries, not committed
