# Baseline-clean declaration — draft for operator signature (2026-09-19)

This is a draft, unsigned. It states the criteria this multi-pass baseline effort was
scoped against and the evidence commit for each, so the operator can sign off on
`ws1-plan-rewrite` as a clean baseline in one place rather than re-deriving it from six
passes' worth of notes.

## Baseline criteria × evidence

| Criterion | Evidence commit(s) |
|---|---|
| Six gates green (`tsc`, golden replay, FA replay, `cargo check`, `cargo check --features fa-inference`, `npm test`) + canonical line | `53449b9` |
| Named flakes (`fa-dev-digest-memo-reset-race`, `whisper-terminal-buffer-cap-eviction-race`) | `53449b9` |
| `.work-phase4/replay/` fixtures committed as tracked content | `549ce63` |
| Dated docs-only WS1 verification notes allowlisted (`ws1-single-tracker.test.ts`) | `2b7d33a` |
| P0 merge (`main` → `ws1-plan-rewrite`) | `2e74209` |
| Preservation sweep (13-finding re-verification, npm gates) | `5221c95` |
| Lane charters landed, STATUS.md closures, NR-2 superseded, D24 re-filed, cap accounting shown | this pass (P4 lane re-charter + STATUS closure) |

## Cap arithmetic (T1) — shown explicitly, with a caveat

`docs/STATUS.md`'s Next-Tasks/Open-Bugs/Backlog lines carried **40** `[OPEN...]` entries
immediately before this pass (verified by direct count against the pre-pass file, not
assumed). This pass's task brief specified "40 open − 6 closures + 2 new = 36 ≤ 40." That
arithmetic does not fully resolve against the actual 40-line list, and this declaration
records the discrepancy rather than silently forcing the number:

- **+2 new** — confirmed: `fa-dev-digest-memo-reset-race` and
  `whisper-terminal-buffer-cap-eviction-race`, registered this pass under WS1 Open Bugs.
- **1 genuine STATUS.md line closure** — confirmed: the R.7 line (was `docs/STATUS.md:32`)
  is now fully closed (clauses 1–2 ratified as shipped-by-other-means, clause 3 retired on
  exhaustive-grep evidence — `verification-sweep-2026-09-18.md` W7).
- **R.3, R.5, R.8, R.9** — formally closed per the mapping report
  (`final-shape-mapping-2026-09-18.md` §E1/E2/E4/E5), but **these were never separate
  `docs/STATUS.md` open lines** to begin with — they existed only as rows in that report's
  own closure table. Recording their closure in `docs/STATUS.md` (this pass's new "Rule
  register closures" note) adds a citation; it does not remove a line from the 40-line
  count, because none of the 40 lines named them.
- **The vocab line and D24** were reworded/relocated this pass, not closed — both remain
  open (vocab: partly closed, runtime loader still open; D24: re-filed WS3→WS1, still
  open).

**Actual net change to the 40-line count this pass: 40 − 1 (R.7) + 2 (new) = 41.** The
task brief's "36" does not hold under the evidence gathered this pass. Flagged for the
operator rather than adjusted to match by fabricating additional closures — per the
standing conservative-default-logged rule for this session.

> **Superseded 2026-09-19 (P4b).** The "40" used as this section's starting baseline was
> itself wrong — a direct recount immediately pre-P4 showed **41**, not 40 (the P4 pass
> undercounted its own starting point). Corrected accounting, and this pass's resolution
> (closing the gitignored-replay-fixtures line with evidence, landing at a final 41), are
> in [`p4b-cap-resolution-2026-09-19.md`](p4b-cap-resolution-2026-09-19.md). This
> section's numbers above are left as-is, as the historical record of the original
> (imperfect) accounting — do not treat them as current.

## Merge proposal

One merge, `ws1-plan-rewrite` → `main`, after this pass — **not executed by this pass**;
docs-only, no push/PR/CI per the task brief's standing rules. On operator go: the
four-worktree wipe via the audited delete helper, with the webgl2 stash preserved as a
patch first (per the standing "stash untouched" rule — preserve before any wipe touches
the shared stash stack).

## Decision Log (this pass)

1. NR-2 marked SUPERSEDED rather than deleted, to keep the FA wiring audit discovery
   trail (`ebec58a`) intact — a new dated note (NR-6, operator rulings) records the
   superseding ruling verbatim rather than editing NR-2's own text.
2. D24 moved from WS3 Open Bugs to WS1 Open Bugs (re-filed, not duplicated) — it is a
   sync-behavior defect (silent FA→Whisper substitution), and WS3's charter narrows the
   lane to export-only.
3. R.3/R.5/R.8/R.9 closures recorded as a new `docs/STATUS.md` note rather than as
   removed/rewritten Next-Tasks lines, because none of the 40 open lines named them —
   avoids fabricating a line to then "close."
4. Cap arithmetic discrepancy (40 − 6 + 2 = 36 claimed vs. 40 − 1 + 2 = 41 actual) recorded
   here rather than resolved by inventing additional closures.
5. `ExportFinishShortfallCard`'s exact name verified in the tree
   (`src/components/recovery/ExportFinishShortfallCard.tsx`) before citing it — the task
   brief's shorthand "ExportFinishShortcard" is not the real identifier.
6. T6's declaration, Decision Log, and command log were placed in this new dated note
   under `docs/ws1-sync-pipeline/` rather than in `docs/archive/history/history.md`,
   because the task brief's AUTHORIZED scope names `docs/STATUS.md` in full, the WS2/WS3
   charter sections, the `saas-target-architecture.md` header refresh, and new notes under
   `docs/ws1-sync-pipeline/` — not `docs/archive/history/`.

## Command log (this pass, read-only/verification commands only — no destructive ops)

```
git log --oneline -1
git status --short
grep -n "R\.3\|R\.8\|R\.9\|E1\b\|E4\b\|E5\b" docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md
grep -n "R\.5" docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md
grep -n "R\.7" docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md
grep -n "W7\|R\.7" docs/ws1-sync-pipeline/verification-sweep-2026-09-18.md
grep -n -i "fa_dev.rs|cache-clear|16-entry|eviction|race" docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md
grep -rn "ExportFinishShort" src/
grep -rn "IdbToNativeMigrationView" src/
grep -rln "buildSourceTimelineHash|timelineIdentityFromProject|sourceTimelineHash" src/ src-tauri/ --include="*.ts" --include="*.tsx" --include="*.rs"
git rev-parse HEAD
npx vitest run scripts/ws1-single-tracker.test.ts
```

## SHAs referenced this pass

- Branch tip at start and end of docs-only work: `53449b9` (`ws1-plan-rewrite`)
- Mapping report: `docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md`
- Verification sweep: `docs/ws1-sync-pipeline/verification-sweep-2026-09-18.md`
- Flake wording source: `docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md`
- FA wiring audit: `ebec58a` (external worktree `4.kinetix-pro-studio-cloud-asr`, branch `ws-cloud-asr-plan`)
- SaaS target architecture recorded-at SHA: `e8ffb6b` (header refreshed, content SHA unchanged)
