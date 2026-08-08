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

---

## Stages 2-6 — Outcomes

### Stage 2 — Drawer slip-bar overflow (fixed)

Root cause: `BottomDrawer.tsx`'s `widthPct` was computed from
`sourceDuration ?? 60` with no clamp. A video segment whose `sourceDuration`
was never probed (undefined) silently used a fabricated 60s denominator — any
such segment with a real duration over 60s produced `widthPct > 100`,
overflowing the Clip Trim track container.

Fix, both halves: (1) extracted the width/left math into a pure, tested
`computeSlipBarGeometry` (`src/services/slipBarGeometry.ts`) that clamps
`widthPct`/`leftPct` to `[0, 100]` unconditionally; (2) removed the `?? 60`
fallback entirely — an unknown/zero/negative `sourceDuration` now reports
`hasKnownSourceDuration: false` and `BottomDrawer.tsx` hides the Clip Trim bar
rather than rendering a proportion against a fabricated number. Matches the
existing convention at `App.tsx:2237`, which already declines to guess when
`sourceDuration` is missing. 8 new tests, all passing.

Related, NOT fixed (out of scope, same bug class, no confirmed repro at these
sites): `Timeline.tsx:654` (`(s.sourceDuration ?? 60) - s.duration`, feeds
`maxTrim` — `Math.max(0, ...)` prevents a negative value but still computes
against a fabricated source length) and `App.tsx:4949`
(`editingSegment.sourceDuration ?? 60`). Flagged for the final bug list.

### Stage 3 — Apply Sync double history entry (fixed)

Root cause confirmed: `handleApplySyncFromFiles` pushed history twice —
the main commit (`setProject`, ~line 2917) and an unrelated, always-keyless
second `setProject` (~line 3005) for the post-hoc boundary-quality log
append, which runs after the async `buildVoiceoverWaveform` await. A keyless
`setProject` always pushes (`historyCoalesce.ts`'s discrete-write rule), so
every Apply Sync cost two undo presses, the first a visual no-op on the
waveform-unavailable branch (which always produces exactly one log entry and
nothing else).

Fix: routed the second write through `setProjectSilent` instead —
it is a continuation of the same edit that already has its entry, not a
second user-authored one, matching `setProjectSilent`'s own documented
"machine-driven write" category. No log entries are lost. 4 new tests
(`applySyncHistory.test.ts`) exercise the real `history.ts`/
`historyCoalesce.ts` modules through a harness that mirrors `App.tsx`'s
`setProject`/`setProjectSilent` wrappers verbatim, since App.tsx itself has
no test harness.

### Stage 4 — historyAnchor coverage hole (closed)

Confirmed [MEASURED]: grep for `historyAnchor` across every test file
returned zero hits before this stage. Extracted `Timeline.tsx`'s undo/redo
anchor effect's decision (segment lookup, unresolvable-anchor degradation,
scroll-vs-flash) into a pure `resolveHistoryAnchorAction`
(`timelineLayout.ts`), behavior-preserving. 5 new tests in a new PART 4 of
`historyStage3.test.ts`: unresolvable anchor degrades to no-scroll without
throwing, a resolvable off-screen anchor scrolls, an already-visible anchor
resolves without scrolling (flash fires either way), and the `canScroll` gate
(container/`didRestoreRef` not ready) still resolves the segment without a
scroll target. No behavior change found or made.

### Stage 5 — dead-code removal (done, 3 grouped commits)

1. Unused deps: `autoprefixer` (JS devDependency), `serde_json` (Rust). Both
   confirmed zero references; `cargo check`/`cargo clippy`/`tsc`/full suite
   clean after removal.
2. Unused exports: `closeGesture` (historyCoalesce.ts), 
   `_resetWaveformMirrorForTests` (waveformStore.ts),
   `__resetWebCodecsSupportCacheForTests` (webcodecsSupport.ts),
   `AudioExtension` (audioFormats.ts). All confirmed zero references anywhere,
   including within their own defining file.
3. Instrumentation: removed the ungated `console.log('[dashboard] loaded
   metas:', data)` in `ProjectDashboard.tsx` (fired on every app launch,
   admitted as a "debug log" in its own introducing commit message).

