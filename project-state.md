# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-06-24 |
| Current HEAD | `254ef1b` on `main`, fully pushed to `origin/main`. **Step 7 (final regression) done — the clean-slate re-sync Architecture Shift is now fully COMPLETE (all steps 1–7).** Built on: clean-slate sync rebuild (3a–3e); dead sync-wizard UI removed (`4890ea6`) — `handleApplySyncFromFiles` is the single live sync entry point; Step 5 (5.1–5.4) — headings live only in the segments array, dual storage gone; Step 7 — combined-pipeline 11→14 regression locking heading carry-forward + real timing together end-to-end. |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` ("chore: remove VO-DIAG/SYNC-DIAG debug logging") |

All foundational/export/desktop/sync work is shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24, commit `254ef1b`). Active work is feature tasks only — see Active Tasks.

---

## Active Tasks

1. **Architecture shift** — ✅ **COMPLETE — 2026-06-24 (Step 7, commit `254ef1b`)**
   - **NOT IMPLEMENTED — superseded.** No `readOnly`/disabled gate exists on the Scene Details editor — `src/components/DropZonePanel.tsx:760` lets the user re-enter edit mode at any time; `:421` only auto-closes the edit view right after a sync completes, it doesn't lock anything. The corruption problem this bullet targeted was solved by a different mechanism instead — see the clean-slate re-sync + confirm-dialog/auto-snapshot bullet below. Edits remain possible; they're just not preserved across re-sync.
   - ✅ Done (Step 5, 2026-06-24) — Headings live array-only, never serialized to sceneDetails text — fixes problem 1 permanently
   - ✅ Done — `DropZonePanel.tsx`'s `isStagedEmpty` gate (`:581-582`) disables the Apply Sync button (`:906`) unless a script/scene/voiceover/asset file is newly staged; comment at `:577-580` confirms this is an intentional invariant, not an accident.
   - **PARTIAL.** `applyAnchorBasedTiming()` runs on lock toggle (`src/App.tsx:776`), heading insert (`:874`), and heading delete (`:927`), plus inside the sync pipeline itself. But the timeline duration drag-resize path (`:2048-2146`) recalculates via a separate `applyDurationChange`/`computeDragCascade` mechanism (`:619`), not `applyAnchorBasedTiming()` — so "any segment/heading mutation" overstates current behavior.
   - Direction changed to CLEAN-SLATE RE-SYNC — Apply Sync wipes all derived state and re-derives fresh from audio; nothing carried forward. 4.5b repair fix reverted (proven regression — removed via commit 452e1eb, the same commit as step 3a below). Manual edits NOT preserved across re-sync by design (re-sync rare; edits are post-sync). Confirm-dialog + auto-snapshot are the safety net.

---
### CLEAN-SLATE RE-SYNC — Final Plan (supersedes all prior 4.5a/4.5b/Step 6 work)

**Core principle:** Apply Sync = fresh start. On any new file + Apply Sync, wipe ALL derived state and re-derive everything from the audio. Nothing carried forward — no merge loop, no anchor restore, no frozen-anchor repair. Manual edits (drag/lock) are NOT preserved across re-sync by design; re-sync is rare, edits are post-sync. Safety net = confirm-dialog + auto-snapshot (built with Version Snapshots task).

**Why:** The diagnostic (run this session) proved the bug class is caused entirely by carrying stale state forward — fresh char-weight guesses colliding with restored real anchors, frozen 'whisper' anchors copied forward un-rechecked, and PASS 2.5 blaming the wrong segment. Eliminating carry-forward eliminates the entire bug class at the root.

**Steps:**
1. ✅ Done (452e1eb, same commit as step 3a) — Revert 4.5b: removed the PASS 2.5 repair-pass logic (proven regression: fixed ~1 of 4 slivers but corrupted previously-correct segments and fabricated new slivers; verified with vs without in the diagnostic).
2. Audit + plan clean-slate re-sync — identify everything to delete: the merge loop (App.tsx ~1509-1534), anchor carry-forward/resolveAnchorSource, PASS 2 (dead code) + PASS 2.5, and any stale-state logic. Define the fresh re-derive path (parse → align fresh against audio → done).
3. Build clean-slate re-sync — Apply Sync wipes derived state, re-derives all segments fresh from audio. One clean path.
   - 3a ✅ Done (452e1eb) — deleted both merge loops, deleted resolveAnchorSource/getComparableText/getSegmentStableKey, deleted old regression tests 2–8 (only test 1 survived).
   - 3b ✅ Done — 2026-06-24. New clean-slate regression tests added to `src/services/syncTiming.test.ts` (11-OLD / 14-NEW Civic 11→14 repro, plus a small synthetic stale-anchor-squeeze pair). All green. Found and fixed a real, pre-existing bug along the way (not a clean-slate regression — this code predates clean-slate work): in `alignScenestoTranscript` (`whisperService.ts`), the silence gap-fill step's search radius could reach past a short neighboring segment and steal the silence belonging to the NEXT boundary, collapsing that segment to ~0 width. Fixed by clamping each boundary's search window to its two neighboring segments' own spoken edges. Manually verified on the real Civic 10→14 re-sync in the app: correct widths, aligned timeline, no out-of-order warning.
   - 3c ✅ Done — 2026-06-24 (`5da64df` = 3c-1, `8523f39` = 3c-2). Deleted `alignScenesToTranscriptAnchorAware` and collapsed `alignSegmentsFromCachedTranscript`'s caller branch to always use the plain aligner (`alignScenestoTranscript`); separately removed the dead Whisper skip-guard in `startTranscription`. Both were reachable by `tsc` but unreachable at runtime under clean-slate (every caller passes all-`'estimate'` or empty segments). Verified: 5/5 vitest, `tsc --noEmit` clean, manual re-sync in the Tauri app unchanged (contiguous, no slivers, no out-of-order warnings).
   - 3d-1 ✅ Done — 2026-06-24 (`eb7fc8e`). Hardened PASS 3's anchor fallback: a missing `anchorStart` now falls back to the segment's own `startTime` (then `0`) instead of collapsing toward the timeline origin. Inert at the time of this commit — PASS 2 still backfilled every anchor first, so the fallback was unreachable until 3d-2.
   - 3d-2 ✅ Done — 2026-06-24 (`f27d557`). Deleted PASS 2 (the character-weight anchor backfill) from `applyAnchorBasedTiming` — under clean-slate re-sync no live path produces an unanchored segment, so it was dead for current inputs. The 3d-1 fallback now safely handles any missing anchor (e.g. a pre-6/18 persisted project) without collapsing it to the origin. Added a regression test for that legacy-project case: fails without the 3d-1 fallback, passes with it. Verified: 6/6 vitest, `tsc --noEmit` clean.
   - 3e ✅ Done — 2026-06-24 (`6090250`). Removed the dead anchorSource demotion in handleVoiceoverStaged — its only consumer (the anchor-aware aligner) was deleted in 3c; kept the load-bearing transcriptTokens clear.
4. ✅ Done — 2026-06-24 (5 commits: `b3a13e3` 5.1, `abcc75e` 5.1.3, `72c1fd3` 5.2, `6342c8d` 5.3, `2516a7c` 5.4) — Step 5, headings array-only. The segments array is now the single source of truth for headings: `computeHeadingAnchors`/`reinsertHeadings` (`syncEngine.ts`, 5.1) carry headings forward across re-sync from the previous array (wired into `handleApplySyncFromFiles` in 5.1.3); the `[HEADING:]` scene-text tag is no longer written (5.3) or read (5.4) — `parseProjectData` recognize-and-skips it (still a scene boundary, materializes no segment). 5.4 also deleted the dead heading duration-budget logic and `HEADING_ONLY_DURATION_SECONDS`, fixing a ~1.5s/heading skew. Heading styling now survives re-sync intact. No migration needed for old projects — the array has been the heading source since 5.1.3, so dormant `[HEADING:]` tags left in old `sceneDetails` are inert text. Round-trip tests + smoke-test doc in 5.2 (`docs/heading-array-source-smoke-tests.md`).
5. ✅ Done — 2026-06-24 (`7aaaf67`). Fix Failure B — handleDeleteAsset now clears transcriptTokens / lastTranscribedAssetId / lastTranscribedFileIdentity when the deleted asset is the voiceover; re-uploading the same file after delete re-transcribes instead of syncing against a stale cached transcript.
6. Regression tests — lock the new clean behavior; the real 10→14 repro (4 new scenes + reworded scene 2) must produce a correct, contiguous, sliver-free timeline. ✅ Satisfied by 3b's new tests above (11-OLD / 14-NEW).

**Dropped as obsolete under clean-slate:** Step 6 (duration-drag re-anchor) and 4.5a (merge-loop prevention) — their only purpose was preserving edits across re-sync, which clean-slate no longer does.

**Step 7 — final regression:** ✅ Done — 2026-06-24 (`254ef1b`). Combined-pipeline 11→14 regression test (heading carry-forward + real timing run together in production order — `computeHeadingAnchors` on the OLD array → full timing pipeline on the NEW array → `reinsertHeadings` onto the timed result), asserting contiguous/sliver-free timing, correct heading placement, and no `[anchor]` out-of-order warning (`console.warn` spy). Smoke-test doc extended with the real 11→14 manual checklist; stale heading-budget transient note corrected (5.3/5.4 allocate zero heading duration for `[HEADING:]` tags, so there's no interim oversized-segment state). Verified 17/17 vitest, `tsc --noEmit` clean, manual 11→14 re-sync in the Tauri app — all checks passed.

**Architecture Shift status: ✅ COMPLETE — all steps (1–7) done as of 2026-06-24.**

**Restore tag:** sync-known-good-2026-06-23 (commit a1a326d).
**Newer reference point:** commit `254ef1b` — current `main` HEAD. Closes the clean-slate re-sync Architecture Shift: Step 7 (final regression) on top of 3a+3b+3c+3d-1+3d-2+3e (clean-slate sync rebuild) + dead sync-wizard cleanup (`4890ea6`) + Step 5 5.1–5.4 (headings array-only, dual storage gone), pushed to `origin/main`.
---

2. **Hard delete segment**
   - Bin icon on each segment row in segments tab (same as heading delete) — deletes with confirmation dialog
   - Previous segment absorbs the deleted segment's duration — same as manual `[IMAGE:]` tag removal today
   - Behavior: deleting a segment removes it and the previous segment absorbs its duration (same as removing an `[IMAGE:]` tag).
   - Confirm dialog before delete.
   - Clean-slate interaction: a hard-deleted segment will REAPPEAR on the next Apply Sync if its scene tag still exists in the scene doc (re-sync rebuilds from the doc, nothing carried forward). To delete permanently, the user removes the tag from the scene doc. Document this clearly so it's expected, not a bug.
   - Follows clean-slate principle: no special stale-state preservation.

3. **Version snapshots system**
   - Entry 1: Initial Sync — auto-saved immediately after Apply Sync completes, locked, undeletable
   - Entry 2: Current Progress — auto-updated continuously, single slot, reflects latest state
   - Entries 3+: Manual Snapshots — user clicks "Save Snapshot", named (default timestamp, renameable)
   - Storage: `kinetix:project:{id}:versions:v1` in localStorage, per-project scoped, survives reload
   - Cap: 20 manual snapshots, oldest auto-purges with toast
   - UI: square rounded-corner icon bottom-left of segments tab, opens popup listing versions newest-first
   - Each row shows: name/timestamp, restore (↻), rename (✏️), delete (🗑) — lock icon on Entry 1 hides delete
   - Restore confirmation: "Restore this version? Current state will be saved as 'Before restore — [timestamp]' first." (auto-safety snapshot)
   - On restore: Entry 2 immediately updates to match restored state, user continues from there
   - **OPEN DECISIONS (decide before building):**
     1. Asset restoration on snapshot restore — Design A vs B:
        - Design A: snapshot stores asset LIST only. Restoring after deleting assets = missing/broken assets (deleted blobs are gone). Lower disk use.
        - Design B: deletes are snapshot-protected — asset blobs persist as long as any snapshot references them. Restoring brings back ALL assets fully working. Higher disk use.
        - DECISION PENDING — owner will choose later. Default to neither until decided.
     2. Scene-doc + state on restore is a FULL REWIND (not a merge): restoring rewinds the entire project to that snapshot's exact state (old scene doc, edits, timings). Current state is auto-saved as "Before restore — [timestamp]" first. New scene-doc differences are set aside, not merged.

---

## Deferred

- **Auto-captions** — Not yet built. Investigate current Whisper pipeline status, then implement auto-caption generation. (Whisper transcription already runs for segment timing; auto-captions would surface those tokens as a text layer.)
- **Export-rendering investigation** — ✅ COMPLETE (2026-06-01). Profiling found the export pipeline is I/O-bound, not render-bound: `canvas.toBlob` (47% of frame time) and IPC frame writes (29%) dominate; actual canvas rendering is ~0.1%. Recommendation: OffscreenCanvas + Web Worker (`convertToBlob` off the main thread), projected 40–55% speedup (~120s → ~60–70s on macOS Intel). Full results in `docs/phase-7-task-1-export-profiling.md`.
- **Export-rendering implementation** — Implement the OffscreenCanvas + Web Worker approach the investigation above recommended. Target >50% speedup on macOS and Windows. Unblocked now that the investigation is complete — still deferred, not started.

---

## Rejected from Scope

- **Multi-window simultaneous projects** — 5–10 parallel webviews + renders would thrash the machine. Use tabs in one window or a render queue instead. Revisit only if single-window UX proves insufficient.

---

## Known Issues

- **Preview transition black flash on video boundaries** — when a transition ends on a video segment, the newly-mounted `<video>` element shows ~100-200ms of black before its first decoded frame paints. Attempted fix (canvas hold + canplay listener + failsafe timeout) did not engage reliably across multiple debugging rounds — root cause never isolated. Removed in favor of shipping the working blend without the hold. Future fix likely requires pre-mounting the next video element offscreen during the pre-roll window, or replacing the canvas blend entirely with a dual-video CSS opacity crossfade. Exports are unaffected — issue is preview-only.

- **Preview letterboxing in normal view** — carried forward from an earlier audit; low-priority cosmetic issue. (The original note never recorded more detail than this.)

- **Video preview jumps to near-start of current segment on resize drag release** — audio position is unaffected and exports are correct. Three fix approaches attempted (isResizing prop, isResizingRef, stable useCallback ref) — all blocked by the same root cause: `currentSegment` `useMemo` re-resolves with new `startTime`s in the same render that clears the resize guard. Deferred until a larger PreviewStage refactor makes a DOM-direct seek approach feasible.

- ~~**Orphaned IndexedDB blob on audio re-stage**~~ — ✅ **RESOLVED (`3b0593c`).** Re-staging audio writes a new IndexedDB blob via `putAsset` with no content dedup; the `oldIdx` splice in `handleApplySyncFromFiles` removed the asset from `project.assets` without calling `deleteAsset`, leaving an orphaned blob. Fixed by pairing the splice with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern.

- ~~**Clipped search window when a new scene is inserted next to an "absorbed" boundary**~~ — ✅ **RESOLVED.** Originally attributed to `alignScenesToTranscriptAnchorAware` (`src/services/whisperService.ts`), which bounded a new/estimate segment's text-matching search window using its nearest surviving whisper-anchored neighbors' `anchorStart` values. If one of those neighbors' anchors was itself positioned by an *earlier* sync's gap-fill pass absorbing audio for content that had no bracket at the time, the resulting window could be narrower than the new segment's own word count — forcing `alignScenestoTranscript`'s sliding-window match to lock onto the wrong (preceding) words instead of the new segment's real content. Confirmed via real-scene-text repro during Step 4.5b investigation (2026-06-23): inserting a new `012_tape_deck` bracket between unchanged `011_cloth_seats` and `013_cd_adapter` — where `013`'s carried-forward anchor had pre-absorbed the (then-unbracketed) "tape deck" audio from the original sync — produced a 0.225s sliver on `011_cloth_seats` and misplaced `012`'s content. **Fixed in `8615639`** (clamped each boundary's gap-fill search window to its two neighboring segments' own spoken edges — the bug actually lived in the shared `alignScenestoTranscript` gap-fill logic, not anything unique to the anchor-aware path it was originally attributed to). The anchor-aware function this entry originally named was itself later deleted in clean-slate step 3c (2026-06-24, commits `5da64df`/`8523f39`).

---

## SaaS Readiness Tasks

> Items required before public launch or multi-user distribution. Not scheduled — tracked here so they aren't forgotten.

- **Backend proxy for API keys** — Pexels/Pixabay/Coverr keys currently in JS bundle (VITE_ prefix). Required before public launch.
- **Auth layer** — No authentication; open access. Required for multi-user.
- **LGPL ffmpeg swap** — Current sidecar is GPL (libx264). Swap for LGPL-only build (OpenH264 or commercial x264 license) before public distribution.
- **4K export validation** — 1080p verified on macOS + Windows. 4K UI option exists but untested. Validate before advertising 4K support.
- **playbackSpeed UI re-expose** — Logic preserved in App.tsx; UI dropdown removed during 2026-06-17 BottomDrawer redesign. Re-expose as compact dropdown if user testing shows it's needed.

---

## Key Invariants

Non-negotiables. Future work — especially the Architecture Shift active task — must not break these without a deliberate, documented decision.

- **(a) Sync timing is regression-locked.** `src/services/syncTiming.test.ts` (8 vitest tests, added in commit `05398f4` "lock sync timing pipeline with regression test") plus the `sync-known-good-2026-06-20` tag protect the sync/anchor timing pipeline. Tag message: *"Known-good single-click ms-correct sync. Baseline for per-slot re-sync work. Restore/bisect target if sync drifts."* Bisect or restore against this tag before reaching for a new fix if sync ever drifts again.
- **(b) Σ segment duration = voiceoverDuration.** Total segment duration must always equal the voiceover's duration. Transition overlaps cancel pairwise by construction (Path B cross-fade design, Decisions Log 2026-05-25), so this holds without special-casing `App.tsx`. This isn't theoretical: removing `splitAudio` in Heading Round 5 broke this invariant and cost 4 rounds of drift-bug fixes before headings were rebuilt as pure overlays.
- **(c) Headings are pure overlays** — no audio/duration splitting; insert/delete absorbs duration via a 50/50 split with neighbors (Heading Round 5). Fully array-only since Step 5 (5.1–5.4, done 2026-06-24, commits `b3a13e3`/`abcc75e`/`72c1fd3`/`6342c8d`/`2516a7c`): the segments array is the sole source of truth, never serialized to `sceneDetails` text — 5.3 stopped writing the `[HEADING:]` tag, 5.4 stopped `parseProjectData` reading it (recognize-and-skip: still a scene boundary, no segment). Dual storage is gone.
- **(d) Transcription cache validity is keyed by file identity, not asset id.** `getFileIdentity(file) = \`${file.name}|${file.size}|${file.lastModified}\`` (`src/services/syncEngine.ts:216`), cached as `Project.lastTranscribedFileIdentity` (`src/types.ts:215`). Necessary because every file-stage event mints a fresh `Asset` id even when the user re-picks the identical file — id/reference equality can't catch a re-stage, but name+size+lastModified can.
- **(e) `anchorSource` provenance only ever moves one direction.** `'whisper'` = precise audio alignment; `'estimate'` = character-weight approximation that Whisper can still realign later. An anchor may be demoted `whisper → estimate` but is never promoted back, regardless of text changes (enforced by `syncTiming.test.ts`).
  - *Post-3c follow-up note — closed 2026-06-24 (post-3d-2):* `anchorSource` is confirmed effectively write-only — no production code branches on `'whisper'` vs `'estimate'`. Still written by `parseProjectData`, `applyAnchorBasedTiming` PASS 1, `distributeSegmentTimes`, and `handleInsertHeading` (PASS 2, the other writer, was deleted in 3d-2). Now documented directly in the `anchorSource` doc-comment in `src/types.ts`; no further cleanup planned.

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-05-16 | **Hosting:** Cloudflare Pages for frontend. Free tier, edge CDN, unlimited bandwidth. Render backend deferred to Phase 3. |
| 2026-05-16 | **Target users:** YouTube creators. Initial private use across 5–10 channels owned by user's team. |
| 2026-05-16 | **Export approach:** ffmpeg.wasm in browser for Phase 3. Slower than native (3-5×) but $0 infra, works offline, no server. Pipeline code will port to native ffmpeg in Phase 6 with minimal changes. |
| 2026-05-16 | **Long-term distribution:** Desktop app via Tauri (Phase 6). Web app remains the development target through Phases 3-5; desktop wrap converts the same codebase. Native ffmpeg replaces ffmpeg.wasm for full-speed renders. |
| 2026-05-16 | **Branch strategy:** `main` is the stable branch. Feature work goes on short-lived branches, merged via PR. |
| 2026-05-16 | **Output format:** MP4 required for YouTube upload. Current WebM output is unacceptable for production — this is a Phase 3 blocker. |
| 2026-05-17 | **ffmpeg.wasm encode speed:** ~25s wall-clock per 1s of 1080p output (≈1.35s per frame at 30fps). Acceptable for Phase 3 validation; production-grade speed requires Phase 6 native ffmpeg via Tauri. |
| 2026-05-17 | **(Historical — wasm path removed in Phase 6.4) Safari export verified:** `crossOriginIsolated=true`, `SharedArrayBuffer` available, COOP/COEP headers correct, export completes, MP4 plays in VLC with H.264 + AAC. No code changes required for Safari support. |
| 2026-05-17 | **Global transition fallback:** `segmentEncoder.ts` now falls back to `project.globalTransition` when a segment's own `transition` field is NONE. Per-segment overrides take precedence. "Override all per-segment transitions" button in Settings still materializes the global value onto segments for per-segment overrides. UX revisit deferred to Phase 5. |
| 2026-05-21 | **Item 3 approach (preview transitions):** Pre-roll snapshot blend (option b). When playhead enters transition window, snapshot outgoing + incoming first frame to offscreen canvases, blend over transition duration via applyTransitionBlend. Universal coverage across image/video, single seek cost lands during pre-roll (before transition visually starts). Rejected option (a) image-only canvas overlay (asset-type branching complexity) and option (c) skip-and-document (would leave preview-vs-export gap user said to close). |
| 2026-05-21 | **NEON_FLICKER glow:** Implemented as ctx.shadowBlur + shadowColor pass on top of keyframe alpha pulse. Documented fallback path if visual quality regresses on dark backgrounds. |
| 2026-05-21 | **Overlay drag clamp policy:** Hard-clamp drag to [halfW/2, 100-halfW/2] (percent). Off-canvas positioning explicitly rejected — overlay drag is positioning, not animation authoring; off-screen reveal effects belong to AnimationType, not overlay position. |
| 2026-05-25 | **Path B over Path A:** The export pipeline now renders true cross-fades (both segments advance during the fade window) rather than holding the incoming segment static. Mechanism: outgoing segment encodes `trailingExtension` seconds past its boundary; incoming segment skips its first `transitionDuration` seconds via `startTimeOffset`. Overlap contributions cancel pairwise on the timeline, so `Σ duration = voiceoverDuration` invariant is preserved without changing `App.tsx`. Commit `261936f`. |
| 2026-05-26 | **Tauri v2 desktop wrap:** Chose Tauri (not Electron) for desktop packaging — smaller bundle, native WebKit, Rust backend. `tauri-plugin-shell` v2.3.5 provides the sidecar API. |
| 2026-05-26 | **Sidecar name resolution:** `sidecar("ffmpeg")` must use the bare name (no `binaries/` prefix). `tauri-build` copies `src-tauri/binaries/ffmpeg-<triple>` → `target/debug/ffmpeg` (strips both triple AND path prefix via `file_name()`). Runtime `relative_command_path()` constructs `{exe_dir}/ffmpeg` — exact match. Using `sidecar("binaries/ffmpeg")` resolves to `{exe_dir}/binaries/ffmpeg` which doesn't exist. |
| 2026-05-27 | **Static evermeet.cx ffmpeg build over Homebrew:** Homebrew binary (385 kB) was dynamically linked to `/usr/local/Cellar/ffmpeg/…/lib/` — not portable to machines without Homebrew. evermeet.cx 8.1.1 static build (76 MB) links only `/System/Library/` and `/usr/lib/` (verified via `otool -L`). Binary is gitignored; `src-tauri/binaries/README.md` documents re-provisioning. |
| 2026-05-27 | **Base64 IPC for frame writes:** Encoding `Uint8Array` as base64 before IPC and decoding on the Rust side eliminates the JSON-array-of-numbers serialization bottleneck. Speedup: 551s → 120s for a 4-segment project (4.6×). Further optimizations (Tauri Channel API binary IPC) deferred to Phase 7 if needed. |
| 2026-05-27 | **GPL sidecar for internal distribution:** evermeet.cx build compiled with `--enable-gpl` (includes libx264). GPL is acceptable for internal distribution (closed, no redistribution). Before public SaaS launch: swap for LGPL-only build (OpenH264 or commercial x264 license). Tracked as SaaS readiness item in `src-tauri/binaries/README.md`. |
| 2026-05-27 | **Branch strategy update:** Continuing short-lived feature branches, but merging directly to `main` with `git merge --no-ff` rather than via PR (single-developer workflow). |

