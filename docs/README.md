# Documentation Index

> **Rule:** no loose `.md` files may live at `docs/` root. Every navigational doc belongs
> in a workstream folder below or in the repo root tier (`CLAUDE.md`, `project-state.md`,
> `README.md`, plus the cross-cutting ledgers `history.md`, `history-2.md`,
> `work-in-progress.md`).

## Workstreams

| Folder | Scope | Living docs |
|---|---|---|
| [`ws1-sync-pipeline/`](ws1-sync-pipeline/README.md) | Script→segment sync, forced alignment, Stage 1 acceptance | Plan, stage1 runbooks, measurements index |
| [`ws2-fa-models/`](ws2-fa-models/README.md) | ONNX forced-alignment model packs and ORT provisioning | Operator runbooks for Manage Models + ORT bundle |
| [`ws2-video-ingest/`](ws2-video-ingest/README.md) | Voiceover fetch, preview pool, Windows ingest | README only — closed diagnoses in archive |
| [`ws2-transcription/`](ws2-transcription/README.md) | Whisper sidecar and optional online transcription | Groq feasibility audit |
| [`ws2-editor/`](ws2-editor/README.md) | Timeline drag, WKWebView pointer quirks | Standing manual QA checklist |
| [`archive/`](archive/README.md) | Closed round audits and diagnoses (read-only) | Per-workstream subfolders |

WS3 export docs remain at `docs/ws3-*.md` until Phase 2 consolidation lands (see
`ws3-docs-inventory.md`).

## Script runbooks (unchanged location)

Per `CLAUDE.md` §7, fixture and measurement runbooks stay beside their readers under
`scripts/` — not moved into `docs/`. Index:

| Path | Purpose |
|---|---|
| `scripts/fixtures/README.md` | Golden baseline and FA fixture contract |
| `scripts/ws2-49-measurement/README.md` | WS2-49 measurement output index |
| `scripts/measure-word-onset.md` | Word-onset measurement notes |
| `scripts/phase3-reference-validity.md` | Phase 3 reference validity notes |

## Archive policy

Closed round audits, closed diagnoses, and superseded investigations move to
`docs/archive/<workstream>/` **byte-for-byte unchanged**. Archived files are never edited
in place — append corrections to the living ledger instead. Git history is the ultimate
retention backstop; the archive exists so cloud agents and pasted prompts can resolve paths
without a checkout.
