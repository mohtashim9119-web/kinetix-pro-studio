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

## REVISION 2 — owner decisions folded in (2026-08-08, WS2 Stage 2)

Revision 1 (everything below) was written as a set of recommendations. The owner has now
ruled on all of them. This section records **what changed as a result**, so a reader can see
which parts of the original text were superseded rather than having to diff two documents in
their head. Where a ruling contradicted revision 1, the body sections below have been
rewritten in place and are marked `[OWNER-RULED]`.

| Question | Ruling | Effect on revision 1 |
|---|---|---|
| Lock conflict on undo | **Block the undo**, scroll to the locked segment, toast "Unlock to undo this change" | **New §5.1.** Revision 1 had no lock-conflict section; the option floated verbally ("skip the entry, leave the locked segment unchanged") was unimplementable — see §5.1 |
| Is lock/unlock itself undoable? | **No** | **§4 corrected** — revision 1 wrongly listed locks as undoable |
| Depth | **20 undo levels**, oldest silently evicted; redo bounded by what you have undone | **§6 corrected** — was 50 |
| New edit after undo clears redo | Yes | §6 unchanged (already this) |
| Undo scroll target | The segment the gesture **started** on, stored as an anchor id per entry | §5.2 — as recommended |
| Scroll behaviour | Scroll **only if off-screen**; **always flash** the anchor | **New §5.2** |
| Apply Sync | **One entry.** Undo once → pre-sync state; redo once → post-sync. Orphaned anchors fall back to no scroll | §5.3 — as recommended, semantics spelled out |
| What clears history | In-memory only, zero storage. Cleared by app restart, project switch, **going back to the dashboard**, and **re-opening a project** | **§6.0, new.** One factual correction folded in: in-memory history cannot survive a page reload (the heap is gone), so "zero storage overhead" is taken as governing and a reload starts fresh — see §6.0 |
| Coalescing | One entry per gesture; slider commits on **pointerup**, text on **blur or 500 ms idle** | **§3.2 rewritten** — was an 800 ms idle window for both |
| `Cmd+Z` in a text field | Native text undo, not project undo | §7 unchanged (already this) |
| Undo during playback | Keep playing | §4 — playhead stays non-undoable |
| Buttons | Toolbar, **left of Apply Sync**, named tooltips | **§8 corrected** — was left of the zoom slider |
| Platforms | **macOS and Windows both** | §7 — `Ctrl+Z`/`Ctrl+Y` are required, not optional extras |

---

## REVISION 2 — the three things revision 1 left open or wrong

### R2.1 The memory number, measured at the ruled depth of 20 [MEASURED]

Revision 1 gave JSON byte counts and estimated live heap as "2-4× JSON". That estimate was
wrong in the conservative direction by two orders of magnitude, because **JSON cannot
represent structural sharing** — serialising 20 snapshots writes all 444 segment objects 20
times, whereas in memory they are one set of objects pointed at 20 times.

Measured directly (`node --expose-gc`, `process.memoryUsage().heapUsed` deltas around forced
GC, real v6 corpus project — 444 segments, its real 339 kB transcript-token array, a full
per-segment field set including `overlayConfig`/`effectGrade`/every `effect*` slug):

| Configuration, v6 (444 segments), depth 20 | Real retained heap |
|---|---|
| **Snapshots with structural sharing** (shallow `Project` copy + shallow `segments` copy; only edited segment objects are new) | **77,936 B — 0.07 MB** |
| Naive `structuredClone` per entry (no sharing) | 20.71 MB |
| Worst conceivable case: all 20 entries are **Apply Sync** commits, so all 444 segment objects are new in every entry | 12.18 MB (624 kB/entry) |

The typical figure is ~3.9 kB per entry: a 444-pointer array copy (~3.6 kB) plus the one-to-
four segment objects a drag cascade actually replaces. A realistic 20-entry session of drags
and field edits therefore costs **well under 0.5 MB**, and the pathological all-Apply-Sync
session costs 12 MB.

For scale, this app already loads a **1.6 GB** Whisper model (`ggml-large-v3-turbo.bin`,
1,624,555,275 B measured) with ~2.1-2.2 GiB peak during inference.

