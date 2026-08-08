# Undo / Redo — Design

> **STATUS: DESIGN ONLY. NOTHING IS BUILT.** No production code was written for this
> document and none should be until it is approved. Written 2026-08-08 at HEAD `32fe35f`,
> working tree clean, suite at 1530 tests (1529 pass / 1 skip).
>
> **Why now.** Undo/redo is the stated mitigation for closing checklist step 10 as an
> accepted limitation (`docs/wkwebview-drag-checklist.md`). It does not stop an interrupted
> drag from dirtying state; it changes that state from unrecoverable to recoverable. That
> is the trade the owner accepted, so this needs to be a real design, not a gesture at one.

---

## 1. The seam

### 1.1 `setProject` is the choke point — confirmed [MEASURED]

`project` is a single `useState<Project>` declared once, at `src/App.tsx:1122`. Every
mutation of the project — segments, headings, assets, text layers, sync log, settings —
goes through its setter.

| Measurement | Count | Source |
|---|---|---|
| `setProject(` call sites in `src/App.tsx` | **61** | `grep -c "setProject(" src/App.tsx` |
| `setProject(` call sites elsewhere in `src/` (non-test) | **1** | `DevTestPanel.tsx:89` |
| **Total real write sites** | **62** | |
| Writers of `projectRef.current` | 1 (`App.tsx:3268`, a read-only mirror) | `grep -n "projectRef.current ="` |

**Correction to the brief's figure.** The brief says "~79 write sites", which is the number
written in `App.tsx`'s own gapless-assertion comment (line ~2718). The actual count today is
**62**. The comment is stale; nothing depends on the number, but it should be corrected when
that region is next touched, and this document uses the measured figure.

The one call site outside `App.tsx` is not a second setter. `DevTestPanel.tsx` receives
App's own setter as a prop (`App.tsx:4654`, wrapped as
`(p) => { setProject(p); setShowDashboard(false); }`), so it funnels through the same state.

### 1.2 Bypassing paths — none found [MEASURED]

Searched for direct mutation of the committed project graph:

- `grep -rnE "project\.segments\[.+\]\.[a-zA-Z]+ ="` over all of `src/` (excluding tests) —
  **zero hits.** The repo's immutable-update convention (`CLAUDE.md`'s DO-NOT-DO table) is
  actually held.
- `projectRef.current` is assigned in exactly one place, from `project`, inside an effect.
  It is a read mirror for non-rendering consumers (the drag session, the sync pipeline); no
  code writes *through* it.
- `setEditingSegment` (the full-edit modal) and the drag session's live DOM writes are the
  two places state appears to change outside `setProject`. Neither is a real bypass:
  `setEditingSegment` holds a **draft** that is committed via `setProject` on "Apply Changes"
  (`App.tsx:~4590`), and the drag session writes `style.left`/`style.width` **only** —
  deliberately behind React's back for the live preview, discarded on release, and always
  resolved into a real `setProject` (commit) or a revert.

**Conclusion: `setProject` is a genuine single funnel, and there are no silent history
holes.** The DEV-only gapless assertion already relies on exactly this property, and has
done since 2026-08-07 without a counterexample.

### 1.3 The capture mechanism, and the one thing that must not be done

Capture must **not** be threaded through all 62 call sites. That is the failure mode the
gapless assertion explicitly rejected — a per-call-site obligation rots the moment someone
adds site 63 — and its reasoning applies identically here.

Two shapes work:

**(a) A wrapper setter.** Rename the raw setter to `setProjectRaw` and export a
`setProject` that pushes the previous value onto the undo stack before delegating. All 62
sites keep their exact current syntax; only the identifier they resolve to changes.

**(b) An effect keyed on `project`,** mirroring the gapless assertion's own structure.

**(a) is the recommendation**, for one reason: an effect cannot tell whether a change was a
user edit or an undo/redo restoring one, so it would need a suppression flag anyway — and a
suppression flag read from an effect is a race, whereas the wrapper knows synchronously at
the call. (b) also cannot distinguish gesture boundaries, which §3 needs.

The wrapper is where §3's coalescing and §4's invariant check live, so it is not merely
plumbing.

---

## 2. Snapshot vs. command/patch

**Recommendation: SNAPSHOTS, with structural sharing.** Size does not rule them out — not
close.