Left untouched, AMBIGUOUS, needs an owner ruling: `getAsset`/`clearAllAssets`
(assetStore.ts), `easeLinear` (canvasAnimations.ts), `renamePreset`
(presetService.ts), `loadMostRecentMeta` (projectStore.ts),
`syncInstrument.ts` (13 call sites, self-described as removable after an
audit whose completion cannot be confirmed from the repo alone).

Zero commented-out code blocks and zero orphaned fixtures found — no commit
needed for either category.

### Stage 6 — App.tsx extraction (partial, honest)

App.tsx measured at 5134 lines before this stage. Full survey result: the
undo/redo wiring's pure logic was ALREADY extracted across Phases 1-3
(`history.ts`, `historyCoalesce.ts`, `historyLockPolicy.ts`) plus this run's
own Stage 4 (`resolveHistoryAnchorAction`). What remains in App.tsx —
`setProject`/`setProjectSilent` (tied to `liveProjectRef`/`setProjectRaw` by
explicit design constraint), `handleUndo`/`handleRedo`/`blockedByLock` (thin
orchestration: ref reads, state setters, an inline toast — no test harness to
characterize against before moving) — does not cleanly extract further
without either violating the "don't move the useState wiring" constraint or
moving untested orchestration logic on faith.

One piece DID extract cleanly: `applyRestoredState`'s post-restore selection/
playhead repair was pure computation wrapped in setState boilerplate. Pulled
into `historyRestore.ts`, characterized first (15 tests, written before the
call sites were touched — `dragSession.test.ts` precedent), then wired in
with the exact same functional-updater call sites preserved. Net effect on
App.tsx: **+3 lines** (14 insertions, 11 deletions) — the import block and a
preserved doc comment outweigh the inlined logic removed. Final size: 5137
lines. Golden replay byte-identical after the move. Reported honestly per the
brief's own instruction: "a partial honest extraction beats a forced one."

---

## Second run — App.tsx debt, second attempt

### Stage 0 — jsdom/testing-library claim, corrected

[MEASURED] `jsdom` **is** a devDependency (`^30.0.1`) and is already used —
five files opt into it per-file via a `// @vitest-environment jsdom` docblock
(the default environment is `node`), one of which is `dragSessionHarness.ts`
itself. `@testing-library/react` is genuinely absent from `package.json`. The
prior run's "no jsdom/testing-library in this repo" blocker was **overstated**
— it conflated the two. jsdom is available and already proven out by the
`dragSessionHarness.ts` pattern; the correct blocker (if any) was only ever
the absence of testing-library, and `dragSessionHarness.ts` shows that gap
doesn't actually block a harness built directly against real DOM events.

### Stage 1 — the two remaining `?? 60` sites

`Timeline.tsx:654`'s `(s.sourceDuration ?? 60) - s.duration` maxTrim bound is
a **genuine data-correctness bug, not cosmetic** — [MEASURED] via direct
computation of the formula: for a segment with `duration > 60` and an unknown
`sourceDuration`, `maxTrim` collapses to `0`, so any drag (regardless of
direction) clamps a pre-existing valid `trimStart` down to `0`, silently
discarding it; for a segment with `duration < 60`, the same fabricated bound
permits committing a `trimStart` tens of seconds past the real (shorter,
unprobed) source length. `App.tsx`'s `editingSegment.sourceDuration ?? 60`
site has the same two failure modes via its range-slider `max`.

**Additional finding, not anticipated by the brief:** both sites sit behind
state that is never set to a live value anywhere in the codebase.
`isAdjustingTrim`/`trimmingSegmentId` (App.tsx `useState`, passed into
`Timeline.tsx` as `onSetAdjustingTrim`/`onSetTrimmingSegment`) have zero call
sites setting them to anything but their initial `false`/`null` — [MEASURED]
`grep -rn "setTrimmingSegmentId(\|setIsAdjustingTrim("` across `src/` matches
only the two `useState` declarations. Likewise `editingSegment` (which gates
the entire `SegmentEditorModal`-shaped block containing the second site) is
only ever set to `null` — [MEASURED] no call site anywhere calls
`setEditingSegment` with an actual segment. Both trim-drag code paths are
therefore currently **unreachable in the shipped app** — real today, but
dormant. Fixed anyway (both are real bugs in the formula itself, and
`CLAUDE.md`'s own Target Structure section names `SegmentEditorModal.tsx` as
a planned extraction target, implying this block is intended to stay/return,
not vestigial cruft to delete).