**RULING: SNAPSHOTS. Not close.** A patch scheme would buy back at most ~12 MB in a case a
user would have to work to reach, in exchange for hand-maintaining an inverse for every one
of the 62 write sites, and would forfeit §9's structural golden-replay guarantee (a snapshot
*restores* a value the pipeline produced; a patch *recomputes* one). Revision 1's JSON tables
are retained below for provenance but the heap figures here are the ones that decide it.

**What a snapshot contains — the `Project` document only.** Confirmed by reading
`src/types.ts:274-345` field by field: `Project` holds strings, numbers, enums, and three
object arrays (`segments`, `headings`, `assets`, `textLayers`, `syncLog`) plus
`transcriptTokens`. **It holds no audio buffers, no decoded media, and no waveform peak
arrays** — `grep -n "waveform\|peaks\|AudioBuffer\|Float32" src/types.ts` returns nothing.
Those live elsewhere and are explicitly out of history:

| Heavy thing | Where it actually lives | In a snapshot? |
|---|---|---|
| Waveform peak arrays | `waveformStore.ts` (IndexedDB) + App-level state | **No** |
| Decoded `VideoFrame`s | `videoDecoderPool.ts` | **No** |
| Audio `AudioBuffer` / PCM | `silenceDetector.ts` / `waveformPipeline.ts`, transient | **No** |
| `transcriptTokens` | On `Project` — 214 kB JSON for v6 | Shared **by reference**, never copied, and excluded from restore (§5.3) |
| `Asset.file?: File` | On `Project.assets` | Shared by reference. A `File` is a lazy handle whose bytes live in the blob store, not the JS heap, and the live project holds the same reference — so history adds nothing |

### R2.2 The simplification revision 1 surfaced but did not exploit: segment identity is stable [MEASURED]

There is no split, merge, insert, delete, reorder, or import of segments anywhere in the app.
Verified by enumerating every `segments:` assignment in `App.tsx`
(`grep -nE "segments:" src/App.tsx`, 24 real write sites): **every one is a
`prev.segments.map(...)`** — same length, same ids, same order — except exactly three, none
of which is an edit:

- `App.tsx:2636` `segments: committedSegments` — **Apply Sync** (new ids: the one exception)
- `App.tsx:3651` `segments: rehydratedSegments` — reload hydration
- `App.tsx:583` `segments: []` — the blank project literal

`Timeline.tsx`'s generic `onSegmentUpdate(updater)` escape hatch has exactly one consumer
(`Timeline.tsx:607`, the trim drag) and it too is a `.map`. `applyDurationChange`'s
`finalSegments` (`App.tsx:1552`) comes from `computeDragCascade`, which is length- and
id-preserving by construction.

**What that lets this design drop, concretely:**

1. **No identity-migration layer in history entries.** An anchor segment id (§5.2) resolves
   in every entry on the same side of an Apply Sync boundary. There is no need to store a
   composite `index + text fingerprint` anchor with fallback resolution, which is the usual
   cost of undo in an editor where a segment can become two.
2. **Selection repair (§4) is an existence check, not a mapping question.** "Does this id
   still exist?" — the exact `prev && segs.some(s => s.id === prev) ? prev : null` test
   `handleSwitchProject` already performs. There is no "this segment became two, which one is
   selected now?" case to answer.
3. **Entry-to-entry diffing for labels and for no-op detection is a per-id field compare.**
   No LCS/alignment pass is needed to know which segments an entry changed, which is what
   makes a human label like "resize segment 12" derivable rather than hand-passed.
4. **Coalescing keys (§3.2) stay valid for a whole session.** `grade:brightness:<segmentId>`
   cannot be invalidated by its target acquiring a new id mid-gesture.
5. **Redo can never resurrect a dead id.** Within a contiguous run of entries, the id set is
   invariant.

**The one exception, stated precisely: Apply Sync.** It replaces every segment with a fresh
id, so anchors stored in pre-sync entries do not resolve in post-sync ones and vice versa.
Per the owner's ruling this is not repaired — an unresolvable anchor falls back to **no
scroll** (§5.2), never to an exception and never to a guessed segment. Note also that
**headings** are genuinely inserted and deleted (`handleInsertHeading`/`handleDeleteHeading`),
so heading identity is *not* stable — but the anchor is always a segment id, so nothing in
§5.2 depends on heading identity.

### R2.3 Lock conflict — revision 1's floated option was unimplementable

