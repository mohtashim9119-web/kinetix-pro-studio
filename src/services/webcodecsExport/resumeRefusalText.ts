/**
 * What the operator is told when an export restarts instead of resuming. One
 * place, so the bulk row and the editor toast say the same true thing. Each
 * text carries the notice's REAL reason (`ResumeRefusalNotice.reason`); a
 * spent recovery budget's reason is already a full sentence with the count
 * ("Resume unavailable — 4 of 4 recovery attempts used without progress.
 * Starting fresh."), so it is shown as it is.
 */
import type { ResumeRefusalNotice } from './exportResumeSession';

/** A Retry that has nothing recorded to continue from. */
export const RESTART_NOTE = 'No checkpoint yet — restarting from the beginning';
/** A survivor existed but could not be used. */
export const COULD_NOT_RESUME_NOTE = "Couldn't resume the saved checkpoint — restarting from the beginning";
/** A Retry that was offered nothing and given no reason. */
export const NOTHING_FOUND_NOTE = "Couldn't find a usable checkpoint — restarting from the beginning";

export function bulkRowResumeNote(notice: ResumeRefusalNotice): string {
  if (notice.kind === 'budget_exhausted') return notice.reason;
  return `${notice.kind === 'no_checkpoint_yet' ? RESTART_NOTE : COULD_NOT_RESUME_NOTE} (${notice.reason})`;
}

export function editorResumeToast(notice: ResumeRefusalNotice): string {
  switch (notice.kind) {
    case 'budget_exhausted':
      return notice.reason;
    case 'bitstream_touched':
      return `A previous export session couldn't be resumed — its saved video was already partly cut (${notice.reason}). Starting fresh.`;
    case 'no_checkpoint_yet':
      return `No checkpoint yet — restarting from the beginning (${notice.reason}).`;
    default:
      return `A previous export session couldn't be resumed (${notice.reason}). Starting fresh.`;
  }
}
