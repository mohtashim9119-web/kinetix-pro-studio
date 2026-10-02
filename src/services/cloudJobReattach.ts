/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { answerCloudJob, listCloudJobs, pauseCloudJob } from './cloudGateway';
import { liveCloudJobId } from './cloudSyncEngine';
import { pauseDialogFromJobs, type CloudJobPause, type OwnedCloudJob } from './cloudJobOwnership';
import { saveFaPause, clearFaPause, type FaPauseRecord } from './faSyncPauseStore';
import { deletedProjectIds } from './projectTombstones';

function asPauseRecord(projectId: string, pause: CloudJobPause): FaPauseRecord {
  return {
    projectId: pause.projectId || projectId,
    syncRunId: pause.id,
    reason: (pause.kind as FaPauseRecord['reason']) || 'inference-failed',
    detail: pause.detail ?? pause.question,
    timestamp: typeof pause.timestamp === 'number' ? pause.timestamp : Date.now(),
    host: pause.host === 'local' ? 'local' : 'cloud',
    audioHash: pause.audioHash ?? undefined,
    stage: pause.stage === 'transcribe' ? 'transcribe' : undefined,
  };
}

function asOwned(jobs: Awaited<ReturnType<typeof listCloudJobs>>): OwnedCloudJob[] {
  return jobs;
}

export async function loadServerPause(projectId: string): Promise<FaPauseRecord | null | undefined> {
  if (deletedProjectIds().has(projectId)) return null;
  try {
    const jobs = asOwned(await listCloudJobs({ projectId, rowId: projectId }));
    const pause = pauseDialogFromJobs(jobs);
    if (pause) {
      const record = asPauseRecord(projectId, pause);
      saveFaPause(record);
      return record;
    }
    if (jobs.some(j => j.pause?.answer != null || (j.status === 'done' && j.pause))) {
      clearFaPause(projectId);
      return null;
    }
    if (jobs.length > 0) {
      return null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function loadServerPauses(projectIds: readonly string[]): Promise<FaPauseRecord[]> {
  const dead = deletedProjectIds();
  const out: FaPauseRecord[] = [];
  for (const id of projectIds) {
    if (dead.has(id)) continue;
    const record = await loadServerPause(id);
    if (record) out.push(record);
  }
  return out;
}

export async function postLivePause(record: FaPauseRecord): Promise<void> {
  const jobId = liveCloudJobId();
  if (!jobId) return;
  try {
    await pauseCloudJob(jobId, {
      id: record.syncRunId,
      kind: record.reason,
      question: record.detail ?? record.reason,
      options: ['retry', 'local', 'whisper', 'cancel'],
      projectId: record.projectId,
      host: record.host ?? 'cloud',
      audioHash: record.audioHash,
      stage: record.stage,
      timestamp: record.timestamp,
      detail: record.detail,
    });
  } catch { /* local record still holds */ }
}

export async function answerServerPause(projectId: string, choice: string): Promise<void> {
  try {
    const jobs = asOwned(await listCloudJobs({ projectId, rowId: projectId }));
    const job = [...jobs].reverse().find(j => j.awaitingAnswer && j.pause && j.pause.answer == null);
    if (job?.pause) await answerCloudJob(job.jobId, job.pause.id, choice);
  } catch {
    /* local clear still happens */
  }
}
