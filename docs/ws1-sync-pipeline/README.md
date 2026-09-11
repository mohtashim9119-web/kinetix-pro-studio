# WS1 — Sync Pipeline

Forced-alignment timing-source upgrade: Whisper alignment, chunk planning, rule-stage
boundary correction, and Stage 1 live acceptance.

**Current state:** WS1 Session AN complete on `main` — anchor-widened chunk edges (arm H)
are the strongest S2-family result yet but not a shipping candidate (46/447 v6 boundaries
still beyond ±50 ms). Stage 1 lock blocked on an open Zero-Defect Register. Active task
detail lives in `docs/work-in-progress.md` §WS1.

## Living docs

| Doc | Purpose |
|---|---|
| [`sync-pipeline-v2-plan.md`](sync-pipeline-v2-plan.md) | Accepted v2 architecture, measurement programme, session parts A–AH |
| [`stage1-live-run-prep.md`](stage1-live-run-prep.md) | Stage 1 live acceptance runbook (prepared, not executed) |
| [`stage1-mover-audit.md`](stage1-mover-audit.md) | 24-row blind ear-scoring dossier for Apply Sync movers |
| [`measurements/README.md`](measurements/README.md) | Index for WS1 research-phase CSV/JSON (not script fixtures) |

## Archived history

Session completion records and folded investigations → [`docs/history.md`](../history.md)
and [`docs/history-2.md`](../history-2.md). Frozen measurement artifacts stay under
`measurements/`; replay audit `.txt` files are historical, not navigational.
