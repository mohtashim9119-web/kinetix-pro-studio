/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Server-owned cloud jobs: the GPU run lives on the gateway. The app submits,
// then polls or reattaches. Reloading, crashing, quitting, sleeping, or
// dropping the network must not DELETE a running job. Pause questions live
// on the job so they survive a session; an answered job never re-asks.

export type CloudJobPause = {
  id: string;
  kind?: string | null;
  question: string;
  options: unknown[];
  answer?: string | null;
  projectId?: string | null;
  host?: string | null;
  audioHash?: string | null;
  stage?: string | null;
  timestamp?: number | null;
  detail?: string | null;
};

export type OwnedCloudJob = {
  jobId: string;
  stage: 'transcribe' | 'align' | string;
  status: string;
  projectId?: string | null;
  rowId?: string | null;
  taskId?: string | null;
  holdOpen?: boolean;
  pause?: CloudJobPause | null;
  awaitingAnswer?: boolean;
  workerSec?: number | null;
  cached?: boolean;
};

export function jobsForOwners(
  jobs: readonly OwnedCloudJob[],
  owners: { projectIds?: readonly string[]; rowIds?: readonly string[] },
): OwnedCloudJob[] {
  const projects = new Set(owners.projectIds ?? []);
  const rows = new Set(owners.rowIds ?? []);
  return jobs.filter(j =>
    (j.projectId && projects.has(j.projectId)) || (j.rowId && rows.has(j.rowId)),
  );
}

/** What a listing offers a reattach. 1.5.2: no job to POLL in place of the
 *  caller's own request (that adopted stale and never-run jobs); a relaunch
 *  re-submits and the gateway re-attaches an identical in-flight job. */
export function reattachPlan(jobs: readonly OwnedCloudJob[]): {
  holdJobId?: string;
  pause?: CloudJobPause;
  taskIds: string[];
} {
  const held = [...jobs].reverse().find(j => j.holdOpen && (j.status === 'queued' || j.status === 'running' || j.status === 'done'));
  const taskIds = [...new Set(jobs.map(j => j.taskId).filter((id): id is string => !!id))];
  return {
    holdJobId: held?.jobId,
    pause: pauseDialogFromJobs(jobs),
    taskIds,
  };
}

export function pauseDialogFromJob(job: OwnedCloudJob | null | undefined): CloudJobPause | undefined {
  if (!job?.pause || !job.awaitingAnswer || job.pause.answer != null) return undefined;
  return job.pause;
}

/** The pause to ask about: the newest open one — unless a LATER job for the
 *  same owner finished (1.5.2). A bulk row's Retry / auto-retry / Retry All
 *  re-runs fresh and never answers; its success is the answer, so an older
 *  pause is retired rather than resurfacing as a ghost dialog on reload. */
export function pauseDialogFromJobs(jobs: readonly OwnedCloudJob[]): CloudJobPause | undefined {
  for (const job of [...jobs].reverse()) {
    const pause = pauseDialogFromJob(job);
    if (pause) return pause;
    if (job.status === 'done') return undefined;
  }
  return undefined;
}

/** Unique GPU containers observed — a reattach of the same run stays at 1. */
export function bootCount(jobs: readonly OwnedCloudJob[]): number {
  return new Set(jobs.map(j => j.taskId).filter((id): id is string => !!id)).size;
}

export function billedWorkerSec(jobs: readonly OwnedCloudJob[]): number {
  return jobs.reduce((sum, j) => sum + (typeof j.workerSec === 'number' ? j.workerSec : 0), 0);
}

/** P11: idle GPU seconds after the job itself finished. Last item / released / handed-off = 0. */
export function postFinishHeldSec(job: {
  holdOpen?: boolean | null;
  released?: boolean;
  handedOff?: boolean;
  waitedSec?: number;
}): number {
  const windowSec = 8;
  if (!job.holdOpen || job.released || job.handedOff) return 0;
  return Math.min(Math.max(job.waitedSec ?? windowSec, 0), windowSec);
}