### 2.1 The measurement [MEASURED]

Built from the real corpus projects (`docs/phase4-baseline-*-segments.csv` for the committed
segment arrays, `.work-phase4/replay/*/transcript_tokens.json` for the real token arrays),
populated with the field set `App.tsx` actually writes onto a synced `VideoSegment`
(`overlayConfig`, `effectGrade`, `effect*` slugs, trim/speed/source duration, anchors).
Figures are JSON bytes.

| Project | Segments | `segments[]` | `transcriptTokens` | Whole `Project` |
|---|---|---|---|---|
| **v6** (largest corpus project) | 444 | 292,806 B | 219,431 B | 563,445 B |
| **173** | 172 | 115,854 B | 100,455 B | 267,517 B |
| **spanish** | 26 | 17,239 B | 18,308 B | 83,457 B |

History cost, **structural sharing** — a snapshot is a shallow `Project` copy; only the
sub-objects an edit actually replaced are new, and `transcriptTokens` (the single largest
field, never touched by an edit) is shared by reference across every entry:

| Project | Per entry | Depth 50 | Depth 100 | Depth 200 |
|---|---|---|---|---|
| v6 (444 segs) | 293 kB | **14.6 MB** | 29.3 MB | 58.6 MB |
| 173 | 116 kB | 5.8 MB | 11.6 MB | 23.2 MB |
| spanish | 17 kB | 0.9 MB | 1.7 MB | 3.4 MB |

For contrast, a naive `structuredClone` of the whole `Project` per entry — no sharing at all:

| Project | Per entry | Depth 50 | Depth 100 |
|---|---|---|---|
| v6 | 563 kB | 28.2 MB | 56.3 MB |
| 173 | 268 kB | 13.4 MB | 26.8 MB |

### 2.2 Reading the numbers honestly

- These are **JSON byte counts, not V8 heap.** A live object graph typically runs 2-4× its
  JSON size. So the recommended configuration (v6, depth 50, structural sharing) is
  **14.6 MB of JSON ≈ 30-60 MB resident** in the worst realistic case.
- Context for whether that is affordable: this app already loads a **1.6 GB** Whisper model
  (`ggml-large-v3-turbo.bin`, measured 1,624,555,275 bytes) with ~2.1-2.2 GiB peak during
  inference, and holds decoded `VideoFrame`s and waveform peak arrays for a 21-minute
  voiceover. 30-60 MB is not the constraint.
- **The number is dominated by `segments[]`, and `segments[]` is what an edit changes.**
  So a patch scheme would not save the bulk of it either — only the difference between "the
  whole array" and "the changed elements", which for a drag is 2-4 segments out of 444. A
  patch scheme is roughly 100× smaller per entry. It is also enormously more complex, and
  buys that saving in a place where 14.6 MB is already fine.

### 2.3 Why snapshots win beyond size

1. **Restore is `setProject(entry)`.** There is no inverse operation to write, per edit
   type, and no inverse to get subtly wrong. With 62 write sites of very different shapes
   (Apply Sync commits an entire re-derived project; the drag commits a cascade; a grade
   slider writes one field), a command scheme means 62 inverses maintained by hand.
2. **§8's golden-replay guarantee is trivial under snapshots and hard under patches.** A
   snapshot restores a value the pipeline itself produced; a patch *recomputes* one.
3. **§4's invariant check is a single call on a whole array.** Patches would need it after
   each application.

**Stated plainly, as asked: size does not rule snapshots out.** Recommend snapshots.

---

## 3. Granularity

**The rule: one user gesture = one history entry.**

### 3.1 Drags — one entry on commit, zero otherwise

This rides directly on the Stage 1′ `finally` teardown in `dragSession.ts`. A drag has
exactly three resolutions and they already funnel through one `handleUp`:

| Resolution | `setProject` called? | History entry |
|---|---|---|
| **Commit** (genuine pointerup, moved) | yes — `commitDurationChange` | **exactly 1** |
| **Revert-blocked** (locked neighbour) | yes — `revertSegments(originalSegments)` | **0** |
| **Discard** (`pointercancel`) | yes — `revertSegments(originalSegments)` | **0** |
| No movement at all | no | **0** |

