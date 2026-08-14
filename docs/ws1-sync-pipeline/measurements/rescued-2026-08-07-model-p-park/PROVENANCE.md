# Provenance — rescued from `wip/preserve-2026-08-07`

Every file under this folder (and the sibling `context-report-2026-08-07.md` — deleted
2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/context-report-2026-08-07.md`;
see `docs/work-in-progress.md` §12 row 18 for disposition)
was copied byte-for-byte, via `git show`/`git cat-file` (no checkout), from commit
`79f779523a35920320ce0f791415d9783e493197` on the orphaned, unmerged branch
`wip/preserve-2026-08-07`. That branch is not an ancestor of `main`; these files exist nowhere
else in reachable git history as of this rescue.

Copied 2026-08-11, in response to an evidence-hunt audit that found the branch at risk of
being pruned with no other copy of its data. Not edited, not regenerated, not re-scored —
a straight preservation copy. Original directory layout (`.answer-keys/`, `.listening-clips/`,
`.work-phase4/`) is preserved 1:1 under this folder for traceability back to the source commit.

Content summary (see the audit report for the full breakdown):
- `answer-keys/` — Step Q Spanish blinded-listening ground truth (10 clips: answer key + human transcripts).
- `listening-clips/spanish-batch/` — the 10 Spanish `.wav` clips those answer keys score.
- `work-phase4/replay/{173,spanish,v6}/` — Step-M golden-baseline snapshots (segments, silences,
  transcript tokens, audio) plus Task 5 boundary-audit reports for the three real corpus projects.
- `work-phase4/spanish-breath-ref.json`, `spanish-targets-all22.json` — the 22-pause Spanish
  breath-aware reference the Spanish gate scoring cites directly (see `docs/work-in-progress.md`
  §6, "Spanish language gate"; original source `spanish-gate-scoring.md` deleted 2026-08-14,
  `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/spanish-gate-scoring.md`).
- `work-phase4/step-aa-c13-live-repro.json`, `step-w-c11-live-repro.json` — live repro evidence
  for the K14 (filename-labeled C13) and K13 (C11) lock bugs, against real corpus data.
- `work-phase4/step-x-clips/` — five named audio evidence clips (C02–C10) for specific structural-check findings.

None of this is read by any script (unlike `scripts/fixtures/`) — it is research-phase
measurement/evidence data, placed here per `docs/ws1-sync-pipeline/measurements/README.md`'s
existing convention for that category.
