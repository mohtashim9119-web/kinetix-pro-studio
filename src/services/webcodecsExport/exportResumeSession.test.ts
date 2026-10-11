/**
 * WS3 Round 12, STEP 1 — `findResumeOffer`'s refusal notice.
 *
 * Discovery already tells the difference between "nothing to resume" and
 * "resume was refused for a reason the operator needs to hear"
 * (`exportResumeDiscovery.test.ts`). This file is the one layer up: proving
 * `findResumeOffer` actually turns that difference into the `notice` it
 * returns, for the two cases that must reach the operator (`bitstream_touched`,
 * `budget_exhausted`) and staying silent for the ordinary ones that must not
 * (identity mismatch, no checkpoint fits, unreadable session).
 */
import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { AnimationType, TransitionType } from '../../types';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { adoptResumeOffer, findResumeOffer } from './exportResumeSession';
import {
  appendExportCheckpoint,
  createExportStateManifest,
  serializeExportState,
  type ExportCheckpointRecord,
} from './exportCheckpoint';
import type { ResumeDiscoveryIo, ResumeSessionHandle } from './exportResumeDiscovery';

const SESSION = '11111111-2222-4333-8444-555555555555';

function project(): Project {
  return {
    id: 'proj-1',
    name: 'p',
    aspectRatio: '16:9',
    resolutionTier: '1080p',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
  } as unknown as Project;
}

function ioFor(handle: Partial<ResumeSessionHandle> & { readExportState: ResumeSessionHandle['readExportState'] }): ResumeDiscoveryIo {
  const sessionFileSize = handle.sessionFileSize ?? (async () => 5_000);
  return {
    listResumableSessionIds: async () => [SESSION],
    peekExportState: async () => ({ kind: 'found', bytes: Array.from(await handle.readExportState()) }),
    peekSessionFileSize: async (_id, path) => sessionFileSize(path),
    reenter: async (sessionId) => ({
      sessionId,
      sessionFileSize: async () => 5_000,
      prepareCheckpointResume: async () => { throw new Error('should not be called'); },
      truncateAnnexbToOffset: async (_p, off) => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
      destroy: async () => {},
      ...handle,
    }),
  };
}

describe('findResumeOffer — resume refusal notice', () => {
  it('bitstream_touched reaches the caller as adoption\'s notice — the offer itself cut nothing', async () => {
    let currentSize = 5_000;
    const io = ioFor({
      readExportState: async () => new TextEncoder().encode(
        manifestJsonFor({ byteOffset: 4_000, cumulativePictures: 30, hash: await expectedHash() }),
      ),
      sessionFileSize: async () => currentSize,
      prepareCheckpointResume: async () => {
        currentSize = 4_000;
        throw new Error('checkpoint offset is not a canonical whole-AU boundary');
      },
    });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(notice).toBeNull();
    expect(currentSize).toBe(5_000);
    const adopted = await adoptResumeOffer(offer!, { io, countPicturesImpl: async () => 60 });
    expect(adopted.resumable).toBeNull();
    expect(adopted.notice?.kind).toBe('bitstream_touched');
    expect(adopted.notice?.bitstreamTouched).toEqual({ path: 'piece_0.h264', fileLengthBefore: 5_000, fileLengthAfter: 4_000 });
  });

  it('budget_exhausted reaches the caller as a notice, with no offer', async () => {
    let manifest = createExportStateManifest({
      sessionId: SESSION, projectId: 'proj-1', sourceTimelineHash: await expectedHash(), fps: 30, width: 1920, height: 1080,
    });
    manifest.totalRecoveryAttempts = 4;
    manifest = appendExportCheckpoint(manifest, {
      pieceIndex: 0, encoderSessionIndex: 0, byteOffset: 4_000, cumulativePictures: 30,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: await expectedHash(),
    });
    const io = ioFor({ readExportState: async () => new TextEncoder().encode(serializeExportState(manifest)) });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice?.kind).toBe('budget_exhausted');
    expect(notice?.reason).toContain('recovery attempts used without progress');
  });

  it('an ordinary identity mismatch (v1-era manifest, wrong project, etc.) yields NO notice — silent, not alarming', async () => {
    const io = ioFor({
      readExportState: async () => new TextEncoder().encode(
        manifestJsonFor({ byteOffset: 4_000, cumulativePictures: 30, hash: 'f'.repeat(64) }),
      ),
    });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice).toBeNull();
  });

  it('no surviving sessions at all yields no offer and no notice', async () => {
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [],
      peekExportState: async () => { throw new Error('unreachable'); },
      peekSessionFileSize: async () => { throw new Error('unreachable'); },
      reenter: async () => { throw new Error('unreachable'); },
    };
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice).toBeNull();
  });

  // WS3 STEP 8 (H5) — a live claim held by a DIFFERENT process must reach
  // the caller as its own distinct notice kind, decided before `reenter` is
  // even attempted (so `prepareCheckpointResume` throwing "should not be
  // called" — ioFor's default — would fail this test if the block did not
  // actually short-circuit).
  it('a live claim reaches the caller as a live_claim_blocked notice, with no offer, and never attempts reenter', async () => {
    let reentered = false;
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      // A session the ledger has no project for is identified by one read-only
      // peek; the live claim is still what turns it down, before any reenter.
      peekExportState: async () => ({ kind: 'found', bytes: Array.from(new TextEncoder().encode(manifestJsonFor({ byteOffset: 4_000, cumulativePictures: 30, hash: await expectedHash() }))) }),
      peekSessionFileSize: async () => { throw new Error('should not be called — live claim must block first'); },
      reenter: async (sessionId) => {
        reentered = true;
        return {
          sessionId,
          readExportState: async () => { throw new Error('should not be called — live claim must block first'); },
          sessionFileSize: async () => 5_000,
          prepareCheckpointResume: async () => { throw new Error('should not be called'); },
          truncateAnnexbToOffset: async (_p, off) => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
          destroy: async () => {},
        };
      },
      readSessionClaim: async () => ({ holderLiveness: 'live' }),
    };
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice?.kind).toBe('live_claim_blocked');
    expect(notice?.reason).toContain('another window is using this session');
    expect(reentered).toBe(false);
  });
});

