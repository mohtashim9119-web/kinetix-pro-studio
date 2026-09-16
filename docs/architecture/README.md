# Architecture — cross-workstream design records

Target-state and cross-workstream architecture that cannot live in a single WS1/WS2/WS3 lane
because it spans all of them. Same cap (7 live docs, README excluded) and archive rule
(`docs/archive/architecture/`, created when this lane first overflows) as the workstream lanes.

| Doc | Purpose |
|---|---|
| [`saas-target-architecture.md`](saas-target-architecture.md) | Target-state SaaS architecture: native render/export core, timeline rewrite, playback engine, reliability model, cloud layer, product capabilities, and the migration path from the current Tauri desktop app |
| [`cloud-asr-plan.md`](cloud-asr-plan.md) | Plan to move transcription and forced alignment to Modal behind a thin gateway, with local whisper.cpp as offline fallback — compatibility, licenses, seam, and payload sizing; not implemented behaviour |
| [`fa-wiring-audit.md`](fa-wiring-audit.md) | Ground-truth audit (2026-09-17): FA build matrix, runtime gates, D24 fallback inventory, NR-1–NR-4 rulings source |
