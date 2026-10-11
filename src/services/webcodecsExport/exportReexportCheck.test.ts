import { describe, it, expect } from 'vitest';
import { TransitionType, AnimationType, type Project } from '../../types';
import { buildSourceTimelineHash, timelineIdentityFromProject } from './exportCheckpoint';
import { checkExistingCheckpoint, findUsableCheckpoint, resolveReexportCheckpoint, type ReexportCheckIo } from './exportReexportCheck';
import type { SpotRenderSpec } from './spotRenderSpec';
import { recordPieceCompleted, createExportStateManifest, serializeExportState } from './exportCheckpoint';

function stubProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test',
    script: 'hello',
    sceneDetails: '',
    segments: [
      {
        id: 'seg-1',
        text: 'hello',
        assetId: 'asset-1',
        startTime: 0,
        duration: 2,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: 0,
      },
    ],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Arial' },
    ...overrides,
  };
}

const DIMS = { fps: 30, width: 1920, height: 1080 };

async function manifestFor(project: Project, sessionId: string): Promise<string> {
  const hash = await buildSourceTimelineHash(timelineIdentityFromProject(project, DIMS));
  return JSON.stringify({
    schemaVersion: 1,
    sessionId,
    projectId: project.id,
    sourceTimelineHash: hash,
    fps: DIMS.fps,
    width: DIMS.width,
    height: DIMS.height,
    checkpoints: [],
  });
}

function bytesOf(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function fakeIo(overrides: Partial<ReexportCheckIo>): ReexportCheckIo {
  return {
    listResumableSessionIds: async () => [],
    peekExportState: async () => ({ kind: 'notFound' }),
    ...overrides,
  };
}

describe('checkExistingCheckpoint', () => {
  it('no-checkpoint when nothing is resumable', async () => {
    const outcome = await checkExistingCheckpoint(stubProject(), fakeIo({}), { spotRenderSpecs: undefined });
    expect(outcome).toEqual({ kind: 'no-checkpoint' });
  });

  it('no-checkpoint when the newest session peeks NotFound (torn manifest / already gone)', async () => {
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'notFound' }),
    });
    const outcome = await checkExistingCheckpoint(stubProject(), io, { spotRenderSpecs: undefined });
    expect(outcome).toEqual({ kind: 'no-checkpoint' });
  });

  it('unedited when the newest checkpoint hashes to the same identity as the current project', async () => {
    const project = stubProject();
    const manifestJson = await manifestFor(project, 'sess-a');
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf(manifestJson) }),
    });
    const outcome = await checkExistingCheckpoint(project, io, { spotRenderSpecs: undefined });
    expect(outcome.kind).toBe('unedited');
    if (outcome.kind === 'unedited') {
      expect(outcome.sessionId).toBe('sess-a');
      expect(outcome.manifest.fps).toBe(30);
    }
  });

  it('edited when the current project timeline has moved since the checkpoint was written', async () => {
    const original = stubProject();
    const manifestJson = await manifestFor(original, 'sess-a');
    const [firstSegment] = original.segments;
    if (!firstSegment) throw new Error('stubProject must have at least one segment');
    const edited = stubProject({
      segments: [{ ...firstSegment, duration: 5 }],
    });
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf(manifestJson) }),
    });
    const outcome = await checkExistingCheckpoint(edited, io, { spotRenderSpecs: undefined });
    expect(outcome.kind).toBe('edited');
    if (outcome.kind === 'edited') expect(outcome.sessionId).toBe('sess-a');
  });

  it('cosmetic-only difference (a field outside the hashed identity) is NOT reported as edited', async () => {
    // Per 2.0 / Ruling C: timelineIdentityFromProject's field set excludes
    // cosmetic state entirely, so there is nothing cosmetic to construct a
    // Project variant of within the hashed fields themselves — this test
    // instead proves the SAME project (no field changed at all) always
    // resolves 'unedited', which is the behavior the cosmetic-invariance
    // guarantee rests on.
    const project = stubProject();
    const manifestJson = await manifestFor(project, 'sess-a');
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf(manifestJson) }),
    });
    const outcome = await checkExistingCheckpoint(stubProject(), io, { spotRenderSpecs: undefined });
    expect(outcome.kind).toBe('unedited');
  });

  it('no-checkpoint when the manifest bytes do not parse as the expected shape', async () => {
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf('{"not":"a manifest"}') }),
    });
    const outcome = await checkExistingCheckpoint(stubProject(), io, { spotRenderSpecs: undefined });
    expect(outcome).toEqual({ kind: 'no-checkpoint' });
  });

  it('peeks exactly ONE session id (never all resumable ids) when multiple exist', async () => {
    // Neither id is known to exportSessionCreatedAt's ledger in this pure
    // unit test, so newestSessionId falls to its string tiebreak — the
    // point of this test isn't which one wins, it's that checkExistingCheckpoint
    // peeks exactly one candidate, not every resumable session id.
    const project = stubProject();
    const manifestJson = await manifestFor(project, 'sess-a');
    let peekCount = 0;
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a', 'sess-b'],
      peekExportState: async () => {
        peekCount += 1;
        return { kind: 'found', bytes: bytesOf(manifestJson) };
      },
    });
    await checkExistingCheckpoint(project, io, { spotRenderSpecs: undefined });
    expect(peekCount).toBe(1);
  });
});

