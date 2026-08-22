# Kinetix Pro Studio — Project State

> **Purpose:** the situation report — perishable status only, always true as of right
> now. Six fixed sections (Current State, Active Workstreams, Open Decisions,
> Next Action, Rulings In Force, Deferred Planned Items); don't add a seventh. **Never
> put here:** task-level detail (checkbox lists, per-task notes) — that's
> `docs/work-in-progress.md`, which also holds each active workstream's own
> WS-specific rulings and deferred/known-bugs list; durable rules/invariants — that's
> `CLAUDE.md`; anything completed — remove it, don't mark it done, its record lives in
> `docs/history.md`. **Cap: ~250 lines.**

---

## 1. Current State

| Field | Value |
|---|---|
| Branch | `main` (trunk; `webgl2-effects-engine` tracks it, name is historical) |
| HEAD | WS1 Session Z — chunk-plan hypothesis for the 45-46 divergence REFUTED by direct measurement (3 real chunk plans, chunk-edge signature present as predicted, FA output still byte-identical across all three); mechanism UNEXPLAINED after ruling out chunk plan, 3 escalating ONNX-determinism mutations, and audio identity; determinism mutation gate declared INERT on this hardware (documentation, not a proven-armed gate); 45-46 committed 172.91 through the full rule stage on the frozen capture, a genuine defect vs. ear ground truth (174.74) on that capture, NOT registered (needs a fixture regeneration this session's constraints bar); v6's boundary-adjacent FA confidence 2.25x lower than 173's, all 8 open Class A/B rows cluster near-zero on both anchors; low-confidence fallback threshold specified (0.056, GEOMETRIC); word-gap placement model ships nothing a second time. `faAnchors.ts` untouched. Prior: Session Y pinned engine determinism, Session X ingested 173's full ear pass, Session W froze 173's pre-fix state, Session V (Part 1) closed seven Zero-Defect Register rows against LIVE |
| `vitest` (`npm test`) | 2465 passed / 23 skipped / 0 failed — 107 files passed, 16 skipped (123) — unchanged from Session Y (no TS/JS files touched this session) |
| `tsc --noEmit` (= `npm run lint`) | clean |
| `cargo check --features fa-inference` | clean |
| `cargo clippy --all-targets --features fa-inference` | clean — 4 pre-existing warnings (`fa_onnx.rs`/`fa.rs`), 0 new |
| `cargo test` (default, no feature) | 141 passed / 0 failed / 1 ignored |
| `cargo test --features fa-inference` | 216 passed / 0 failed / 24 ignored (+1 vs. Session Y — this session's own third determinism-mutation test in `fa_onnx.rs`'s `phase1_determinism` module, `forced_parallel_session_control_173`, real, passes under `-- --ignored`) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts` + `phase4-fa-replay.test.ts`) | 6/6 byte-identical |
| FA Zero-Defect Register (`scripts/phase4-fa-replay.test.ts`) | **8 open** (unchanged this session — down from 15, WS1 Session V closed 7 via `status: 'fixed'`, i.e. against LIVE, not the frozen fixture; not empty — this is still the Stage 1 lock's own blocking criterion, see §2) |
| `faAnchors.ts` sha256 | `b61e94cb6ac61a3f8f22ce076ac55440227f4d4b5aef0c6d6aa980035db7380c` — unchanged since Session E |

All six floors re-measured directly 2026-08-22 (WS1 Session Z) after adding a third determinism-mutation test — all match Session Y's own numbers except `cargo test --features fa-inference`'s ignored count (+1, this session's own new test, expected). App status: shipping desktop app (Tauri DMG/installer, native ffmpeg sidecar export, no server/web hosting). Target users: YouTube creators, initial internal use across 5–10 channels. Repo: `github.com/mohtashim9119-web/kinetix-pro-studio`.

---

## 2. Active Workstreams

Task-level detail lives in [`docs/work-in-progress.md`](docs/work-in-progress.md), not here.

- **WS1 — Sync Pipeline (forced-alignment timing-source upgrade):** **WS1 Session Y (2026-08-22)** pinned `fa_onnx.rs`'s `load_session` to single-threaded/sequential/deterministic ONNX Runtime execution and MEASURED 3 independent runs byte-identical on real 173 and v6 production audio (a permanent, `#[ignore]`d gate test); the mutation control (same window, pre-fix unpinned construction) was ALSO byte-identical on this hardware, so Session X's live-vs-regen divergence stays INFERRED, not confirmed. Tested the script-anchored word-gap placement hypothesis on real ground truth (173's 5 defects + 19 controls, v6's 15 register rows) — mixed result (3/5 defects confirm, biased off the geometric midpoint; 2/5 refute; v6 contaminated by near-zero-confidence anchor words) — ships nothing, `faAnchors.ts` untouched. The propose/arbitrate rule-stage rebuild (below) was designed but deliberately not implemented this session — no driving rule change from the placement result, and the rewrite's regression risk to a hash-pinned, 2465-test-covered module warrants a dedicated session. Full detail: `sync-pipeline-v2-plan.md`'s Part T, `docs/work-in-progress.md` §§11a-11b. Phase 3 (= Task 5) is **PRODUCTION PATH WIRED, gate PER-PROJECT, DEFAULT OFF**. The FA gate's default flip to ON is deferred to the final act of Stage 1 (ruling R-AD), gated on an **EMPTY Zero-Defect Register** — currently **8 open rows, all Class A (3) + Class B (5)**; full detail and row IDs in `docs/work-in-progress.md` §11. WS1 Session V (2026-08-22, Part 1) closed the other 7 (the five R.12 fixture-scoped rows, the `266_forty_one_burden` live-path row, and the reopened `383_sixty_four`) against a fresh run-id-stamped live bundle plus an operator A/B ear pass — `status: 'fixed'` in `KNOWN_BAD`, not converted to `CLOSED_BY_POSITIVE_ASSERTION`, because that requires matching the frozen fixture CSV, deliberately still unregenerated. `266`'s "regression" classification (788.65→788.75) is REFUTED: 788.75 is now the operator-confirmed correct value. Session V Part 2 (a Class A/B attribution-side detector) remains ON HOLD, not started. **WS1 Session W (2026-08-22, capture only)** froze the pre-fix state of the 173 project after a live sync surfaced an apparent wrong cut at the segment 6-7 boundary: a fresh run-id-stamped capture found the 6-7 boundary matches the live app exactly and is attribution-clean (no word crosses the seam) — if still wrong on a re-listen it is a placement, not attribution, defect — plus one unrelated fidelity-gate divergence (`vessel_damage_clue`, live 174.74 vs. this session's fresh regen 172.91, both real silence midpoints) not yet explained. Ear list: `docs/ws1-sync-pipeline/stage1-session-w-173-ear-list.md`. **WS1 Session X (2026-08-22)** ingested the operator's full 173 listening pass (24 verdicts: 19 correct, 5 real defects — `docs/ws1-sync-pipeline/stage1-session-w-173-ear-list.md`'s own 21 rows plus 3 off-list defects caught in a fuller listen-through) into `scripts/ws1-ear-pass-ledger.ts`, measured every live boundary signal's precision/recall against that ground truth for the first time (still-playing 20% recall / 17% precision; silence-distance>20ms 20% recall / 6% precision; every other rule 0 fires on this corpus this run), found the v6-tuned silence-midpoint geometry does NOT generalize to 173 (83-94% false-positive rates), searched for and did not find a clean suppression-class discriminator ("R-MD" — negative result, nothing shipped), and chased the `vessel_damage_clue` (45-46) live-vs-regen divergence Session W deferred to a named mechanism: Whisper tokens are byte-identical between the two captures, but FA (ONNX) word-level output diverges substantially for the same tokens — most likely ONNX Runtime's own unpinned thread pool, scoped to FA-gated projects only (opt-in, default OFF). No register row opened or closed. See `docs/work-in-progress.md` §11, Session X entry. **WS1 Session Z (2026-08-22)** chased the `vessel_damage_clue` (45-46) divergence further: REFUTED the chunk-plan hypothesis by direct measurement (three real 173 chunk plans — 118/119/126 chunks — one pair genuinely splits right where the divergent word sits and one doesn't, exactly the predicted edge-vs-mid-chunk signature, but all three give byte-identical FA word output at that word); ran 7 total reproduction trials (idle/CPU-saturated/concurrent) plus a third, strictly stronger determinism mutation (forced parallel execution, 8+4 threads) — all byte-identical, so the mutation gate is now stated plainly as INERT on this hardware, not a proven-armed regression gate. The mechanism stays UNEXPLAINED (not retracted) after ruling out chunk plan, engine threading, and audio identity. Adjudicated 45-46 through the complete rule stage on the frozen capture: commits 172.91 (a pure silence-snap decision, no rule involvement) — a genuine defect vs. ear ground truth (174.74) on that capture, named but NOT added to `KNOWN_BAD` (needs a fixture regeneration this session's constraints bar). Measured v6's boundary-adjacent FA confidence at 2.25x lower than 173's (44.3% vs. 19.7% below 0.01), found all 8 open Class A/B rows cluster in the near-zero band on both their committed and ear-correct anchors, and specified a GEOMETRIC low-confidence fallback (0.056). Re-tested the word-gap placement hypothesis with a derived ~20ms pre-roll — both previously-refuting rows still refute — ships nothing, a second negative. No register row opened or closed, `faAnchors.ts` untouched. Full detail: `sync-pipeline-v2-plan.md` Part U, `docs/work-in-progress.md` §11c.

---

## 3. Open Decisions

- **Class A (3 open of 4) / Class B (5 open) rows need a new detection track, not a placement fix.** WS1 Session R found the defect class is word-*attribution* (Hirschberg hands 1-5 words to the wrong segment), not boundary placement — any rule testing a boundary against segment spans is structurally blind to it (0/446 violations found by word-containment). No attribution-side detector has been designed yet. Detail: `docs/work-in-progress.md` §11, Session R entry.
- **Rule-stage architecture: propose-then-arbitrate rebuild is scheduled, not started.** Rules currently mutate a shared array in sequence, so a conflict between two rules' claims resolves by ordering with no record a conflict occurred (this is what produced the R.11/R.12 collision R-AP closed in Session S). The scheduled fix — every rule emits a proposal against the origin array, an arbitrator resolves competing claims on stated ownership — would also absorb the R-AP performance cost below. Detail: `docs/work-in-progress.md` §11(f).
- **R-AP's measured cost (~2.70s per Apply Sync on the 447-segment v6 corpus) has a known fix, not yet built.** `computeUnscriptedRuns`'s Hirschberg alignment now runs 4 times per Apply Sync instead of 1 (once per rule stage that needs run structure); a memo on the pure function removes 3 of the 4 passes. Deliberately bundled with the propose/arbitrate rebuild above rather than bolted on standalone. Detail: `docs/work-in-progress.md` §11(h2).

---

## 4. Next Action

Rolling 3 — worked in order. **Maintenance rule:** when the first task completes it is removed, the list shifts up, and the next task from the roadmap's priority order is appended; the list is always exactly three.

1. **Design an attribution-side detector for Class A/Class B (8 open rows) — WS1 Session V Part 2, scoped, awaiting approval to proceed.** Session R closed off the boundary-placement family of candidate signals (structurally blind, measured 0/446) and reframed the defect as word-attribution — this is now the ENTIRE open register (Session V Part 1 closed everything else). Detail: `docs/work-in-progress.md` §11, Session R + Session V entries.
2. **Slice 2 — re-derive the 50/50 silence-split rule.** Port `snapBoundaries.ts` + Apply-Sync plumbing (park-commit `210855d`) against current `main`. Still not started; will deliberately break the golden replay, budget a per-boundary review, never a blind re-baseline. Detail: `docs/work-in-progress.md` WS1 item 2.
3. **Not currently determined.** The master roadmap this rolling list drew its priority order from (`ws1-master-roadmap.md`) was deleted 2026-08-14 during the docs consolidation (content folded elsewhere, per `CLAUDE.md` §7); no further next-priority item beyond the two above is presently named anywhere in the tracked docs. Needs the owner to set the next item explicitly rather than one being inferred here.

---

## 5. Rulings In Force

One line each — full record in `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section (operative rule also in `CLAUDE.md` §4 Invariants). This section holds only cross-cutting rulings that apply beyond a single workstream; WS-specific rulings (currently WS1's) live in that workstream's block in `docs/work-in-progress.md` instead.

- **Model P (gapless partition)** — `project.segments` is a gapless partition; Model S (independently-positioned slots with legal gaps) is rejected. [`docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07`](docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07), full analysis [`#the-segments-invariant--ruling-document-2026-08-07`](docs/history.md#the-segments-invariant--ruling-document-2026-08-07), revert-scope context [`#the-model-p-revert--what-actually-happened-2026-08-07`](docs/history.md#the-model-p-revert--what-actually-happened-2026-08-07).
- **Last-segment right edge is locked, both directions, w.r.t. drag.** `segments[N-1].end === mediaDuration` is a hard invariant. [`docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08`](docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08).
- **A cancelled drag (`pointercancel`) discards, never commits.** [`docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08`](docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08).
- **Undo/redo design** — snapshots not patches, 20-state depth, page-reload persistence, lock-blocks-traversal policy. [`docs/history.md#undo--redo--design-2026-08-08`](docs/history.md#undo--redo--design-2026-08-08) (now a record of what was built, not a proposal).

**Task 5 rulings (2026-08-11).** WS1-scoped, registered here rather than `docs/work-in-progress.md` by explicit owner instruction — the detail behind each lives in `docs/ws1-sync-pipeline/ws1-master-roadmap.md`'s NEXT UP block (pointed to per-ruling below), which this section indexes.

- **R-D — Step T is not in Task 5.** Model distribution/on-demand-download is its own task, required before any release build, not before Task 5 (no release is imminent — WS1 finishes first). Task 5 itself resolves FA models via `app_local_data_dir` with a manual-placement fallback. Detail: roadmap NEXT UP, "Files expected to change."
- **R-E — Model P outranks R.5.** A forced-alignment wildcard span is assigned to the preceding segment; forced alignment may never emit a real gap in `project.segments`. Settles the open recommendation at `sync-pipeline-v2-plan.md:1441` in Model P's favor.
- **R-F — Decision 8 splits.** R.5's CTC-wildcard windowing mechanic is in Task 5/Phase 3's own scope; heading-assignment UI (Option A's on-screen behavior) stays Phase 5. Detail: roadmap NEXT UP, "Out of scope for this task."
- **R-G — `anchorSource` gains `'forced-alignment'`**, ordered above `'whisper'` (forced-alignment > whisper > estimate). Demote-only ordering is preserved; the value is set explicitly by the code path that produced it, never inferred. Detail: roadmap NEXT UP hazards list.
- **R-H — Golden replay is extended before FA timing lands.** A forced-alignment input set and a second baseline are added while the diff against the existing baseline is still zero, ahead of any FA timing change. **Amended 2026-08-12 (R-Q): HALF SATISFIED** — the input set/first baseline landed, but the second pass ("FA swap run and reviewed per-boundary against that baseline") can't happen until Task 5 wires a real model; recorded as a hard precondition on that slice. Detail: roadmap NEXT UP acceptance criteria, R-H status note.
- **R-Q — FA golden-replay fixtures are MMS-FA-derived and scoped to Viterbi/windowing fidelity only.** MMS-FA is barred from shipping (Decision 3); production ships jonatasgrosman per-language models instead, so the fixtures are not a reference for text normalization, vocab coverage, or word-drop behavior. Regenerating them against jonatasgrosman is an obligation on the FA wiring slice (Task 5), not on the text normalizer. Detail: roadmap NEXT UP, R-H status note.
- **R-I — `-nfa` stays deferred until after Task 5 ships.** Independent by design, entangled with Task 5 at the measurement-baseline level. Detail: roadmap §13.
- **R-J — `preserveSegmentLocks` position is locked.** Stays at its current post-`autoMatchSegments` call site; must not be moved into `applyAnchorBasedTiming` under Task 5 or any later phase. Detail: roadmap NEXT UP hazards list.
- **R-K — No release build until WS1 completes.** R-D (Step T, model distribution, kept out of Task 5) depends on this; if release timing changes, R-D must be revisited before Task 5 ships. Detail: roadmap NEXT UP, "Files expected to change."
- **R-L — Forced alignment runs natively in-process, compiled into the binary.** Out-of-process sidecars (Python, or any external runtime) are rejected permanently as a delivery mechanism for alignment — closes the runtime-delivery Option A (a distinct decision from Decision 8's heading-wildcard Option A, roadmap §4 Step V). `ffmpeg` and `whisper-cli` remain sidecars; R-L governs alignment only. Detail: roadmap §13.
- **R-M — `ort` (ONNX Runtime) is the forced-alignment runtime.** `candle` is rejected — no wav2vec2/CTC implementation exists in `candle-transformers`, and hand-writing the forward pass is out of scope. Accepted cost: a from-source onnxruntime build for `x86_64-apple-darwin` in CI, following the existing whisper-cli from-source pattern in the same workflow. Detail: runtime-spike measurement file, G3/G4.
- **R-N — R-L's packaging reading is DEFERRED, not decided.** R-L's "compiled into the binary" has two readings for `ort` specifically: static-link (single fat binary) vs. default/load-dynamic (in-process, but bundles a separate onnxruntime dylib). R-K means no build is being cut, and load-dynamic already compiles — both readings satisfy R-L's in-process requirement, so this is not urgent yet. Must be decided before Step T and before any release build — recorded as a blocker on both. Detail: roadmap §13, `sync-pipeline-v2-plan.md` Step T.

**R.1 spec-hole rulings (2026-08-12).** WS1-scoped, registered here by the same explicit owner instruction as the Task 5 rulings above — full detail lives in `sync-pipeline-v2-plan.md` at R.1/R.4.

- **R-O — "Distinctive" (R.1(a)) is a measurable admissibility test: length ≥ `MIN_ANCHOR_WORD_CHARS` (3, seeded from C10's own ≥3-char definition) AND first canonicalized character not in `GLIDE_INITIAL_CHARS` (`{w, y}`, seeded from Step B's measured glide-initial finding). No stopword list, for any of the 5 supported languages. Resolves a conflict in R.1(a)'s own text: its justification cites Step B's PHONETIC glide-initial measurement, but its rule text said "not a function word" — LEXICAL, C10's definition. This ruling picks the phonetic reading; C10's lexical definition governs C10 only. Biased toward rejection deliberately: a rejected anchor only costs a longer run (bounded by `MAX_RUN_SEC`); a wrong anchor corrupts timing — the costs are not symmetric. Detail: `sync-pipeline-v2-plan.md` at R.1.
- **R-P — R.4 force-split selection** (when no admissible anchor exists within `MAX_RUN_SEC`): split at the longest detected silence inside the window; if the window has no detected silence, split at exactly `MAX_RUN_SEC`. The resulting boundary's provenance is recorded distinguishably from an agreed anchor. Never produces a gap (R-E, Model P). Detail: `sync-pipeline-v2-plan.md` at R.4.

---

## 6. Deferred Planned Items

### Polish Features

Owner-maintained — items are added or removed only on explicit owner instruction, never as a side effect of an audit.

1. Version snapshots — blocked on two open design decisions (asset-restoration approach, full-rewind-on-restore).
2. Auto-captions (reuse Whisper transcript tokens as a timed text layer).
3. Multi-user support — team accounts vs. staying single-user, revisit if demand materializes.
4. Sync loading screen — live 0-100% progress instead of the current static message.
5. Export quality — real color-space conversion + cross-segment drift correction (mux-time bt709 tagging already fixes the practical color mismatch; revisit only if a real issue surfaces).

### SaaS/Public-Launch Readiness

Not scheduled — required before public launch or multi-user distribution, tracked here so they aren't forgotten.

- Backend proxy for API keys — Pexels/Pixabay/Coverr keys currently ship in the client JS bundle (`VITE_`-prefixed).
- Auth layer — no authentication today; open access. Required for multi-user.
- LGPL ffmpeg swap — current sidecar (`libx264`) is GPL; swap for an LGPL-only build (OpenH264 or a commercial x264 license) before public distribution.
- Restrict `fetch_url_bytes` with a domain allowlist (SSRF hardening, `src-tauri/src/lib.rs`) — currently fetches any URL the webview passes; acceptable for internal single-user use, required before public launch.
- Download-on-first-use for the whisper model — `ggml-large-v3-turbo.bin` (~1.51 GiB) is bundled via `tauri.conf.json`'s `bundle.resources` glob today; needs fetch + progress UI + SHA-256 verification + storage-path resolution before public distribution, or every install ships ~1.65 GiB of model weight.
