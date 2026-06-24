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

## 🧪 Manual Test — Real 11→14 scale re-sync (add 3 scenes + reword a boundary)

Scales the test above up to the real case Step 7 targets: several scenes
changing at once, plus a same-boundary rewording, not just one scene added
on each side.

**Setup:** A synced project with an 11-scene script/scene-details pair and a
voiceover. Insert a heading between two scenes that will stay **unchanged**
in the edit below (e.g. between scene `H` and scene `I`).

1. Edit Scene Details: add three new bracketed scenes anywhere away from the
   heading's neighbors, and reword one existing scene boundary elsewhere in
   the file (split the text differently between two adjacent bracket tags —
   same two tags, different wording). `H` and `I` themselves stay untouched.
2. Save the Scene Details edit, then re-stage the voiceover (drag it in
   again) so Apply Sync re-enables, and wait for transcription to reach
   "done".
3. Click **Apply Sync**.
4. **Pass:** Scrub the playhead across the entire timeline. No tile is
   visually zero-width (a "sliver"), and there are no visible gaps or
   overlaps between any two adjacent tiles anywhere along the scrub.
5. **Pass:** Open DevTools (or the terminal running `tauri dev`) and check
   the console for the sync that just ran. No `[anchor] out-of-order anchor`
   warning was printed.
6. **Pass:** The heading still sits immediately after `H` and immediately
   before `I` — unaffected by the 3 new scenes and the reworded boundary
   elsewhere in the timeline.
7. **Pass:** The last segment's end time matches the voiceover's audio
   duration — the timeline neither falls short of nor overruns the audio.

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

## Resolved — heading-budget transient (pre-Step 5.3/5.4)

Earlier revisions of this doc warned about a transient ~0.5s/heading
duration surplus landing on the last segment mid-resync. That no longer
applies: as of Step 5.3/5.4, `parseProjectData` recognize-and-skips a
`[HEADING:]` scene-text tag as a pure scene boundary — it materializes no
segment and allocates no duration for it at all. The only heading-duration
logic that runs now is `reinsertHeadings`'s 50/50 neighbor-steal (Step
5.1.3), which lands the heading at exactly 1.0s in the same pass that
commits the timeline — there's no interim oversized-segment state to see.
If you observe a wrong last-segment duration after a sync settles, that's
still a real bug — file it.