describe('findUsableCheckpoint — the bulk Retry question', () => {
  const SID = (n: number): string => `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(n).padStart(2, '0')}`;
  async function realManifest(project: Project, sessionId: string, finishedPieces: number): Promise<string> {
    const hash = await buildSourceTimelineHash(timelineIdentityFromProject(project, DIMS));
    let m = createExportStateManifest({ sessionId, projectId: project.id, sourceTimelineHash: hash, ...DIMS });
    if (finishedPieces > 0) m = recordPieceCompleted(m, finishedPieces - 1);
    return serializeExportState(m);
  }
  const ioOf = (sessions: Record<string, string>): ReexportCheckIo => fakeIo({
    listResumableSessionIds: async () => Object.keys(sessions),
    peekExportState: async (id) => ({ kind: 'found', bytes: bytesOf(sessions[id]!) }),
  });

  it('an empty manifest (nothing recorded yet) is NOT a checkpoint', async () => {
    const p = stubProject();
    expect(await findUsableCheckpoint(p, ioOf({ [SID(1)]: await realManifest(p, SID(1), 0) }))).toBeNull();
  });

  it('a manifest with a finished piece is usable', async () => {
    const p = stubProject();
    const found = await findUsableCheckpoint(p, ioOf({ [SID(1)]: await realManifest(p, SID(1), 1) }));
    expect(found?.sessionId).toBe(SID(1));
  });

  it('another project\'s session never hides this project\'s own (or counts as it)', async () => {
    const mine = stubProject();
    const other = stubProject({ id: 'proj-other' });
    const found = await findUsableCheckpoint(mine, ioOf({
      [SID(1)]: await realManifest(mine, SID(1), 1),
      [SID(2)]: await realManifest(other, SID(2), 3),
    }));
    expect(found?.sessionId).toBe(SID(1));
    expect(await findUsableCheckpoint(stubProject({ id: 'proj-third' }), ioOf({ [SID(2)]: await realManifest(other, SID(2), 3) }))).toBeNull();
  });

  it('an edited timeline has nothing to resume', async () => {
    const p = stubProject();
    const m = await realManifest(p, SID(1), 1);
    const edited = stubProject({ script: 'changed', segments: [{ ...p.segments[0]!, duration: 5 }] });
    expect(await findUsableCheckpoint(edited, ioOf({ [SID(1)]: m }))).toBeNull();
  });
});

/**
 * C2 (P0-A + P0-B) — the Export-click auto-purge may delete ONLY this
 * project's checkpoint, hashed from the same ingredients the writer used, and
 * never one a live claim holds. With no ledger in this unit environment the
 * newest-first order falls to the id tiebreak, so B's id sorts first: B is
 * "newest".
 */