The live preview writes no state at all — it writes `style.left`/`style.width` directly —
so the 60 frames of a gesture are structurally incapable of producing entries. That is a
property of the existing architecture, not something this design has to add.

The two revert paths **do** call `setProject`, so a naive wrapper would record them. The
handling: `revertSegments` restores `originalSegments`, which is by definition the array
that was already the top of history, so the entry is a **no-op duplicate**. Two options —

- **(i)** have `revertSegments` call a `setProjectSilent` that bypasses capture;
- **(ii)** have the wrapper drop an entry whose `segments` array is reference-identical to
  the current top.

**Recommend (i).** It is explicit at the one call site that means it, and does not rely on
reference identity surviving future refactors. (ii) is a reasonable belt-and-braces addition.

### 3.2 Coalescing rule for continuous controls

Sliders and text fields fire many `setProject` calls per gesture and must not produce many
entries.

**The rule:** an entry is opened by the first write carrying a given *coalescing key*, and
stays open — absorbing every subsequent write with the same key — until either

- **800 ms** elapse with no further write of that key, **or**
- a write arrives with a *different* key, **or**
- focus leaves the control, or the active segment/selection changes.

The **coalescing key** is `(control identity, target identity)` — e.g.
`grade:brightness:<segmentId>`, `overlayText:<segmentId>:<overlayId>`,
`playbackSpeed:<segmentId>`. Keying on the target as well as the control is what makes
"drag brightness on segment 5, then drag brightness on segment 9" two entries rather than
one, which is what a user means.

Discrete actions (a button, a toggle, a lock, Apply Sync, a drag commit) carry **no**
coalescing key and always open and immediately close their own entry.

Notes on the 800 ms figure: `EffectsPanel`'s grade sliders already debounce their writes at
120 ms, so a continuous drag emits roughly 8 writes/second and 800 ms is comfortably longer
than the inter-write gap while still short enough that a deliberate pause reads as a new
edit. It is **chosen, not tuned against a real hand** — same honesty as the auto-scroll ramp
constants — and should be revisited after first use.

---

## 4. Scope — what is undoable

**Undoable (all of it is `Project` state):**

- segment timing — every drag commit, the playback-speed slider's duration coupling, the
  segment editor's numeric duration field
- segment content — asset assignment, trim, overlay text and formatting, per-segment
  transition/animation/filter/grade
- global aesthetics — global transition/animation/filter/overlay config, apply-to-all
- headings — insert, delete, move, resize, edit
- text layers — add, edit, delete, per-segment toggle
- locks — lock/unlock, lock-all/unlock-all
- **Apply Sync** — see §5, this is the one with a caveat

**NOT undoable (deliberately — none of it is `Project` state):**

- **playback position** (`currentTime`) and play/pause
- **zoom** (`sliderT`) and **timeline scroll** (`timelineScrollLeft`)
- **selection** (`selectedSegmentId`, `selectedSegmentIds`, `selectedHeadingId`) and which
  tab/panel is open
- panel sizes, fullscreen, global playback speed
- export settings and the export run itself
- project switching, project deletion, asset deletion from IndexedDB

The line is drawn exactly where the state lives: everything in `useState<Project>` is
undoable; everything in the sibling `useState`s and `uiStateStore` is not. That is a rule
someone can apply without consulting a list, which is why it is preferable to a curated one.

**On selection specifically** — the brief is right that getting this wrong makes undo feel
haunted, and there are two distinct failure modes:

- *Restoring* selection on undo is the haunted one: the user undoes a timing change and the
  editor jumps to a segment they are no longer looking at. **Do not do this.**
- *Failing to repair* selection is the other: undoing back past a heading's creation can
  leave `selectedHeadingId` pointing at something that no longer exists. So selection is not
  restored, but it **is validated** after every restore — a selection whose target is gone
  is cleared, exactly as `handleSwitchProject` already does
  (`prev && rehydratedSegments.some(s => s.id === prev) ? prev : null`).

Same for `currentTime`: not restored, but clamped into the restored timeline's bounds.

---

## 5. Invariant safety