See **§5.1**, new. The short version: "skip the entry but leave the locked segment unchanged"
cannot be built. Under snapshots the older entry simply *contains* the locked segment's older
value — there is nothing to skip, because there is no per-segment delta to omit. Under
patches, applying some inverses and not others yields a state the pipeline never produced and
can break the gapless invariant outright. The owner's chosen policy — **block the undo** — is
the only one of the three that is both implementable and honest.

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

> **SUPERSEDED IN PART BY R2.1.** The ruling is unchanged (snapshots) but the numbers below
> are **JSON byte counts, and they overstate real cost by ~80×** because JSON cannot represent
> structural sharing. R2.1's `heapUsed` measurements at the ruled depth of 20 are the figures
> of record. This section is retained for provenance and for the argument in §2.3.

**Ruling: SNAPSHOTS, with structural sharing.** Size does not rule them out — not close.

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

- These are **JSON byte counts, not V8 heap**, and this bullet's own estimate ("2-4× JSON",
  giving 14.6 MB → 30-60 MB resident at depth 50) **was wrong in the conservative direction by
  roughly two orders of magnitude** — see R2.1. JSON serialises every shared segment object
  once per entry; the live heap points at one copy. The measured figure at the ruled depth of
  20 is **0.07 MB**, not 30-60 MB. Retained here as the mistake it was, since "we estimated
  and the estimate was 80× high" is the useful part.
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

### 3.2 Coalescing rule for continuous controls `[OWNER-RULED]`

Sliders and text fields fire many `setProject` calls per gesture and must not produce many
entries. **The ruling: one entry per gesture, with the gesture's END defined by the control's
own natural boundary rather than by a single idle timer for everything.**

| Control class | Entry closes on | Rationale |
|---|---|---|
| **Sliders** (grade brightness/contrast/saturation/temperature, playback speed) | **`pointerup`** | A slider gesture has an unambiguous end. A timer is a guess; the pointer release is the fact. Also removes the failure mode where a slow, deliberate drag crosses the idle window and splits into two entries |
| **Text fields** (overlay text, project name, script/scene textareas, numeric duration) | **`blur`, or 500 ms idle**, whichever comes first | A text field has no release event, so an idle timer is unavoidable; `blur` closes it early when the user tabs or clicks away |
| **Discrete actions** (button, toggle, Apply Sync, drag commit, apply-to-all) | Immediately — they open and close their own entry | No gesture to coalesce |

The **coalescing key** is `(control identity, target identity)` — e.g.
`grade:brightness:<segmentId>`, `overlayText:<segmentId>:<overlayId>`,
`playbackSpeed:<segmentId>`. Keying on the target as well as the control is what makes
"drag brightness on segment 5, then drag brightness on segment 9" two entries rather than
one, which is what a user means. An open entry is also force-closed by a write carrying a
*different* key, so an interleaved edit can never be absorbed into the wrong entry.

Two implementation notes:

- **`pointerup` for sliders needs a real pointerup listener,** not an inference from "no
  further writes". `EffectsPanel`'s grade sliders debounce their `setProject` at 120 ms
  (`EffectsPanel.tsx`, `onGradeLive`), so the last write of a gesture lands up to 120 ms
  *after* the release. The entry must therefore close on the release **and still absorb** that
  trailing debounced write — i.e. the key stays claimable for one short grace period after
  release rather than being closed hard. Getting this wrong produces exactly one spurious
  one-write entry per slider gesture, which is the bug this section exists to prevent.
- **500 ms** for text idle is the owner's figure and is **chosen, not tuned against a real
  hand** — same honesty as the auto-scroll ramp constants. Revisit after first use.

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
- **Apply Sync** — see §5.3, this is the one with a caveat

**NOT undoable (deliberately):**

- **Locks — lock/unlock, lock-all/unlock-all.** `[OWNER-RULED]` Revision 1 listed these as
  undoable, which was wrong. A lock is not an edit to the video; it is a *statement about how
  future edits may behave*, and making it undoable creates a genuinely confusing interaction
  with §5.1: undo would sometimes remove a lock and sometimes be blocked *by* one, and the
  user could not predict which. Excluded. This means lock writes go through the silent setter
  (§3.1 option (i)), which also removes any question about ordering between a lock toggle and
  §5.1's block check.
