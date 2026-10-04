/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  billedWorkerSec,
  bootCount,
  jobsForOwners,
  pauseDialogFromJob,
  pauseDialogFromJobs,
  postFinishHeldSec,
  reattachPlan,
  type OwnedCloudJob,
} from './cloudJobOwnership';

/** In-memory stand-in for the gateway jobs dict. Client death = dropping the poller. */
class FakeGateway {
  jobs = new Map<string, OwnedCloudJob>();
  kills = 0;
  spawns = 0;
  releases = 0;

  submit(partial: Omit<OwnedCloudJob, 'jobId' | 'status'> & { jobId?: string; status?: string }): OwnedCloudJob {
    const existing = [...this.jobs.values()].find(j =>
      j.projectId === partial.projectId && j.stage === partial.stage && (j.status === 'queued' || j.status === 'running'),
    );
    if (existing) return existing;
    this.spawns += 1;
    const job: OwnedCloudJob = {
      jobId: partial.jobId ?? `j${this.spawns}`,
      stage: partial.stage,
      status: partial.status ?? 'running',
      projectId: partial.projectId,
      rowId: partial.rowId,
      taskId: partial.taskId ?? `ta-${this.spawns}`,
      holdOpen: partial.holdOpen,
      pause: partial.pause,
      awaitingAnswer: partial.awaitingAnswer,
      workerSec: partial.workerSec ?? 0,
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  /** App crash: stop polling. Must not DELETE. */
  dropClient(): void { /* poller gone; jobs stay */ }

  kill(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.releases += 1;
    if (job.status === 'done') {
      this.jobs.set(jobId, { ...job, holdOpen: false });
      return;
    }
    if (job.status === 'cancelled') return;
    this.kills += 1;
    this.jobs.set(jobId, { ...job, status: 'cancelled', holdOpen: false });
  }

  finish(jobId: string, workerSec: number): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'cancelled') return;
    this.jobs.set(jobId, { ...job, status: 'done', workerSec, holdOpen: job.holdOpen ?? true });
  }

  list(owners: { projectIds?: string[]; rowIds?: string[] }): OwnedCloudJob[] {
    return jobsForOwners([...this.jobs.values()], owners);
  }
}

