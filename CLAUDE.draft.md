# CLAUDE.md — Kinetix Pro Studio (DRAFT)

> **TEMPORARY — Phase 2 only.** Replace `CLAUDE.md` with this file, then delete `CLAUDE.draft.md`.
> Do not edit the live `CLAUDE.md` until Phase 2 applies this draft.

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
| `docs/work-in-progress.md` | **Phase 2:** moves to `docs/archive/history/`; task detail folds into `project-state.md` until then |

Completed work → `docs/archive/history/history.md` (+ `history-2.md` overflow). **Do not restate WS3 Rung/Tier registers here** — they live in `docs/ws3-export/architecture-ledger.md` after Phase 2 lands.

---

## 4. Architecture map (pointers only)

**Sync:** `syncEngine.ts`, `whisperService.ts`, `snapBoundaries.ts`, `faAnchorTrustGate.ts`, `faChunkPlan.ts` — see `docs/ws1-sync-pipeline/README.md`.

**Timeline / drag:** `dragCascade.ts`, `dragGeometry.ts`, `dragSession.ts`, `Timeline.tsx` — manual QA: `docs/ws2-app/editor-wkwebview-drag-checklist.md`.

**Preview / GL:** `PreviewStage.tsx`, `useGlPreview.ts`, `services/gl/`.

**Export (WebCodecs default):** `useExport.ts`, `webcodecsExport/exportWorker.ts`, `exportPipelineWebCodecs.ts`, `tauriFfmpeg.ts`; legacy `exportPipeline.ts`. Native: `ffmpeg.rs` (session lifecycle, append batch IPC, annexb concat/mux, resume/checkpoint commands). Liveness, rung failover, durable resume → `docs/ws3-export/` (Phase 2 paths).

**Speech:** `useWhisper.ts`, `whisper.rs`. **FA models:** `docs/ws2-app/fa-models-*.md`.

---

## 5. Invariants (standing — detail in archive)

**Segment timing:** Model P gapless partition; headings in `project.headings`; `anchorSource` demote-only; transcription cache keyed by file identity.

**Undo/redo:** Whole-`Project` snapshots; 20-state cap; lock blocks traversal; lock/unlock not undoable; never `setProjectRaw` outside wrappers; never restore through `computeDragCascade`.

**Export:** AnnexB end-to-end; absolute frame timestamps; `concatAnnexbPieces` not concat protocol; mux with `-r` not `-framerate`; video/audio mux separate; color space at mux; **cancel kills worker before ffmpeg**.

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

Full table in live `CLAUDE.md` until Phase 2 swap — this draft carries the highest-churn entries only.

---

## 7. Where things live

- **Status / next actions** → `project-state.md`
- **Active task ledger (until Phase 2 archive move)** → `docs/work-in-progress.md`
- **Lane indexes** → `docs/README.md`, `docs/ws1-sync-pipeline/README.md`, `docs/ws2-app/README.md`, `docs/ws3-export/README.md`
- **Sync v2 plan** → `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`
- **Script fixtures** → `scripts/fixtures/` (hardcoded paths — grep before moving)
- **WS1 measurements (non-fixture)** → `docs/ws1-sync-pipeline/measurements/`
- **Manual drag QA** → `docs/ws2-app/editor-wkwebview-drag-checklist.md`
