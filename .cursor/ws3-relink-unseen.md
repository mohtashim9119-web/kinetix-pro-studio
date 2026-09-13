# UNSEEN — re-link resolution (item B landed)

CC item A (`64d2c5f`) poisons a project whose `project.json` metadata
survived but whose bytes are unresolvable. Re-link is the only exit.
Item B published `assetRecovery.ts` (`relinkAsset`, `ProjectAssetRecoveryStatus`)
and `nativeAssetStore.ts`. This slice stays pure matching + a state machine;
the host still owns the write.

| ID | Assumption | How to resolve |
|---|---|---|
| U30 | Unresolved-asset props are `{ id, name, type, duration }` from `Asset` | Mapped via `unresolvedMetadataFromAssets`. Extra Asset fields (`nativeFps`, `addedAt`) stay on the host. |
| U31 | Candidate files arrive as `{ id, name, type, duration, path }` | Duration/type are props — this module does not probe. |
| U32 | Item B command name / IPC args | Host wires `confirm`/`written` after `relinkAsset`. This module does not name a Tauri command. |
| U33 | Native copy existence | CC's one fact is `nativeResolved` (no separate `backupExists`). |
| U34 | Folder pick listing | This slice assumes the host already enumerated candidates. Directory walk is native. |
| U35 | Item F may add/rename `ExportErrorKind` | `EXPORT_FAILURE_COPY` remains a total record. Verified still the same 11 kinds after rebase onto `5a96f92`. |
