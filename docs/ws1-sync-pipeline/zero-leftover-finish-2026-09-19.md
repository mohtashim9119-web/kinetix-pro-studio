# Zero-leftover finish — 2026-09-19

Closes the CC TASK "Zero-leftover finish: merge unique work, refs, warning, signed plan."
Executed from the main worktree. Merge never rebase; no history rewrites.

## T1 — Unique-work refs, verified one at a time

| Ref | Verdict | Why |
|---|---|---|
| `ws2-44-zip-blob-leak` | **MERGED** (`673a3b0`) | Single focused commit; clean merge (0 conflicts); diff matched the branch's own described scope exactly (`src/App.tsx`, `src/services/zipAssetMerge.ts`, its test); branch's own commit message reports gates green (tsc/lint clean, vitest 2966/0/77 skipped, gaplessInvariant 36/36, golden replay 6/6, K13 3/3) and documents its own test-removal probes. Post-merge gates re-run fresh and green (see T6 below). |
| `preserve/indexeddb-project-store` | **PARKED** | Its own commit message states "NOT rebased onto current main. NOT reviewed. NOT merged" and requires relocating a `docs/history.md` hunk to `docs/history-2.md` before any merge — explicit WIP per the task's own T1d rule. Ref kept, untouched. |
| `ws3-120fps-preview` | **PARKED** | Its own tip commit ("record field refutation and Windows diagnostic decision tree") documents that the branch's core buffer-budget-hypothesis fix was refuted in the field, with diagnostics pending Windows data — not complete work. Also conflicts with `main` on 4 files (`src/App.tsx`, `src/components/AppSettingsModal.tsx`, `docs/archive/history/history-2.md`, `docs/archive/history/work-in-progress.md`). Ref kept, untouched. |
| `ws3-recovery-ui` | **PARKED — STOP-AND-REPORT** | `main` already has its own `src/components/recovery/` implementation, wired into `src/App.tsx` and `src/hooks/useStorageRootRelocation.ts`, independently of this branch (branches diverged at `5a96f92`, before this content existed on either side in its current form). Dry-run merge produces 18 add/add conflicts. This is unexpected merge content — duplicate/superseded work, not unique work — per the task's own STOP-AND-REPORT clause. Ref kept, untouched; no attempt made to resolve the conflicts, since doing so would mean picking a winner between two independently-evolved implementations without operator input. |

## T2 — STATUS.md sync

No update made. `docs/STATUS.md` has no existing open item naming this zip-import blob
leak (`extractZipToAssets`/`zipAssetMerge`) — grepped for `ws2-44`, `zipAssetMerge`, and
`leak`, zero hits. The bug was discovered and fixed within the same branch, never tracked
as a STATUS.md line, so there is nothing to close. Cap arithmetic unchanged: STATUS.md's
line count is untouched by this pass.

## T3 — Refs

