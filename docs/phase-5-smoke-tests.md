# Phase 5 Smoke Tests

## 🧪 Manual Test — Step 1: autoMatchAssets delete regression

**Setup:** Load app with at least 2 uploaded assets and ≥1 synced segment.

1. Confirm a segment has `assetId` set (thumbnail visible in timeline).
2. Open the Assets tab → click the trash icon on that segment's linked asset.
3. **Pass:** The segment thumbnail goes blank (no asset linked). The deleted asset does NOT re-appear as the segment's asset after any re-render.
4. Upload a different asset. **Pass:** The uploaded asset auto-fills only unlinked segments — it does NOT re-fill the segment you just cleared.

---

## 🧪 Manual Test — Step 3: Mid-export cancellation

**Setup:** A project with ≥3 segments (enough to export for several seconds).

1. Click **Export**. The export modal appears with a progress bar.
2. While the progress bar is moving (before it reaches 100%), click **Cancel Export**.
3. **Pass:** The modal immediately switches to "Export Cancelled" heading with no retry/copy-diagnostics buttons visible.
4. **Pass:** A single "Dismiss" button is shown. Clicking it closes the modal and returns to normal editing state.
5. Click **Export** again immediately. **Pass:** A fresh export starts (no stale state from the cancelled run).

---

## 🧪 Manual Test — Step 6: Apply Transition button label

**Setup:** Open the Settings panel.

1. Locate the button near the Global Transition dropdown.
2. **Pass:** Button reads **"Apply to All Scenes"** (not "Apply Transition to All Scenes" or any other variant).
3. Hover the button. **Pass:** A tooltip appears reading "Writes the current global transition to every scene's per-segment field".
4. Change the Global Transition to e.g. FADE. Click the button. **Pass:** All segments in the timeline now show FADE as their per-segment transition (verify in Segment Editor for any one segment).

---

## 🧪 Manual Test — Step 7: Stock API 429 handling

**Note:** Triggering a real 429 requires exceeding Pexels/Pixabay rate limits. Use browser DevTools to simulate.

1. Open **Stock Library** modal.
2. In DevTools → Network → select the Pexels or Pixabay request → right-click → Block request URL.
3. Alternatively, in DevTools intercept and return a 429 response.
4. Type a search query (≥3 chars).
5. **Pass:** After the debounce delay, the modal shows a clock icon with amber text: "Rate limited — please try again in a moment".
6. Unblock the URL and search again. **Pass:** Normal results appear (no error state).
7. Block both Pexels and Pixabay URLs. **Pass:** After retry exhaustion, a red AlertCircle appears with "Search failed — check your connection and try again".

---

## 🧪 Manual Test — Step 8: Accessibility

### 8a — ARIA labels

1. Open browser accessibility tree (DevTools → Accessibility tab or axe extension).
2. Inspect each icon-only button: asset delete, close segment editor, layout toggle, fullscreen toggle, play/pause, seek-to-start, timeline zoom range inputs.
3. **Pass:** Every icon-only button has a non-empty accessible name (aria-label).
4. Tab through the UI. **Pass:** Focus is always visible (orange 2px outline on focused element).

### 8b — aria-live export stage

1. Start an export. Open VoiceOver (macOS: Cmd+F5) or NVDA.
2. **Pass:** Screen reader announces each stage transition ("Encoding segment 1 of N", "Muxing audio", etc.) without announcing every percentage tick.

### 8c — Timeline scrubber keyboard

1. Click on the timeline seek bar to focus it.
2. Press **←** / **→** arrow keys. **Pass:** Playhead moves by 1 second per press.
3. Press **Shift+←** / **Shift+→**. **Pass:** Playhead moves by 5 seconds per press.
4. Check accessibility tree. **Pass:** Element has `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext` with current time.

### 8d — Focus trap in modals

1. Open the Stock Library modal. Press **Tab** repeatedly.
   **Pass:** Focus cycles only within the modal — it never escapes to the background.
2. Press **Shift+Tab** from the first focusable element.
   **Pass:** Focus moves to the last focusable element in the modal (not background).
3. Close the modal (press Escape or click Close). **Pass:** Focus returns to the button that opened the modal.
4. Repeat for: Sync Review modal, Export modal, Segment Editor modal.
