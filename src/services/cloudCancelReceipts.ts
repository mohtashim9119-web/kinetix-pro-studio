/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U5 — cancel honesty (plan-v3 Wave 3 item 5, operator U5 ruling).
//
// What a cancel cost is the gateway's answer, not a guess: every cloud job a
// cancel stops comes back with a receipt (did it start, how many seconds the
// meter charged). The copy below turns those receipts into the one line the
// Sync Log shows.
//
//   - cancelled before submit      → nothing reached the cloud: no charge.
//   - cancelled while queued       → this job is $0. The ruling on the
//     container-level finding: a GPU that Modal was already starting for it
//     may still bill its start-up, and the copy says so instead of claiming
//     "free" for the whole cloud.
//   - cancelled mid-run            → the seconds already worked are billed,
//     and the line gives them.
//   - the cancel never landed      → said plainly: the job may finish and bill.
// ---------------------------------------------------------------------------

export interface CloudCancelReceipt {
  stage: 'transcribe' | 'align';
  jobId: string;
  confirmed: boolean;
  started: boolean;
  workerSec: number;
  estimatedUsd: number;
  at: number;
}

const receipts: CloudCancelReceipt[] = [];
const MAX_KEPT = 50;
const stopping = new Set<Promise<unknown>>();

export function recordCancelReceipt(receipt: CloudCancelReceipt): void {
  receipts.push(receipt);
  if (receipts.length > MAX_KEPT) receipts.splice(0, receipts.length - MAX_KEPT);
}

/** A cloud run whose signal was aborted: it settles once the gateway has
 *  answered the cancel (Rust awaits the DELETE before it returns). */
export function trackStoppingRun(run: Promise<unknown>): void {
  const settled = run.then(() => undefined, () => undefined);
  stopping.add(settled);
  void settled.then(() => { stopping.delete(settled); });
}

/** Grace for the receipt event, which rides a channel separate from the
 *  command's own reply. */
const RECEIPT_GRACE_MS = 150;
export const SETTLE_TIMEOUT_MS = 8000;

/** Resolves when every run being stopped has its answer, or at the timeout
 *  (an unanswered cancel then reads as unconfirmed, never as free). */
export async function settleCloudCancels(timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
  if (stopping.size > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...stopping]),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }
  await new Promise<void>(resolve => setTimeout(resolve, RECEIPT_GRACE_MS));
}

export function hasStoppingCloudRuns(): boolean {
  return stopping.size > 0;
}

/** Removes and returns the receipts recorded at or after `since`. */
export function takeCancelReceiptsSince(since: number): CloudCancelReceipt[] {
  const mine = receipts.filter(r => r.at >= since);
  const rest = receipts.filter(r => r.at < since);
  receipts.splice(0, receipts.length, ...rest);
  return mine;
}

/** Test-only. */
export function __resetCancelReceiptsForTests(): void {
  receipts.splice(0, receipts.length);
  stopping.clear();
}

/** Operator-swappable copy. */
export const CLOUD_CANCEL_COPY = {
  stopping: 'Stopping the cloud job…',
  nothingRan: 'Nothing had started on the cloud, so there is no charge.',
  queuedFree:
    'It was still waiting for a cloud GPU, so this job costs nothing. A GPU that was already starting up for it may still bill its start-up (about $0.01 or less).',
  unconfirmed:
    'The app couldn\'t reach the cloud to confirm the stop. The job may finish and be billed.',
  timelineUnchanged: 'Your timeline is unchanged.',
  stageName: { transcribe: 'transcription', align: 'alignment' } as const,
} as const;

function usd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/**
 * The honest line for a cancelled run. `cloud` says whether this run was on
 * the cloud at all (a local run's cancel has nothing to report). `heldReleased`
 * is true when a GPU held for this sync was let go.
 */
export function describeCloudCancel(
  runReceipts: readonly CloudCancelReceipt[],
  options: { cloud: boolean; heldReleased?: boolean },
): string {
  const parts: string[] = [];
  if (options.cloud) {
    const unconfirmed = runReceipts.filter(r => !r.confirmed);
    const started = runReceipts.filter(r => r.confirmed && r.started);
    const queued = runReceipts.filter(r => r.confirmed && !r.started);
    for (const r of started) {
      parts.push(
        `The cloud had already worked ${r.workerSec.toFixed(1)} s on ${CLOUD_CANCEL_COPY.stageName[r.stage]}. That completed work is billed (about ${usd(r.estimatedUsd)}).`,
      );
    }
    if (queued.length > 0) parts.push(CLOUD_CANCEL_COPY.queuedFree);
    if (unconfirmed.length > 0) parts.push(CLOUD_CANCEL_COPY.unconfirmed);
    if (runReceipts.length === 0) {
      parts.push(
        options.heldReleased
          ? 'The GPU held for this sync was released. Only the few seconds it waited are billed.'
          : CLOUD_CANCEL_COPY.nothingRan,
      );
    }
  }
  parts.push(CLOUD_CANCEL_COPY.timelineUnchanged);
  return parts.join(' ');
}
