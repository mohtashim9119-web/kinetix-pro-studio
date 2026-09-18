# Baseline closeout — 2026-09-19

Status: **T0 and T2 complete. T1 (merge) and T3 (wipe) NOT executed by this pass** —
blocked by this session's own environment scope, not by any finding in the work itself.
Explained in full below so a session that *can* run them has everything it needs without
re-deriving context.

## Why T1/T3 were not executed here

This session runs inside `ws1-plan-rewrite` as an isolated git worktree; its own
environment instructions are explicit: run all commands from this directory, do not `cd`
to the original repository root. That's a hard scope boundary on this session, not a
judgment call available to override on a task's say-so.

- **T1 (merge into `main`)** needs to run *in the main worktree* — git will not let a
  second worktree check out or fast-forward a branch that's already checked out
  elsewhere, so there is no way to land this merge without being in that worktree.
- **T3 (wipe 4 worktrees)** deletes other worktrees' directories outright. The
  environment note for this session explicitly warns the stash stack (and by extension,
  those worktrees) may have other concurrent sessions active in them — deleting them from
  here, blind to whatever else might be running there, is exactly the kind of
  hard-to-reverse, shared-state action that needs to happen from a vantage point that can
  actually see and coordinate with that state, not from an isolated copy.

Both are staged so a session opened in the main worktree can execute them immediately —
see "Remaining work, staged" below.

## T0 — Signature + D23 closure (COMPLETE)

- **Acceptance block** added to
  [`baseline-clean-declaration-2026-09-19.md`](baseline-clean-declaration-2026-09-19.md):
  operator signature dated 2026-09-19, D23 ruling recorded verbatim, declaration itself
  marked accepted. Table and the `083f31a` superseded-arithmetic pointer left unchanged,
  per instruction.
- **D23 closed** in `docs/STATUS.md` (WS3 Open Bugs) — RETIRED AS MOOT, citing the
  consumer report (`383569d`) and the operator ruling verbatim. NR-5's stale "D23 remains
  open" line corrected. Banner updated.
- **Cap arithmetic:** 41 − 1 (D23) = **40, at cap** — verified by direct count
  (`grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md`) after the edit,
  not assumed.
- **Commit:** `8a38600`.

## T1 — Merge (NOT EXECUTED — staged for the main worktree)

Not run from this session; see "Why" above. For whoever runs it, in the main worktree:

```
git fetch . ws1-plan-rewrite   # or: already up to date if same object store
git checkout main
git merge --no-ff ws1-plan-rewrite
```

Expect zero conflicts (docs-only branch throughout). If any conflict appears: **stop,
abort (`git merge --abort`), record the conflict verbatim, report** — do not resolve
blind.

On success, verify:
- `git rev-parse pre-round28-main` still resolves to `4d4922c` (rollback tag untouched).
- The full lane chain is present in `main`'s history: `2e74209`, `e0e3653` (verified
  ancestor of `ws1-plan-rewrite`'s HEAD via `git merge-base --is-ancestor`, though not in
  the linear first-parent log), `5221c95`, `2b7d33a`, `549ce63`, `ce8bca1`, `53449b9`,
  `9d50d58`, `383569d`, `795a1dd`, `083f31a`, `8a38600`, `f5d6dcf` (T0 + T2 this pass).

Then run all six gates **fresh** from the main worktree (this is the first main-side
green claim — it must not be inherited from `ws1-plan-rewrite`'s runs):

```
npx tsc --noEmit
npm run lint
npm test
cargo test
cargo test --features fa-inference
cargo build --release --features fa-inference
```

Expected (per `53449b9`'s gate 6, re-run fresh, not assumed to still hold): `npm test` →
3925/78/0; `cargo test` → 437/0; `cargo test --features fa-inference` → 523/0. Any
deviation gets root-caused, not excused.

## T2 — Stash preservation (COMPLETE)

Five `webgl2-effects-engine` stash entries (`stash@{2}`..`stash@{6}`) marked
unique/unmerged in the P1b disposition table exported as patches under
[`docs/archive/stash-patches/`](../archive/stash-patches/README.md), each verified to
apply cleanly to its recorded base via a throwaway git index (no working-tree or
real-index mutation). `stash@{0}` (likely superseded) and `stash@{1}` (undeterminable —
its named branch doesn't exist) were left out, per the same table — not guessed.

**Stash stack itself: untouched.** `git stash list` still shows all 7 entries after this
pass (verified post-commit).

**Commit:** `f5d6dcf`.

## T3 — Wipe (NOT EXECUTED — pre-conditions not yet met)

Blocked on T1 succeeding (task's own ordering: "only after T1 and T2 both succeed"). T2
is done; T1 is not. When T1 has landed and gates are green from `main`, re-verify the
pre-wipe checklist against `53449b9`/`083f31a`/this pass before invoking the audited
delete helper on: `round28`, `round29`, `recovery-header-fix`, `ws3-export-integration`.
After: `git worktree list` should show exactly the surviving set (`main`,
`ws1-plan-rewrite`, `ws-cloud-asr`, plus any other non-slated worktree) — record it at
that time, from a session that can see the full worktree list (this session's `git
worktree list` output reflects the same shared repo state and could be checked from
here too, but the deletion itself cannot).

## Cap arithmetic, final state this pass

```
Post-P4b:                          41
T0: D23 closed                     -1
                                 ------
Current:                           40   (at cap, verified by direct count)
```

## Decision Log

1. T1 and T3 deferred rather than attempted from this worktree — the environment's own
   "do not cd to the repository root" instruction is a scope boundary on this session,
   not a preference to weigh against the task's "never ask questions." Treated as
   binding rather than negotiable.
2. T2 executed as planned — it required no `cd`, only shared-object-store reads
   (`git stash show`, `git log`) and writes into this worktree's own tracked files.
3. The task brief's expected merge-chain SHA `e0e3653` doesn't appear in `ws1-plan-rewrite`'s
   linear first-parent `git log` (it's on a side branch folded in by an earlier merge) —
   checked with `git merge-base --is-ancestor e0e3653 HEAD` before including it above,
   rather than assumed present or silently dropped.
4. `stash@{1}` left unexported — the P1b table itself couldn't determine uniqueness
   ("cannot determine without a fresh diff"); exporting it would have been guessing at
   what the brief's "any other unique-unmerged entry" meant, which the table doesn't
   support.

## Command log (this pass)

```
grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md
git stash list
grep -n "^| \`stash@" docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md
git log -1 --format="stash-commit=%H parent-base=%P" "stash@{N}"   # N = 2..6
git stash show -p "stash@{N}" > /tmp/stash_N.patch                 # N = 2..6
git read-tree --index-output=/tmp/idx_N <base>                      # N = 2..6
GIT_INDEX_FILE=/tmp/idx_N git apply --check --cached /tmp/stash_N.patch
git stash list   # post-commit, confirm still 7 entries
git status --short
```

## SHAs

- T0 commit: `8a38600`
- T2 commit: `f5d6dcf`
- Baseline signature source: `docs/ws1-sync-pipeline/baseline-clean-declaration-2026-09-19.md`
- Stash patches: `docs/archive/stash-patches/` (README lists each patch's stash index and base commit)
- Rollback tag (unverified from here — verify from main worktree): `pre-round28-main` → `4d4922c`
