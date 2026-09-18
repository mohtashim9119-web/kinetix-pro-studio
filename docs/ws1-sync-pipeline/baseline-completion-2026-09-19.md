# Baseline completion — 2026-09-19 (main worktree)

Status: **T1 (merge + fresh gates) and T3 (four-worktree wipe) COMPLETE.** This note
closes the baseline staged by
[`baseline-closeout-2026-09-19.md`](baseline-closeout-2026-09-19.md) (`c0f416a`). Executed
from the main worktree, which is what that note said the deferred steps required. Nothing
pushed, no PR, no CI dispatch. `ws1-plan-rewrite` remains the sync lane.

## T1 — Merge

- Pre-state verified: `main` at `4bd18ce`, clean tree; `ws1-plan-rewrite` tip `c0f416a`.
- `git merge --no-ff ws1-plan-rewrite` → **zero conflicts**.
- **Merge SHA: `05b011f813b892aeafb0b4013d1881e2bbad4266`** (parents `4bd18ce` `c0f416a`).
- `git diff --stat c0f416a HEAD` → empty (main's tree is byte-identical to the branch tip).
- Rollback tag: `pre-round28-main` is an *annotated* tag (tag object `4096d91`);
  `pre-round28-main^{commit}` → **`4d4922c`**, as expected. Untouched.
- Chain present in `main` (each checked with `git merge-base --is-ancestor <sha> HEAD`):
  `2e74209`, `e0e3653`, `5221c95`, `2b7d33a`, `549ce63`, `ce8bca1`, `53449b9`, `9d50d58`,
  `383569d`, `795a1dd`, `083f31a`, `8a38600`, `f5d6dcf`, `c0f416a` — all **YES**.

## Six gates, fresh from `main` at `05b011f`

Environment: `npm install` re-run first (reported "added 153 packages, and removed 151";
tree still clean afterward — lockfile unchanged). Node v22.22.2, cargo 1.95.0.

| # | Gate | Result (verbatim) | Expected | Match |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0, no output | pass | yes |
| 2 | `npm run lint` | exit 0, no output | pass | yes |
| 3 | `npm test` | `Test Files  254 passed \| 63 skipped (317)` / `Tests  3925 passed \| 78 skipped (4003)` / Duration 228.45s | 3925 / 78 / 0 | yes |
| 4 | `cargo test` | `running 443 tests` / `test result: ok. 437 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out; finished in 20.11s` | 437 / 0 | yes |
| 5 | `cargo test --features fa-inference` | `running 559 tests` / `test result: ok. 523 passed; 0 failed; 36 ignored; 0 measured; 0 filtered out; finished in 20.15s` | 523 / 0 | yes |
| 6 | `cargo build --release --features fa-inference` | `Finished \`release\` profile [optimized] target(s) in 47.00s`, exit 0, 0 warnings/errors | pass | yes |

No deviations. Full logs were captured to the session scratchpad (`gate3-npm-test.log`,
`gate4-cargo-test.log`, `gate5-cargo-test-fa.log`, `gate6-cargo-build-release-fa.log`);
the lines above are copied from them.

## T3 — Wipe

### Pre-wipe checklist (re-verified against `main` at `05b011f`)

For each of `round28` (`1560ac5`, `ws3-round28`), `round29` (`c4612db`,
`ws3-round29-defects`), `recovery-header-fix` (`96dddfe`, `fix/recovery-modal-header-state`),
`ws3-export-integration` (`45d5860`, `ws3-export-integration`):

- tracked-file modifications: **0**; untracked non-ignored files: **0**
- HEAD is an ancestor of `main`: **YES**; `git rev-list --count main..HEAD`: **0**
- ignored-but-present files (excluding `node_modules/`, `target/`, `dist/`, `.DS_Store`,
  `src-tauri/gen/`):
  - `.work-phase4/step-aa-c13-live-repro.json`, `.work-phase4/step-w-c11-live-repro.json` —
    test output regenerated on every `npm test` (writer:
    `scripts/phase4-step-aa-unlock-repro.test.ts:38` and the step-w counterpart; ignored via
    `.gitignore:55` `.work-phase4/*`). Compared against main's copies: **identical modulo
    `generatedAt`**. Regenerable.
  - `src-tauri/binaries/ffmpeg-*`, `whisper-*` — gitignored sidecars, present in main's own
    `src-tauri/binaries/`, regenerable per `src-tauri/binaries/README.md`.
  - `ws3-export-integration` only: `.work-phase4/replay/v6/transcript_tokens.json` (ignored
    there under the branch's older `.gitignore`) — sha256 **identical** to the copy now
    tracked in main.
- Replay fixtures tracked in main: `git ls-files .work-phase4/replay` → **97 files**
  (`549ce63` ancestor of main: YES).
- Stash patches tracked in main: `docs/archive/stash-patches/` README + 5 patches
  (`f5d6dcf` ancestor of main: YES).
- Stash stack: 7 entries before and after. Untouched.

Nothing unique, nothing non-regenerable.

### Wipe log

```
git worktree remove /Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-round28                  exit=0  dir-exists=no
git worktree remove /Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-round29                  exit=0  dir-exists=no
git worktree remove /Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-recovery-header-fix      exit=0  dir-exists=no
git worktree remove /Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-ws3-export-integration   exit=0  dir-exists=no
git worktree prune -v                                                                                          (nothing to prune)
```

No `--force`; no raw recursive delete. Branch refs `ws3-round28`, `ws3-round29-defects`,
`fix/recovery-modal-header-state`, `ws3-export-integration` still exist — the wipe removed
working directories only, not history.

### Final worktree list

```
/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio                  05b011f [main]
/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-baseline-1560ac5 1560ac5 (detached HEAD)
/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-cloud-asr        eb1c4fa [ws-cloud-asr-plan]
/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-ws1-plan-rewrite c0f416a [ws1-plan-rewrite]
```

Expected survivors `main`, `ws1-plan-rewrite`, `ws-cloud-asr` all present; `baseline-1560ac5`
is the "non-slated other" — not in the brief's wipe set, left alone.

## Cap confirmation

`grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md` on main at `05b011f`
→ **40**. At cap (40/40), unchanged by this pass.

## Decision Log

1. **"Audited delete helper" resolved to `git worktree remove` (no `--force`).** The only
   thing in this repo called the audited delete helper is the in-app Rust
   `safe_delete::delete_app_staging_dir` (`src-tauri/src/safe_delete.rs`), bounded by
   canonical-path containment and a required prefix to app-created staging dirs; it has no
   CLI, no bin target, and would refuse a git worktree path by design. No `scripts/` or
   `.claude/` wrapper exists (grepped `audited.delete|delete.helper` across `.md .sh .py .ts
   .rs .json .toml`; sole hit is the architecture doc pointing at `storage_root.rs`).
   Conservative default: git's own audited removal path, which refuses a worktree with
   modifications or untracked files unless forced — the same class of guard, applied to the
   right object. Every removal was preceded by the explicit per-worktree checks above so the
   guard had nothing to catch.
2. `pre-round28-main` resolving to `4096d91` on plain `git rev-parse` was root-caused
   (annotated tag object) rather than flagged as a mismatch; `^{commit}` gives `4d4922c`.
3. `e0e3653` verified via `merge-base --is-ancestor` as the closeout note asked; not re-flagged.
4. `npm install` was run before the gates because the brief authorizes environment setup and
   the expected numbers must come from a fresh, correctly-installed tree; `git status` was
   re-checked afterward (clean) so the install could not have silently altered a tracked file.
5. Ignored per-worktree `step-*-live-repro.json` files were diffed modulo `generatedAt`
   against main's copies before the wipe rather than assumed regenerable from their name.
6. `baseline-1560ac5` (detached, not in the brief's wipe set) left in place — the brief names
   four worktrees; widening the wipe is not this pass's call.

## Command log

```
git status --short; git rev-parse --short HEAD; git rev-parse --short ws1-plan-rewrite; git worktree list; git stash list
git show ws1-plan-rewrite:docs/ws1-sync-pipeline/baseline-closeout-2026-09-19.md
grep -rn -iE 'audited.delete|delete.helper|audited_delete' --include='*.md' --include='*.sh' --include='*.py' --include='*.ts' --include='*.rs' --include='*.json' --include='*.toml' .
git merge --no-ff ws1-plan-rewrite -m "..."
git rev-parse HEAD; git log -1 --format=%p
git merge-base --is-ancestor <sha> HEAD        # for each chain SHA
git diff --stat c0f416a HEAD
git cat-file -t pre-round28-main; git rev-parse --short 'pre-round28-main^{commit}'
npm install --no-audit --no-fund
npx tsc --noEmit
npm run lint
npm test
(cd src-tauri && cargo test)
(cd src-tauri && cargo test --features fa-inference)
(cd src-tauri && cargo build --release --features fa-inference)
git -C <wt> status --porcelain --untracked-files=no | wc -l           # per slated worktree
git -C <wt> status --porcelain --untracked-files=all | grep '^??'
git -C <wt> status --porcelain --ignored --untracked-files=all | grep '^!!'
git merge-base --is-ancestor $(git -C <wt> rev-parse HEAD) main; git rev-list --count main..<wt-HEAD>
shasum -a 256 .../step-aa-c13-live-repro.json .../step-w-c11-live-repro.json   # all worktrees
python3 <json diff modulo generatedAt>
git ls-files .work-phase4/replay | wc -l; git ls-files docs/archive/stash-patches
git worktree remove <path>       # x4, no --force
git worktree prune -v; git worktree list; git branch --list ...; git stash list
grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md
npx vitest run scripts/ws1-single-tracker.test.ts
```

## SHAs

- Merge commit: `05b011f813b892aeafb0b4013d1881e2bbad4266`
- Pre-merge main: `4bd18ce`; merged branch tip: `c0f416a`
- Rollback tag: `pre-round28-main` → `4d4922c` (commit), `4096d91` (tag object)
- This note's commit: recorded in `git log` — see the commit whose subject starts
  `docs(ws1): baseline completion`
