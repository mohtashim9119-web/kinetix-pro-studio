# CLAUDE.md — Kinetix Pro Studio

> **Purpose:** the operating manual — architecture, conventions, invariants. Durable
> content only: true today and still true in six months. **Never put here:** status,
> test/line counts, commit SHAs, dates, or task lists — those rot the moment they're
> written. Status → `project-state.md`. Task-level detail → archived
> `docs/archive/history/work-in-progress.md`. Dated fixes/investigations/measured numbers →
> `docs/archive/history/history.md`. **Cap: ~400 lines**; if adding content would exceed it,
> something existing moves to `docs/archive/history/history.md` first.

---

## 1. What This Project Is

Kinetix Pro Studio is a desktop video slideshow compositor: script, scene-tagged assets, and voiceover sync into a gapless segment timeline with transitions, overlays, filters, and animations, exported as H.264/AAC MP4. Built for solo creators without a full NLE. Tauri v2 — React/Vite frontend, Rust shell, native ffmpeg sidecar (export), whisper.cpp sidecar (speech alignment), optional in-process forced alignment (`fa-inference` feature). **Local-first:** transcription and export run on-device; optional online Groq transcription is documented as feasibility only (`docs/ws2-app/transcription-groq-feasibility.md`), not shipped.

---

## 2. Commands

```
npm run dev             # Vite only — no Tauri APIs, no export
npm run tauri:dev       # Full app — export/ffmpeg/whisper work here
npm run tauri:dev:fa    # Same + fa-inference (ONNX forced alignment)
npm run build           # vite build (frontend only)
npm run tauri:build     # Production bundle
npm run lint            # tsc --noEmit
npm test                # vitest run
npm run test:watch      # vitest watch
```

Perishable test counts and branch HEAD → `project-state.md`. Rust: `cargo check` / `cargo build` from `src-tauri/`. ffmpeg binaries gitignored — `src-tauri/binaries/README.md`.

---

## 3. Documentation map

| Doc | Job |
|---|---|
| `CLAUDE.md` | Durable operating manual (this file) |
| `project-state.md` | Perishable situation report — six fixed sections |
| `docs/README.md` | Three-lane index + archive policy |
| `docs/ws1-sync-pipeline/README.md` | Sync pipeline living docs |
| `docs/ws2-app/README.md` | App/platform living docs |
| `docs/ws3-export/README.md` | Export architecture (ledger, durable state — see lane README) |
| `docs/archive/` | Folded history, closed investigations |

Completed work → `docs/archive/history/history.md` (+ `history-2.md` overflow). **Do not restate WS3 Rung/Tier registers here** — they live in `docs/ws3-export/architecture-ledger.md`.

---

## 4. Architecture map (pointers only)

**Sync:** `syncEngine.ts`, `whisperService.ts`, `snapBoundaries.ts`, `faAnchorTrustGate.ts`, `faChunkPlan.ts` — see `docs/ws1-sync-pipeline/README.md`.

**Timeline / drag:** `dragCascade.ts`, `dragGeometry.ts`, `dragSession.ts`, `Timeline.tsx` — manual QA: `docs/ws2-app/editor-wkwebview-drag-checklist.md`.

**Preview / GL:** `PreviewStage.tsx`, `useGlPreview.ts`, `services/gl/`.

**Export (WebCodecs default):** `useExport.ts`, `webcodecsExport/exportWorker.ts`, `exportPipelineWebCodecs.ts`, `tauriFfmpeg.ts`; legacy `exportPipeline.ts`. Native: `ffmpeg.rs` (session lifecycle, append batch IPC, annexb concat/mux, resume/checkpoint commands). Liveness, rung failover, durable resume → `docs/ws3-export/`.

**Speech:** `useWhisper.ts`, `whisper.rs`. **FA models:** `docs/ws2-app/fa-models-*.md`.

---

## 5. Invariants (standing — detail in archive)

**Segment timing:** Model P gapless partition; headings in `project.headings`; `anchorSource` demote-only; transcription cache keyed by file identity.

**Undo/redo:** Whole-`Project` snapshots; 20-state cap; lock blocks traversal; lock/unlock not undoable; never `setProjectRaw` outside wrappers; never restore through `computeDragCascade`.

**Export:** AnnexB end-to-end; absolute frame timestamps; `concatAnnexbPieces` not concat protocol; mux with `-r` not `-framerate`; video/audio mux separate; color space at mux; **cancel kills worker before ffmpeg**; export-scoped recovery budget carried across piece boundaries (C11).

**Sync / FA:** Timestamps measure distance, never decide identity; golden replay stops at `snapCoveredBoundaries` — not an FA/rule gate.

**Repo ops:** Stage named paths only; no redirect-truncate into existing files; no `git checkout` to revert probes with uncommitted edits.

Full discovery trail → `docs/archive/history/history.md` Decisions Log; `project-state.md` Rulings In Force indexes cross-cutting rulings.

---

## 6. Do-not list (selected)

| Rule | Reason |
|---|---|
| Mutate before `setState` | Breaks history snapshots |
| `Math.random().substr` IDs | Deprecated / collision-prone |
| `any` type | Use proper types |
| Base64 large blobs over Tauri IPC | ~5–8× memory inflation — use raw IPC body |
| ffmpeg concat protocol for annexb pieces | FD limit on macOS |
| Timestamp proximity for identity in sync/FA | Smears 100–900ms — use token index |
| `FontFace.load(url)` in export worker | WKWebView NetworkError — fetch on main thread |
| `-framerate` on annexb mux | Wrong packet duration — use `-r` |
| `git add -A` / `git add .` | Sweeps untracked `public/` etc. |

Full table preserved in git history at pre-consolidation `CLAUDE.md` — this file carries the highest-churn entries only.

---

## 7. Where things live

- **Status / next actions** → `project-state.md`
- **Archived task ledger** → `docs/archive/history/work-in-progress.md`
- **Lane indexes** → `docs/README.md`, `docs/ws1-sync-pipeline/README.md`, `docs/ws2-app/README.md`, `docs/ws3-export/README.md`
- **Sync v2 plan** → `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`
- **Script fixtures** → `scripts/fixtures/` (hardcoded paths — grep before moving)
- **WS1 measurements (non-fixture)** → `docs/ws1-sync-pipeline/measurements/`
- **Manual drag QA** → `docs/ws2-app/editor-wkwebview-drag-checklist.md`
- **Export ledger** → `docs/ws3-export/architecture-ledger.md`

**No CSV/JSON data files live in `docs/` — they're test fixtures, not documentation.** Files a `scripts/*.py` or `scripts/*.test.ts` reads by *hardcoded path* live in `scripts/fixtures/`. Everything else (WS1 research-phase measurement output) lives in `docs/ws1-sync-pipeline/measurements/`. Before moving any file into or out of `scripts/fixtures/`, grep `scripts/` for its filename; if there's a hit, update every hardcoded path in the same commit and re-verify golden replay 3/3 — see `docs/archive/history/history.md`'s "Docs Restructure Phase 5" entry.