async function expectedHash(): Promise<string> {
  const { buildSourceTimelineHash, timelineIdentityFromProject } = await import('./exportCheckpoint');
  return buildSourceTimelineHash(timelineIdentityFromProject(project(), { fps: 30, width: 1920, height: 1080 }));
}

function manifestJsonFor(params: { byteOffset: number; cumulativePictures: number; hash?: string }): string {
  const hash = params.hash;
  const record: Omit<ExportCheckpointRecord, 'sourceTimelineHash' | 'fps' | 'width' | 'height'> = {
    pieceIndex: 0, encoderSessionIndex: 0, byteOffset: params.byteOffset, cumulativePictures: params.cumulativePictures,
  };
  // Built synchronously with a placeholder hash when the real (async) one
  // isn't needed — the mismatch tests pass an explicit wrong hash instead.
  const finalHash = hash ?? 'a'.repeat(64);
  let manifest = createExportStateManifest({
    sessionId: SESSION, projectId: 'proj-1', sourceTimelineHash: finalHash, fps: 30, width: 1920, height: 1080,
  });
  manifest = appendExportCheckpoint(manifest, { ...record, sourceTimelineHash: finalHash, fps: 30, width: 1920, height: 1080 });
  return serializeExportState(manifest);
}

/**
 * The bug this round opened for: discovery used to claim, fence and seam-cut
 * before the operator answered, so a cancel at the prompt left the file cut
 * and the session claimed by this process — and the next pass in the same app
 * run refused it as "another window is using this session". This fake models
 * the native pair: `reenter` takes this process's claim (read back `live`
 * while the app runs), the fence and seam cut shorten the file, and an
 * unforced destroy only drops the claim.
 */