---

## Open Questions

- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [x] Dangling segment references on asset delete — **Resolved (Phase 4, Step 3):** cleaned up at delete time via `c7515e5`.
- [x] Bundle splitting — **Resolved (Phase 4, Step 5):** jszip, StockSearchModal, SyncReviewModal are now lazy-loaded. Main bundle: 542 kB → 433 kB.
- [x] Stock API key handling — kept client-side for internal use; backend proxy deferred (tracked in Long-running Deferred Items as "Backend proxy for API keys — required for public launch").
- [x] **Phase 3 end-to-end export verified — 2026-05-17.** Multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. Verified before `phase-3-export` merged to `main`.

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 2,777 |
| Project persistence | Per-project scoped: `kinetix:project:{id}:v1` + registry `kinetix:projects:v1` in localStorage (legacy single-project key `kinetix:project:v1` retained for one-time migration only) |
| IndexedDB | `kinetix-assets` DB v2, store `assets-v2`, compound keyPath `['projectId','id']` (legacy v1 store retained for migration) |
| Total dependencies | 6 prod + 12 dev |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | Native ffmpeg sidecar (evermeet.cx 8.1.1 static build, GPL) via Tauri `tauri-plugin-shell` |
| Export speed (1080p/30fps) | macOS Intel (x86_64): ~10× realtime (120s for 12s of output); Windows: ~6× realtime (6 min per 1 min of video, measured on brother's PC); macOS arm64: pending measurement |
| Frontend bundle size | 505.86 kB / 152.74 kB gzip main bundle (measured 2026-06-22; no wasm in bundle — ffmpeg is a sidecar binary) |
| Lazy chunks | StockSearchModal 8.79 kB · jszip 95.87 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Transition enum values in UI | 10 (only implemented transitions shown) |
| Filter names in UI | 26 (only implemented filters shown) |
| AnimationType values rendered in export | 12 (all applied via `canvasAnimations.ts`) |