describe('re-export auto-purge deletes only THIS checkpoint (C2)', () => {
  const B_SESSION = 'sess-a';
  const A_SESSION = 'sess-b';
  const NO_SPOTS = { spotRenderSpecs: undefined };

  function purgeIo(sessions: Record<string, string>, claims: Record<string, 'live' | 'stale' | 'unclaimed'> = {}) {
    const destroyed: { sessionId: string; opts: { force: boolean; failureKind: string } }[] = [];
    const io = {
      listResumableSessionIds: async () => Object.keys(sessions),
      peekExportState: async (id: string) => ({ kind: 'found' as const, bytes: bytesOf(sessions[id]!) }),
      readSessionClaim: async (id: string) => ({ holderLiveness: claims[id] ?? ('unclaimed' as const) }),
      reenter: async (sessionId: string) => ({
        destroy: async (opts: { force: boolean; failureKind: string }) => { destroyed.push({ sessionId, opts }); },
      }),
    };
    return { io, destroyed };
  }

  it('(1) another project\'s newer session is never "edited" for this one, and its id never reaches destroy', async () => {
    const a = stubProject({ id: 'proj-A' });
    const b = stubProject({ id: 'proj-B', script: 'other' });
    const both = purgeIo({ [B_SESSION]: await manifestFor(b, B_SESSION), [A_SESSION]: await manifestFor(a, A_SESSION) });
    expect(await checkExistingCheckpoint(a, both.io, NO_SPOTS)).toMatchObject({ kind: 'unedited', sessionId: A_SESSION });
    await resolveReexportCheckpoint(a, both.io, NO_SPOTS);
    expect(both.destroyed).toEqual([]);

    const onlyB = purgeIo({ [B_SESSION]: await manifestFor(b, B_SESSION) });
    expect(await resolveReexportCheckpoint(a, onlyB.io, NO_SPOTS)).toEqual({ outcome: { kind: 'no-checkpoint' }, purge: null });
    expect(onlyB.destroyed).toEqual([]);
  });

  it('(2) a spotted project whose manifest was hashed the writer\'s way reads "unedited"', async () => {
    const p = stubProject();
    const specs: SpotRenderSpec[] = [{ assetId: 'asset-1', startSec: 0.5, durSec: 1, xPct: 10, yPct: 10, wPct: 30, hPct: 30 }];
    // The writer's derivation (exportPipelineWebCodecs.ts — the checkpoint writer's sourceTimelineHash).
    const hash = await buildSourceTimelineHash(timelineIdentityFromProject(p, DIMS, { spotRenderSpecs: specs }));
    const manifest = serializeExportState(createExportStateManifest({ sessionId: A_SESSION, projectId: p.id, sourceTimelineHash: hash, ...DIMS }));
    const { io, destroyed } = purgeIo({ [A_SESSION]: manifest });
    expect(await resolveReexportCheckpoint(p, io, { spotRenderSpecs: specs })).toMatchObject({ outcome: { kind: 'unedited', sessionId: A_SESSION }, purge: null });
    expect(destroyed).toEqual([]);
  });

  it('(3) a live-claimed session is NOT purged and the skip is reported — the intended over-skip', async () => {
    const p = stubProject();
    const edited = stubProject({ script: 'changed', segments: [{ ...p.segments[0]!, duration: 5 }] });
    const { io, destroyed } = purgeIo({ [A_SESSION]: await manifestFor(p, A_SESSION) }, { [A_SESSION]: 'live' });
    expect(await resolveReexportCheckpoint(edited, io, NO_SPOTS)).toMatchObject({
      outcome: { kind: 'edited', sessionId: A_SESSION },
      purge: { kind: 'skipped-live-claim', sessionId: A_SESSION },
    });
    expect(destroyed).toEqual([]);
  });

  it('(4) the legitimate case still purges: same project, same specs, edited timeline (unclaimed or stale)', async () => {
    const p = stubProject();
    const edited = stubProject({ script: 'changed', segments: [{ ...p.segments[0]!, duration: 5 }] });
    for (const liveness of ['unclaimed', 'stale'] as const) {
      const { io, destroyed } = purgeIo({ [A_SESSION]: await manifestFor(p, A_SESSION) }, { [A_SESSION]: liveness });
      expect(await resolveReexportCheckpoint(edited, io, NO_SPOTS)).toMatchObject({
        outcome: { kind: 'edited', sessionId: A_SESSION },
        purge: { kind: 'purged', sessionId: A_SESSION },
      });
      expect(destroyed).toEqual([{ sessionId: A_SESSION, opts: { force: true, failureKind: 'timeline-edited-auto-purge' } }]);
    }
  });
});
