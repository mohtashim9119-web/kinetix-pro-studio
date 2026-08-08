# Cleanup Run Findings — 2026-08-08

Scratch file for the cleanup run. Will be folded into `docs/history.md` and deleted
next session. Not part of the documentation freeze.

Tooling used: `knip` (installed as a temporary devDependency for this run — see
Stage 5 note on whether to keep it), `cargo clippy --all-targets`, targeted `grep`
census, and manual cross-file usage verification (knip's cross-file-only view
produces false positives for symbols used within their own file, so every knip
finding below was hand-verified against actual occurrence counts before
classification).

---

## Stage 1 Census

### A. Unused files (knip) — build artifacts, false positive

`src-tauri/target/**` (33 files) — [MEASURED] gitignored build output
(`src-tauri/.gitignore:3:/target/`), not source. Knip has no config excluding
non-source paths from its scan. **Not a real finding** — no knip.json exists in
this repo; adding one is out of scope for this run (docs/tooling-config freeze
adjacent). **KEEP / N/A.**

### B. `src/dev/*` spike & fixture-builder files (12 files) — KEEP

`buildCheckpoint2Fixture.ts`, `buildPhase5Fixture.ts`, `buildScaleFixture.ts`,
`webcodecsAuditSpike/main.ts`, `webcodecsB0Repro/main.ts`, `webcodecsMuxProof/main.ts`,
`webcodecsSpike/main.ts`, `webcodecsStep2Spike/*.ts` (5 files),
`webcodecsWorkerSpike/{main,worker}.ts`, `webglFeasibilitySpike/main.ts`.

[ASSERTED] Not imported by the app bundle (no entry point references them), which
is why knip flags them as unused files — they are standalone scripts invoked
manually during past investigations. **KEEP**, not DELETE: `CLAUDE.md`'s own
`videoDemuxer.ts` file-map entry cites `src/dev/webcodecsSpike/main.ts` by name as
the source of two real bugs still fixed in production code today ("Carries forward
two real bugs found and fixed in the Phase 0 spike"). Treating one spike file as
load-bearing historical record while deleting its siblings from the same
investigation arc would be inconsistent; the whole cluster is kept as the
audit trail for the WebCodecs export path. Zero runtime cost (never bundled).

### C. Unused devDependency — `autoprefixer` — **DELETE**

[MEASURED] No `postcss.config.*` file exists anywhere in the repo, and grep for
`autoprefixer` outside `package.json`/`package-lock.json` returns nothing. Tailwind
v4's `@tailwindcss/vite` plugin (already the sole CSS pipeline, per `vite.config.ts`)
handles vendor prefixing internally — there is no separate PostCSS stage for
autoprefixer to plug into. Confirmed genuinely unused, not just cross-file-invisible.

### D. Unused exports (knip) — mostly false positives after verification

Knip's "unused export" list conflates two different things: (1) truly dead code
(zero references anywhere, including the defining file), and (2) exported but only
ever used *within* the same file (a real usage, just an unnecessary `export`
keyword — cosmetic, not dead). [MEASURED] via per-symbol occurrence counts.

**Category D1 — used only within own file (cosmetic over-export, not dead) — KEEP,
not worth a commit:**
`applyTransitionBlend`, `BRIGHTNESS_MAX_OFFSET`, `CONTRAST_GAIN_MAX`,
`SATURATION_MAX_SCALE`, `MAX_LOOK_PRESETS`, `searchPexels`, `searchPixabay`,
`searchCoverr`, `isFuzzyMatch`, `syncInstrOn`, `bytesToBase64` (tauriFfmpeg.ts),
`foldUnicodeHygiene`, `NUMBER_WORDS`, `DROP_REASONS`, `WINDOW_AHEAD_SEC`,
`MAX_CACHED_SESSIONS`, `MAX_TOTAL_BUFFERED_FRAMES`, `VERTICAL_PADDING_PX`,
`AMP_SHAPE_EXP`, `normalizeSceneDoc`, `countAnnexbFrames` — all confirmed called
2+ times within their defining file. Also applies to all 15 "unused exported
types" knip listed (`SegmentSkipReason`, `StagedFile`, `WaveformTile`,
`UseExportState`, `AlignFromCacheResult`, `AudioExtension`* excepted below,
`DragScheduler`, `DragOutcomeKind`, `ExportErrorKind`, `TransitionBlendParams`,
`ZoomAnimationSlug`, `CoalesceDecision`, `PartitionViolationKind`,
`TokenAlignmentOp`, `ZoomDirection`) — each used locally, exported unnecessarily.
Removing `export` from ~15 files for a pure style nit, each requiring a full
gate re-run, is not worth the risk/reward this run. Left as-is.

