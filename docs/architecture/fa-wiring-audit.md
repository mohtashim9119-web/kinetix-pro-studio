# Forced alignment wiring — ground-truth audit

**Date:** 2026-09-17  
**Worktree:** `../4.kinetix-pro-studio-cloud-asr`  
**Branch:** `ws-cloud-asr-plan`  
**Source SHA:** `ebec58aa920e3654bc873bbfda80d5c6b0e47113` (local and `origin/ws-cloud-asr-plan` matched at audit start)

Read-only code inspection except for this document and sibling `docs/` rulings. Parallel session owns Rust/TS fixes.

---

## STEP 1 — Build matrix

| Build variant | Literal command (file:line) | `--features fa-inference` / `-f fa-inference` | FA compiled in Rust binary |
|---|---|---|---|
| Vite-only dev | `vite --port=3000 --host=0.0.0.0` — `package.json:7` (`npm run dev`) | No (no Tauri build) | N/A — no `fa_align` IPC |
| Tauri dev (default) | `tauri dev` — `package.json:16` | No | **No** — `fa_onnx` module omitted (`lib.rs:16-17`) |
| Tauri dev (FA) | `tauri dev -f fa-inference` — `package.json:17` | Yes (`-f fa-inference`) | **Yes** |
| Tauri production (local default) | `tauri build` — `package.json:18` | No (unless caller adds `-f`) | **No** |
| Tauri production (CI installers) | `npm run tauri:build -- --target ${{ matrix.target }} -f fa-inference` — `.github/workflows/build.yml:424` | Yes | **Yes** |
| Frontend before bundle | `npm run build` → `vite build` — `tauri.conf.json:10` `beforeBuildCommand` | No (frontend only) | N/A |
| Raw Cargo release (no Tauri CLI) | `cargo build --release` from `src-tauri/` (not invoked by `tauri.conf.json`; Tauri drives its own cargo invocation) | Only if `-f fa-inference` passed on that cargo line | Default **No** |

No other FA-related npm scripts exist in `package.json` (only `tauri:dev`, `tauri:dev:fa`, `tauri:build`).

### `src-tauri/Cargo.toml` `[features]` (verbatim)

```93:110:src-tauri/Cargo.toml
[features]
# Opt-in devtools in a RELEASE build. Tauri's own
# `open_devtools`/`close_devtools`/`is_devtools_open` are gated on
# `any(debug_assertions, feature = "devtools")` — of *tauri's* feature — so
# `lib.rs`'s `toggle_devtools` needs a matching feature on THIS crate for its own
# cfg to mean anything. Without this declaration the cfg is always false in
# release and cargo warns about an unexpected feature name.
#
# Not enabled by default: a shipped build should not carry the inspector unless
# someone asks for it (`cargo build --features devtools`). Debug builds get
# devtools regardless, via `debug_assertions`.
devtools = ["tauri/devtools"]

# Real ONNX forward pass for forced alignment (WS1 Task 5, Slice D2). OFF by
# default — with this feature disabled, `ort` is entirely absent from the
# build graph and the crate compiles/behaves exactly as it did before this
# slice. See fa.rs / fa_onnx.rs for the feature-gated inference code.
fa-inference = ["dep:ort"]
```

There is **no** `default = ["fa-inference"]` (or any `default = [...]` enabling FA). `fa-inference` is opt-in per cargo/tauri invocation.

### Installer verdict

- **Official Windows/macOS installers produced by `.github/workflows/build.yml`** include forced-alignment inference code (`-f fa-inference` at `build.yml:424`), with onnxruntime provision steps at `build.yml:124` (macOS) and `build.yml:216` (Windows).
- **A release bundle built locally with plain `npm run tauri:build` (no `-f`)** does **not** compile FA; `fa_align` returns `NotImplemented` (`fa.rs:1139-1161`).
- **Operator report** (`npm run tauri:dev:fa` succeeds; desktop installer tests FA) is consistent with evidence: dev uses `-f fa-inference`; CI installers use the same flag. Prior docs that claim “every shipped build” lacks FA are **stale** relative to CI; they remain accurate only for the non-`-f` local packaging path.

---

## STEP 2 — Runtime gate chain

Ordered gates from UI to native inference (Apply Sync path).