Fix: widened `slipBarGeometry.ts` with `maxTrimStartSec` (0 whenever
`hasKnownSourceDuration` is false, mirroring `widthPct`/`leftPct`'s existing
"decline to guess" rule) and reused `computeSlipBarGeometry` at both sites —
`Timeline.tsx` now bails out before attaching drag listeners when the source
duration is unknown; `App.tsx` hides the trim controls entirely, matching
`BottomDrawer.tsx`'s own precedent for this exact case. 4 new tests in
`slipBarGeometry.test.ts`. Commit `46d2304`.

### Stage 2 — owner rulings applied

Ruling 1 (five dead-but-symmetric exports, delete three, keep the pair if it
is one): kept `getAsset`/`clearAllAssets` (`assetStore.ts`) — the
`CLAUDE.md`-documented full-CRUD pair. Deleted `easeLinear`
(`canvasAnimations.ts`), `renamePreset` (`presetService.ts`),
`loadMostRecentMeta` (`projectStore.ts`) — each confirmed zero references
anywhere, no dedicated test file for any of the three modules to update.

Ruling 2 (keep `syncInstrument.ts`, fix the stale header): header claimed
"two call sites" — [MEASURED] actually 14 (11 in `App.tsx`, 3 in
`waveformPipeline.ts`; note the *first* cleanup run's own Stage H summary
sentence said "13" while its own breakdown listed 11+3=14 — that summary
figure was itself arithmetically wrong, corrected here against a fresh
count). Header now states the real count and an explicit revisit condition
(delete the file and all 14 call sites together, once the owner confirms the
Apply-Sync freeze audit is closed) so it reads as deliberately kept. Commit
`5f2e385`.

### Stage 3 — App.tsx history-cluster extraction, second attempt

Target: `setProject`/`setProjectSilent`, `applyRestoredState`,
`blockedByLock`, `handleUndo`/`handleRedo` — the cluster the first run
declined to move for lack of a characterization harness (its own Stage 6:
"does not cleanly extract further without... moving untested orchestration
logic on faith").

Unlike `dragSession.ts`, none of this cluster reaches the real DOM/`window` —
it is pure ref/state-setter orchestration. So the harness
(`historySessionHarness.ts`) does **not** need jsdom, unlike
`dragSessionHarness.ts` — it runs under the repo's default `node`
environment. jsdom being available (Stage 0) is what makes a DOM-touching
harness like `dragSessionHarness.ts` possible in general; it doesn't mean
every harness needs one.

Order followed: (1) `historySession.test.ts` PART 1 hand-transcribes the
pre-extraction `App.tsx` closures verbatim (cited by line number against
commit `5f2e385`) as plain in-memory fakes — 15 tests pinning the no-op-write
skip, discrete-vs-coalesced pushes, the `MAX_HISTORY_STATES` depth-cap
eviction, the `isResizingRef` drag guard, a lock-blocked undo leaving history
untouched (entry not consumed — undo again after unlocking works), redo
being unreachable after a new edit discards the future branch, anchor
propagation, and the DEV gapless-violation `console.error`. (2)
`historySession.ts` extracted as a byte-identical move — `App.tsx` keeps
every `useState`/`useRef` declaration, this module receives them only
through explicit deps objects, same `DragSessionDeps` pattern. (3)
`historySession.test.ts` PART 2 re-runs the identical scenario tables against
the real functions (via `HistorySessionHarness`) — byte-identical. (4)
`App.tsx`'s five `useCallback` bodies became thin call-ins; five now-dead
imports (`findLockConflict`, `lockConflictMessage`, `coalesceWrite`,
`pushEntry`, `replaceEntry`, `undo as undoHistory`, `redo as redoHistory`,
and the whole `historyRestore.ts` import block) were removed since nothing in
`App.tsx` calls them anymore. No behavior found to be wrong during
characterization — the "awkward parts" (lock-block-leaves-history-untouched,
drag guard, coalescing) all pinned exactly as documented in their own
existing doc comments.

31 new tests, `tsc` clean, full suite green, golden replay 3/3 byte-identical
both before this stage started and after. `App.tsx`: 5154 → 5070 lines (-84,
this stage only; 30 insertions/114 deletions). New files: `historySession.ts`
(228 lines, the extracted logic), `historySessionHarness.ts` (238 lines, the
harness), `historySession.test.ts` (503 lines, both PARTs).
