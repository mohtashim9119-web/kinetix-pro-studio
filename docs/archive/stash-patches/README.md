# Stash preservation patches (2026-09-19, baseline closeout T2 + T5)

Exported from the shared stash stack (`git stash list`, same across all worktrees of this
repo) per the disposition table in
`docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md` (T5). The stash stack itself was
left untouched — these are read-only exports (`git stash show -p`), not drops or pops.
As of the baseline reconciliation pass (T5), all 7 stash entries are now mirrored here.

## What's here and why

The first five entries the disposition table marked **unique, unmerged** (content that
exists nowhere else — not superseded by later committed work, not contained in an
existing branch). All five are on the `webgl2-effects-engine` line of work, an
abandoned/unconfirmed experiment:

| File | Stash | Base commit | Subject |
|---|---|---|---|
| `webgl2-effects-engine-stash2-wip-before-8d83358.patch` | `stash@{2}` | `6eae48e8588dc662caefa67692c198d52f63d7e5` | "WIP before checking out 8d83358" |
| `webgl2-effects-engine-stash3-session-backup-before-hard-reset.patch` | `stash@{3}` | `de4c195593077b7c72d515e1672e0c6365134998` | "session-backup-before-hard-reset-20260717-195303" |
| `webgl2-effects-engine-stash4-playhead-isolation-option1.patch` | `stash@{4}` | `de4c195593077b7c72d515e1672e0c6365134998` | "backup-option1-playhead-isolation-…: tested, did not fix lag" |
| `webgl2-effects-engine-stash5-playhead-isolation-pre-revert.patch` | `stash@{5}` | `de4c195593077b7c72d515e1672e0c6365134998` | "backup-before-revert-…: playhead-isolation + sticky/tiled canvas attempts" |
| `webgl2-effects-engine-stash6-video-flicker-preroll-fix.patch` | `stash@{6}` | `65b84ee30909699242deacc68b61ee52ced4810e` | "video-video-flicker: pre-roll snapshot starvation fix (unconfirmed against real repro)" |

Each patch is `git stash show -p stash@{n}`'s full diff against its own base commit
(the stash's first parent — the tree state at the moment the stash was taken), not
against any other tree. **Verified to apply cleanly to its recorded base** before being
committed here: `git read-tree --index-output=<tmp> <base>` followed by
`GIT_INDEX_FILE=<tmp> git apply --check --cached <patch>`, run against a throwaway index
so the check touched neither this worktree's real index nor its working directory. All
five passed.

## Remaining two (exported 2026-09-19, T5)

These were left out of the first pass — one flagged "likely superseded", the other
"cannot determine without a fresh diff" — but were exported this pass for
completeness. Their disposition question is unchanged by exporting them: a patch on
disk is not a claim of uniqueness, just a mirror of stash content that would otherwise
vanish if the stack were ever dropped.

| File | Stash | Base commit | Subject |
|---|---|---|---|
| `stash0-detached-367a873-pre-ws3-export-integration.patch` | `stash@{0}` | `367a873372b6555bbba596e3e471a3d318bcfc72` | "backup: detached-367a873 working tree before switching to ws3-export-integration (2026-09-13)" |
| `stash1-ws3-export-liveness-cursor-cloud-agent.patch` | `stash@{1}` | `1b3c03f284cb989901fd2f85aa7eb1971b4fa7f7` | "Cursor: moved local changes to cloud agent (source agent 2f264114-f91b-4957-bbee-38f6f3282750)" |

- `stash@{0}` — disposition table: "Likely superseded" (later committed work on the same
  files exists in the `ws3-export-integration` worktree past this stash's parent). Not
  re-adjudicated here — still not confirmed superseded vs. unique, just no longer
  unmirrored.
- `stash@{1}` — disposition table: "Cannot determine without a fresh diff" (the named
  branch `ws3-export-liveness` doesn't exist to compare against). Same caveat.

Both verified to apply cleanly to their recorded base commit via the same throwaway-index
method as the first five (`git read-tree --index-output=<tmp> <base>` +
`GIT_INDEX_FILE=<tmp> git apply --check --cached <patch>`), touching neither this
worktree's real index nor its working directory.

## To apply one of these later

```
git apply docs/archive/stash-patches/<file>.patch
```
from a worktree whose tree matches (or is close enough to three-way-merge from) the
listed base commit.
