# Final consolidation — 2026-09-19

Dated, read-only, docs-only closeout note. Not a live tracker. Follows
`baseline-reconciliation-2026-09-19.md`; ends the multi-worktree era: one folder on the
drive, one checked-out branch, main pushed to origin. Run from the main worktree under
explicit operator authorization for: committing pending docs, preserving unmerged
worktree content, removing worktrees and extra app folders, deleting merged refs,
clearing the mirrored stash, and pushing `main` + tag `pre-round28-main`.

## T1 — Pending changes

`git status` on main: **clean**. The two files the task expected as modified
(`docs/archive/stash-patches/README.md`, `baseline-reconciliation-2026-09-19.md`) were
already committed by the previous pass — `dcb8f43` (README), `8c61ea3` + `cbbbfcb`
(note). No other modified or untracked files. Ignored content in main (`.env*`,
`.venv-phase4*`, `.work-phase4/` scratch, `.claude/`, `.listening-clips/`) left as-is —
none of it is new to this pass and none was gitignored blind here.

## T2 — Diff badge diagnosed

| | SHA |
|---|---|
| `origin/main` (before push) | `4bd18ce` |
| local `main` at start of pass | `cbbbfcb` |
| `git rev-list --count origin/main..main` | **24** ahead, 0 behind |

`git diff --shortstat origin/main main`: 160 files, **+1,164,880 / −16**. Breakdown by
top-level path:

| Path | Files | + | − | What |
|---|---|---|---|---|
| `.work-phase4/` | 97 | 769,184 | 0 | replay fixtures made tracked (`549ce63`) |
| `cloud/` | 37 | 372,729 | 0 | Modal measurements (`d5ee757`) |
| `docs/` | 23 | 22,895 | 14 | baseline notes, stash patches |
| `.gitignore` | 1 | 10 | 1 | |
| `scripts/` | 1 | 42 | 0 | single-tracker allowlist additions |
| `src-tauri/` | 1 | 20 | 1 | `binaries/README.md` only (`53449b9`, docs) |

Confirmed: the 1.16M badge is local-ahead-of-origin baseline work, not junk. No `src/`
changes; the lone `src-tauri/` line is a README. Resolved by the T7 push.

## T3 — Pre-removal sweep (no loss)

### a) Ancestry

| Worktree | Branch tip | `merge-base --is-ancestor <tip> main` |
|---|---|---|
| `4.kinetix-pro-studio-ws1-plan-rewrite` | `ws1-plan-rewrite` @ `c0f416a` | **yes** |
| `4.kinetix-pro-studio-cloud-asr` | `ws-cloud-asr-plan` @ `d5ee757` | **yes** |

### b) Untracked + ignored sweep

`git status --short --ignored` in each worktree; every `!!` line classified:

**ws1-plan-rewrite**

| Item | Class | Evidence |
|---|---|---|
| `.work-phase4/session-p/` (832K, 8 files) | not unique | `diff -rq` vs main's `session-p/`: every file present in main and identical; main has 17 more |
| `.work-phase4/step-aa-c13-live-repro.json`, `step-w-c11-live-repro.json` | regenerable | differ from main's copies only in `generatedAt` |
| `node_modules/`, `src-tauri/gen/`, `src-tauri/target/` | regenerable | build output |
| `src-tauri/binaries/ffmpeg-x86_64-apple-darwin` | duplicate | sha256 `3a0ea97a…f93a` == main's copy |
| `src-tauri/binaries/whisper-x86_64-apple-darwin` (2,903,728 B, built 2026-09-19) | regenerable build artifact, **disk-preserved anyway** | sha256 `59056974…0a13` ≠ main's Jun-4 build (`ea78a123…e701`). Copied to main as `src-tauri/binaries/whisper-x86_64-apple-darwin.ws1-plan-rewrite-20260919` (ignored by `.gitignore:15`, no git change). Binaries are gitignored by standing policy (`src-tauri/binaries/README.md`). |

**cloud-asr**

| Item | Class | Evidence |
|---|---|---|
| `.work-phase4/replay` | symlink → main's `.work-phase4/replay` | nothing to preserve |
| `cloud/__pycache__/` (96K) | regenerable | |
| `node_modules/`, `src-tauri/gen/`, `src-tauri/target/` | regenerable | |
| `src-tauri/binaries/ffmpeg-*`, `whisper-*` (17 B each) | junk | `#!/bin/sh\nexit 0` stubs |
| **`cloud/fixtures/`** (188 MB, 20 files) | **unique** — absent from main and from git | see below |

**`cloud/fixtures/` disposition.** Whole directory copied byte-for-byte into main's
`cloud/fixtures/` (ignored by `.gitignore:68`; `diff -rq` clean) — nothing is lost on
disk regardless of git. Then a preservation commit to main (precedents `549ce63`,
`d5ee757`):