| # | Gate | Location | Pass condition | User-visible failure |
|---|------|----------|----------------|----------------------|
| G1 | Tauri IPC present | `faGate.ts:101-104` `isFaCapable()` | `isTauri()` true | Project Settings FA toggle disabled; copy at `ProjectSettingsModal.tsx:258+` (browser / no desktop runtime) |
| G2 | Per-project FA switch (read-time) | `faGate.ts:122-127` `isFaEnabledForProject` | `faHighPrecisionSync === true`, OR `undefined`/absent → `FA_PROJECT_DEFAULT_ON` (`faGate.ts:91`, currently **`false`**) | Sync continues on Whisper; `buildFaGateClosedEntry` when capable but gate closed (`App.tsx:3952-3958`) |
| G3 | Combined gate | `faGate.ts:174-177` `isFaGateOpenForProject` | G1 ∧ G2 | FA branch skipped; same as G2 |
| G4 | Cached Whisper transcript | `App.tsx:3918` (`cachedTokensReady`) | Matching `lastTranscribedFileIdentity` + non-empty `transcriptTokens` | Apply Sync aborts earlier (empty transcript path) — FA never attempted |
| G5 | FA preflight (observational) | `App.tsx:3949-3951`, `faPreflight.ts:78-179` | Does **not** block FA; logs `fa-preflight` entry | Warning in Sync Log with `fixHint`; sync still runs FA if G3 open |
| G6 | Supported FA language | `forcedAlignmentRun.ts:123-128` | `languageCode` ∈ `{en,es,fr,de,pt}` via `resolveFaLanguage` | Sync Log `fa-fallback` / `unsupported-language`; Whisper timing committed |
| G7 | Non-empty chunk plan | `forcedAlignmentRun.ts:142-145` | `computeFaChunkPlan(...).length > 0` | Sync Log `fa-fallback` / `empty-chunk-plan`; Whisper timing |
| G8 | Audio staging IPC | `forcedAlignmentRun.ts:163-168` `fa_stage_audio_raw` | IPC succeeds | `fa-fallback` / `inference-error` + `detail`; Whisper timing |
| G9 | Production align IPC | `forcedAlignmentRun.ts:179-184` `fa_align_production` | Channel `Done` with words | `fa-fallback` / `inference-error` or `zero-words`; Whisper timing |
| G10 | Feature compiled (Rust) | `fa.rs:1033-1137` vs `1139-1161` | `fa-inference` enabled at compile time | `NotImplemented` → TS `inference-error`; preflight `featureCompiled: false` |
| G11 | Model on disk + hash | `fa_dev.rs` manifest verify, `fa_model_path` | Pack present and SHA matches | `inference-error` / preflight `modelPresent: false` |
| G12 | ORT dylib load | `fa_preflight.rs:70-75`, `fa_onnx` session | `ORT_DYLIB_PATH` / bundled runtime loads | preflight `runtimeOk: false`; align `InferenceFailed` |
| G13 | Single-flight | `fa_dev.rs:653` `already_running` | No concurrent FA run | `inference-error` (`alreadyRunning`) |
| G14 | Non-zero FA words | `forcedAlignmentRun.ts:187-189` | `words.length > 0` | `fa-fallback` / `zero-words` |

### `FA_PROJECT_DEFAULT_ON` and `isFaEnabledForProject` (verbatim)

```91:127:src/services/faGate.ts
export const FA_PROJECT_DEFAULT_ON = false;

let cachedFaCapability: boolean | null = null;

export function isFaCapable(): boolean {
  if (cachedFaCapability !== null) return cachedFaCapability;
  cachedFaCapability = isTauri();
  return cachedFaCapability;
}

export function isFaEnabledForProject(
  project: Pick<Project, 'faHighPrecisionSync'> | null | undefined,
): boolean {
  const stored = project?.faHighPrecisionSync;
  return typeof stored === 'boolean' ? stored : FA_PROJECT_DEFAULT_ON;
}
```

**Persistence:** `Project.faHighPrecisionSync` optional boolean (`types.ts`). Absent key = “no preference” → read-time default only (`faGate.ts:22-27`, never written on load). Explicit `true`/`false` written only when user moves toggle and Save uses `shouldPersistFaChoice` (`faGate.ts:160-161`, `App.tsx:6259`). New-project seed: `NEW_PROJECT_FA_DEFAULT_ON = false` (`appDefaults.ts:67`, separate from `FA_PROJECT_DEFAULT_ON`).

**Legacy key:** `LEGACY_GLOBAL_FA_TOGGLE_KEY = 'faHighPrecisionSyncEnabled'` retired and not read (`faGate.ts:58-57`).

### Rust `#[cfg(feature = "fa-inference")]` sites (production path)

| File:line | With feature | Without feature |
|---|---|---|
| `lib.rs:16-17` | `mod fa_onnx;` compiled | Module absent — no ONNX |
| `fa_preflight.rs:70-85` | Probes ORT via `probe_ort_runtime` | `feature_compiled: false`, fixed message pointing to `tauri:dev:fa` |
| `fa.rs:1033-1137` | Real `align_chunked_for_language` on blocking pool | N/A (other arm runs) |
| `fa.rs:1139-1161` | N/A | `FaError::not_implemented(...)`, `FaEvent::Error`, IPC `Err` |

---

## STEP 3 — Silent-fallback inventory (defect D24)

