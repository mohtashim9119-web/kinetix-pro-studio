# WS3 — Export pipeline

Living architecture for the WebCodecs+WebGL2 export path: liveness watchdogs, append batching,
hardware rung failover, and durable checkpoint/resume. Round-by-round history lives in the ledger
preamble (Rung/Tier taxonomy) — not restated here.

| Doc | Purpose |
|---|---|
| `architecture-ledger.md` | Round-by-round export architecture ledger (Rung/Tier registers) |
| `durable-state.md` | Durable checkpoint/resume preconditions and Round 11–13+ records |
| `pipeline-audit.md` | PROMPT 12 cross-branch pipeline audit (static) |
| `windows-validation.md` | Windows long-path delivery and installer validation checklist |
| `silent-gaps-diagnosis.md` | Timer-starvation / occlusion diagnosis (code-cited) |
| `recovery-architecture.md` | Flush-timeout / rung failover architecture (code-cited living spec) |
| `speed-architecture-audit.md` | Export speed optimization feasibility study |

**Archive:** closed round audits → [`docs/archive/ws3/`](../archive/ws3/).