- **playback position** (`currentTime`) and play/pause. `[OWNER-RULED]` Undo **during
  playback keeps playing** — the playhead is not history, so an undo mid-playback changes the
  timeline under a still-running clock and does not pause it. (`currentTime` is still *clamped*
  into the restored timeline's bounds — see below — which is repair, not restore.)
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

**The duration-invariance guard does not apply to undo, and must not.** `DRAG_CASCADE_OPTIONS`
(`dragCascade.ts`) sets `conserveTotalDuration`, which enforces "no drag changes total
duration" — the last-segment-lock ruling of 2026-08-08. That switch is **opt-in and passed
only by the drag path**: `applyDurationChange`'s `options` parameter is `undefined` for every
other caller, and the speed slider deliberately relies on that (it legitimately changes the
last segment's duration through the same `computeDragCascade`). Undo restores via
`setProject` directly and never enters `computeDragCascade` at all, so it is structurally
outside that guard — which is correct, because a restored state may legitimately have a
different total duration than the current one (undoing an Apply Sync is the obvious case).
**This must be verified explicitly, not assumed** (§10 item 10): a restore path that
accidentally routed through the cascade would refuse legitimate undos.

### 5.1 Lock conflict — undo is BLOCKED `[OWNER-RULED]`

**The situation.** History entry *N* changed segment 12's timing. The user then locked
segment 12. Pressing undo would move a segment the user has explicitly pinned.

**The ruling: block the undo.** Do not restore, do not partially restore, do not silently
unlock. Instead:

1. Leave history untouched — the entry stays on the undo stack, and pressing undo again after
   unlocking performs it normally. (Nothing is consumed by a blocked attempt.)
2. Scroll the locked segment into view, using §5.2's machinery.
3. Show the toast **"Unlock to undo this change"**, with the same **Unlock** action button
   `applyDurationChange`'s locked-neighbour toast already offers (`App.tsx:1540-1545`) — so the
   user can resolve it in one click from where they are.

**Why the alternative was rejected.** The option floated in revision 1 — "skip the entry but
leave the locked segment unchanged" — is not implementable in either representation:

- **Under snapshots** there is nothing to skip. The older entry *is* a whole `Project`; the
  locked segment's older value is simply part of it. "Restoring everything except segment 12"
  would mean synthesising a hybrid of two states, and since segment timings are mutually
  constrained (`startTime[i] + duration[i] === startTime[i+1]`), holding one segment at a
  newer value while its neighbours go back to older ones **breaks the gapless invariant
  directly** — the assertion in §5 would fire on our own write.
- **Under patches** it is worse: applying a subset of inverses out of order produces a state
  no version of the pipeline ever produced, with no guarantee of any invariant.

Blocking is the only option that keeps every reachable state one the pipeline actually
committed, which is the property §5 and §9 both rest on.

**Detection.** A blocked undo is decided *before* the write: compare the target entry's
segments against current state by id (cheap and exact — see R2.2 point 3), and if any segment
whose timing differs is `locked` in **current** state, block. Locked-in-current is the right
test, not locked-in-the-entry: the lock is a statement about the timeline as it stands now.

### 5.2 Anchor scroll and flash `[OWNER-RULED]`

Each history entry carries an **anchor segment id**: the segment the gesture **started** on,
not the whole set it cascaded across. For a five-segment cascade from a drag on segment 12,
the anchor is 12. This is captured at push time by the caller that knows the gesture (the
drag session already has `id`), never inferred by diffing.

On undo or redo:

- **Scroll only if the anchor is off-screen.** If it is already visible, do not move the
  timeline — a scroll the user did not need is the "haunted" feeling §4 warns about. When it
  *is* off-screen, bring it into view.
- **Always flash the anchor**, whether or not a scroll happened, so the change is visible
  even when it is on-screen and subtle (a 0.2 s duration change is otherwise invisible).
- **Reuse the existing scroll machinery** from `Timeline.tsx`'s segment-follow auto-scroll
  (the Step 9 work), including its `didRestoreRef` gate. Do not write a second scroller: the
  existing one already handles the reload-restore ordering trap that caused the visible
  "0 then scroll" flash, and a parallel implementation would reintroduce it.
- **Scroll position and selection are NOT undoable** (§4). The anchor scroll is a *reaction*
  to an undo, not restored state — undoing twice and redoing twice must not replay a scroll
  history.
- **An unresolvable anchor falls back to no scroll and no flash.** It must not throw and must
  not guess a nearby segment. This is reachable exactly across an Apply Sync boundary
  (R2.2) — the ids in a pre-sync entry do not exist post-sync.

### 5.3 Apply Sync `[OWNER-RULED]`

**Apply Sync is one entry.** Undo once returns to the pre-sync state — including whatever
messy manual edits were there; redo once returns to the post-sync state. That before/after
toggle is the explicitly wanted behaviour: it lets the two states be compared directly.

Two consequences worth stating so they are not mistaken for bugs:

- Undoing past the Apply Sync entry continues into the pre-sync edit history normally (the
  stack is a plain linear 20, not a special case). The owner's "one undo allowed" describes
  what it takes to *get back* to the pre-sync state, not a cap.
- Anchors do not survive the boundary in either direction (R2.2), so a sync undo/redo scrolls
  nowhere and flashes nothing. Accepted.

**The excluded-field caveat.** Apply Sync is undoable — but undoing it must
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

- **Depth: 20 undo levels.** `[OWNER-RULED]` (Revision 1 said 50.) At the measured ~3.9 kB per
  typical entry that is well under 0.5 MB, and 12.18 MB in the pathological all-Apply-Sync
  case (R2.1).
- **Redo depth is not a second budget.** Redo can only ever hold what has been undone, so it
  is bounded by the same 20 — "20 each" would be a misreading. The invariant is
  `undoDepth + redoDepth <= 20`.
- **Eviction: FIFO from the oldest end, silently**, on push past 20. No warning, no toast.
- **Redo is discarded on any new edit** `[OWNER-RULED]` — the standard linear model. No redo
  tree.
- **History is CLEARED on:** project switch, New Project, app quit (trivially — nothing is
  persisted across a process restart), the DEV scale-fixture load, and project deletion. Each
  is "this is a different project now"; an undo stack that survived one could restore another
  project's segments onto this one's assets.
- **Apply Sync does NOT clear history** — it pushes one entry like any other edit (§5.3).

### 6.0 RULED — in-memory only, zero storage `[OWNER-RULED 2026-08-08]`

**The ruling, as given:** *"Undo history stays in memory during your active session… It only
resets when the app restarts, user switch project or even go back to dashboard. Re-opening a
project starts fresh. Fast, clean, and requires zero extra storage overhead."*

So the decision is **reading (B) of §6.1 below: in-memory only, no persistence layer, nothing
written to disk.** §6.1 is retained as the record of what (A) would have cost.

**Clearing list, final:**

| Event | History |
|---|---|
| Editing inside the currently-open project | **Kept** — this is the whole session |
| Switching to another project | Cleared |
| **Going back to the dashboard** | Cleared *(added by this ruling)* |
| **Re-opening a project** (even the same one) | **Starts fresh** *(added by this ruling)* |
| New Project | Cleared |
| App restart | Cleared (nothing persisted, so this is automatic) |
| DEV scale-fixture load, project deletion | Cleared |
| Apply Sync | **Kept** — pushes one entry (§5.3) |

**One factual correction to the ruling, because it changes what gets built.** The ruling says
history *"does not reset if the page reloads during the active session."* That is not
achievable together with "zero extra storage overhead": **a page reload discards the entire JS
heap**, including the history stack, so in-memory history cannot survive one. There is no
middle option — surviving a reload *is* persistence (§6.1(A)), with its own IndexedDB store
and per-entry asset rehydration.

Since the ruling also explicitly asks for zero storage overhead, and those two requirements
are mutually exclusive, **zero-storage is taken as the governing constraint** and a reload
therefore starts with empty history. Worth noting this costs very little in practice: in the
shipped Tauri app a page reload is not a user-reachable action — there is no reload control;
it is a dev-time `Cmd+R`. If surviving a reload turns out to matter, it is §6.1(A) and its own
phase; flag it and it will be scoped rather than smuggled in.

**The part of the reload concern that IS real, and must be implemented:** history must not be
cleared by *incidental* project-state churn during a single session. Specifically, the
clear-on-switch trigger must **not** fire on App's mount-time hydration, where a placeholder
`Project` is swapped for the real persisted one. Keying the clear on `project.id` alone
reproduces exactly the D15 bug the `sliderT` restore already had to fix
(`hasSkippedHydrationResetRef`) — a first-run guard is consumed by the placeholder's id and
then fires unguarded when the real project arrives. The same `isHydrating` gate applies here.
At mount the stack is empty anyway, so this is about correctness of the trigger rather than
about saving entries — but it is the kind of thing that silently starts eating history the
moment hydration order changes.

### 6.1 What persistence would have cost — retained for the record, NOT being built

Revision 1 recommended that all four exits clear history, with no persistence. The owner
accepted three and **excluded the fourth: "except page reload inside the project"** — i.e.
reloading the page while staying in the same project should *keep* the undo stack.

**This is the one ruling in the set that adds real, non-trivial work, and it is worth
confirming the intent before building on it.** Flagging rather than silently deferring:

- **It requires persistence.** There is no in-memory way to survive a reload; the JS heap is
  gone. So this is not a small carve-out from "no persistence" — it *is* persistence, with a
  storage layer, a schema version, and a migration story.
- **`localStorage` will not hold it.** Serialised, history cannot use structural sharing (the
  0.07 MB figure is a live-heap property, not a byte-count one), so 20 entries of v6 is
  **6.02 MB of JSON** [MEASURED] against a ~5-10 MB origin quota that the project itself
  already shares. It would need its own IndexedDB store, like `waveformStore.ts` has.
- **Asset rehydration has to be re-run per entry.** `Asset.url` is a `blob:` URL stripped
  before persistence (`projectStore.ts`) and rebuilt from IndexedDB on load. Every persisted
  entry would need the same drop-missing-asset repair the hydration path performs — 20 times
  per load — or entries would carry dead blob URLs that only fail when restored.
- **Writing it is not free either.** The existing 500 ms debounced project save would have to
  serialise up to 6 MB alongside the project on every edit.

**Two readings of the ruling, and they cost very different amounts:**

- **(A) Literal:** history genuinely survives a webview reload. Cost: a new IndexedDB store,
  per-entry asset rehydration, schema versioning — a phase of its own, comparable in size to
  Phases 1-3 combined.
- **(B) "Do not gratuitously clear it":** the concern is that history must not be wiped by
  *incidental* project-state churn — the reload-hydration effect writing `rehydratedSegments`
  through the same seam, or the placeholder-project swap the `sliderT` D15 fix already had to
  guard against (`hasSkippedHydrationResetRef`). Under this reading the requirement is that
  **hydration must not be treated as a project switch**, which is a one-line gate, essentially
  free, and closes a real bug the D15 fix's history says is easy to hit.

**RESOLVED: (B).** See §6.0 above — the owner ruled for in-memory only with zero storage
overhead. (A) is not being built. This subsection stays as the costing, so that if surviving a
reload is ever wanted, the price is already known and does not have to be re-derived.

---

## 7. Keyboard shortcuts

`[OWNER-RULED]` **Both platforms are targets — macOS and Windows.** The Windows bindings are
required, not optional extras, and `tauri.conf.json` already bundles an
`x86_64-pc-windows-msvc` ffmpeg sidecar, so Windows is a real shipping target.

| Action | macOS | Windows |
|---|---|---|
| Undo | `Cmd+Z` | `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Shift+Z` **and** `Ctrl+Y` (both accepted) |

Detect the modifier as `e.metaKey || e.ctrlKey` rather than branching on a platform sniff —
one code path, and it matches how the existing keydown branches are written. `Ctrl+Y` is
macOS-harmless (it is not a system binding there), so it can be accepted unconditionally
rather than gated on platform.

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

- **Placement:** `[OWNER-RULED]` the toolbar, **immediately left of Apply Sync**. (Revision 1
  proposed left of the zoom slider; superseded.)
- **Icons:** lucide-react `Undo2` / `Redo2`, matching every other control in the app.
- **Ignored while a drag gesture is live.** A click or shortcut arriving mid-drag does nothing
  — the gesture owns the timeline until it resolves, and an undo landing between a drag's live
  DOM writes and its commit would leave the preview and state disagreeing. Gate on the
  existing `isResizingRef`, which is already the app's canonical "a drag is in progress" flag.
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
5. **Coalescing (§3.2).** A slider gesture of 30 writes produces 1 entry, closed by
   `pointerup`, **including** the trailing 120 ms-debounced write that lands after the release;
   a text field's writes produce 1 entry closed by `blur` or 500 ms idle; a write with a
   different coalescing key opens a second entry immediately.
6. **Invariant safety.** Every state reachable by undo/redo in the §3 property test passes
   `findPartitionViolations` — reusing the existing checker, not a new one.
7. **Eviction and clearing.** Depth cap holds at **20**; the oldest entry is evicted silently;
   `undoDepth + redoDepth <= 20` always; project switch/New Project/fixture load clear both
   stacks; a new edit after an undo discards redo.
8. **Excluded-field merge (§5.3).** A snapshot taken before Apply Sync, restored, keeps the
   current `transcriptTokens` and does not resurrect `undefined`.
9. **Selection repair (§4).** Undoing past a heading's creation clears a selection pointing
   at it; `currentTime` is clamped into the restored bounds.
10. **Undo is outside the duration-invariance guard (§5).** A restore whose total duration
    differs from current state succeeds — asserted directly, since a restore accidentally
    routed through `computeDragCascade` with `DRAG_CASCADE_OPTIONS` would refuse it. Undoing an
    Apply Sync is the natural fixture: pre- and post-sync totals differ.
11. **Lock conflict blocks (§5.1).** Undo against an entry that would move a currently-locked
    segment does not write, does not consume the entry, and the same undo succeeds after the
    segment is unlocked.
12. **Locks are not undoable (§4).** A lock toggle pushes **zero** entries; undo after a lock
    toggle reaches past it to the previous real edit.

---

## 11. Phased plan

`[OWNER-RULED]` Revision 1 proposed six phases. The owner's brief collapses them into
**three**, which is the plan of record. Test-count deltas are estimates.

| Phase | Scope | Ships? | Tests |
|---|---|---|---|
| **1 — history core, no UI** | `src/services/history.ts`: pure push/replace/undo/redo/evict/clear over an opaque state type, with explicit push-vs-replace semantics so callers state intent rather than the store inferring it. An entry carries the snapshot, a human label, and the anchor segment id. Capture wired at the `setProject` seam; `setProjectSilent` for the two revert paths and for lock writes. §10 items 1-4, 6, 7, 10, 12. | No UI | **+30** |
| **2 — buttons and shortcuts** | **The WKWebView key-interception experiment runs FIRST, before the handler is written** (§12). Then: `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Ctrl+Y`, §7's text-field and modal suppression, toolbar buttons left of Apply Sync with disabled states and named tooltips, ignored while a drag is live. | Yes | **+18** |
| **3 — anchor scroll, lock policy, coalescing** | §5.2's anchor scroll (reusing the Step 9 scroller) and flash; §5.1's lock block with its toast; §3.2's coalescing. §10 items 5, 9, 11. | Yes | **+25** |

**Total: roughly +73 tests, 1530 → ~1603.** Golden replay must stay byte-identical at every
phase boundary — verified per stage, not once at the end.

**Deferred, deliberately, and not in any of the three phases:** history persistence across a
page reload (§6.1, pending a ruling between readings (A) and (B)); a history dropdown; a redo
tree.

---

## 12. The decision I am least confident about — now scheduled as an experiment

**§7's platform risk — whether the global `Cmd+Z` handler can own the shortcut at all in the
real WKWebView/Tauri shell.**

Everything else here is settled by measurement or by an existing pattern in the codebase.
This one is a guess about a platform, and the codebase's own history is a warning: the
browser Fullscreen API silently fails in this shell, keyboard focus does not return to the
webview after a fullscreen exit without three layers of fallback, and a native macOS menu
this app has never configured (`grep -n "menu"` finds nothing in `tauri.conf.json` or
`lib.rs`) is presumed — not verified — to bind `Cmd+Z` to the OS text responder.

**This is no longer a note; it is Phase 2's first task, gating the handler.** The experiment:
a temporary `keydown` logger in the existing effect, `npm run tauri:dev`, and `Cmd+Z` pressed
in four states — (a) nothing focused, (b) a text field focused, (c) a range slider focused,
(d) immediately after exiting fullscreen — recording which reach the listener and whether the
native Edit menu flashes. If `Cmd+Z` never arrives at `window`, the finding is reported as
such and the **native-menu / Tauri global-shortcut route** is proposed instead of working
around it blindly.
