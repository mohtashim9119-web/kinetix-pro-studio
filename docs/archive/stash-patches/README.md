# Stash preservation patches (2026-09-19, baseline closeout T2)

Exported from the shared stash stack (`git stash list`, same across all worktrees of this
repo) per the disposition table in
`docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md` (T5). The stash stack itself was
left untouched — these are read-only exports (`git stash show -p`), not drops or pops.

## What's here and why

Only entries the disposition table marked **unique, unmerged** (content that exists
nowhere else — not superseded by later committed work, not contained in an existing
branch) were exported. All five are on the `webgl2-effects-engine` line of work, an
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

## Not exported

- `stash@{0}` — disposition table: "Likely superseded" (later committed work on the same
  files exists in the `ws3-export-integration` worktree past this stash's parent).
- `stash@{1}` — disposition table: "Cannot determine without a fresh diff" (the named
  branch `ws3-export-liveness` doesn't exist to compare against). Not confirmed
  unique/unmerged, so not exported this pass — flagged, not guessed.

## To apply one of these later

```
git apply docs/archive/stash-patches/<file>.patch
```
from a worktree whose tree matches (or is close enough to three-way-merge from) the
listed base commit.
