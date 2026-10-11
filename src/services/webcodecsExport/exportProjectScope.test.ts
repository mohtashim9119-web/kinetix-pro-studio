// @vitest-environment jsdom
/**
 * Retention, cleanup and discovery are scoped PER PROJECT.
 *
 * The operator's field log showed every bulk row start destroying the session
 * the previous row (a different project) had just cancelled and kept: the
 * collector ran a global "keep one besides mine" cap over every project's
 * sessions. A row now only ever sees its own project's sessions, keeps the
 * per-project cap, and deletes nothing whose age is unknown, whose claim is
 * live, or whose project another owner (a bulk row) still has interest in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Project } from '../../types';
import { AnimationType, TransitionType } from '../../types';
import { adoptResumeOffer, buildExpectedIdentity, findResumeOffer } from './exportResumeSession';
import { appendExportCheckpoint, createExportStateManifest, serializeExportState } from './exportCheckpoint';
import type { ResumeDiscoveryIo } from './exportResumeDiscovery';
import { exportSessionProjectId, recordExportSessionCreated, recordExportSessionProject } from './exportSessionLedger';
import { ExportInterestRegistry } from './exportInterestRegistry';

const proj = (id: string): Project => ({
  id, name: id, aspectRatio: '16:9', resolutionTier: '1080p', segments: [], assets: [],
  globalTransition: TransitionType.NONE, globalTransitionDuration: 0, globalAnimation: AnimationType.NONE,
}) as unknown as Project;

interface Sess { projectId: string; manifest: string | null; size: number; claimed: boolean }

function world() {
  const disk = new Map<string, Sess>();
  const touched: string[] = [];
  const destroyedBy: string[] = [];
  let n = 1;
  const uuid = (): string => `${String(n++).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const io: ResumeDiscoveryIo = {
    listResumableSessionIds: async () => [...disk].filter(([, s]) => s.manifest).map(([id]) => id).sort(),
    readSessionClaim: async (id) => { touched.push(`claim:${id}`); return { holderLiveness: disk.get(id)?.claimed ? 'live' : 'unclaimed' }; },
    peekExportState: async (id) => {
      touched.push(`peek:${id}`);
      const s = disk.get(id);
      return s?.manifest ? { kind: 'found', bytes: Array.from(new TextEncoder().encode(s.manifest)) } : { kind: 'notFound' };
    },
    peekSessionFileSize: async (id) => { touched.push(`size:${id}`); return disk.get(id)!.size; },
    reenter: async (id) => {
      touched.push(`reenter:${id}`);
      const s = disk.get(id);
      if (!s) throw new Error('gone');
      s.claimed = true;
      return {
        sessionId: id,
        readExportState: async () => new TextEncoder().encode(s.manifest!),
        sessionFileSize: async () => s.size,
        prepareCheckpointResume: async (_p, cp) => { s.size = cp.byteOffset; return { pictures: cp.cumulativePictures, vclNals: 0, bytesRemoved: 0, keptBytes: cp.byteOffset }; },
        truncateAnnexbToOffset: async (_p, off) => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
        clearResumeFence: async () => undefined,
        destroy: async (o) => {
          s.claimed = false;
          if (o?.force || !s.manifest) { disk.delete(id); destroyedBy.push(`${id}:${o?.failureKind}`); }
        },
      };
    },
  };
  async function manifestFor(projectId: string, sessionId: string, pictures: number): Promise<string> {
    const e = await buildExpectedIdentity(proj(projectId), { fps: 30, width: 1920, height: 1080 });
    let m = createExportStateManifest({ sessionId, projectId, sourceTimelineHash: e.sourceTimelineHash, fps: 30, width: 1920, height: 1080 });
    m = appendExportCheckpoint(m, { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: pictures * 10, cumulativePictures: pictures, fps: 30, width: 1920, height: 1080, sourceTimelineHash: e.sourceTimelineHash });
    return serializeExportState(m);
  }
  async function leftover(projectId: string, pictures: number, at: number | null): Promise<string> {
    const id = uuid();
    disk.set(id, { projectId, manifest: await manifestFor(projectId, id, pictures), size: pictures * 10 + 5, claimed: false });
    if (at !== null) recordExportSessionCreated(id, at, projectId);
    return id;
  }
  /** What useExport does for one row up to the operator's cancel (Retry, resume on). */
  async function runRow(projectId: string, now: number, extra: { interests?: ExportInterestRegistry; owner?: string } = {}): Promise<{ resumedFrom: string | null; note: string }> {
    const fresh = uuid();
    disk.set(fresh, { projectId, manifest: null, size: 0, claimed: true });
    recordExportSessionCreated(fresh, now, projectId);
    const { offer, notice } = await findResumeOffer({
      project: proj(projectId), fps: 30, width: 1920, height: 1080, pieceExpectedFrames: [3000],
      inUseSessionId: fresh, io, nowMs: now, interests: extra.interests, interestOwner: extra.owner,
    });
    let target = fresh;
    let resumedFrom: string | null = null;
    if (offer) {
      const adopted = await adoptResumeOffer(offer, { io, countPicturesImpl: async () => 3000 });
      if (adopted.resumable) { target = adopted.resumable.sessionId; resumedFrom = target; }
    }
    const t = disk.get(target)!;
    const prev = t.manifest ? (JSON.parse(t.manifest) as { checkpoints: { cumulativePictures: number }[] }).checkpoints.at(-1)!.cumulativePictures : 0;
    t.manifest = await manifestFor(projectId, target, prev + 300);
    t.size = (prev + 300) * 10 + 5;
    t.claimed = false; // cancel, keepForResume: files kept, claim released
    if (target !== fresh) disk.delete(fresh);
    return { resumedFrom, note: notice?.kind ?? '' };
  }
  return { disk, io, touched, destroyedBy, leftover, runRow, uuid };
}