**Category D2 — genuinely zero references anywhere, but part of a documented/
symmetric API surface — AMBIGUOUS (needs a ruling):**
- `getAsset`, `clearAllAssets` (`src/services/assetStore.ts`) — `CLAUDE.md`
  documents this module's public surface as "putAsset, getAsset, getAllAssets,
  deleteAsset, clearAllAssets" (full CRUD). Deleting half the symmetry contradicts
  the documented architecture even though nothing calls them today.
- `easeLinear` (`src/services/canvasAnimations.ts`) — one member of an explicit
  easing-function toolkit (`easeOutQuad`, `easeInOutSine`, `springApprox` are all
  used); trivial one-liner, low deletion value.
- `renamePreset` (`src/services/presetService.ts`) — symmetric with the used
  `deletePreset`/`savePreset` in the same "legacy" (per `CLAUDE.md`) per-category
  preset CRUD module. No UI wires a rename action to it — looks like an unwired
  capability, not proven-dead code. Removing it is a product decision.
- `loadMostRecentMeta` (`src/services/projectStore.ts`) — possible dormant
  "resume last project" capability; `ProjectDashboard.tsx` exists as the actual
  entry point today, so this may be vestigial, but could also be an intentional
  unwired affordance.

**Category D3 — genuinely dead, no product/architecture reason to keep — DELETE:**
- `closeGesture` (`src/services/historyCoalesce.ts:145`) — trivial
  `() => null` one-liner, zero callers; callers that need "gesture is closed"
  already just pass `null` directly. Not named in `CLAUDE.md`'s description of
  this file's public surface.
- `_resetWaveformMirrorForTests` (`src/services/waveformStore.ts:107`) — test
  helper; [MEASURED] `waveformStore.test.ts` exists but does not call it — its own
  comment says tests use per-test key isolation instead of a reset call. Orphaned.
- `__resetWebCodecsSupportCacheForTests` (`src/services/webcodecsSupport.ts:27`) —
  [MEASURED] no test file exists for `webcodecsSupport.ts` at all. Orphaned.
- `AudioExtension` (`src/services/audioFormats.ts:27`) — derived type alias, zero
  references anywhere including its own file beyond the declaration line.

### E. Rust — `serde_json` unused direct dependency — **DELETE**

[MEASURED] `grep -rl serde_json src-tauri/src/*.rs` (all 4 source files) → zero
matches. `cargo clippy --all-targets` is silent on this because Cargo does not
lint unused *declared* dependencies by default (would need `cargo-udeps` /
`cargo-machete`, neither installed). Likely a leftover from an earlier direct-JSON
approach before `#[tauri::command]` + `Serialize` derives took over marshalling.
Tauri itself depends on `serde_json` transitively, so removing our explicit
top-level declaration should not affect the build — verify with `cargo check`
after removal (Stage 5).

### F. `cargo clippy --all-targets` — clean

[MEASURED] Zero warnings on a full run (`Finished` with no diagnostic lines).

### G. `devtools` Cargo feature — confirmed wired, not dead