Deleted (via `git branch -d`, each verified `git merge-base --is-ancestor <sha> main` ==
YES before deletion — the `-d` guard would have refused any that weren't):

- `ws3-docs-restructure` (`34e04d1`) — known-merged per task brief
- `ws3-relink-menu-entry` (`0f95e5e`) — known-merged per task brief
- `ws3-round27` (`831c872`) — known-merged per task brief
- `ws3-storage-unified` (`0bdc8a5`) — known-merged per task brief
- `ws2-44-zip-blob-leak` (`a2e2b26`) — merged this pass (T1)

Local remotes on `origin` for these five names are left untouched — this pass only
deletes local refs and pushes `main`; it does not delete or force-push remote branches.

`git branch` now shows `main` plus exactly the 3 parked refs
(`preserve/indexeddb-project-store`, `ws3-120fps-preview`, `ws3-recovery-ui`), each
explained above and left for the operator.

## T4 — Zero-warning push (72MB patch)

`git lfs version` → command not found; not installed on this machine, and no new tooling
was installed to get it (would be a system change outside this pass's scope). Fell back to
gzip per the task's own instruction.

`docs/archive/branch-patches/wip-preserve-2026-08-07.patch` (75,973,751 bytes, a
`git format-patch` file whose payload is `GIT binary patch` blocks — already zlib+base85
internally) only compressed to 61,145,796 bytes under `gzip -9`, still over GitHub's 50MB
recommendation. Split that gzip into two parts, both under 50MB
(`wip-preserve-2026-08-07.patch.gz.part-aa` at 31,457,280 bytes,
`wip-preserve-2026-08-07.patch.gz.part-ab` at 29,688,516 bytes), with a README documenting
reassembly (`cat part-* | gunzip`) and the pre-removal SHA-256
(`942b79b4b530e06bca635607c9e3c386d1f201db66ace47fcf9b6c4ec534cd09`) verified byte-identical
against the reassembled output before the plaintext blob was removed from the tip. Commit:
`3d0f396`. This does not rewrite history — the original plaintext blob remains reachable via
`bb7b0f8`/`a0120f7`, which are already on `origin/main`.

## T5 — Signed plan

`docs/ws1-sync-pipeline/sync-pipeline-plan-v3.md` committed (`22bdfec`), header
"Operator-signed 2026-09-19; supersedes sync-pipeline-v2-plan (archived e0e3653)", assembled
from `docs/ws1-sync-pipeline/operator-product-rulings-2026-09-19.md` (rulings, from `9d50d58`,
superseding NR-6) and `docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md` §M2/§M7
(wave breakdown). `sync-pipeline-v2-plan.md` got a SUPERSEDED banner pointing to v3, stating
Part AL (frozen-assets registry) remains canonical in place per operator directive. Both
files, plus this closeout note, allowlisted in `scripts/ws1-single-tracker.test.ts`
(verified passing).

## T6 — Final verification

Six gates, fresh from `main` at `22bdfec` (pre-push):

| # | Gate | Result | Match |
|---|---|---|---|
| 1 | `tsc --noEmit` | exit 0, no output | pass |
| 2 | `npm run lint` | exit 0, no output | pass |
| 3 | `npm test` | `Test Files 255 passed \| 63 skipped (318)` / `Tests 3931 passed \| 78 skipped (4009)` | pass |
| 4 | `cargo test` | `437 passed; 0 failed; 6 ignored` | matches recorded baseline exactly |
| 5 | `cargo test --features fa-inference` | `523 passed; 0 failed; 36 ignored` | matches recorded baseline exactly |
| 6 | `cargo build --release --features fa-inference` | `Finished` release profile, 0 warnings/errors | pass |

`git status` → clean (+0 −0). `git branch` → `main` + 3 parked (listed above, T3).
`git worktree list` → main root only.

## Decision Log

1. `ws3-recovery-ui` treated as STOP-AND-REPORT rather than attempting a conflict resolution
   — the task explicitly lists "unexpected merge content" as a stop condition, and choosing
   between two independently-evolved recovery-UI implementations is a product/architecture
   call, not a merge-mechanics one.
2. `ws3-120fps-preview` parked on its own evidence (the branch's last commit documents its
   fix hypothesis was refuted), not merely on the merge conflicts — the conflicts are a
   secondary signal, not the primary reason.
3. No STATUS.md edit made for T2, rather than inventing a line to then "close" — mirrors the
   NR-6/`9d50d58` precedent of recording a gap rather than fabricating a closure.
4. gzip-split chosen over installing `git-lfs` — avoids an unrequested system/tooling change
   mid-task; the split achieves the same zero-new-warning outcome without it.
5. Remote branches for the 5 now-locally-deleted refs left untouched on `origin` — the task's
   T3 names local ref cleanup (`git branch shows main + parked-only`) and T6 names pushing
   `main`; neither asks for `git push origin --delete` on the merged branches, which is a
   separate, more visible action against shared state.

## Command log (this pass — merges, deletes, and the final push; verification commands
omitted, shown inline above)

```
git merge --no-commit --no-ff preserve/indexeddb-project-store   # dry-run, aborted
git merge --no-commit --no-ff ws3-recovery-ui                    # dry-run, aborted
git merge --no-commit --no-ff ws2-44-zip-blob-leak                # dry-run, clean
git merge --no-commit --no-ff ws3-120fps-preview                  # dry-run, aborted
git merge --no-ff ws2-44-zip-blob-leak -m "..."                   # 673a3b0
git rm --cached docs/archive/branch-patches/wip-preserve-2026-08-07.patch
git commit  # 3d0f396 (T4)
git commit  # 22bdfec (T5)
git branch -d ws3-docs-restructure ws3-relink-menu-entry ws3-round27 ws3-storage-unified ws2-44-zip-blob-leak
git commit  # this note (T6)
git push origin main
```
