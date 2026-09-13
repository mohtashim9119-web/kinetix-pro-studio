# WS3 size estimators — UI constraint

CC owns which module survives. This note records the UI-side constraint so
the recovery / relocation views do not grow a fourth copy of "required vs
available bytes."

## The three estimators

1. **Badge estimator** — `src/services/exportOutputEstimate.ts` on
   `ws3-export-modal` (`f81674e`). Not present at `b80ba40`. Live file-size
   badge in the unified export modal. Formula: `bitrateKbps × 125 × duration`
   + AAC (`EXPORT_DISK_AAC_BYTES_PER_SECOND`) then `applyHeadroom` from
   `diskFull.ts`. Destination gate uses `destinationRequiredBytes`.

2. **CC destination module** — `src/services/webcodecsExport/exportDestinationDiskEstimate.ts`
   at `b80ba40`. Same bitrate-aware destination formula as (1). Tests only;
   nothing in the live export pipeline imports it. CC has called this dead.
   Do not delete it from this branch.

3. **Live session preflight** — `src/services/webcodecsExport/diskFull.ts`
   `estimateExportDiskBytes`, wired from `exportPipelineWebCodecs.ts`. Models
   peak bytes in the *session temp tree* at the frozen 8 Mbps GL rate, plus a
   destination term at that same fixed rate. This is the estimator export
   actually runs.

## Constraint for the relocation / recovery modal

- There must be **one** source of truth for the numbers fed into
  `StorageRootRelocationView` (`requiredBytes` / `availableBytes`). The view
  itself computes nothing.
- After CC consolidates, the host that fills those props **must import the
  surviving estimator** — not a new helper and not a copy of the badge
  formula.
- `diskFull.ts` has to remain for the live pipeline (temp-peak + ENOSPC).
  The bitrate-aware destination term (badge + `exportDestinationDiskEstimate`)
  should collapse into whatever single API CC keeps. The modal then imports
  that API's required-bytes result.
- Do not implement the consolidation here.

Dashboard `navigator.storage.estimate()` (origin quota bar) is a different
question and is not this estimator.
