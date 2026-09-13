# UNSEEN — export-failure message layer

The Prompt-37 register (`U1`–`U24`) lives on `ws3-export-modal`
(`.cursor/prompt-37-rebase-plan.md` at `c0c0c26`). It is not on this
branch. New rows for this slice start at **U25**.

| ID | Assumption | How to resolve |
|---|---|---|
| U25 | `ExportErrorKind` may gain or be renamed by item F | `EXPORT_FAILURE_COPY` is a **total record** (`satisfies` + `[K in ExportErrorKind]`). Adding/renaming a kind without a matching copy row is a `tsc` error. Verified still total after rebase onto `64d2c5f` (same 11 kinds). Do not invent names. |
| U26 | Resume is never keyed on `kind` | Gate is `retentionAttempted` + `source: 'retainForResume'` + `disposition: 'retained'` + `manifestPresent`. `retainForResume` and `destroySession` both emit `"destroyed"` — do not read that string alone. |
| U27 | `cancelled` and `asset_missing` never resume | Policy exceptions. `asset_missing` routes to `DegradedProjectRecoveryScreen` via `onOpenDegradedRecovery` and never offers Save. |
| U28 | disk_full is two cards | Preflight (bytes + reclaim, no Resume) vs mid-export (Resume only under U26). Numbers are props. |
| U29 | Raw errors stay in Technical details | Primary body is dictionary copy only. Tests feed stack/panic/`rawError` and assert they are absent from `[data-testid="export-failure-primary"]`. |

Wiring into `App.tsx` / `useExport` is rebase work — **UNSEEN** which parent
CC wants. This slice does not mount the cards.
