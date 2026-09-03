# WS2 Phase 4 — manual observability checklist (T4.1 / T4.2)

Written at WS2 T4.1 Step 5, against `a170b85`. **Scope: only what a user can see
or do.** Anything Phase 4 built that has no UI expression is listed in §Z as
NOT OBSERVABLE, so nobody goes looking for it.

Build column: `dev` = `npm run dev` (browser, no Tauri IPC), `tauri` = `npm run
tauri:dev` (default features, **no** `fa-inference`), `tauri:fa` = `npm run
tauri:dev:fa`. The FA rows differ between the last two and that difference is
the point.

**Reload discipline.** Every colour/inheritance row and every row that reads
persisted state must be checked after a FULL page reload, not an HMR update —
HMR gives wrong readings for inherited colour (established in Step D3).

---

## A. The dashboard gear

| # | Build | Do | Expect |
|---|---|---|---|
| A1 | any | Open the app with **no project loaded** (empty dashboard). | A gear button sits in the dashboard header, left of "New Project". |
| A2 | any | Click it. | App Settings opens **over the dashboard**. It must not require a project — this is the whole reason it renders in App's outer fragment. |
| A3 | any | Read the modal's heading and the grey line under it. | "App Settings", then "These settings apply to every project on this computer…". Text is legible light-grey — **not black** on the near-black panel. (This is the `#root` base-colour fix; a black heading is the regression.) |
| A4 | any | Press Escape. | Modal closes, nothing saved. |
| A5 | any | Reopen, press Escape while a text/select control has focus. | Still closes. |
| A6 | any | With App Settings open, press `S`, then `D`. | Nothing happens to the project behind the modal (the destructive pair is suppressed). **Known open:** Space, `+`/`-`, arrows and `F` still leak through — see §Z4, do not file it again. |

## B. The three blocks

| # | Build | Do | Expect |
|---|---|---|---|
| B1 | any | Scroll the modal top to bottom. | Exactly three blocks in this order — Export Engine (titled "Rendering Engine" when this row was run; reverted 2026-09-03, see C1/§Z1), Models & Add-ons, New Project Defaults — separated by near-invisible hairlines. No cards, no tabs, no nested dialog. |
| B2 | any | Look at block 2. | The models list is rendered **inline**, not behind a "Manage models" link. Its copy says downloads/deletions "take effect immediately — they are not held until Save." |
| B3 | tauri | In block 2, start a download, then press **Cancel** on the modal. | The download is **not** rolled back — block 2 is the deliberate exception to draft-then-commit. Reopen App Settings: the model's state reflects what actually happened on disk. |
| B4 | any | Change a control in block 1 or 3, press Cancel, reopen. | The control shows its **old** value. Draft-then-commit. |
| B5 | any | Change the same control, press **Save**, then do a **full page reload** and reopen. | The new value persisted. |

## C. Export Engine toggle

| # | Build | Do | Expect |
|---|---|---|---|
| C1 | any | Read the block title and toggle label. | **RESOLVED 2026-09-03 (C4) — this row was run and passed against the pre-C4 copy, and its expectation has since changed. As observed: "Rendering Engine" / "Use the WebCodecs renderer (faster, beta)". As shipped now: "Export Engine" / "Use the WebCodecs encoder (faster, beta)". The rename was reverted because D6's finding, which motivated it, was false — see §Z1.** |
| C2 | dev (Safari/WKWebView, or any runtime without WebCodecs) | Open App Settings on a device lacking the capability. | Toggle is visibly disabled, and the line "Not available on this device — requires WebCodecs, WebGL2, and module worker support." is shown. |
| C3 | tauri | Toggle OFF, Save, full reload, run an **export**. | Export uses the legacy canvas path. |
| C4 | tauri | Toggle OFF, Save, full reload, watch the **preview** across a transition. | **RESOLVED 2026-09-03 (C4 ruling) — the row did its job and is now spent.** It was written to expose a copy-vs-code discrepancy and it did: the toggle never reached the preview. The copy has been corrected (the block now says the preview is unaffected) and the preview was deliberately NOT wired, because the Canvas2D fallback was deleted at the WebGL2 cutover, so the switch would disable the only preview renderer that exists. Expectation now: the preview is unchanged by this toggle, and that is correct and documented. `src/hooks/webcodecsToggleConsumers.test.ts` holds it. |

