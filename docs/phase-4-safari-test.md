# Phase 4 Safari Validation

> **Status:** Awaiting human run  
> **Time-box:** One work session — if it balloons, document and defer to Phase 5  
> **Branch:** `phase-4-polish`

---

## Setup

Run the Vite preview server (serves the production build with correct COOP/COEP headers):

```bash
npm run build && npm run preview
```

The preview server starts at `http://localhost:4173/`. Open that URL in **Safari desktop (latest stable, 17+)**. Do not use the dev server for this test — `npm run preview` serves the built output, which matches production (Cloudflare Pages) more closely.

> **Alternative:** If you have a Cloudflare Pages preview deploy of `phase-4-polish`, you may use that instead. The COOP/COEP headers are served via `public/_headers` which is included in the build.

---

## 🧪 Manual Test — Safari Export Validation

### Before you click anything

1. Open Safari DevTools: **Develop → Show Web Inspector** (enable Develop menu via Safari → Settings → Advanced → "Show features for web developers").
2. Go to the **Console** tab. Clear it.
3. Go to the **Network** tab. Clear it. Check "Preserve Log".

### Step 1 — Page load check

1. Navigate to `http://localhost:4173/` (or your Pages preview URL).
2. In the Console, type and run:
   ```js
   crossOriginIsolated
   ```
   Note the value (`true` or `false`).
3. In the Console, type and run:
   ```js
   typeof SharedArrayBuffer
   ```
   Note the value (`"function"` = available, `"undefined"` = not available).
4. In the Network tab, click on the first request (the HTML document). Look at **Response Headers**. Note the exact values of:
   - `Cross-Origin-Opener-Policy`
   - `Cross-Origin-Embedder-Policy`
5. Note any console errors on page load (copy the full text of any red entries).

### Step 2 — Create a minimal project

1. In the **Script** tab, paste:
   ```
   This is the first scene with a short sentence.
   This is the second scene which is slightly longer to show proportional timing.
   ```
2. In the **Scene Details** tab, paste:
   ```
   [IMAGE: test1.jpg]
   This is the first scene with a short sentence.
   [IMAGE: test2.jpg]
   This is the second scene which is slightly longer to show proportional timing.
   ```
3. In the **Assets** tab, upload any two `.jpg` images from your machine (any images, even screenshots).
4. Upload any short audio file (`.mp3`, `.m4a`, or `.wav`, 10–20 seconds) as the voiceover.
5. Run through the 3-step sync wizard (Parse → Review → Sync buttons in the header).
6. In **Settings**, set the transition to **fade**.

### Step 3 — Export

1. Note the time.
2. Click the **Export** button in the header.
3. Watch the export modal. Note which stage label appears and how long each stage takes:
   - `Loading ffmpeg…`
   - `Encoding segment 1 / 2`
   - `Encoding segment 2 / 2`
   - `Muxing & packaging…`
   - `Done!`
4. Note whether the modal switches to the error view at any stage. If so, copy the error text verbatim.
5. Note the end time.
6. If a file downloaded: note the filename (should match `{projectName}_{timestamp}.mp4`).

### Step 4 — Verify the output

If a file downloaded:
1. Open it in **VLC** (not Safari — we want a real container check).
2. Note: does it play start to finish without errors?
3. Note: is audio present? Does it match the visuals?
4. In VLC, go to **Window → Media Information → Codec** tab. Note the video codec and audio codec shown.

### Step 5 — Network tab check (worker)

1. In Safari's Network tab, filter by "JS" or search for "exportWorker".
2. Click the worker request and check its Response Headers for `Cross-Origin-Embedder-Policy` (if present).

---

## Diagnostics to Paste Back

Please paste back the following in a structured block:

```
Safari version: (Apple menu → About Safari)
crossOriginIsolated: true | false
typeof SharedArrayBuffer: "function" | "undefined"

COOP header on main document: [exact value]
COEP header on main document: [exact value]

Console errors on page load:
[paste full text, or "none"]

Export modal stages reached (check all that applied):
[ ] Loading ffmpeg…  (took ~___ seconds)
[ ] Encoding segment 1/2  (took ~___ seconds)
[ ] Encoding segment 2/2  (took ~___ seconds)
[ ] Muxing & packaging…  (took ~___ seconds)
[ ] Done — file downloaded as: _______________
[ ] Error view shown — error text: _______________

Console errors during export:
[paste full text, or "none"]

VLC playback (if file downloaded):
Plays without error: yes | no
Audio present and synced: yes | no
Video codec shown in VLC: _______________
Audio codec shown in VLC: _______________

Total wall-clock time (start to download): ___ seconds
Voiceover duration: ___ seconds
Wall-clock / output ratio: ___ : 1
```

---

## Decision Matrix

Based on what you report, CC will take the following action:

| `crossOriginIsolated` | Export completes | What it means | What CC does |
|---|---|---|---|
| `true` | Yes — MP4 plays in VLC with H.264 + AAC | Full multi-threaded export works on Safari | Update `CLAUDE.md` + `project-state.md` Decisions Log: "Safari verified on {date} / Safari {version}, full export works". No code changes. Proceed to Step 8. |
| `true` | No — error view shown | COOP/COEP fine; something else breaks | Capture exact error. Likely a Safari-specific API gap (worker module loading, `URL.createObjectURL` timing, or a missing Web API). CC triages: if it's a small targeted fix (≤ ~20 lines), apply it in a `phase-4: fix Safari export <description>` commit. If structural, document and defer to Phase 5. |
| `false` | n/a | `SharedArrayBuffer` unavailable → ffmpeg.wasm falls back to single-threaded | CC checks `vite.config.ts` and `public/_headers` for a header fix (Safari sometimes requires `credentialless` instead of `require-corp`). If a header tweak fixes it, ship it. If headers are already correct and Safari simply doesn't support COOP/COEP on this path, CC adds a one-time warning toast shown only on Safari (`/^((?!chrome|android).)*safari/i.test(navigator.userAgent)`) that export will be slower due to single-threaded fallback, then verifies the slow export still produces a valid MP4. |
| `false` | Export errors | Both `SharedArrayBuffer` missing AND something else fails | Document fully, defer to Phase 5. |

---

## Rollback Plan

Any code change CC makes based on your report is limited to one of these files:

| Scenario | Files touched | How to revert |
|---|---|---|
| Header fix (`credentialless` etc.) | `vite.config.ts`, `public/_headers` | `git revert <commit>` |
| Safari warning toast | `src/App.tsx` (single `useEffect` + one JSX element) | `git revert <commit>` |
| Safari-specific API fix | At most `src/hooks/useExport.ts` or `src/workers/exportWorker.ts` | `git revert <commit>` |

No changes touch the export pipeline logic (`exportPipeline.ts`, `segmentEncoder.ts`, `frameRenderer.ts`) as part of Safari triage — those are stable and shared with Chrome.
