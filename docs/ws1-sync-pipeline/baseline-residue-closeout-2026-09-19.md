# Baseline residue closeout — 2026-09-19

Dated, read-only-for-code, docs-only closeout note. Not a live tracker. Follows
`final-consolidation-2026-09-19.md`'s T8(5): disposes the 12 unmerged local branch refs that pass
left for a future one, and lands the canonical frozen-assets doc `verification-sweep-2026-09-18.md`
§W6(b) proposed but couldn't fill in (fixtures were absent from that machine).

## R1 — 12 unmerged refs disposed

Each: commits ahead of `main` (three-dot from merge-base), files touched, class. Patch = full diff
from merge-base, exported to `docs/archive/branch-patches/<ref>.patch` (slash in a ref name flattened
to `-` in the filename), verified `git apply --check`/`git am` clean against a fresh checkout of its
own merge-base before any ref was deleted.

| Ref | Ahead | Files touched | Summary | Class |
|---|---|---|---|---|
| `final-crash-audit` | 1 | 7 (`exportPipelineWebCodecs.ts`, `exportResumeDiscovery.{ts,test.ts}`, `boundedRerenderWiring.test.ts`, +3) | F1-F3 export-losing-hole fixes to `TauriFfmpeg.destroy`'s `force`/`failureKind` contract | **SUPERSEDED** |
| `phase-7-sync-audit` | 1 | 1 (`docs/phase-7-sync-audit.md`) | Read-only June-2026 audit of the pre-rewrite sync pipeline (missing-asset reflow bug, timing allocation) | **SUPERSEDED** |
| `ws3-docs-baseline` | 1 | 5 (`docs/ws3-export/{README.md,architecture-ledger.md}`, `docs/archive/history/history.md`, +2) | Round-log headers / link fixes / baseline note against the pre-restructure `docs/ws3-export/` tree | **SUPERSEDED** |
| `ws3-persistence-audit` | 1 | 1 (`docs/ws3-export/persistence-layer-audit.md`) | Independent read-only audit: no `navigator.storage.persist()` call site existed at `b80ba40` | **SUPERSEDED** |
| `ws3-win-perf-audit` | 1 | 2 (`webgl2Diagnosis.{ts,test.ts}`) | WebGL2 export-failure diagnosis module | **SUPERSEDED** |
| `model-p-editor-work` | 2 | 17 (`timelinePartition.ts`, `projectFingerprint.{ts,test.ts}`, `snapBoundaries.ts`, `exportPipeline.ts`, +12) | Explicit park commit ("uncommitted... at revert time... Not a reviewed commit") of an editor working tree reverted 2026-08-07 | **ABANDONED** |
| `session-docs-2a` | 1 | 3 (`CLAUDE.md`, `docs/history-2.md`, `docs/work-in-progress.md`) | WS2-46 teardown-flush doc + perishable test/cargo baseline counts, pre-dates the docs restructure paths | **ABANDONED** |
| `wip/preserve-2026-08-07` | 1 | 40 (`docs/context-report-2026-08-07.md`, 39 audio clips under `step-x-clips/`) | Forensic snapshot of a detached-HEAD tree 134 commits behind `main` at the time | **ABANDONED** |
| `preserve/indexeddb-project-store` | 1 | 14 (`projectDataStore.ts`, `projectStore.ts`, `projectStoreGuard.test.ts`, `usePersistProject.ts`, +10) | Unreviewed fix for a real reported bug: `localStorage.setItem` `QuotaExceededError` on autosave past ~915,000 chars | **UNIQUE-WORK** |
| `ws2-44-zip-blob-leak` | 1 | 3 (`zipAssetMerge.{ts,test.ts}`, `App.tsx`) | Fixes a deduplicated zip import leaking its already-persisted IndexedDB asset row | **UNIQUE-WORK** |
| `ws3-120fps-preview` | 17 | 17 (`videoDecoderPool.{ts,test.ts}`, `previewDiagnostics.{ts,test.ts}`, `previewBufferBudget.{ts,test.ts}`, `PreviewDiagnosticsPanel.tsx`, +9) | Time/byte preview-buffer budget replacing an fps-blind frame cap; 4K feed-horizon fix | **UNIQUE-WORK** |
| `ws3-recovery-ui` | 5 | 38 (`relinkResolution/*`, `recovery/*`, `exportFailure/*`, `exportOutputEstimate.{ts,test.ts}`, +30) | Re-link/recovery UI; almost entirely landed in `main` under the same paths already except `exportOutputEstimate.{ts,test.ts}` (absent from `main`) | **UNIQUE-WORK** |

**Evidence for each class**, beyond the summary column:

- **SUPERSEDED** — `webgl2Diagnosis.{ts,test.ts}` and every `relinkResolution/matchProposals.ts`
  /`relinkStateMachine.ts` file diff byte-identical to `main`'s current tip; `ws3-docs-baseline`'s
  `architecture-ledger.md` cites `main`@`4d4922c` as its rollback anchor while `main`'s live copy
  cites Round 28/29 at `42988f1` — a strictly later, actively-maintained replacement; `phase-7-sync-audit`
  predates the full WS1 sync-pipeline-v2 rewrite this file (`sync-pipeline-v2-plan.md`) documents;
  `ws3-persistence-audit`'s headline finding ("no `persist()` call site") is now false — `main` has
  `src/services/storagePersistence.ts` calling `navigator.storage.persist()`; `final-crash-audit`'s
  `exportResumeDiscovery.ts` diff shows `main`'s `TauriFfmpeg.destroy` signature evolved strictly
  past the branch's fix (added `force`/`failureKind`, a TTL-collection policy the branch predates).