## D. New Project Defaults → New Project

| # | Build | Do | Expect |
|---|---|---|---|
| D1 | any | In block 3 set Aspect 9:16, Resolution 720p, Language French, both toggles to non-default. **Save.** Full reload. Click **New Project**. | Every one of those fields is **pre-filled** with what you set. |
| D2 | any | While still in block 3, change Resolution between 720p and 1080p. | The dimension line under it updates live (e.g. 1080×1920 ↔ 720×1280) before any Save. |
| D3 | any | Set block 3's language to **Auto-detect**. | The helper line reads "New projects store no language at all and let the first transcription detect it." With any real language selected it reads "…overriding auto-detection." |
| D4 | any | Set default language to Auto-detect, Save, create a new project, then open **Project Settings**. | Its language dropdown shows **Auto-detect** — no language was written. (Direct proof is in §Z2; from the UI, Auto-detect showing is the observable.) |
| D5 | any | Set a default of, say, Spanish; create a project; open Project Settings. | Language shows Spanish. |
| D6 | any | Create a project seeded from defaults, then go back and change block 3's values, Save. Reopen the **already-created** project's settings. | Unchanged. Defaults are seeds only and never reach an existing project. |
| D7 | any | Note the shipped default of "High-Precision Auto-Sync on new projects" on a machine that has never set it. | **OFF.** Deliberate — a default build cannot run FA at all (§Z3). |

## E. FA pack detector — Project Settings, all five states

The detector lives in **Project Settings**, under the language dropdown, and
probes the **draft** value — it re-checks as you move the dropdown, before any
Save. Open Project Settings on any project for every row below.

| # | Build | Do | Expect (`data-state`) |
|---|---|---|---|
| E1 | dev | Open Project Settings, pick English. | "Pack status is unavailable outside the desktop app." (`unavailable`) — no runtime to probe. |
| E2 | tauri | Pick English (or es/fr/de/pt). | ⚠️ "This build cannot run high-precision sync at all, so no pack would help. Syncs use standard timing." (`unbuilt`) — **and no download prompt.** The absence of a download offer is the thing to check: offering a 1.2 GiB pack this binary cannot use is the defect Step 3 exists to prevent. Pack presence on disk is irrelevant here; do not expect it to change the message. |
| E3 | tauri:fa | Pick a language whose pack is **installed**. | Green check, "<Language> alignment pack installed" (`installed`). |
| E4 | tauri:fa | Pick a language whose pack is **not** installed. | Amber warning, "…is not installed — high-precision sync will fall back to standard timing." with an **"Install it"** link. (`missing`) |
| E5 | tauri:fa | Click "Install it". | An inline installer appears **in place**, listing only that one language, with no Whisper model in it. Same progress/completion behaviour as block 2 of App Settings. |
| E6 | tauri:fa | Complete that install without leaving the modal. | The detector flips to `installed` on its own. |
| E7 | any | Pick **Auto-detect**. | "Auto-detect has no single pack to check…". **Neither** a green tick nor a missing-pack warning, and **no** download prompt. Both of the other two would be false statements here. |
| E8 | any | Pick a supported-but-not-FA language (a whisper code outside en/es/fr/de/pt), if reachable from the dropdown. | "No alignment pack exists for '<code>'…" (`unsupported`). **May be unreachable** — the dropdown is built from `SUPPORTED_LANGUAGES`, which is exactly the five. If you cannot select such a language, this state is not user-reachable and that is correct; skip it. |
| E9 | tauri:fa | Move the dropdown quickly through several languages. | The final message always matches the final selection — a slow probe never overwrites a newer one with a stale answer. |
| E10 | any | Move the dropdown to a new language and press **Cancel**. | Detector was live on the draft the whole time; on reopen it reflects the **saved** language again. |

## F. D4 — a mixed per-segment overlay must survive an unrelated Save

This is the destructive-regression row. Run it deliberately.

