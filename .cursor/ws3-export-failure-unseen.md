# UNSEEN — export-failure message layer

The Prompt-37 register (`U1`–`U24`) lives on `ws3-export-modal`
(`.cursor/prompt-37-rebase-plan.md` at `c0c0c26`). It is not on this
branch. New rows for this slice start at **U25**.

| ID | Assumption | How to resolve |
|---|---|---|
| U25 | `ExportErrorKind` may gain entries | `EXPORT_FAILURE_COPY` is a **total record** (`satisfies` + `[K in ExportErrorKind]`). A new kind is a `tsc` error until copy is added. Do not invent names; wait for CC's `satisfies`-checked policy record. |
| U26 | Resume is never keyed on `kind` | Gate is `retentionAttempted` + `source: 'retainForResume'` + `disposition: 'retained'` + `manifestPresent`. `retainForResume` and `destroySession` both emit `"destroyed"` — do not read that string alone. |
| U27 | `cancelled` and `asset_missing` never resume | Policy exceptions. `asset_missing` routes to `DegradedProjectRecoveryScreen` via `onOpenDegradedRecovery` and never offers Save. |
| U28 | disk_full is two cards | Preflight (bytes + reclaim, no Resume) vs mid-export (Resume only under U26). Numbers are props. |
| U29 | Raw errors stay in Technical details | Primary body is dictionary copy only. Tests feed stack/panic/`rawError` and assert they are absent from `[data-testid="export-failure-primary"]`. |
| U30 | Machine 1's twelve destroyed disk-full rows differ only in diagnostic identity, not resume evidence | The regression fixture preserves twelve rows with `disposition: destroyed`, `retainedBytes: 0`, and no manifest; every row must hide Resume. |
| U36 | Preflight disk-full reclaim uses export-session bytes, not storage-root reclaim | `ExportFailureMessage`'s Reclaim button calls `TauriFfmpeg.reclaimSessions` for abandoned export temp dirs; storage settings reclaim remains a separate native command. **Resolved below (Round 28 Q7) — decision recorded, not yet wired; unblocks a future D5 task.** |

U25–U30 closed @ `86dde13` (Round 27 Step 6 wired `ExportFailureMessage` into `App.tsx`; post-audit follow-up @ next tip wires preflight reclaim bytes + `hardwareFailoverUsed` on GL encode failures). `ExportFinishShortfallCard` and `StorageRootRelocationView` remain intentionally unwired in the export overlay — storage settings owns relocation UI.

## U36 resolution (Round 28 Q7) — `reclaimSessions` vs `storage_root_reclaim` ownership

Read in full, both sides:

- **`TauriFfmpeg.reclaimSessions(sessionIds)`** (`src/services/tauriFfmpeg.ts:334`) → Rust
  `ffmpeg_reclaim_sessions` (`src-tauri/src/ffmpeg.rs:454`). Operates on `kinetix-export-*`
  directories under the **OS temp tree** (see `ffmpeg_reclaimable_sessions`'s doc comment,
  `ffmpeg.rs:439-445` — "every `kinetix-export-*` directory under the temp tree"), classified
  `live`/`resumable`/`orphan`. This is per-export-session scratch space: encoded pieces,
  manifests, concat intermediates for sessions that are abandoned (crashed, cancelled without
  resume, or resumed elsewhere). It has never touched the app's storage root.

- **`storage_root_reclaim(app)`** (`src-tauri/src/storage_root.rs:504`) operates **inside the
  app's storage root** (`resolve_storage_root`). Per its own doc comment (`storage_root.rs:501-502`):
  clears only reclaimable subtrees — the storage root's `cache/` dir and stale project backups
  (`project_mirror::sweep_stale_project_backups`) — and explicitly **never** touches
  `assets/`, `projects/`, or `models/` inside that root.

**(a) Ownership.** The two mechanisms own disjoint filesystem trees by construction: `reclaimSessions`
owns OS-temp export-session scratch space; `storage_root_reclaim` owns the storage root's own
`cache/` + stale project-backup subtrees. Neither can reach into the other's territory today —
there is no overlap to arbitrate, only a naming/discoverability gap (both read as "free up space"
to a user with no visibility into which tree either touches).

**(b) Storage Settings "Reclaim" button.** Must call `storage_root_reclaim` — it is already
wired there (`StorageSettingsSection.tsx`'s `storage-reclaim` button, `invoke('storage_root_reclaim')`)
and is the correct target: that surface is about the storage root's own housekeeping (cache,
stale backups), which is exactly what `storage_root_reclaim` owns. No change needed.

**(c) Disk-full card's "free up space" action.** Must call `TauriFfmpeg.reclaimSessions` (via
`TauriFfmpeg.reclaimableSessions()` first, to list `orphan`/`resumable` candidates) — a disk-full
event during/before an export is almost always caused by abandoned export-session scratch space
in OS temp, not by the storage root's cache. This is already `ExportFailureMessage`'s existing
behavior per this row's original note; the decision here is that it should **stay** that way and
should **not** be redirected to `storage_root_reclaim`, which wouldn't free the bytes actually
implicated in an export-time disk-full event. (A future enhancement could additionally surface
`storage_root_reclaim`'s cache bytes as a secondary option on the same card, since a full disk
has no reason to prefer one tree over the other — but that is new scope, not part of this
decision.)

**(d) Unify or keep separate?** **Keep separate.** They classify and remove different things for
different reasons: `reclaimSessions` needs per-session `live`/`resumable`/`orphan` classification
tied to session claim state (a live process can hold a claim `storage_root_reclaim` has no concept
of — see `session_claim.rs`), while `storage_root_reclaim` is a flat "clear the known-safe
subtrees" sweep with no per-item classification. Merging them would force one function to
understand both a claim-lifecycle state machine and a storage-root layout it currently has zero
knowledge of, for no benefit — the UI surfaces that call them are already distinct (Storage
Settings vs. the export disk-full card) and should stay so. If a future workstream wants one
"free up space" entry point that reasons about both trees, it should be a thin **orchestrator**
that calls both existing functions and merges their reports — not a merge of the two
implementations themselves.

No wiring changes were made for this item — per scope, this is a decision + documentation update
only, to unblock a future D5 task.