- **`48bfcd9`** — `data(cloud): preserve cloud/fixtures audio + frozen V6 source 6.m4a
  before cloud-asr worktree removal` — 21 files, **109 MB**, force-added.
  - `6.m4a` — the frozen V6 corpus voiceover, 32,851,696 bytes, sha256
    `23c5eaba60b95dff774c84c100665240fc024b3f8c1415ac65b98dfac2978492`. Not in any
    worktree; sole copy was `~/Downloads/All Projects Test Data/V6 Natural Long Pause
    Segs/6.m4a`. Hash **matches** main's IndexedDB forensics blob
    `.work-phase4/forensics-20260819-033211/…/3714.blob` byte-for-byte. Now tracked.
  - `spanish_16k.wav`, `spanish_16k_cbr16k.opus` — undocumented derivation
    (`baseline-p0-p2-2026-09-19.md:174`), not regenerable → unique.
  - `v6_16k.wav`, `v6_16k_cbr16k.opus`, `hour_16k_cbr16k.opus`, `hour_chunks_{1,4,10}/`
    — the exact bytes the `cloud/results/` measurements ran against.
  - **Not committed: `hour_16k.wav`** (115,200,078 B). Exceeds GitHub's 100 MB per-file
    hard limit → committing it would guarantee a T7 push rejection. Regenerable via
    `cloud/prepare_fixtures.sh` from the `6.m4a` committed here; disk-preserved in
    main's ignored `cloud/fixtures/` (219 MB on disk total incl. `6.m4a`).

### c) Removal

```
git worktree remove ".../4.kinetix-pro-studio-ws1-plan-rewrite"   → removed
git worktree remove ".../4.kinetix-pro-studio-cloud-asr"          → removed
```
No `--force`. `git worktree list` → one entry (main).

## T4 — Drive cleanup

Parent dir `ls -la` after T3: `1.personal-site`, `2.facebook-automater`,
`3.youtube-scriptwriter`, `4.kinetix-pro-studio`, `4.kinetix-pro-studio-relink-menu`,
`5. YT Automation System`, `ClipCut`, `VibeDeck`, `.DS_Store`.

- `4.kinetix-pro-studio-relink-menu` — re-verified: not a repo (`fatal: not a git
  repository`), 8.0K, contents only `.vite/deps/{_metadata.json,package.json}`. Deleted
  (`rm -r`). Not a worktree, so `git worktree remove` did not apply.
- The other six folders are unrelated sibling projects, not kinetix app folders — out of
  scope, untouched.

End state: `ls -d *kinetix*` → **`4.kinetix-pro-studio` only**.

## T5 — Refs + stash

| Ref | Check | Action |
|---|---|---|
| `ws1-plan-rewrite` @ `c0f416a` | ancestor of main | `git branch -d` — deleted |
| `ws-cloud-asr-plan` @ `d5ee757` | ancestor of main | `git branch -d` **refused** ("not yet merged to `refs/remotes/origin/ws-cloud-asr-plan`" — local was 1 ahead of its own upstream, though merged to HEAD). `git branch --unset-upstream`, then `git branch -d` — deleted. Guard (merged-into-HEAD) still enforced; no `-D`. |
| tag `pre-round28-main` | `4096d91` (→ commit `4d4922c`), local == `git ls-remote --tags origin` | **kept** |

**Stash:** 7 entries; 7 patches in `docs/archive/stash-patches/` — `f5d6dcf`
(stash@{2}..{6}) + `dcb8f43` (stash@{0}, {1}), each verified apply-clean to its base
commit before commit. `git stash clear` → 0 entries. Lossless by mirror.

## T6 — This note

Added to `scripts/ws1-single-tracker.test.ts` ALLOWLIST in the same commit — together
with `baseline-reconciliation-2026-09-19.md`, which the previous pass created *after*
its `npm test` run and never allowlisted (the test was red on main from `8c61ea3`
until this commit). Single-tracker test re-run green after the edit.

## Final drive / git table

| Surface | State |
|---|---|
| Drive: kinetix app folders | `4.kinetix-pro-studio` (1) |
| `git worktree list` | `4.kinetix-pro-studio` `[main]` (1) |
| `git status` | clean |
| Checked-out branch | `main` |
| Tag | `pre-round28-main` @ `4096d91`, local == origin |
| Stash | empty (7/7 mirrored) |
| Other local branch refs | 16 remain — **not authorized this pass**, see T8(5) |

## Decision Log

1. **T1 expectation stale, not wrong** — the two "modified" files were already
   committed last pass; nothing to do. Logged rather than re-committed.
2. **`hour_16k.wav` excluded from the preservation commit** — 115 MB > GitHub's 100 MB
   per-file hard limit; committing it would have manufactured a T7 push rejection
   (a STOP condition). Regenerable by documented script from the committed `6.m4a`,
   and disk-preserved in main. Every other `cloud/fixtures/` byte is committed.
