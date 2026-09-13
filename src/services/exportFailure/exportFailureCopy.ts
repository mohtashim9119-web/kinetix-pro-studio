/**
 * Operator-facing copy for every `ExportErrorKind`.
 *
 * Total record: `tsc` fails if CC adds a kind without a row. Do not invent
 * kind names. The union may grow — see `.cursor/ws3-export-failure-unseen.md`.
 *
 * Shared copy is platform-neutral (no "Windows blocked") and does not
 * attribute GPU/hardware causes. Hardware wording is a separate optional
 * note, only when `hardwareFailoverUsed` or a supporting `failureVia` is set.
 */

import type { ExportErrorKind } from '../exportPipeline';

export interface ExportFailureKindCopy {
  title: string;
  body: string;
}

export type ExportFailureCopyMap = {
  [K in ExportErrorKind]: ExportFailureKindCopy;
} & {
  disk_full: ExportFailureKindCopy & {
    preflightTitle: string;
    preflightBody: string;
    midExportTitle: string;
    midExportBody: string;
  };
};

export const NEVER_RESUME_KINDS = ['cancelled', 'asset_missing'] as const;

type NeverResumeKind = (typeof NEVER_RESUME_KINDS)[number];
type _NeverResumeIsSubset = NeverResumeKind extends ExportErrorKind ? true : never;
const _neverResumeIsSubset: _NeverResumeIsSubset = true;
void _neverResumeIsSubset;

export const EXPORT_FAILURE_COPY = {
  cancelled: {
    title: 'Export cancelled',
    body: 'The export was cancelled. The destination file was not written.',
  },
  disk_full: {
    title: 'Not enough disk space',
    body: 'The volume ran out of space before the export could finish.',
    preflightTitle: 'Not enough space to start',
    preflightBody: 'There is not enough free space to start this export. Free space or reclaim unused export data, then try again.',
    midExportTitle: 'Disk filled during export',
    midExportBody: 'The volume ran out of space after encoding had already started.',
  },
  encode: {
    title: 'Encoding stopped',
    body: 'A video piece could not be finished. The destination file was not written.',
  },
  concat: {
    title: 'Pieces could not be joined',
    body: 'Encoded pieces were produced, but they could not be joined into one video.',
  },
  mux: {
    title: 'Could not finish the file',
    body: 'Video and audio could not be combined into the final file.',
  },
  unknown: {
    title: 'Export stopped unexpectedly',
    body: 'The export stopped before a finished file was written.',
  },
  destination_path: {
    title: 'Save path cannot be used',
    body: 'The chosen destination cannot be used for this export. Pick a different folder or file name.',
  },
  asset_missing: {
    title: 'Project media is missing',
    body: 'Media used by this project cannot be resolved. Open recovery to re-link the original files. Saving is blocked until every asset is resolved.',
  },
  timeline_gap: {
    title: 'Timeline is not gapless',
    body: 'Export refused to start because the timeline is not a gapless partition.',
  },
  ffmpeg_load: {
    title: 'Export engine unavailable',
    body: 'The export engine could not be loaded, so nothing was encoded.',
  },
  grade_loss_refused: {
    title: 'Export refused to drop grades',
    body: 'This export would drop visual grades the selected path cannot render, so it was refused before encoding started.',
  },
} as const satisfies ExportFailureCopyMap;

export const RESUME_UNAVAILABLE_COPY = {
  title: 'Nothing to resume',
  body: 'This export session could not be preserved. There is no checkpoint to continue from — start a new export after addressing the problem.',
} as const;

export const FINISH_SHORTFALL_COPY = {
  title: 'Export finished with missing frames',
  body: 'A file was written, but fewer frames were produced than this timeline required.',
} as const;

export const HARDWARE_FAILOVER_NOTE =
  'This export already switched away from hardware encoding after a previous failure on this run.';

export const GRAPHICS_CONTEXT_LOST_NOTE =
  'The graphics context was lost during this export.';

export function isNeverResumeKind(kind: ExportErrorKind): boolean {
  return (NEVER_RESUME_KINDS as readonly ExportErrorKind[]).includes(kind);
}
