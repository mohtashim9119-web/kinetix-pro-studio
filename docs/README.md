# Documentation index

Kinetix Pro Studio docs are organized into three active workstream lanes, a cross-workstream
architecture lane, and a shared, frozen archive. Nothing sits loose at `docs/` root except this
file and `STATUS.md`.

## Tracking

**[`STATUS.md`](STATUS.md) is the only tracking doc** — one per-workstream ledger (In
Progress / Next Tasks / Open Bugs / Deferred Tasks) plus a cross-workstream Backlog. Do not
create a second tracking file for any workstream; update `STATUS.md` in place.

## Active lanes

| Lane | Path | Scope |
|---|---|---|
| WS1 — Sync pipeline | [`ws1-sync-pipeline/`](ws1-sync-pipeline/README.md) | Forced-alignment timing, measurement programme, live runbooks |
| WS2 — Editing pipeline | [`ws2-editing-pipeline/`](ws2-editing-pipeline/README.md) | FA model packs, editor QA, transcription feasibility |
| WS3 — Export pipeline | [`ws3-export-pipeline/`](ws3-export-pipeline/README.md) | WebCodecs export architecture, liveness, durable resume |

## Cross-workstream lanes

| Lane | Path | Scope |
|---|---|---|
| Architecture | [`architecture/`](architecture/README.md) | Cross-workstream architecture and target-state design records — content that spans more than one workstream lane and so cannot live in any single one |

Same cap and archive rule as the workstream lanes below (`archive/architecture/` once one exists).

## Archive

Completed investigations, session overflow, and retired tracking docs live under
[`archive/`](archive/README.md). **`docs/archive/**` is frozen and never edited** — new
findings go in `STATUS.md` or the owning lane, not into an archived file. Historical path
citations inside archived narrative are left as written — they record where a file lived
when the event happened, not navigation targets.

## Rules

- **No loose files** at `docs/` root besides this index and `STATUS.md`.
- **Cap of 7 live docs per lane** (READMEs excluded), including `architecture/`; overflow goes to
  that lane's matching archive folder (`archive/ws1/`, `archive/ws2/`, `archive/ws3/`,
  `archive/architecture/`).
- **Script runbooks** stay beside their readers under `scripts/` per `CLAUDE.md` §7.
