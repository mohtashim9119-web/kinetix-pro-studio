# WS3 — Export pipeline

Living architecture for the WebCodecs+WebGL2 export path: liveness watchdogs, append batching,
hardware rung failover, and durable checkpoint/resume. Round-by-round history lives in the ledger
preamble (Rung/Tier taxonomy) — not restated here.

| Doc | Purpose |
|---|---|
| [`architecture-ledger.md`](architecture-ledger.md) | Round-by-round export architecture ledger (Rung/Tier registers) |
| [`durable-state.md`](durable-state.md) | Durable checkpoint/resume preconditions and Round 11–13+ records |
| [`pipeline-audit.md`](pipeline-audit.md) | PROMPT 12 cross-branch pipeline audit (static) |
| [`recovery-architecture.md`](recovery-architecture.md) | Flush-timeout / rung failover architecture (code-cited living spec) |
| [`silent-gaps-diagnosis.md`](silent-gaps-diagnosis.md) | Timer-starvation / occlusion diagnosis (code-cited) |
| [`w23-machine1-validation.md`](w23-machine1-validation.md) | Mux-stage disk-full retain/resume validation runbook (W23) |
| [`windows-validation.md`](windows-validation.md) | Windows long-path delivery and installer validation checklist |

Lane is at cap (7/7). Next overflow goes to [`../archive/ws3/`](../archive/README.md).

**Archive:** closed round audits and the static speed-optimization feasibility study →
[`docs/archive/ws3/`](../archive/README.md).