**Contract today:** `runForcedAlignmentForSync` never throws; failures return `{ status: 'fallback', reason, detail? }` (`forcedAlignmentRun.ts:16-31`). `App.tsx:3974-4022` sets `faTokens = null` and uses cached Whisper tokens — sync **succeeds** with Whisper timing. Session J added Sync Log `fa-fallback` + `buildSyncEngineEntry` (`App.tsx:3981-4001`, `syncLog.ts:425-444`) — **not** a blocking modal or Apply Sync error.

| Path | File:line | Trigger | Log | User told |
|---|---|---|---|---|
| Unsupported language | `forcedAlignmentRun.ts:123-128` | Language ∉ five packs | `console.warn` + sync `fa-fallback` | Sync Log warning + fixHint |
| Empty chunk plan | `forcedAlignmentRun.ts:143-145` | No chunk text | warn + `fa-fallback` | Sync Log |
| Zero words | `forcedAlignmentRun.ts:187-189` | Empty `Done.words` | warn + `fa-fallback` | Sync Log |
| IPC / inference catch-all | `forcedAlignmentRun.ts:200-206` | Any throw/reject in try | warn + `fa-fallback` `inference-error` | Sync Log + optional `errorMessage` |
| Gate closed | `App.tsx:3960-3974` | `isFaGateOpenForProject` false | `fa-gate-closed` entry if capable | Sync Log only |
| Gate open, preflight not ready | `faPreflight.ts:134-177` | Model/runtime/feature | `fa-preflight` warning | Sync Log; **FA still attempted** — verified non-substituting 2026-09-19 (observational only; see STATUS.md D24 CLOSED @ `4e36080`) |
| CTC-infeasible chunk (native) | `fa_onnx.rs:1572-1578` | Lattice S=2L+1 vs frames | Rust `log` line | **No** — run may `status: ok` with placeholder words (`fallback_words_for_infeasible_chunk`), not Whisper fallback |
| Silence detect fail inside FA | `forcedAlignmentRun.ts:136-140` | `detectSilences` error | warn; run continues | Optional `silence-error` sync entry on success (`App.tsx:3988-3989`) — verified non-substituting 2026-09-19 (see STATUS.md D24 CLOSED @ `4e36080`) |

### Failure-mode classification

| Mode | Classification | Notes |
|---|---|---|
| Feature not compiled | Genuine incapability — must surface error when toggle ON | Maps to `inference-error` / preflight `featureCompiled: false` |
| Model pack absent / partial | Incapability when toggle ON | Partial download → hash mismatch → `inference-error` |
| ORT session init failure | Incapability / env | preflight + `inference-error` |
| Language outside five packs | **Honest exception** | Today fallback; NR-2 contract may allow disable-with-message |
| Audio staging / resample failure | Incapability | `inference-error` |
| CTC infeasibility (S vs frames) | **Bug** if user expected real FA | Native substitutes placeholder words; user may think FA ran |
| Vocab / normalization mismatch | Bug or incapability | Often surfaces as poor alignment or inference failed |
| Chunk-boundary / planner errors | Bug | Often empty plan or inference |
| Cancel / timeout | Transient or user action | `Cancelled` kind exists; bundled into `inference-error` on TS side |
| Concurrent invocation | Incapacity (retry) | `alreadyRunning` |
| OOM | Incapacity | `InferenceFailed` |

### Provenance on stored timing

- **Per sync run:** `syncLog` entries `info` engine line + optional `fa-fallback` (`syncLog.ts:380-444`). Not persisted as structured fields on `Project` beyond the log array.
- **`Project.faWordTimings`:** FA output cache; no `engine` / `modelRevision` field (`types.ts:534`).
- **`Project.transcriptTokens`:** Whisper; no engine stamp.
- **Segment `anchorSource`:** `'forced-alignment' | 'whisper' | 'estimate'` per segment (`types.ts:235`) — demote-only within a run, not a durable cross-run engine audit trail.
- **Conclusion:** No stored timing record carries a durable triple `(engine, modelRevision, engineVersion)`; post-hoc detection of silent fallback relies on `syncLog` (if user opens it) or inferring from segment anchors.

### Diagnostic logs on machine

Search for `kinetix-diagnostic.log` under `~/Library` timed out; no log file was read this session. Sync Log is the primary FA fallback artifact in-app. Missing fields for root-cause after the fact: structured `FaErrorKind` on project JSON, ORT load path, model revision, chunk-level infeasibility counts, distinction between Whisper fallback vs placeholder-word “success”.

---

## STEP 4 — Proposed contract (“FA on means FA runs”) — design only

