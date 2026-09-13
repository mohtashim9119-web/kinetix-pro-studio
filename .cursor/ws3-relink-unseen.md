# UNSEEN — re-link resolution (item B)

CC item A (`64d2c5f`) poisons a project whose `project.json` metadata
survived but whose bytes are unresolvable. Re-link is the only exit.
Item B will expose the real resolution payload and native command.
**Do not guess command names.** This slice is pure matching + a state
machine against caller-supplied descriptors.

| ID | Assumption | How to resolve |
|---|---|---|
| U30 | Unresolved-asset props are `{ id, name, type, duration }` from `Asset` in project.json | Item B's real row may add `nativeFps`, `addedAt`, mime, or a native-copy path. Map in the host; do not invent fields here. |
| U31 | Candidate files arrive as `{ id, name, type, duration, path }` | Whether the picker yields a path, a file descriptor, or a mime-probed blob is **unverified**. Duration/type are props — this module does not probe. |
| U32 | Item B command name / IPC args | Unknown. Do not name a Tauri command. Host wires `confirm`/`written` after the real write. |
| U33 | Native copy / backup existence | Recovery UI already treats these as booleans. Whether item B returns paths or only flags is unverified. |
| U34 | Folder pick listing | This slice assumes the host already enumerated candidates. Directory walk is item B's job. |
| U35 | Item F may add/rename `ExportErrorKind` | `EXPORT_FAILURE_COPY` remains a total record (`satisfies` + `[K in ExportErrorKind]`). A new/renamed kind is a `tsc` error until copy is added. See U25. |