describe('findResumeOffer — the offer mutates nothing; adoption runs only after Resume', () => {
  function appRun(json: string, pieceBytes: number) {
    const files: Record<string, number> = { 'piece_0.h264': pieceBytes };
    const claims = new Set<string>();
    const mutations: string[] = [];
    let prepared = 0;
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      readSessionClaim: async (id) => ({ holderLiveness: claims.has(id) ? 'live' : 'unclaimed' }),
      peekExportState: async () => ({ kind: 'found', bytes: Array.from(new TextEncoder().encode(json)) }),
      peekSessionFileSize: async (_id, path) => files[path]!,
      reenter: async (sessionId) => {
        mutations.push('reenter');
        claims.add(sessionId);
        return {
          sessionId,
          readExportState: async () => new TextEncoder().encode(json),
          sessionFileSize: async (path) => files[path]!,
          prepareCheckpointResume: async (path, cp) => {
            mutations.push('prepareCheckpointResume');
            files[path] = cp.byteOffset;
            prepared = cp.cumulativePictures;
            return { pictures: cp.cumulativePictures, vclNals: 0, bytesRemoved: 0, keptBytes: cp.byteOffset };
          },
          truncateAnnexbToOffset: async (path, off) => {
            mutations.push('truncateAnnexbToOffset');
            files[path] = off;
            return { pictures: prepared, vclNals: 0, bytesRemoved: 0, keptBytes: off };
          },
          clearResumeFence: async () => { mutations.push('clearResumeFence'); },
          destroy: async () => { mutations.push('destroy'); claims.delete(sessionId); },
        };
      },
    };
    return { io, files, claims, mutations };
  }

  async function checkpointJson(): Promise<string> {
    let manifest = createExportStateManifest({
      sessionId: SESSION, projectId: 'proj-1', sourceTimelineHash: await expectedHash(), fps: 30, width: 1920, height: 1080,
    });
    manifest = appendExportCheckpoint(manifest, {
      pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 4_000, seamByteOffset: 3_900, cumulativePictures: 30,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: await expectedHash(),
    });
    return serializeExportState(manifest);
  }

  const offerParams = (io: ResumeDiscoveryIo) => ({
    project: project(), fps: 30, width: 1920, height: 1080, pieceExpectedFrames: [60], io, nowMs: 0,
  });

  it('(1) THE ABANDON CASE: cancel at the prompt leaves the file byte-identical and unclaimed, and the next pass makes the SAME offer', async () => {
    const run = appRun(await checkpointJson(), 4_500);
    const first = await findResumeOffer(offerParams(run.io));
    expect(first.offer?.sessionId).toBe(SESSION);
    // The operator cancels here: nothing adopts.
    expect(run.files).toEqual({ 'piece_0.h264': 4_500 });
    expect(run.mutations).toEqual([]);
    expect(run.claims.size).toBe(0);

    const second = await findResumeOffer(offerParams(run.io));
    expect(second.notice).toBeNull();
    expect(second.offer?.sessionId).toBe(SESSION);
    expect(second.offer?.picturesAlreadyRendered).toBe(first.offer!.picturesAlreadyRendered);
    expect(second.offer?.picturesTotal).toBe(first.offer!.picturesTotal);
    expect(run.files).toEqual({ 'piece_0.h264': 4_500 });
  });

  it('(2) cancelled while discovery is still running: the file is untouched, and useExport adopts only after the generation check and a Resume answer', async () => {
    const run = appRun(await checkpointJson(), 4_500);
    const pending = findResumeOffer(offerParams(run.io));
    // useExport.ts: `if (generationRef.current !== gen) return;` straight after
    // discovery — the result is dropped, nothing else runs.
    await pending;
    expect(run.mutations).toEqual([]);
    expect(run.files).toEqual({ 'piece_0.h264': 4_500 });

    const src = readFileSync(resolve(import.meta.dirname, '..', '..', 'hooks', 'useExport.ts'), 'utf-8');
    const discoveryAt = src.indexOf('await findResumeOffer(');
    const genCheckAt = src.indexOf('if (generationRef.current !== gen) return;', discoveryAt);
    const resumeAnswerAt = src.indexOf("if (choice === 'resume')", genCheckAt);
    const adoptAt = src.indexOf('await adoptResumeOffer(');
    expect(discoveryAt).toBeGreaterThan(-1);
    expect(genCheckAt).toBeGreaterThan(discoveryAt);
    expect(resumeAnswerAt).toBeGreaterThan(genCheckAt);
    expect(adoptAt).toBeGreaterThan(resumeAnswerAt);
    expect(src.indexOf('adoptResumeOffer(', adoptAt + 'await adoptResumeOffer('.length)).toBe(-1);
  });

  it('(3) choosing Resume still resumes — and the file is cut only then', async () => {
    const run = appRun(await checkpointJson(), 4_500);
    const { offer } = await findResumeOffer(offerParams(run.io));
    expect(run.files['piece_0.h264']).toBe(4_500);
    const adopted = await adoptResumeOffer(offer!, { io: run.io, countPicturesImpl: async () => 60 });
    expect(adopted.resumable?.sessionId).toBe(SESSION);
    expect(adopted.resumable?.appendFromByteOffset).toBe(3_900);
    expect(adopted.resumable?.picturesAlreadyRendered).toBe(30);
    expect(run.mutations).toEqual(['reenter', 'prepareCheckpointResume', 'truncateAnnexbToOffset']);
    expect(run.files['piece_0.h264']).toBe(3_900);
  });

  it('(4) no app restart is needed to get the offer back: abandon twice, then Resume adopts in the same run', async () => {
    const run = appRun(await checkpointJson(), 4_500);
    await findResumeOffer(offerParams(run.io));
    await findResumeOffer(offerParams(run.io));
    const { offer, notice } = await findResumeOffer(offerParams(run.io));
    expect(notice).toBeNull();
    const adopted = await adoptResumeOffer(offer!, { io: run.io, countPicturesImpl: async () => 60 });
    expect(adopted.resumable?.sessionId).toBe(SESSION);
    expect(adopted.notice).toBeNull();
  });
});