[MEASURED] `Cargo.toml`'s `devtools = ["tauri/devtools"]` is consumed by
`lib.rs`'s `toggle_devtools` via `#[cfg(any(debug_assertions, feature =
"devtools"))]`, matching the file's own extensive doc comment. Real, load-bearing.
**KEEP, no action.**

### H. Leftover instrumentation

- **`src/services/syncInstrument.ts` — AMBIGUOUS, needs an owner ruling.** File's
  own header: *"TEMP diagnostic instrumentation (Apply-Sync freeze audit)... zero
  effect on normal runs... Remove this file (and its two call sites) after the
  audit."* [MEASURED] The header is now stale on its own terms — there are 13 call
  sites across `App.tsx` (11) and `waveformPipeline.ts` (3), not 2, including marks
  bracketing the exact Apply Sync commit path touched in Stage 3
  (`applySync:entry`, `setProject:called`). Gated behind
  `globalThis.__SYNC_INSTRUMENT__` (dormant/false by default) — genuinely zero
  runtime cost when off, so it is not urgent, but I cannot confirm from the repo
  alone whether the "freeze audit" it names is actually closed. Left in place this
  run; flagging for an explicit ruling rather than guessing. Not blocking — Stage
  3's fix does not need to touch these call sites, and left them untouched.
- **`console.log('[dashboard] loaded metas:', data)`
  (`src/components/ProjectDashboard.tsx:29`) — DELETE.** [MEASURED] Not
  DEV-gated (`import.meta.env.DEV`), not documented anywhere in `CLAUDE.md`, and
  its own introducing commit message admits what it is: `1dba3a7 "fix: show
  dashboard on launch + debug log for metas (priority-2)"`. Fires on every app
  launch for every user. Genuine leftover debug print.
- `[calibrate]` / `[inspector]` logs in `App.tsx` — [MEASURED] gated behind
  `if (!import.meta.env.DEV) return;` at the top of their owning effects (lines
  3042/3088/3209), matching `CLAUDE.md`'s documented `window.__calibrateBoundaryQuality`
  / `window.__transcriptInspector` dev-only harnesses. Dead-code-eliminated in
  production builds. **KEEP.**
- `[align-recover]` log in `whisperService.ts:1202` — explicitly documented in
  `CLAUDE.md` as "DEV-gated, permanent". **KEEP.**
- `[align-instr]` logs in `whisperService.ts` (365, 1383) — gated behind a
  `_instrOn()` runtime flag (same dormant-by-default convention as
  `syncInstrument.ts`), carries `eslint-disable-next-line no-console`, i.e.
  deliberate. **KEEP** (same category as syncInstrument.ts — dormant debug
  instrumentation, not urgent, not touched this run).
- `[export] Using sequential fallback...` / `Using pipelined worker encode...`
  (`segmentEncoder.ts:651,660,663`) — ungated, but low-frequency (once per export,
  not per-frame) and operationally meaningful for diagnosing platform-dependent
  export path selection on a feature with documented cross-platform variance.
  **KEEP** — judged a deliberate operational log, not debug cruft, though not
  explicitly documented as such; lower confidence than the other KEEPs above.
- `dbg!`/`eprintln!` in Rust: **zero found.** Clean.
- The ⌘+Tab investigation's own DEV logging (dragSession.ts's `handleBlur`,
  referenced in `CLAUDE.md`'s DO NOT DO list as "[MEASURED 2026-08-08] ... see
  dragSession.ts's handleBlur for the captured log") — [MEASURED] no `console.*`
  call remains in `handleBlur` today; only the doc reference to the finding
  survives. Already clean, nothing to remove.

### I. TODO/FIXME/HACK/XXX census

Two hits, both the same item: `src/effectsOptions.ts:61`
`TODO(filters-tab): 'color-grade', 'gaussian-blur', 'duotone', 'sepia' and
'invert' are FILTERS, not animations...` — explicitly documents current
architecture and says **"do not delete them"**. Not stale, not a bug marker — a
real forward-looking product-scope note (a dedicated Filters tab is unbuilt).
Referenced again (by cross-reference, not duplication) in
`glCompositable.ts:59`. **KEEP — real outstanding work item, listed in the final
bug list, not resolved.**

No `FIXME`/`HACK`/`XXX` markers exist anywhere in `src/` or `src-tauri/src/`.

### J. Skipped / expected-fail test census

