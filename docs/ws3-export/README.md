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
| `w23-machine1-validation.md` | Machine 1 mux-stage disk-full validation runbook (Round 24a, active) |

**Archive:** closed round audits → [`docs/archive/ws3/`](../archive/ws3/).

**Lane cap note:** WS3 living-doc cap is ≤7 (`docs/README.md`). This lane currently has **8** content
docs (table above). Round 23 brought the count to 7; `w23-machine1-validation.md` is the +1 and stays
in-lane this week. If the cap must be enforced before archiving the runbook, fold
`silent-gaps-diagnosis.md` or `pipeline-audit.md` (static PROMPT 12 audit — dispositions now in the
ledger) to `docs/archive/ws3/` first.