describe('server-owned cloud jobs', () => {
  it('killing the client mid-transcribe does not cancel the server job — it completes', () => {
    const gw = new FakeGateway();
    const job = gw.submit({ stage: 'transcribe', projectId: 'p1', rowId: 'p1' });
    gw.dropClient();
    expect(gw.jobs.get(job.jobId)?.status).toBe('running');
    expect(gw.kills).toBe(0);
    gw.finish(job.jobId, 6);
    expect(gw.jobs.get(job.jobId)?.status).toBe('done');
  });

  it('relaunch reattaches, resumes progress, and bills one boot', () => {
    const gw = new FakeGateway();
    const running = gw.submit({ stage: 'transcribe', projectId: 'p1', rowId: 'p1', taskId: 'ta-1' });
    gw.dropClient();
    const again = gw.submit({ stage: 'transcribe', projectId: 'p1', rowId: 'p1' });
    expect(again.jobId).toBe(running.jobId);
    expect(gw.spawns).toBe(1);
    gw.finish(running.jobId, 6);
    const listed = gw.list({ projectIds: ['p1'] });
    const plan = reattachPlan(listed);
    expect(plan.taskIds).toEqual(['ta-1']);
    expect(bootCount(listed)).toBe(1);
    expect(billedWorkerSec(listed)).toBe(6);
  });

  it('a pause question survives reload and is answerable afterwards', () => {
    const gw = new FakeGateway();
    const job = gw.submit({
      stage: 'transcribe', projectId: 'p1',
      pause: { id: 'pause-1', question: 'Script and audio do not match.', options: ['retry', 'cancel'] },
      awaitingAnswer: true,
      status: 'done',
    });
    gw.dropClient();
    const listed = gw.list({ projectIds: ['p1'] });
    const pause = pauseDialogFromJobs(listed);
    expect(pause?.id).toBe('pause-1');
    const answered: OwnedCloudJob = {
      ...job,
      pause: { ...job.pause!, answer: 'retry' },
      awaitingAnswer: false,
    };
    gw.jobs.set(job.jobId, answered);
    expect(pauseDialogFromJob(gw.jobs.get(job.jobId))).toBeUndefined();
  });

  it('an answered-then-succeeded job shows no dialog on open', () => {
    const job: OwnedCloudJob = {
      jobId: 'j1', stage: 'transcribe', status: 'done', projectId: 'p1', awaitingAnswer: false,
      pause: { id: 'pause-1', question: 'Offline.', options: ['retry'], answer: 'retry' },
      taskId: 'ta-1', workerSec: 4,
    };
    expect(pauseDialogFromJob(job)).toBeUndefined();
    expect(pauseDialogFromJobs([job])).toBeUndefined();
  });

  it('P9: killing the client mid-align does not cancel the server job — it completes; relaunch is one boot', () => {
    const gw = new FakeGateway();
    gw.submit({ stage: 'transcribe', projectId: 'p1', rowId: 'p1', taskId: 'ta-1', status: 'done', workerSec: 5 });
    const align = gw.submit({ stage: 'align', projectId: 'p1', rowId: 'p1', taskId: 'ta-1' });
    gw.dropClient();
    expect(gw.jobs.get(align.jobId)?.status).toBe('running');
    expect(gw.kills).toBe(0);
    // The relaunch re-submits; the gateway re-attaches the live job (1.5.2).
    const again = gw.submit({ stage: 'align', projectId: 'p1', rowId: 'p1' });
    expect(again.jobId).toBe(align.jobId);
    expect(gw.spawns).toBe(2);
    gw.finish(align.jobId, 3);
    expect(bootCount(gw.list({ projectIds: ['p1'] }))).toBe(1);
  });

  it('P10: operator kill mid-transcribe stops the server job; billed seconds do not grow after kill', () => {
    const gw = new FakeGateway();
    const job = gw.submit({ stage: 'transcribe', projectId: 'p1', rowId: 'p1', workerSec: 4 });
    gw.kill(job.jobId);
    expect(gw.jobs.get(job.jobId)?.status).toBe('cancelled');
    expect(gw.kills).toBe(1);
    const frozen = billedWorkerSec(gw.list({ projectIds: ['p1'] }));
    gw.finish(job.jobId, 99);
    expect(gw.jobs.get(job.jobId)?.status).toBe('cancelled');
    expect(billedWorkerSec(gw.list({ projectIds: ['p1'] }))).toBe(frozen);
  });

  it('P10: panic kill after a fresh client drop stops every running job for this user', () => {
    const gw = new FakeGateway();
    gw.submit({ stage: 'transcribe', projectId: 'a', rowId: 'a', taskId: 'ta-1' });
    gw.submit({ stage: 'align', projectId: 'b', rowId: 'b', taskId: 'ta-2' });
    gw.dropClient();
    const all = gw.list({ projectIds: ['a', 'b'] });
    expect(all.every(j => j.status === 'running')).toBe(true);
    for (const j of all) gw.kill(j.jobId);
    expect(gw.kills).toBe(2);
    expect([...gw.jobs.values()].every(j => j.status === 'cancelled')).toBe(true);
  });

  it('P11: a finished job bills zero post-finish hold; kill releases GPU and keeps the record', () => {
    const gw = new FakeGateway();
    const job = gw.submit({ stage: 'align', projectId: 'p1', rowId: 'p1', holdOpen: false });
    gw.finish(job.jobId, 3);
    const done = gw.jobs.get(job.jobId)!;
    expect(done.status).toBe('done');
    expect(postFinishHeldSec({ holdOpen: false, waitedSec: 30 })).toBe(0);
    expect(postFinishHeldSec({ holdOpen: true, released: true, waitedSec: 30 })).toBe(0);
    expect(postFinishHeldSec({ holdOpen: true, handedOff: true, waitedSec: 0.2 })).toBe(0);
    expect(postFinishHeldSec({ holdOpen: true, waitedSec: 30 })).toBe(8);
    expect(postFinishHeldSec({ holdOpen: true, handedOff: true, waitedSec: 8 })).toBe(0);
    expect(postFinishHeldSec({ holdOpen: true, waitedSec: 8 })).toBe(8);
    gw.kill(job.jobId);
    expect(gw.jobs.get(job.jobId)?.status).toBe('done');
    expect(gw.jobs.get(job.jobId)?.workerSec).toBe(3);
    expect(gw.jobs.get(job.jobId)?.holdOpen).toBe(false);
    expect(gw.releases).toBe(1);
    expect(gw.kills).toBe(0);
    const again = gw.submit({ stage: 'align', projectId: 'p1', rowId: 'p1' });
    expect(again.jobId).not.toBe(job.jobId);
    expect(gw.spawns).toBe(2);
  });
});