3. **`6.m4a` committed** — task named it a known candidate to preserve; it existed in no
   worktree and nowhere in git, only in `~/Downloads/`. 32 MB, push-safe. Hash
   cross-checked against the forensics IndexedDB blob.
4. **ws1's whisper sidecar build disk-preserved, not committed** — sidecars are
   gitignored by standing policy; copied under a suffixed, still-ignored name so
   nothing is lost and no policy is broken.
5. **`--unset-upstream` + `-d` instead of `-D`** — the refusal was the upstream-tracking
   heuristic, not a merge fact; `-d`'s merged-into-HEAD guard remained in force.
6. **16 other local branches left alone** — T5 authorized exactly two deletions.
   4 are merged (`ws3-docs-restructure`, `ws3-relink-menu-entry`, `ws3-round27`,
   `ws3-storage-unified`), 12 unmerged. Reported under T8(5) for a future pass.

## Command log (representative)

```
git status --short --ignored
git fetch origin; git rev-list --count origin/main..main; git diff --shortstat origin/main main
git merge-base --is-ancestor ws1-plan-rewrite main; git merge-base --is-ancestor ws-cloud-asr-plan main
diff -rq <w1>/.work-phase4/session-p <main>/.work-phase4/session-p
shasum -a 256 <sidecar binaries>; shasum -a 256 6.m4a <forensics blob>
cp -a <cloud-asr>/cloud/fixtures/. <main>/cloud/fixtures/; cp -a ~/Downloads/.../6.m4a <main>/cloud/fixtures/
find cloud/fixtures -type f ! -name hour_16k.wav -print0 | xargs -0 git add -f; git commit   → 48bfcd9
git worktree remove <ws1-plan-rewrite>; git worktree remove <cloud-asr>
rm -r 4.kinetix-pro-studio-relink-menu
git branch -d ws1-plan-rewrite; git branch --unset-upstream ws-cloud-asr-plan; git branch -d ws-cloud-asr-plan
git stash clear
npx vitest run scripts/ws1-single-tracker.test.ts
git push origin main; git push origin pre-round28-main
```

## T7 — Push

| | SHA |
|---|---|
| `origin/main` before | `4bd18ce` |
| `git push origin main` | `4bd18ce..6918f1e  main -> main` — accepted, no rejection |
| `origin/main` after | `6918f1e` == local `main` |
| `git push origin pre-round28-main` | "Everything up-to-date" — tag already on origin at `4096d91` |

This note's own commit (`6918f1e`) was the pushed tip; the T7/T8 addendum below is a
one-line follow-up commit pushed the same way so `origin/main == main` still holds.

## T8 — TRUE-CLEAN-BASELINE checklist

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | One app folder on drive | **PASS** | `ls -d *kinetix*` → 1 (`4.kinetix-pro-studio`) |
| 2 | `git worktree list` = one entry | **PASS** | `…/4.kinetix-pro-studio 6918f1e [main]` |
| 3 | `git status` clean, +0 −0 | **PASS** | 0 status lines; `git diff HEAD --shortstat` empty |
| 4 | `origin/main == main` | **PASS** | both `6918f1e` (re-fetched after push) |
| 5 | Only branch = main, tag intact | **PARTIAL** | tag `pre-round28-main` @ `4096d91`, local == origin ✓. Checked-out branch is `main` and the two active-lane refs are gone ✓. But **16 other local branch refs remain** — T5 authorized deleting exactly `ws1-plan-rewrite` and `ws-cloud-asr-plan`; deleting the rest was not authorized, so not done. Merged (safe `-d` candidates): `ws3-docs-restructure`, `ws3-relink-menu-entry`, `ws3-round27`, `ws3-storage-unified`. Unmerged (need review): `final-crash-audit`, `model-p-editor-work`, `phase-7-sync-audit`, `preserve/indexeddb-project-store`, `session-docs-2a`, `wip/preserve-2026-08-07`, `ws2-44-zip-blob-leak`, `ws3-120fps-preview`, `ws3-docs-baseline`, `ws3-persistence-audit`, `ws3-recovery-ui`, `ws3-win-perf-audit`. |
| 6 | Stash empty (mirrored) | **PASS** | `git stash list` → 0; 7 patches in `docs/archive/stash-patches/` (`f5d6dcf`, `dcb8f43`) |
| 7 | Cap 40/40 on record | **PASS** | `baseline-completion-2026-09-19.md:98` — "At cap (40/40), unchanged by this pass." Nothing here changes the count. |
| 8 | Nothing in T1–T6 touched `src/` or `src-tauri/` | **PASS** | `git diff --name-only cbbbfcb 6918f1e \| grep -E '^(src\|src-tauri)/'` → none. Files touched: `cloud/fixtures/**` (21), this note, `scripts/ws1-single-tracker.test.ts`. Standing fresh-green: `05b011f` (six gates) / `4c1bce7` (lint + npm test, 3925 passed). Single-tracker test re-run green after the allowlist edit; tsc clean. |
