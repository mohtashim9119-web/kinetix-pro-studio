# Baseline reconciliation — 2026-09-19

Follow-on pass after `baseline-completion-2026-09-19.md`: drive-vs-git audit, the
deferred cloud-ASR merge, the `1560ac5` worktree disposition, branch-ref tidy, and
closing the stash-mirror gap. Run from the main worktree. Merge-never-rebase,
no push/PR/CI, guarded removals only, evidence at every step.

## T1 — Drive vs git

`git worktree list` before this pass: `main`, `baseline-1560ac5`, `cloud-asr`,
`ws1-plan-rewrite` — matches expected.

Parent dir (`ls /Users/mohtashim/Drive/Vibe Coding Projects/`) held one folder git
didn't know about: **`4.kinetix-pro-studio-relink-menu`**. Inspected:
- Not a git repository (`git status` → `fatal: not a git repository`).
- Contents: a single `.vite/` cache subdirectory, 8.0K total.
- Not registered in `git worktree list`; no unique content vs. any branch.
- **Not removed this pass** (T1 is report-only). Recommend deleting the directory
  directly (not a worktree, so no `git worktree remove`) in a future pass, or leaving
  it — it's inert.

Slated-for-removal folders (`round28`, `round29`, `recovery-header-fix`,
`ws3-export-integration`) were **not present on disk** — confirmed already removed,
consistent with the prior baseline-completion pass. No re-appeared folder found; no
correction needed to prior removal evidence.

## T2 — `ws-cloud-asr-plan` → main

On the branch (`4.kinetix-pro-studio-cloud-asr` worktree): `cloud/results/` was
**gitignored** (`.gitignore:62`), not merely untracked — `git status` showed a clean
tree with `cloud/results/` listed under "Ignored files". Measured: 7.4M, 37 files.
≤200MB → force-added (`git add -f`) and committed:

- **`d5ee757`** — `data(cloud): commit irreplaceable Modal cloud/results measurements (7.4M, 37 files)`

Merged `ws-cloud-asr-plan` into `main`: **zero conflicts**. The branch's full diff
against `main` looked large (176 files, src-tauri touched, heavy deletions) because
most of that branch's other work had already landed on `main` via earlier baseline
merges — the actual merge commit only brought in the new `cloud/results/` files
(37 files, insertions only, no `src-tauri/` paths touched).

- **Merge SHA: `4c1bce7`** — `Merge branch 'ws-cloud-asr-plan' into main`

No `src-tauri/` changes in the merge itself → ran the three-gate case (not all six):
- `npm run lint` (tsc --noEmit): **clean**.
- `npm test`: **254 files passed, 63 skipped (317); 3925 tests passed, 78 skipped (4003). 0 failures.**

## T3 — `baseline-1560ac5`

`git merge-base --is-ancestor 1560ac5 main` → **is an ancestor**. Checked the worktree
for untracked/ignored content before removal:
- `.work-phase4/step-aa-c13-live-repro.json`, `.work-phase4/step-w-c11-live-repro.json`
  — gitignored (`.gitignore:48`), regenerated scratch output; diffed against `main`'s
  copies at the same path — identical except `generatedAt` timestamp. Not unique.
- `.work-phase4/session-ws2-49-legacy-v1/findings.md` — gitignored, byte-identical to
  `main`'s copy.
- `node_modules/` — gitignored, trivially regenerable.

No unique content found. Removed via guarded removal:

```
git worktree remove "/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-baseline-1560ac5"
```

No `--force` needed; succeeded cleanly. Folder confirmed gone from disk.

## T4 — Branch-ref tidy

`git merge-base --is-ancestor <branch> main` confirmed for all four before deletion:

| Ref | Ancestor of main? | Action |
|---|---|---|
| `ws3-round28` | yes | `git branch -d ws3-round28` — deleted (was `1560ac5`) |
| `ws3-round29-defects` | yes | `git branch -d ws3-round29-defects` — deleted (was `c4612db`) |
| `fix/recovery-modal-header-state` | yes | `git branch -d fix/recovery-modal-header-state` — deleted (was `96dddfe`) |
| `ws3-export-integration` | yes | `git branch -d ws3-export-integration` — deleted (was `45d5860`) |