beforeEach(() => localStorage.clear());

describe('per-project retention and discovery', () => {
  it('(1) A\'s discovery leaves B\'s checkpoint on disk, and B still resumes from it', async () => {
    const w = world();
    const aOld = await w.leftover('A', 1800, 100);
    const b = await w.leftover('B', 900, 200);
    await w.leftover('A', 300, 300);
    await w.runRow('A', 1_000);
    expect(w.disk.has(b)).toBe(true);
    expect((await w.runRow('B', 2_000)).resumedFrom).toBe(b);
    expect(w.disk.has(aOld)).toBe(true);
  });

  it('(2) five cancel/Retry cycles of two projects destroy nothing', async () => {
    const w = world();
    const a = await w.leftover('A', 300, 100);
    const b = await w.leftover('B', 300, 200);
    for (let cycle = 0; cycle < 5; cycle++) {
      expect((await w.runRow('A', 1_000 + cycle * 10)).resumedFrom).toBe(a);
      expect((await w.runRow('B', 1_005 + cycle * 10)).resumedFrom).toBe(b);
    }
    expect(w.destroyedBy.filter((d) => d.endsWith(':ttl-collect'))).toEqual([]);
  });

  it('(3) leftovers in a third project never cost A or B a checkpoint', async () => {
    const w = world();
    const cs = [await w.leftover('C', 300, 10), await w.leftover('C', 600, 20), await w.leftover('C', 900, 30)];
    const a = await w.leftover('A', 300, 100);
    const b = await w.leftover('B', 300, 200);
    for (let cycle = 0; cycle < 3; cycle++) {
      await w.runRow('A', 1_000 + cycle * 10);
      await w.runRow('B', 1_005 + cycle * 10);
    }
    for (const id of [a, b, ...cs]) expect(w.disk.has(id), id).toBe(true);
  });

  it('(5) a row never touches a foreign project\'s session — no peek, rank, claim, fence, cut or destroy', async () => {
    const w = world();
    const foreign = await w.leftover('B', 900, 50);
    await w.leftover('A', 300, 100);
    await w.runRow('A', 1_000);
    expect(w.touched.filter((t) => t.endsWith(foreign))).toEqual([]);
    expect(w.disk.has(foreign)).toBe(true);
  });

  it('a session the ledger has no project for is identified once (read-only), then scoped like any other', async () => {
    const w = world();
    const legacy = await w.leftover('B', 900, null); // pre-upgrade: no ledger row at all
    await w.leftover('A', 300, 100);
    await w.runRow('A', 1_000);
    expect(w.touched.filter((t) => t.endsWith(legacy))).toEqual([`peek:${legacy}`]);
    expect(exportSessionProjectId(legacy)).toBe('B');
    w.touched.length = 0;
    await w.runRow('A', 1_100);
    expect(w.touched.filter((t) => t.endsWith(legacy))).toEqual([]);
  });
});