// 1.5.2 — a pause is retired by a LATER success on the same owner, not only by
// an explicit answer: a bulk row's Retry / auto-retry / Retry All re-run fresh
// and never answer. Captured live from v19 (2026-10-04): pause posted on the
// row's job, then the row's fresh run succeeded — the gateway still lists the
// old pause as awaiting an answer.
describe('1.5.2 a later success retires an older pause', () => {
  const LIVE_LIST_AFTER_SUCCESS = [
    { jobId: '3a2bc59a42b74a6caf78c20810d4191a', stage: 'transcribe', status: 'done', cached: true, projectId: 'p152-pause-1791103111', rowId: 'p152-pause-1791103111', awaitingAnswer: true, holdOpen: false,
      pause: { id: 'run-1', kind: 'inference-failed', question: 'The cloud job failed.', options: ['retry', 'local', 'whisper', 'cancel'], answer: null, projectId: 'p152-pause-1791103111', host: 'cloud', audioHash: '5a326cc8c82ab1a8c5213b4c8c1590d67bdaf367ddd7eaa995c7215b9b335670', stage: 'align', timestamp: 1791103118341, detail: 'The cloud job failed.' } },
    { jobId: 'eb848131ef9f429db52a74e03d86af07', stage: 'transcribe', status: 'done', cached: true, projectId: 'p152-pause-1791103111', rowId: 'p152-pause-1791103111', awaitingAnswer: false, holdOpen: false, pause: null },
  ];
  const open = (id: string) => ({ id, question: 'q', options: [], answer: null });

  it('the live list after a successful retry resurfaces no dialog', () => {
    expect(pauseDialogFromJobs(LIVE_LIST_AFTER_SUCCESS)).toBeUndefined();
  });

  it('a pause with no later success still asks', () => {
    // Bulk posts the pause on the row's (done) transcribe; its align failed.
    expect(pauseDialogFromJobs([
      { jobId: 't', stage: 'transcribe', status: 'done', awaitingAnswer: true, pause: open('p1') },
      { jobId: 'a', stage: 'align', status: 'failed' },
    ])?.id).toBe('p1');
    expect(pauseDialogFromJobs([{ jobId: 't', stage: 'transcribe', status: 'done', awaitingAnswer: true, pause: open('p1') }])?.id).toBe('p1');
  });

  it('the newest open pause wins over an older retired one', () => {
    expect(pauseDialogFromJobs([
      { jobId: 't1', stage: 'transcribe', status: 'done', awaitingAnswer: true, pause: open('p1') },
      { jobId: 't2', stage: 'transcribe', status: 'done', cached: true },
      { jobId: 'a2', stage: 'align', status: 'failed', awaitingAnswer: true, pause: open('p2') },
    ])?.id).toBe('p2');
  });
});