**Every restore goes through the same `setProject` wrapper as every other write**, so it is
subject to the identical DEV gapless assertion (`App.tsx`'s `project.segments`-keyed effect)
and the identical export guard (`checkTimelineIsGapless`). Undo is not a back door around
Model P, structurally — it cannot be, because it is not a second write path.

Beyond that, snapshots make the question nearly vacuous: **every stored state was itself
produced by a write that already passed the assertion.** Undo restores a value the pipeline
committed, not one it computes. A patch scheme would not have that property, which is a
third argument for §2's recommendation.

One addition worth making explicit: the restore should assert **before** committing, in DEV,
with the entry's index in the message. If history ever does contain a bad state, the useful
information is *which* entry, and a violation surfacing only after the restore loses that.

**The Apply Sync caveat.** Apply Sync is undoable as a single entry — but undoing it does
not un-transcribe. `transcriptTokens` and the waveform are expensive derived data shared by
reference across snapshots (§2), and a snapshot taken before Apply Sync would restore
`transcriptTokens: undefined`, discarding a multi-minute Whisper run. **Recommendation:
`transcriptTokens`, `lastTranscribedAssetId`, `lastTranscribedFileIdentity`, and `language`
are EXCLUDED from restore** — carried forward from current state rather than taken from the
snapshot. They are cache/provenance, not user-authored content, and re-deriving them is not
what the user asked for by pressing Cmd+Z. This is a real exception to "restore is
`setProject(entry)`" and must be implemented as an explicit, named merge, not left implicit.

---

## 6. Depth, eviction, and clearing

- **Depth: 50 entries.** At v6's 293 kB/entry that is 14.6 MB JSON (§2.1) — the number the
  recommendation is sized against. 50 is well past the ~10 the literature says users
  actually reach, and it keeps the worst realistic project inside a budget that needs no
  further argument.
- **Eviction: FIFO from the oldest end**, on push past depth.
- **Redo is discarded on any new edit** — the standard linear model. No redo tree.
- **History is CLEARED on:** project load/switch, New Project, the DEV scale-fixture load,
  and project deletion. All four are "this is a different project now"; an undo stack that
  survived them could restore another project's segments onto this one's assets.
- **Apply Sync does NOT clear history** — it pushes one entry like any other edit (with §5's
  caveat). Undoing an Apply Sync you did not want is one of the most valuable things this
  feature can offer.

### Persistence across reload: **NO. Recommended against.**

Three reasons, in order of weight:

1. **The blobs do not survive.** `Asset.url` is a `blob:` URL, deliberately stripped before
   persistence (`projectStore.ts`) and reconstructed on load from IndexedDB. A persisted
   history entry would carry stale asset references, and the hydration path's existing
   drop-missing-asset logic would have to be re-run per entry — 50 times, on every load.
2. **It changes what undo means.** In every editor users know, Cmd+Z reaches back through
   *this session's* work. History surviving a reload invites undoing an edit from days ago
   with no memory of what it was.
3. **Cost with no matching benefit.** 14.6 MB into `localStorage` is not viable (it would
   need IndexedDB and its own store, versioning, and migration), and the existing 500 ms
   debounced project save would have to serialise it.

---

## 7. Keyboard shortcuts

| Action | Binding |
|---|---|
| Undo | `Cmd+Z` (macOS) / `Ctrl+Z` (Windows) |
| Redo | `Cmd+Shift+Z` / `Ctrl+Shift+Z` |
| Redo (Windows convention) | `Ctrl+Y` — accepted **in addition**, not instead |

Implementation goes in the existing `window` `keydown` effect (`App.tsx:3391-3438`), as a
new branch alongside Space / `+` / `-` / arrows / `F` / the DEV panel toggle.

**Focus suppression — mandatory, and the existing pattern already has it.** Every branch in
that handler guards on `isTextEntryElement(document.activeElement)` (`App.tsx:1112`), which
exists precisely because a focused range slider was trapping the spacebar. Undo/redo must
use the same guard and must be **stricter** about it than the others: `Cmd+Z` inside a text
field is the browser's own text undo, and stealing it would make every text field in the app
feel broken. Concretely, suppress the global handler when:

- `isTextEntryElement(document.activeElement)` is true — script/scene textareas, overlay
  text inputs, the numeric duration field, project name, search;
- a modal owning its own key handling is open — `ProjectSettingsModal`,
  `ExportSettingsModal`, `ReviewMappingModal`, `NewProjectModal`, `DevTestPanel` (five
  separate `window` keydown listeners exist today, `grep` confirmed);
- an export is in flight (undoing a timing change mid-render is meaningless and the pipeline
  has already snapshotted).

### Two platform risks, flagged explicitly

**(a) WKWebView interception.** This app has a documented history of the shell swallowing
input, and it is not speculative:

- the browser Fullscreen API "silently fails in the Tauri WebView shell" and had to be
  replaced with `getCurrentWindow().setFullscreen()`;
- after any fullscreen exit, keyboard focus reaches the OS window but **not** the embedded
  WebView, requiring a bespoke `restoreWebViewFocus()` (`getCurrentWebview().setFocus()` +
  window focus + three DOM focus fallbacks);
- the ghost-click swallower exists because WKWebView's synthetic post-release click lands
  somewhere the code did not expect.

So **`Cmd+Z` reaching the `window` listener at all must be verified in the real shell before
this feature is called done** — it is a manual checklist step, not an assumption. If it does
not arrive, the fallback is a Tauri-side global shortcut or a native menu accelerator
forwarding to the webview via an event.

**(b) Native menu conflict.** [MEASURED] `src-tauri/tauri.conf.json` and `src-tauri/src/lib.rs`
declare **no menu at all** — `grep -n "menu"` returns nothing in either. On macOS, Tauri
supplies a default application menu, whose **Edit** submenu carries `Cmd+Z`/`Cmd+Shift+Z`
bound to the OS text-editing responder. That is a genuine conflict and the most likely place
this breaks. It also has a silver lining: those bindings are exactly what should keep working
inside a focused text field, so the correct end state may be to let the native menu own
`Cmd+Z` when a text field has focus and the app own it otherwise — which is what §7's
suppression rule already produces. **Resolving this needs a real-shell test, and it is the
single riskiest unknown in this document** (see §11).

---

## 8. Buttons

- **Placement:** the timeline toolbar, immediately left of the zoom slider — the same
  cluster as the other timeline-wide controls, and adjacent to where edits happen. Not in
  the top bar, which is project-level (Export, Projects, Settings).
- **Icons:** lucide-react `Undo2` / `Redo2`, matching every other control in the app.
- **Disabled state:** greyed and non-interactive when the respective stack is empty, using
  the app's existing disabled treatment. Disabled, not hidden — a control that disappears
  makes users hunt for it.
- **Labelling the next action: YES, in the tooltip only.** `Undo lock segment 12`,
  `Redo resize segment 4`. This requires each history entry to carry a short human label,
  which the wrapper can take as an optional argument — cheap, and it is what makes a 50-deep
  stack navigable. Do **not** put the label in the button face: it changes width on every
  edit and the toolbar reflows.
- **No history dropdown** in the first version. It is a genuinely useful feature and a
  separate one.

---

## 9. Golden-replay risk

**The guarantee: undo/redo cannot alter committed timings for any corpus project, because it
adds no code to the sync pipeline and computes no timing.**

Specifically:

1. `scripts/phase4-handoff-replay-sync.test.ts` imports `parseProjectData`,
   `alignScenestoTranscript`, `distributeSegmentTimes`, `applyAnchorBasedTiming`,
   `headExtendFirstSegment`, and `snapCoveredBoundaries` **directly** — it never renders
   `App`, never touches `useState`, and never reaches a `setProject`. A wrapper around a
   React setter is not in its import graph at all.
2. Snapshots (§2) **store and restore values the pipeline produced**. There is no
   recomputation, so there is no opportunity to produce a different number. This is the
   design property that makes the guarantee structural rather than a hope, and it is the
   strongest single argument against a command/patch scheme, which *would* recompute.
3. The one place a diff could sneak in is §5's excluded-field merge. That is why it must be
   an explicit named function with its own unit test asserting the excluded set exactly —
   an implicit spread would be the exact shape of a silent regression.

**Verification requirement:** the golden replay runs unchanged at every phase boundary in
§11, and must stay byte-identical. If it moves, the phase does not land.

---

## 10. Test strategy

Minimum bar, all of it:

1. **Round-trip identity.** For each of a representative set of edits (drag commit, lock
   toggle, grade write, heading insert, text-layer delete, apply-to-all): do → undo →
   `expect(project).toEqual(before)`, **deep**, not by reference.
2. **Redo identity.** do → undo → redo → `expect(project).toEqual(afterDo)`.
3. **Property: random N-operation round trip.** Apply N random operations from the edit
   vocabulary, then undo N times, and assert byte-identical return to the initial state; then
   redo N times and assert return to the final state. Sweep N and the seed. This is the test
   that finds the edit whose inverse nobody thought about.
4. **Discarded drags create no entry.** Through the **real** `DragSessionHarness`, not a
   mock: a `pointercancel` discard, a locked-neighbour block, and a press-release with no
   movement each leave `historyDepth` unchanged; a genuine commit increments it by exactly 1.
   The harness already resolves all four outcomes, so this is a new assertion on existing
   machinery.
5. **Coalescing.** 30 slider writes inside the window produce 1 entry; a write after the
   window produces a second; a write with a different coalescing key produces a second
   immediately.
6. **Invariant safety.** Every state reachable by undo/redo in the §3 property test passes
   `findPartitionViolations` — reusing the existing checker, not a new one.
7. **Eviction and clearing.** Depth cap holds at 50; the oldest entry is evicted; project
   switch/New Project/fixture load clear both stacks; a new edit after an undo discards redo.
8. **Excluded-field merge (§5).** A snapshot taken before Apply Sync, restored, keeps the
   current `transcriptTokens` and does not resurrect `undefined`.
9. **Selection repair (§4).** Undoing past a heading's creation clears a selection pointing
   at it; `currentTime` is clamped into the restored bounds.

---

## 11. Phased plan

Smallest shippable slice first. Test-count deltas are estimates.

| Phase | Scope | Ships? | Tests |
|---|---|---|---|
| **1 — the seam** | `historyStore.ts`: pure push/undo/redo/evict/clear over an opaque state type. No React, no `App.tsx` changes. Depth, eviction, redo-discard, clearing. | No (nothing wired) | **+20** |
| **2 — wrapper + drags only** | `setProjectRaw`/`setProject` wrapper; `setProjectSilent` for the two revert paths. Only drag commits captured; everything else silent. Buttons rendered, no shortcuts. Item 4 of §10 in full. | **YES — the smallest useful slice.** Undo an unwanted drag, which is exactly step 10's mitigation. | **+18** |
| **3 — full scope** | Every other edit captured. §5's excluded-field merge with its own test. §4's selection repair and `currentTime` clamp. Round-trip + redo identity across the edit vocabulary. | Yes | **+30** |
| **4 — coalescing** | §3.2's key + 800 ms window for sliders and text fields. | Yes | **+12** |
| **5 — shortcuts** | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y, with §7's suppression. **Gated on a real-shell manual verification** that the keys arrive and the native menu does not eat them. | Yes | **+10** |
| **6 — property test + labels** | §10 item 3's random N-operation round trip; entry labels and button tooltips. | Yes | **+8** |

**Total: roughly +98 tests, 1530 → ~1628.** Golden replay must stay byte-identical at every
phase boundary.

---

## 12. The decision I am least confident about

**§7(b) — whether the global `Cmd+Z` handler can own the shortcut at all in the real
WKWebView/Tauri shell.**

Everything else here is settled by measurement or by an existing pattern in the codebase.
This one is a guess about a platform, and the codebase's own history is a warning: the
browser Fullscreen API silently fails in this shell, keyboard focus does not return to the
webview after a fullscreen exit without three layers of fallback, and a native macOS menu
this app has never configured is presumed — not verified — to be binding `Cmd+Z` to the OS
text responder. Any of those could mean the key never reaches `window`, or reaches it only
sometimes depending on focus, which is worse.

**What would resolve it:** a ten-minute experiment in the real shell, before Phase 5 and
ideally before Phase 2 — add a temporary `keydown` logger to the existing effect, run
`npm run tauri:dev`, and press `Cmd+Z` in four states: (a) nothing focused, (b) a text field
focused, (c) a range slider focused, (d) immediately after exiting fullscreen. Record which
of the four reach the listener and whether the native Edit menu flashes. That single result
decides between the `window`-listener design above and a Tauri-side global-shortcut or
menu-accelerator design — and it is much cheaper to run now than to discover at Phase 5,
after four phases have been built on the assumption.

I did not run it in this session because Stage 3 is design-only and that experiment requires
launching the real app.