1. **`FA_PROJECT_DEFAULT_ON` → `true`** and **`NEW_PROJECT_FA_DEFAULT_ON` → `true`** when implementation lands (NR-2).
2. **Migration:** Absent `Project.faHighPrecisionSync` must mean “adopt new default ON” without writing the key (existing `shouldPersistFaChoice` / load-path proof in `faGate.test.ts`). Explicit `false` must remain respected. **The persistence layer can distinguish** never-set (`undefined`) from explicit `false` — no new key required.
3. **When toggle ON:** Any failure → typed error with reason code + required user action; **no** Whisper substitution for that Apply Sync (abort or explicit “Continue with Whisper” — operator choice in implementation dispatch).
4. **Proposed error kinds (from STEP 3):** `feature-not-compiled`, `runtime-load-failed`, `model-missing`, `model-hash-mismatch`, `unsupported-language`, `empty-chunk-plan`, `audio-stage-failed`, `alignment-infeasible`, `alignment-zero-words`, `inference-failed`, `cancelled`, `already-running`, `out-of-memory`, `vocab-normalization` (split as needed).
5. **Preconditions for “runs 100% of the time” honesty:** FA feature compiled; ORT loadable; model pack installed and verified; language ∈ five packs; voiceover staged; chunk plan non-empty; no concurrent FA run; sufficient memory; transcript present. **Exception:** unsupported language — recommend gate closed with clear UI (disable toggle + banner), not silent Whisper.
6. **Provenance stamp (proposed fields on each committed timing set):** `timingEngine: 'forced-alignment' | 'whisper'`; `faModelRevision` (HF/git pin); `faEngineVersion` (app + ort version string); `whisperModelId` when Whisper used.

---

## STEP 5 — Stale-claim index (recorded, not rewritten in WS1 lane)

WS1 `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` — historical rows (e.g. line 33 table: “ALIGNER COMPLETE, dev-only… zero production callers”) **left as-is**; supersession noted at file top only.

| Location | Quoted claim |
|---|---|
| `docs/STATUS.md:14` (pre-audit) | “`fa-inference` non-default so shipped builds fall back to Whisper timing” — partial: true for non-`-f` builds; false for CI installers |
| `docs/STATUS.md:26` (pre-audit) | “Make FA reachable in shipped build — `fa-inference` non-default” — closed NR-1 (CI already `-f`) |
| `docs/architecture/cloud-asr-plan.md:7` (pre-Amendment 3) | “`fa-inference` is off in every shipped Cargo build… every installer… `notImplemented`… never reached a user” |
| `docs/architecture/cloud-asr-plan.md:21` (pre-amend) | “shipped build without that feature returns `notImplemented`” — without CI exception |
| `docs/architecture/cloud-asr-plan.md:86` | “ONNX Runtime is bundled… unused unless `fa-inference` is compiled in” — still true; understates CI compile |
| `src/services/appDefaults.ts:54-59` | “SHIPPED OFF… default build's `fa_align` returns `not_implemented`… every run” — true for plain `tauri:build`, not CI |
| `src/services/faPreflight.ts:188-191` | “in a plain `tauri:dev`/`tauri:build` binary… `fa_align` returns `NotImplemented`” — omits `tauri:dev:fa` and CI |
| `src/services/faTextNormalize.ts:514` | “reachability is gated by the `fa-inference` Cargo feature, which is OFF in” (default builds) |
| `src/components/FaPackStatus.test.tsx:13` | “`fa-inference` is not in `Cargo.toml`'s default feature set” — factually true, not “FA absent from product” |
| `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:33` | “dev-only… behind the `fa-inference` feature flag, zero production callers” — stale vs `App.tsx:3960+` |
| `cloud/README.md:126` | “Local English parity (existing FA path, `fa-inference`, production” — acknowledges live path |
| `CLAUDE.md` (main worktree manual) | “off by default in plain `tauri:dev`/`tauri:build`” — accurate; does not mention CI `-f` |

UI strings that describe fallback behaviour (not “FA disabled”): `FaPackStatus.tsx:145` “will fall back to”; Sync Log templates in `syncLog.ts:435`.

---

## Decisions for operator

1. Whether local `npm run tauri:build` without `-f` should also ship FA (align dev/prod packaging docs).
2. Whether CTC-infeasible placeholder words should fail the run under NR-1 or remain a counted degradation.
3. Whether preflight “not ready” should hard-block FA attempts (today observational only).
4. Closing STATUS open item “Make FA reachable in shipped build” (audit: CI already passes `-f fa-inference`) to make room for D24 at 40/40 `[OPEN` cap.

## Decisions taken (conservative)

- Treat **CI installers** as the definition of “shipped” for FA compilation unless operator confirms a non-CI bundle.
- Record D24 as **silent Whisper substitution while toggle ON still completes sync successfully** — Sync Log mitigates but does not meet NR-1 bar (no modal/abort).
- Do not rewrite WS1 sync-pipeline design doc body; status note + STATUS only.
