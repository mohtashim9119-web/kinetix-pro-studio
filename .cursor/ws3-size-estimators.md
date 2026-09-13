# WS3 size estimators — UI constraint

Item G landed on `ws3-export-integration` (`76cac7e`): `exportDestinationDiskEstimate.ts`
is deleted. The surviving destination API is
`estimateExportDestinationDiskBytes` in `src/services/webcodecsExport/diskFull.ts`.

## The two estimators

1. **Badge estimator** — `src/services/exportOutputEstimate.ts` on this branch.
   Imports `estimateExportDestinationDiskBytes` from `diskFull.ts`. Live file-size
   badge + relocation required-bytes host. Selector snap / fps / resolution stay
   here; byte arithmetic does not.

2. **Live session preflight** — `src/services/webcodecsExport/diskFull.ts`
   `estimateExportDiskBytes`, wired from `exportPipelineWebCodecs.ts`. Models
   peak bytes in the *session temp tree* at the frozen 8 Mbps GL rate, plus a
   destination term at that same fixed rate. This is the estimator export
   actually runs.

Current-storage usage for relocation (`managedBytes`, size report) is
`storageRoot.ts` (`getStorageRootStatus` / `getSizeReport`) — do not conflate
with the destination-file estimate.

## Constraint for the relocation / recovery modal

- There must be **one** source of truth for the numbers fed into
  `StorageRootRelocationView` (`requiredBytes` / `availableBytes`). The view
  itself computes nothing.
- The host that fills those props imports `estimateExportOutputBytes` (badge)
  or `estimateExportDestinationDiskBytes` (raw destination term) — not a
  third helper and not a copy of the formula.
