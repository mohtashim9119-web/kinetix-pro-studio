# Heading Array-Source — Manual Smoke Tests

> Step 5 (headings sourced from the segments array on re-sync). Covers
> insert/rename/delete survival across Apply Sync. Run in the Tauri app —
> this is desktop-only, same as export.

## Prerequisites

1. `npm run tauri dev` (or your usual Tauri dev launch).
2. A project with a script, scene details (≥4 bracketed scenes), and a
   voiceover already staged and synced once, so you start from a normal
   timeline with no headings.

---

## 🧪 Manual Test — Insert heading

**Setup:** A synced project with ≥2 content segments in the timeline.

1. Click **+ Add Heading** (top of the segment list, or the per-segment insert
   button between two scenes).
2. **Pass:** A new heading tile appears in the timeline, taking ~0.5s from
   each neighboring segment (or the full amount from a single neighbor if
   inserted at the very start/end).
3. Click the heading tile to open the **BottomDrawer**. **Pass:** A "Heading
   Style" panel appears with Text / Font / Weight / Size / Auto-fit / Text
   Color / BG Color / X / Y / BG Asset controls — default text reads
   "Heading 1" (or the next sequential number).

---

## 🧪 Manual Test — Rename + custom styling

**Setup:** Continue from the heading inserted above.

1. In the "Heading Style" panel, change **Text** to something distinctive,
   e.g. "Chapter Two".
2. Change **Text Color** and drag the **X** / **Y** sliders to a non-default
   position.
3. Click elsewhere to close the drawer. **Pass:** The timeline tile reflects
   the new text; reopening the drawer shows the new color/position retained.

---

## 🧪 Manual Test — Trigger Apply Sync (re-sync)

**Note:** Apply Sync only enables on a *newly staged* file — re-running it on
unchanged persisted data is intentionally blocked (`isStagedEmpty` gate). To
force a re-sync without changing your actual content, **re-upload the same
voiceover file** in the Files tab (drag it in again, or browse and re-select
it). This stages it as "new" and re-enables the **Apply Sync** button without
requiring you to change the script or scene details.

1. Re-upload the voiceover file.
2. Wait for the transcription bar to reach "done" (Apply Sync stays disabled
   with tooltip "Waiting for transcription to finish…" until then).
3. Click **Apply Sync**.
4. **Pass:** The view switches to the Segments tab and the timeline rebuilds.

---

## 🧪 Manual Test — Confirm exactly one heading + styling survives

**Setup:** Immediately after the re-sync above.

1. Scan the timeline. **Pass:** Exactly one heading tile is present — no
   duplicate, no second copy.
2. Open its BottomDrawer. **Pass:** Text still reads "Chapter Two"; the
   custom Text Color and X/Y position from the rename step are unchanged.
3. **Pass:** The heading sits between the same two neighboring scenes it was
   originally inserted between (by asset, not by position number — see next
   test for what happens when scene count changes).

---

## 🧪 Manual Test — Add scenes before/after the heading, then re-sync

**Setup:** A synced project with a heading already placed between two named
scenes (e.g. scene `B` and scene `C`).

1. Edit Scene Details: add a new bracketed scene **before** `B` and another
   new bracketed scene **after** `C` (don't touch `B` or `C` themselves).
2. Save the Scene Details edit (this stages it as a new file, same as
   re-uploading the voiceover — Apply Sync re-enables).
3. Click **Apply Sync**.
4. **Pass:** The heading still sits immediately after `B` and immediately
   before `C` — the two new scenes land outside that pair, not between the
   heading and its neighbors.
5. **Pass:** Still exactly one heading tile; styling from the rename step is
   still intact.

---

## 🧪 Manual Test — Delete heading + re-sync, confirm no resurrection

**Setup:** A synced project with a heading present.

1. Click the **×** button on the heading tile (visible in the timeline strip
   for heading segments).
2. **Pass:** The heading disappears immediately; its duration is returned to
   its two neighbors (~50/50 split), visible as both neighboring tiles
   growing slightly.
3. Force a re-sync (re-upload the voiceover, as in the Apply Sync test
   above) without re-adding a heading.
4. Click **Apply Sync**.
5. **Pass:** No heading reappears anywhere in the timeline — deletion is
   permanent across re-sync, not just until the next sync.

---

## Known transient (not a bug to file)

Immediately after a re-sync that includes a heading, you may see one
segment — usually the last one in the timeline — briefly oversized before
settling. This is expected: the character-weight estimate pass
(`parseProjectData`) still allocates `HEADING_ONLY_DURATION_SECONDS` (1.5s)
per legacy `[HEADING:]` scene-text tag before Whisper alignment runs, while
the final committed duration for any heading is pinned to exactly 1.0s by
`applyHeadingTiming`. That 0.5s/heading surplus has to land somewhere in the
interim, and the last segment's clamp-to-audio-duration absorbs it. The
`[HEADING:]` tag itself is belt-and-suspenders (Step 5.1.3) and slated for
removal in a later phase of this work, which will remove this transient
along with the tag. If the *final* committed timeline (after Apply Sync
settles) has a visibly wrong last-segment duration, that's a real bug —
file it. A brief flash during the sync itself is not.
