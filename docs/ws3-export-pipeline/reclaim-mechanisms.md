# Two "Reclaim" mechanisms — which root each covers, which UI invokes which

WS3 Batch 2 (Ruling E, D5/U36). This app has TWO independent things that
free disk space, both historically labeled "Reclaim" in the UI, which is
what made D5/U36 look like one bug instead of two separate mechanisms with
separate targets. They are NOT merged — this doc exists so the next person
does not try to merge them.

## 1. Storage-root reclaim — "Free up cached data" (App Settings)

**UI surface:** `StorageSettingsSection.tsx`'s button in the App Settings
modal (Storage section). Labeled **"Free up cached data"** as of this
batch (previously "Reclaim {bytes}" — the same word the export-failure
modal's button uses, which was the actual D5/U36 confusion).

**Native command:** `storage_root_reclaim` (`storage_root.rs`).

**Scope — the configurable storage root**, i.e. whatever
`resolve_storage_root` currently points at (`assets/`, `projects/`,
`models/`, `project-mirror/`, `diagnostic-logs/` — all relocate with the
root as of Round 29's `MANAGED_RELOCATION_SUBTREES` unification, but are
never RECLAIMED/deleted by this button; `cache/` and
`project-store-backups/` — the only two reclaimable subtrees):

- `cache/` — cleared unconditionally (everything in it, always).
- `project-store-backups/` — only the AGED, ORPHANED subset:
  a backup subdirectory whose owning project id is no longer live AND
  whose newest file is older than `STALE_BACKUP_MIN_AGE_SECS` (30 days).
  A live project's backups, or a dead project's backups still inside the
  grace period, are never touched, regardless of button clicks.
- The legacy `project-mirror/` tree's own backups (a SEPARATE directory,
  outside the configurable storage root — see `project_mirror.rs`'s module
  doc comment) are also swept by the same call
  (`sweep_stale_project_backups` sweeps both trees), but `size_report`
  has no row for that tree, so its bytes are never advertised in the
  Settings UI even though they ARE freed. Pre-existing gap, not
  introduced this batch — flagged, not fixed here.

**Byte accounting (D5a/D5b/D5c, this batch):** the advertised
"reclaimable" figure for the backups row now comes from
`project_mirror::store_backups_stale_bytes` — a read-only dry run using the
IDENTICAL staleness predicate and the IDENTICAL `storage_root::dir_size`
byte-counter the real sweep (`sweep_stale_backup_dirs`) uses, so the two
numbers cannot drift onto separately-computed totals. Proven exactly equal
by `project_mirror.rs`'s
`stale_backup_bytes_dry_run_advertises_exactly_what_the_sweep_actually_frees`
test (a mixed fixture: two aged-and-orphaned backup dirs of different
sizes, one dead-but-within-grace-period dir, one live project's dir —
advertised bytes == actually-freed bytes, asserted with `assert_eq!`, not
approximately).

## 2. Export-session reclaim — "Reclaim {bytes}" (failure modal)

**UI surface:** `ExportFailureMessage.tsx`'s primary action for the
`disk_full` preflight variant (Ruling A, row 3 of the primary-slot ladder).
Stays labeled **"Reclaim {bytes}"** — unchanged this batch, per Ruling E.

**Native commands:** `ffmpeg_reclaimable_sessions` / `ffmpeg_reclaim_sessions`
(`ffmpeg.rs`), wired through `App.tsx`'s `handleExportSessionReclaim` ->
`TauriFfmpeg.reclaimableSessions()` / `.reclaimSessions()`.

**Scope — the export-session temp tree**, i.e. `kinetix-export-<uuid>`
directories directly under the OS temp root (`std::env::temp_dir()`),
never the configurable storage root at all. A session is reclaimable when
its `class !== 'live'` (not currently held by a claim) — abandoned/orphaned
export sessions from crashed or otherwise-uncollected runs, entirely
independent of the storage-root cache/backups concept above.

## 3. Stale-root cleanup — "Clean up all stale storage locations" (App Settings)

**UI surface:** `StorageSettingsSection.tsx`'s cleanup button, shown only
when at least one stale root is recorded — a THIRD mechanism, added
Round 29, deliberately not merged into mechanism 1 above despite living in
the same Settings section.

**Native command:** `storage_root_cleanup_all_stale_roots` (`storage_root.rs`).

**Scope — every location this app knows still holds a full or partial
copy of managed data that ISN'T the current root**: a completed
relocation's old location, and/or a failed/cancelled relocation's
abandoned target, accumulated across as many hops as the operator makes
(`stale_roots: Vec<String>` in `storage-root.json`, dedup, never
overwritten). One action clears every recorded location in one pass — per
an explicit operator decision ("just add up, one cleanup deletes
everything") — deleting every `MANAGED_RELOCATION_SUBTREES` entry found at
each stale path EXCEPT `diagnostic-logs/` (Windows-audit fix — that one
subtree can still hold the app's own actively-open log file; see
`docs/ws3-export-pipeline/architecture-ledger.md`'s Round 29 entry for
why). The whole `stale_roots` list clears unconditionally afterward, even
if an individual subtree's deletion failed, mirroring every other
best-effort cleanup in this module.

**Why it's separate from mechanism 1:** mechanism 1 reclaims bytes WITHOUT
changing what/where the current root is (cache churn, aged backups — an
ongoing maintenance action against the live root). This mechanism instead
cleans up the DEBRIS of past relocations — a different root entirely, not
touched by normal use, that only exists because relocation deliberately
stopped auto-deleting the old copy the instant a new one verified (an
earlier Round 29 fix, so a failed/interrupted relocation is recoverable
rather than silently losing data).

## Why they stay separate

Different roots (OS temp tree vs. the configurable storage root),
different native commands, different UI surfaces, different operator
intent (freeing crashed export leftovers vs. freeing general app cache/
backup bloat). Merging them would either make the Settings action start
deleting export session data it has no business touching, or make the
export-failure modal's Reclaim button start walking the storage root mid
disk-full-recovery — both are scope violations, not simplifications.

## Flag back to the owner

Both labels were reviewed as part of this batch's copy pass. "Free up
cached data" was chosen over reusing "Reclaim" a second time specifically
to end the two-mechanisms-one-word confusion this doc exists to document —
but it is a naming call, not a design one, and worth a second look:
"cached data" undersells that it also clears aged project backups, not
just `cache/`. An alternative like "Free up cache and old backups" would
be more precise but longer for a settings-panel button. Flagging rather
than re-litigating unilaterally, per Ruling E's instruction.