describe('(4) the collector deletes only what is provably abandoned', () => {
  async function overCap(w: ReturnType<typeof world>): Promise<{ oldest: string }> {
    // A's offer + three older leftovers: the per-project cap keeps one.
    await w.leftover('A', 3000 - 1, 900);
    await w.leftover('A', 600, 300);
    await w.leftover('A', 300, 200);
    const oldest = await w.leftover('A', 100, 100);
    return { oldest };
  }

  it('the per-project cap still collects a provably abandoned leftover of this project', async () => {
    const w = world();
    const { oldest } = await overCap(w);
    await w.runRow('A', 1_000);
    expect(w.disk.has(oldest)).toBe(false);
  });

  it('never a session whose age is unknown', async () => {
    const w = world();
    await overCap(w);
    const unknownAge = await w.leftover('A', 50, null);
    recordExportSessionProject(unknownAge, 'A'); // project known, age not
    await w.runRow('A', 1_000);
    expect(w.disk.has(unknownAge)).toBe(true);
  });

  it('never a session whose claim is live', async () => {
    const w = world();
    const { oldest } = await overCap(w);
    w.disk.get(oldest)!.claimed = true;
    await w.runRow('A', 1_000);
    expect(w.disk.has(oldest)).toBe(true);
  });

  it('never a session of a project another owner (a bulk row) has live interest in', async () => {
    const w = world();
    const { oldest } = await overCap(w);
    const interests = new ExportInterestRegistry();
    interests.setProjects('bulk', ['A']);
    await w.runRow('A', 1_000, { interests, owner: 'editor' });
    expect(w.disk.has(oldest)).toBe(true);
  });

  it('never a session an owner has published interest in', async () => {
    const w = world();
    const { oldest } = await overCap(w);
    const interests = new ExportInterestRegistry();
    interests.setSessions('bulk', [oldest]);
    await w.runRow('A', 1_000, { interests, owner: 'bulk' });
    expect(w.disk.has(oldest)).toBe(true);
  });

  it('the owner holding the interest may still collect its own project\'s abandoned leftovers', async () => {
    const w = world();
    const { oldest } = await overCap(w);
    const interests = new ExportInterestRegistry();
    interests.setProjects('bulk', ['A']);
    await w.runRow('A', 1_000, { interests, owner: 'bulk' });
    expect(w.disk.has(oldest)).toBe(false);
  });
});

describe('every disposition is logged with project id, session id and reason', () => {
  it('collected, kept and skipped sessions each log their project and reason', async () => {
    const w = world();
    await w.leftover('A', 3000 - 1, 900);
    const kept = await w.leftover('A', 600, 300);
    const live = await w.leftover('A', 300, 200);
    const doomed = await w.leftover('A', 100, 100);
    w.disk.get(live)!.claimed = true;
    const lines: string[] = [];
    const fresh = w.uuid();
    await findResumeOffer({
      project: proj('A'), fps: 30, width: 1920, height: 1080, pieceExpectedFrames: [3000],
      inUseSessionId: fresh, io: w.io, nowMs: 1_000, logDisposition: (line) => lines.push(line),
    });
    const of = (id: string): string | undefined => lines.find((l) => l.includes(`sessionId=${id}`));
    expect(of(doomed)).toMatch(/disposition=collected projectId=A .*reason=/);
    expect(of(live)).toMatch(/disposition=skipped projectId=A .*reason=.*live claim/);
    expect(of(kept)).toMatch(/disposition=kept projectId=A .*reason=/);
  });
});