Exactly one: `src/services/dragSessionHarness.test.ts:818`,
`it.skip('WONTFIX (owner ruling 2026-08-08) — an early-bail drag start leaves
resizingId/the resizing class stuck...')`. This is the stuck-`resizingId` pin the
run brief explicitly protects. **KEEP, no action** — matches instructions exactly.
No other `it.skip`/`describe.skip`/`it.fails`/`it.todo`/`test.skip`/`test.todo`
anywhere in the suite.

### K. Orphaned fixtures / `scripts/` / `docs/measurements/`

- `docs/measurements/*` — protected per instructions, not touched, not audited
  for orphans this run.
- `scripts/*.py` (measurement/investigation scripts: `measure-*.py`,
  `phase3-*.py`, `phase4-*.py`) — [ASSERTED] standalone tools, not imported by
  any TS/test file (expected — they're Python). They are the methodology/
  reproducibility record behind the protected `docs/measurements/*.csv` files.
  **KEEP** — treated as paired with the protected data, not as dead weight.
- `scripts/*.test.ts` (4 files: `no-tmp-artifacts.test.ts`,
  `phase4-handoff-replay-sync.test.ts` [the golden-replay harness],
  `phase4-step-aa-unlock-repro.test.ts`, `phase4-step-w-k13-repro.test.ts`) —
  [MEASURED] confirmed part of the live vitest suite (`npx vitest run scripts/`
  → 4 files, 12 tests, all passing). Not orphaned — active regression coverage.
- `scripts/__pycache__/` — [MEASURED] gitignored (`.gitignore:24`), not tracked
  by git. Zero repo-cleanliness cost; not worth a commit to delete a local cache
  dir that's already invisible to the repo.

### L. Commented-out code blocks over ~5 lines

Ran a heuristic scanner (code-like punctuation inside `//` comment runs) across
all of `src/`. **Zero real hits** — all 11 candidate blocks manually inspected
were prose documentation comments (design rationale, calibration notes, bug
history) that happened to contain parentheses/equals signs/semicolons in
running text, not actual disabled code. No commented-out code blocks exist in
this codebase.

---

## Stage 1 Summary by Category

| Category | Count | Disposition |
|---|---|---|
| Build-artifact false positives (knip) | 33 files | N/A — not source |
| `src/dev/*` spike files | 12 files | KEEP — cited by CLAUDE.md as historical record |
| Unused devDependency | 1 (`autoprefixer`) | **DELETE** |
| Unused exports, used-locally-only (cosmetic) | 29 fns/consts + 15 types | KEEP — not dead, not worth the churn |
| Unused exports, genuinely dead, documented-symmetry | 4 (`getAsset`, `clearAllAssets`, `easeLinear`, `renamePreset`) + 1 (`loadMostRecentMeta`) | AMBIGUOUS — needs ruling |
| Unused exports, genuinely dead, no reason to keep | 4 (`closeGesture`, `_resetWaveformMirrorForTests`, `__resetWebCodecsSupportCacheForTests`, `AudioExtension`) | **DELETE** |
| Unused Rust dependency | 1 (`serde_json`) | **DELETE** |
| Clippy warnings | 0 | Clean |
| `devtools` feature wiring | — | Confirmed wired, no action |
| Leftover instrumentation, dormant/gated | `syncInstrument.ts` (13 call sites), `[align-instr]` | AMBIGUOUS — needs ruling on audit status |
| Leftover instrumentation, ungated debug print | 1 (`ProjectDashboard.tsx:29`) | **DELETE** |
| TODO/FIXME/HACK/XXX | 2 hits, 1 item | KEEP — real scope note |
| Skipped tests | 1 (`dragSessionHarness.test.ts`) | KEEP — protected WONTFIX pin |
| Orphaned fixtures/scripts | 0 | None found — all live or protected |
| Commented-out code blocks | 0 | None found |

**Net Stage 5 deletion scope:** 1 devDependency (`autoprefixer`), 4 dead exports
(`closeGesture`, `_resetWaveformMirrorForTests`,
`__resetWebCodecsSupportCacheForTests`, `AudioExtension`), 1 Rust dependency
(`serde_json`), 1 ungated debug `console.log`. Everything else in this census is
either a proven false positive, protected by explicit instruction, or flagged
AMBIGUOUS and left untouched pending a ruling.