| # | Build | Do | Expect |
|---|---|---|---|
| F1 | any | On a project with several segments, turn segment text overlay **ON for some segments and OFF for others** (per-segment, in the Effects/segment UI). Note exactly which. | Mixed state established. |
| F2 | any | Open **Project Settings**. Do **not** touch the Text Overlay toggle. Change something else entirely (resolution tier, or language). Press **Save**. | Every segment keeps the overlay state it had. **The regression this guards against is every segment's overlay silently turning OFF** — because the modal's toggle seeds from `segments.every(s => s.showOverlay)`, which reads `false` on a mixed project. |
| F3 | any | Repeat F1, then in Project Settings **do** move the Text Overlay toggle, and Save. | Now the cascade fires and every segment takes the toggle's value. Changing it is supposed to cascade; not changing it is not. |
| F4 | any | Repeat F1, open Project Settings, move the toggle, move it **back**, Save. | Mixed state preserved — the gate is on the value differing from what the control opened with, not on having been touched. |

## G. Colour / inheritance regression sweep (Step 4)

| # | Build | Do | Expect |
|---|---|---|---|
| G1 | any | **Full page reload** (⌘R / relaunch — not HMR). Open the New Project modal from the dashboard. | Heading, name input and resolution select are light text, not black-on-#111. |
| G2 | any | Same reload, open App Settings from the dashboard gear. | Same — all copy legible. |
| G3 | any | Reload with a **saved project** present, and watch the very first frame. | The brief "LOADING…" screen renders in light grey on near-black. Transient and easy to miss; see §Z5. |
| G4 | any | Run an **Apply Sync** and watch the overlay. | "Preparing your project…" renders light grey on the dark panel. |

---

## Z. NOT observable from the UI — do not go looking

- **Z1. The Export Engine toggle does not reach the preview — by ruling, not by
  oversight.** Its only consumers are `useExport.ts` and the App Settings modal
  itself; `PreviewStage.tsx:380` gates on `isWebCodecsPreviewSupported()`, a
  capability-only check that never reads the stored toggle. Row C4 was written to
  expose this and did.
  **Resolved 2026-09-03 (C4).** The owner decision this note asked for was made:
  correct the copy, do not wire the preview. Wiring it would hand the user a
  switch that turns off the only preview renderer in the app, since the
  Canvas2D/CSS path was deleted at the WebGL2 cutover rather than gated. The
  block title reverted to "Export Engine" — the "Rendering Engine" rename rested
  entirely on D6's claim that the preview read the same value, and that claim was
  measured false (the two files share a local variable name, nothing more).
  `src/hooks/webcodecsToggleConsumers.test.ts` now pins the consumer set, so the
  copy cannot outrun the wiring again.
- **Z2. "Auto-detect writes nothing" is a field ABSENCE, not a visible state.**
  The UI can only show you that the dropdown reads Auto-detect. That the created
  project carries no `language` key at all is checkable only in devtools
  (`localStorage` project JSON) or by the locking tests
  (`languageDefaultDrift.test.ts`, `appDefaultsSurface.test.ts`). Row D4 is the
  closest UI proxy and is not proof.
- **Z3. Why the FA default ships OFF** is a build fact, not a UI fact — there is
  nothing to look at. See §Z6.
- **Z4. The bare-key shortcut leak** (Space, `+`/`-`, arrows, `F` acting behind
  an open modal) is a known open non-blocking defect. Only `S`/`D` were fixed.
  Row A6 records it; it is not a Phase 4 regression.
- **Z5. The two spans edited in Step 4 are transient and may never render on a
  test machine.** `App.tsx`'s hydrating "Loading…" only mounts while a saved
  project is being rehydrated (it did not mount at all on an empty install
  during Step 4 verification, across a 6-second MutationObserver watch);
  `SyncLoadingOverlay` only mounts during a sync. Their inheritance was verified
  instead against replicas carrying the exact remaining class strings, in a
  fully-reloaded real DOM.
- **Z6. `featureCompiled: false` is not something a build can be talked into.**
  In `tauri:dev`/`tauri:build`, `fa_align` returns `not_implemented` for every
  run regardless of what packs are installed. Row E2 is the only UI expression
  of it. Do not try to make E3/E4 appear in a `tauri:dev` build.
- **Z7. There is no UI difference between "the pack is on disk" and "the pack is
  on disk AND the ONNX runtime dylib loaded"** in the `unbuilt` state, because
  neither is consulted. In `tauri:fa` the detector reports disk presence only
  (via `checkInstalledModels`), deliberately not `fa_preflight`'s own
  `modelPresent` — one question, one answer.
