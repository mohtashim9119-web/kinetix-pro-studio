# WS2 — Transcription

Local `whisper-cli` sidecar transcription (`src/hooks/useWhisper.ts`,
`src-tauri/src/whisper.rs`) and feasibility analysis for optional online paths.

**Current state:** Production path is local whisper-cli only. Groq LPU Speech feasibility
was audited read-only; not shipped. No active transcription workstream.

## Living docs

| Doc | Purpose |
|---|---|
| [`groq-feasibility.md`](groq-feasibility.md) | Static feasibility audit: Groq vs local whisper-cli (2026-09-09) |

## Archived history

Whisper sidecar implementation records → [`docs/history.md`](../history.md) and
[`docs/history-2.md`](../history-2.md).