`ws1-plan-rewrite` and `ws-cloud-asr-plan` kept (active lanes, still checked out in
their own worktrees).

## T5 — Stash completeness

The 5 entries mirrored by `f5d6dcf` (stash@{2}..stash@{6}, all `webgl2-effects-engine`)
were left untouched. Exported the remaining two — previously flagged "likely
superseded" (stash@{0}) and "cannot determine without a fresh diff" (stash@{1}) — as
patches:

| File | Stash | Base commit |
|---|---|---|
| `stash0-detached-367a873-pre-ws3-export-integration.patch` | `stash@{0}` | `367a873372b6555bbba596e3e471a3d318bcfc72` |
| `stash1-ws3-export-liveness-cursor-cloud-agent.patch` | `stash@{1}` | `1b3c03f284cb989901fd2f85aa7eb1971b4fa7f7` |

Both verified to apply cleanly to their recorded base commit via a throwaway index
(`git read-tree --index-output=<tmp> <base>` + `GIT_INDEX_FILE=<tmp> git apply --check
--cached <patch>`) — this worktree's real index and working directory untouched.
Exporting does not re-adjudicate the "superseded"/"undeterminable" labels; it just
closes the mirror gap. Stash stack itself untouched (no pop/drop) — **7 entries, now
fully mirrored** in `docs/archive/stash-patches/`.

- **`dcb8f43`** — `docs(archive): T5 — mirror the remaining two stash entries as patches`

## Final state

Worktrees (`git worktree list`):
```
main                    dcb8f43
cloud-asr               d5ee757  [ws-cloud-asr-plan]
ws1-plan-rewrite        c0f416a  [ws1-plan-rewrite]
```

Parent-dir folders (`ls /Users/mohtashim/Drive/Vibe Coding Projects/ | grep kinetix`):
```
4.kinetix-pro-studio
4.kinetix-pro-studio-cloud-asr
4.kinetix-pro-studio-relink-menu   (stray, non-repo, inert — see T1)
4.kinetix-pro-studio-ws1-plan-rewrite
```

## Decision Log

1. **`cloud/results/` was gitignored, not untracked** — task said "if untracked,
   measure size"; treated gitignore-hidden the same as untracked for the size check
   since `git status` reported a clean tree either way. Measured 7.4M, committed with
   `-f`.
2. **Merge diff-stat vs. actual merge diff differ** — `git diff main ws-cloud-asr-plan`
   (full branch comparison) showed src-tauri changes and heavy deletions, but the
   actual merge (`git diff --cached` after `git merge --no-commit`) only added
   `cloud/results/`. Gate scope decided on the **merge's own diff**, not the branch's
   full history diff — ran three gates, not six.
3. **`.work-phase4/*.json` and `node_modules/` in the 1560ac5 worktree judged "no
   unique content"** — diffed byte-for-byte against main's copies (or judged trivially
   regenerable for `node_modules/`); proceeded with guarded removal rather than
   branching off first.
4. **`4.kinetix-pro-studio-relink-menu` reported, not removed** — out of scope for T1
   (report-only pass); it's not a worktree so `git worktree remove` doesn't apply to it
   anyway.

## Command log (representative)

```
git worktree list
git merge-base --is-ancestor 1560ac5 main
git add -f cloud/results/ && git commit -m "..."
git merge --no-commit --no-ff ws-cloud-asr-plan
git commit -m "Merge branch 'ws-cloud-asr-plan' into main"
npm run lint && npm test
git worktree remove ".../4.kinetix-pro-studio-baseline-1560ac5"
git branch -d ws3-round28 ws3-round29-defects fix/recovery-modal-header-state ws3-export-integration
git stash show -p stash@{0} > stash0....patch
git stash show -p stash@{1} > stash1....patch
git read-tree --index-output=<tmp> <base> && GIT_INDEX_FILE=<tmp> git apply --check --cached <patch>
git commit -m "docs(archive): T5 — mirror the remaining two stash entries as patches"
```

## Commit SHA

This note's own commit SHA is recorded in the commit that adds it (see repo log for
`docs(ws1): baseline reconciliation — T1 drive audit, T2 cloud merge, T3 1560ac5
removal, T4 ref tidy, T5 stash mirror complete`).
