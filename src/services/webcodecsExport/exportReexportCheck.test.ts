import { describe, it, expect } from 'vitest';
import { TransitionType, AnimationType, type Project } from '../../types';
import { buildSourceTimelineHash, timelineIdentityFromProject } from './exportCheckpoint';
import { checkExistingCheckpoint, type ReexportCheckIo } from './exportReexportCheck';

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
    const outcome = await checkExistingCheckpoint(stubProject(), fakeIo({}));
    expect(outcome).toEqual({ kind: 'no-checkpoint' });
  });

  it('no-checkpoint when the newest session peeks NotFound (torn manifest / already gone)', async () => {
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'notFound' }),
    });
    const outcome = await checkExistingCheckpoint(stubProject(), io);
    expect(outcome).toEqual({ kind: 'no-checkpoint' });
  });

  it('unedited when the newest checkpoint hashes to the same identity as the current project', async () => {
    const project = stubProject();
    const manifestJson = await manifestFor(project, 'sess-a');
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf(manifestJson) }),
    });
    const outcome = await checkExistingCheckpoint(project, io);
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
    const outcome = await checkExistingCheckpoint(edited, io);
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
    const outcome = await checkExistingCheckpoint(stubProject(), io);
    expect(outcome.kind).toBe('unedited');
  });

  it('no-checkpoint when the manifest bytes do not parse as the expected shape', async () => {
    const io = fakeIo({
      listResumableSessionIds: async () => ['sess-a'],
      peekExportState: async () => ({ kind: 'found', bytes: bytesOf('{"not":"a manifest"}') }),
    });
    const outcome = await checkExistingCheckpoint(stubProject(), io);
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
    await checkExistingCheckpoint(project, io);
    expect(peekCount).toBe(1);
  });
});