- **ABANDONED** — `model-p-editor-work`'s own commit message says it is an unreviewed park of a
  reverted tree, and `main` independently carries its own, later, reviewed `timelinePartition.ts`
  (CLAUDE.md's standing "Model P gapless partition" invariant); `session-docs-2a`'s WS2-46 content
  has zero hits anywhere in current docs and only records now-stale perishable gate counts;
  `wip/preserve-2026-08-07`'s audio clips (`step-x-clips/*`) are already byte-present in `main`'s
  tracked `.work-phase4/step-x-clips/`, and its forensic report is a snapshot of a tree state
  hopelessly behind current `main`.
- **UNIQUE-WORK** — `main`'s `extractZipToAssets`/zip-dedup path (`src/App.tsx`) still only calls
  `URL.revokeObjectURL` on a dropped duplicate, never `deleteAsset`/`deleteAssetNative` — the
  IndexedDB row `ws2-44-zip-blob-leak` fixes is still leaked today; `main`'s `projectStore.ts`
  still calls `localStorage.setItem` with the full serialized project body (line ~358), so the
  quota bug `preserve/indexeddb-project-store` targets is not visibly closed by a different
  mechanism; `ws3-120fps-preview`'s `previewDiagnostics.ts`, `previewBufferBudget.ts`, and
  `PreviewDiagnosticsPanel.tsx` have no counterpart anywhere in `main`; `ws3-recovery-ui`'s
  `exportOutputEstimate.ts` (120 lines) + its test are likewise absent from `main` even though the
  rest of that branch's `relinkResolution`/`recovery` work already landed.

**Action taken.** Patches for all 12 exported first (R1 above), each verified apply-clean against
its own merge-base in a throwaway `git worktree`. The 8 SUPERSEDED/ABANDONED refs then deleted
(`git branch -D`, since none is an ancestor of `main` — `-d`'s safety guard would have refused). The
4 UNIQUE-WORK refs kept, for operator decision on whether/how to port their content into `main`:
`preserve/indexeddb-project-store`, `ws2-44-zip-blob-leak`, `ws3-120fps-preview`, `ws3-recovery-ui`.

Local refs left untouched by this pass (out of the 12-ref scope): the 4 branches
`final-consolidation-2026-09-19.md` T8(5) already found merged into `main`
(`ws3-docs-restructure`, `ws3-relink-menu-entry`, `ws3-round27`, `ws3-storage-unified`) — no
authorization here to delete those.

## R2/R3 — Frozen fixture digests, landed at their canonical home

The four SHA-256 digests and the eight frozen byte constants are now recorded in
`sync-pipeline-v2-plan.md` Part AL, per `verification-sweep-2026-09-18.md` §W6(b)'s proposal
(append-only Part, same file already carrying Part M and the design-of-record). Not duplicated
here — see that Part for the full table, the `6.m4a` committed-identity cross-check, and the
`hour_16k.wav` GitHub-100MB exclusion note.

## R4 — Regen proof

Ran `cloud/prepare_fixtures.sh`'s `hour_16k.wav` derivation (16 kHz mono resample of the committed
`6.m4a` → `v6_16k.wav`, then 3× concat + `-t 3600` trim) from the tracked `6.m4a`, in an isolated
scratch directory — no tracked or gitignored file touched. Result: **115,200,078 bytes**, SHA-256
`cddd5a931379ac45bad551595033dfcbb04893e4a6101eb9a9c26b800b9ef53b` — identical on both counts to
the disk-preserved `cloud/fixtures/hour_16k.wav`. **Verdict: the exclusion is provably lossless.**
No STOP condition hit.

## Command log (representative)

```
git for-each-ref refs/heads
git rev-list --count main..<ref>; git diff --stat main...<ref>
git diff main:<file> <ref>:<file>   # per touched file, vs main's current tip
git format-patch --stdout <merge-base>..<ref> > docs/archive/branch-patches/<ref>.patch
git diff --binary <merge-base> model-p-editor-work > docs/archive/branch-patches/model-p-editor-work.patch  # merge commit — plain diff instead of format-patch
git worktree add --detach <scratch> <merge-base>; git am --quiet <patch>   # apply-clean check, per ref
git branch -D final-crash-audit phase-7-sync-audit ws3-docs-baseline ws3-persistence-audit \
  ws3-win-perf-audit model-p-editor-work session-docs-2a wip/preserve-2026-08-07
shasum -a 256 cloud/fixtures/{v6_16k.wav,v6_16k_cbr16k.opus,hour_16k.wav,hour_16k_cbr16k.opus,6.m4a}
ffmpeg -y -i cloud/fixtures/6.m4a -ar 16000 -ac 1 <scratch>/v6_16k.wav
ffmpeg -y -f concat -safe 0 -i <scratch>/concat-v6.txt -t 3600 -ar 16000 -ac 1 <scratch>/hour_16k.wav
shasum -a 256 <scratch>/hour_16k.wav   # == cddd5a93…ef53b, == cloud/fixtures/hour_16k.wav
```