describe('findResumeOffer — the recovery budget never refuses across projects, and never deletes its evidence', () => {
  const EXHAUSTED = 'ffffffff-2222-4333-8444-555555555555';
  const EMPTY = '00000000-2222-4333-8444-555555555555';
  async function manifestOf(sessionId: string, opts: { projectId?: string; attempts?: number; checkpoint?: boolean }): Promise<string> {
    const hash = await expectedHash();
    let m = createExportStateManifest({ sessionId, projectId: opts.projectId ?? 'proj-1', sourceTimelineHash: hash, fps: 30, width: 1920, height: 1080 });
    if (opts.checkpoint !== false) {
      m = appendExportCheckpoint(m, { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 30, fps: 30, width: 1920, height: 1080, sourceTimelineHash: hash });
    }
    if (opts.attempts !== undefined) m = { ...m, totalRecoveryAttempts: opts.attempts };
    return serializeExportState(m);
  }
  function diskIo(manifests: Record<string, string>): { io: ResumeDiscoveryIo; destroyed: string[] } {
    const destroyed: string[] = [];
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => Object.keys(manifests),
      readSessionClaim: async () => ({ holderLiveness: 'unclaimed' }),
      peekExportState: async (id) => ({ kind: 'found', bytes: Array.from(new TextEncoder().encode(manifests[id]!)) }),
      peekSessionFileSize: async () => 5_000,
      reenter: async (sessionId) => ({
        sessionId,
        readExportState: async () => new TextEncoder().encode(manifests[sessionId]!),
        sessionFileSize: async () => 5_000,
        prepareCheckpointResume: async () => { throw new Error('not in this test'); },
        truncateAnnexbToOffset: async () => { throw new Error('not in this test'); },
        destroy: async () => { destroyed.push(sessionId); },
      }),
    };
    return { io, destroyed };
  }
  const params = (io: ResumeDiscoveryIo) => ({ project: project(), fps: 30, width: 1920, height: 1080, pieceExpectedFrames: [60], io, nowMs: 0 });

  it('(4) a FOREIGN project\'s exhausted session produces no refusal notice on this row', async () => {
    const { io } = diskIo({ [EXHAUSTED]: await manifestOf(EXHAUSTED, { projectId: 'someone-else', attempts: 4 }) });
    const { offer, notice } = await findResumeOffer(params(io));
    expect(offer).toBeNull();
    expect(notice).toBeNull();
  });

  it('(5) this project\'s refusal carries the real reason and count', async () => {
    const { io } = diskIo({ [EXHAUSTED]: await manifestOf(EXHAUSTED, { attempts: 4 }) });
    const { notice } = await findResumeOffer(params(io));
    expect(notice?.kind).toBe('budget_exhausted');
    expect(notice?.reason).toBe('Resume unavailable — 4 of 4 recovery attempts used without progress. Starting fresh.');
  });

  it('D1.5 — the refused session is not collected as collateral in the same pass', async () => {
    const { io, destroyed } = diskIo({
      [EMPTY]: await manifestOf(EMPTY, { checkpoint: false }),
      [EXHAUSTED]: await manifestOf(EXHAUSTED, { attempts: 4 }),
    });
    await findResumeOffer(params(io));
    expect(destroyed).not.toContain(EXHAUSTED);
  });
});
