# WS3 — Export pipeline

Living architecture for the WebCodecs+WebGL2 export path: liveness watchdogs, append batching,
hardware rung failover, and durable checkpoint/resume. Round-by-round history lives in the ledger
preamble (Rung/Tier taxonomy) — not restated here.

| Doc | Purpose |
|---|---|
| [`architecture-ledger.md`](architecture-ledger.md) | Round-by-round export architecture ledger (Rung/Tier registers) |
| [`pipeline-audit-round28.md`](pipeline-audit-round28.md) | Round 28 closeout D9 encoder-restart audit (read-only, static) |
| [`reclaim-mechanisms.md`](reclaim-mechanisms.md) | Which of the two "Reclaim" mechanisms (storage-root vs. export-failure) covers which root (WS3 Batch 2, D5/U36) |
| [`recovery-architecture.md`](recovery-architecture.md) | Flush-timeout / rung failover architecture (code-cited living spec) |
| [`silent-gaps-diagnosis.md`](silent-gaps-diagnosis.md) | Timer-starvation / occlusion diagnosis (code-cited) |
| [`w23-machine1-validation.md`](w23-machine1-validation.md) | Mux-stage disk-full retain/resume validation runbook (W23) |
| [`windows-validation.md`](windows-validation.md) | Windows long-path delivery and installer validation checklist |

Lane cap reconciled Round 28: the count was actually 8/7, not 7/7 —
`reclaim-mechanisms.md` (added WS3 Batch 2) had never been added to this table, so the prior
closeout's single `pipeline-audit.md` swap left the lane over cap without anyone noticing.
`durable-state.md` (Round 11–13+ checkpoint/resume preconditions) is now the second doc moved,
to [`../archive/ws3/durable-state.md`](../archive/ws3/durable-state.md) — it is the least current
of the 8: its own content is superseded piecemeal by later rounds (Round 28's D4 storage-root
work in particular), and it is cited only as historical record by `architecture-ledger.md`, never
as a live precondition doc in its own right. Lane is back to 7/7. Next overflow goes to
[`../archive/ws3/`](../archive/README.md).

Target-state architecture now lives in the cross-workstream
[`docs/architecture/`](../architecture/README.md) lane, not here — see
[`saas-target-architecture.md`](../architecture/saas-target-architecture.md).

**Archive:** closed round audits and the static speed-optimization feasibility study →
[`docs/archive/ws3/`](../archive/README.md).
