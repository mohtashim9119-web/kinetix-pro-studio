# WS3 — Export pipeline

Living architecture for the WebCodecs+WebGL2 export path: liveness watchdogs, append batching,
hardware rung failover, and durable checkpoint/resume. Round-by-round history lives in the ledger
preamble (Rung/Tier taxonomy) — not restated here.

| Doc | Purpose |
|---|---|
| [`architecture-ledger.md`](architecture-ledger.md) | Round-by-round export architecture ledger (Rung/Tier registers) |
| [`durable-state.md`](durable-state.md) | Durable checkpoint/resume preconditions and Round 11–13+ records |
| [`pipeline-audit-round28.md`](pipeline-audit-round28.md) | Round 28 closeout D9 encoder-restart audit (read-only, static) |
| [`reclaim-mechanisms.md`](reclaim-mechanisms.md) | Which of the two "Reclaim" mechanisms (storage-root vs. export-failure) covers which root (WS3 Batch 2, D5/U36) |
| [`recovery-architecture.md`](recovery-architecture.md) | Flush-timeout / rung failover architecture (code-cited living spec) |
| [`silent-gaps-diagnosis.md`](silent-gaps-diagnosis.md) | Timer-starvation / occlusion diagnosis (code-cited) |
| [`w23-machine1-validation.md`](w23-machine1-validation.md) | Mux-stage disk-full retain/resume validation runbook (W23) |
| [`windows-validation.md`](windows-validation.md) | Windows long-path delivery and installer validation checklist |

Lane is at 8/7 (over cap) as of Round 28 closeout — `pipeline-audit.md` (static Round 9 audit,
superseded by `pipeline-audit-round28.md`) was moved to
[`../archive/ws3/pipeline-audit-prompt12-round9.md`](../archive/ws3/pipeline-audit-prompt12-round9.md),
but `reclaim-mechanisms.md` (added WS3 Batch 2, never previously added to this table) was found
already outstanding against the cap during this pass. Flagging rather than silently archiving a
second doc beyond the single swap the closeout process calls for — next round should pick which
of the 8 to fold or archive. Next overflow goes to [`../archive/ws3/`](../archive/README.md).

**Archive:** closed round audits and the static speed-optimization feasibility study →
[`docs/archive/ws3/`](../archive/README.md).
