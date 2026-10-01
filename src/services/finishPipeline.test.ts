/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
import { TransitionType, AnimationType, type Asset, type Project, type TranscriptToken, type VideoSegment } from '../types';
import type { StagedFiles } from '../components/DropZonePanel';
import type { AlignFromCacheResult } from '../hooks/useWhisper';
import type { SegmentAlignment } from './whisperService';
import {
  runFinishPipeline,
  stagedOwnerMismatch,
  STAGED_FOR_ANOTHER_PROJECT_MESSAGE,
  type FinishStages,
  type FinishPipelineInput,
} from './finishPipeline';
import { BulkBatchRunner, stagesToRun } from './bulkBatch';
import { SyncQueue, type QueueEngine } from './syncQueue';

const NOW = 1_700_000_000_000;
const TOKENS: TranscriptToken[] = [
  { text: 'hello', startSec: 0, endSec: 0.5 },
  { text: 'world', startSec: 0.5, endSec: 1 },
];
const FA_WORDS: TranscriptToken[] = [
  { text: 'hello', startSec: 0.01, endSec: 0.49, confidence: 0.99 },
  { text: 'world', startSec: 0.5, endSec: 0.99, confidence: 0.98 },
];

function segment(): VideoSegment {
  return {
    id: 's1',
    order: 0,
    startTime: 0,
    duration: 1,
    text: 'hello world',
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
  };
}

function coverage(): SegmentAlignment {
  return {
    t0: 0, t1: 1, firstTokenIdx: 0, lastTokenIdx: 1, confidence: 1,
    matched: true, matchedWords: 2, totalWords: 2, longestRun: 2,
  };
}

const stages: FinishStages = {
  parseProjectData: async () => [segment()],
  evaluateCoverageGate: () => ({ aborted: false }),
  filterToCoveredSegments: (segs, cov) => ({
    kept: segs, skipped: [], keptAlignments: cov,
  }),
  retileCoveredSegments: kept => kept,
  emptySceneDocAbortMessage: () => null,
  buildSyncInfoEntry: (id, total, matched, skipped, ts) => ({
    id: 'e1', syncRunId: id, type: 'info', message: `${total}/${matched}/${skipped}`, timestamp: ts,
  }),
};

function stagedFor(tag: string, owner = tag): { staged: StagedFiles; owner: string } {
  return {
    owner,
    staged: {
      scriptFile: { file: new File([`script ${tag}`], `script-${tag}.txt`, { type: 'text/plain' }), key: `s-${tag}` },
      sceneFile: { file: new File([`[Scene 1] scene ${tag}`], `scenes-${tag}.txt`, { type: 'text/plain' }), key: `c-${tag}` },
      voiceoverFile: { file: new File([`audio ${tag}`], `vo-${tag}.m4a`, { type: 'audio/mp4' }), key: `v-${tag}` },
      assetFiles: [],
      zipFiles: [],
    },
  };
}

function project(id: string): Project {
  return {
    id, name: id, script: '', sceneDetails: '', segments: [], assets: [], headings: [],
    confirmed: true, bulkContext: true, language: 'en',
  } as unknown as Project;
}

function aligned(): AlignFromCacheResult {
  return {
    segments: [{ ...segment(), startTime: 0, duration: 1 }],
    coverage: [coverage()],
    silences: [],
    tokens: FA_WORDS,
    malformedTokenCount: 0,
    totalTokenCount: 2,
  };
}

function baseInput(id: string, extras: Partial<FinishPipelineInput> = {}): FinishPipelineInput {
  const { staged, owner } = stagedFor(id);
  return {
    project: project(id),
    staged,
    stagedOwnerId: owner,
    stages,
    persistVoiceover: async (_pid, file) => ({
      id: `vo-${id}`, name: file.name, url: 'blob:test', type: 'audio', file, addedAt: 1, duration: 1,
    } as Asset),
    probeDuration: async () => 1,
    persistMedia: async (_pid, _st, assets) => ({ assets }),
    now: () => NOW,
    lookupTranscript: async () => ({ tokens: TOKENS, language: 'en' }),
    runFa: async () => ({
      status: 'ok',
      tokens: FA_WORDS,
      unscriptedRuns: [],
      cloudProvenance: { engine: 'fa-cloud', model: 'fa-en', modelVersion: 'rev-1' },
      cloudCached: true,
    }),
    alignFromCache: async () => aligned(),
    hashScript: async (script, scene) => `script:${script}|${scene}`,
    hashAudio: async () => `audio-${id}`,
    ...extras,
  };
}

function goldenSlice(p: Project): unknown {
  return {
    faWordTimings: p.faWordTimings,
    timingProvenance: p.timingProvenance,
  };
}

describe('U1 — extract, never copy', () => {
  it('the editor’s bulk Apply Sync and the batch finalizer both call runFinishPipeline', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toContain('if (liveProjectRef.current.bulkContext)');
    expect(app).toContain('runFinishPipeline({');
    const finishCount = app.split('runFinishPipeline({').length - 1;
    expect(finishCount).toBeGreaterThanOrEqual(2);
  });
});

describe('v1.2.2 owner-id check lives on the extracted pipeline', () => {
  it('refuses a set staged for another project before anything is hashed or saved', async () => {
    const saved: Project[] = [];
    const hashed: string[] = [];
    const result = await runFinishPipeline(baseInput('B', {
      stagedOwnerId: 'A',
      hashScript: async (script, scene) => { hashed.push(`${script}|${scene}`); return 'no'; },
      save: async p => { saved.push(p); },
    }));
    expect(result).toEqual({ ok: false, message: STAGED_FOR_ANOTHER_PROJECT_MESSAGE });
    expect(hashed).toEqual([]);
    expect(saved).toEqual([]);
    expect(stagedOwnerMismatch('B', 'A', stagedFor('B').staged)).toBe(true);
    expect(stagedOwnerMismatch('B', 'B', stagedFor('B').staged)).toBe(false);
  });
});

describe('U2 — background finish is byte-identical to the editor finish', () => {
  it('word timings and provenance match when both callers use runFinishPipeline', async () => {
    const editor = await runFinishPipeline(baseInput('row', { save: undefined }));
    const backgroundSaves: Project[] = [];
    const background = await runFinishPipeline(baseInput('row', {
      save: async p => { backgroundSaves.push(p); },
    }));
    expect(editor.ok).toBe(true);
    expect(background.ok).toBe(true);
    if (!editor.ok || !background.ok) return;
    expect(JSON.stringify(goldenSlice(background.project))).toBe(JSON.stringify(goldenSlice(editor.project)));
    expect(background.project.faWordTimings).toEqual(FA_WORDS);
    expect(background.project.timingProvenance?.alignment?.engine).toBe('fa-cloud');
    expect(background.project.timingProvenance?.transcription?.engine).toBe('whisper-cloud');
    expect(backgroundSaves).toHaveLength(1);
  });
});

describe('U3 — checkpoints resume from the last completed stage', () => {
  it('stagesToRun includes ready as a terminal checkpoint', () => {
    expect(stagesToRun('staged', false)).toEqual(['transcribe', 'align', 'build']);
    expect(stagesToRun('transcript-cached', false)).toEqual(['align', 'build']);
    expect(stagesToRun('aligned', false)).toEqual(['build']);
    expect(stagesToRun('built', false)).toEqual([]);
    expect(stagesToRun('ready', false)).toEqual([]);
  });

  it('records staged → transcript-cached → aligned → built → ready', async () => {
    const seen: string[] = [];
    const result = await runFinishPipeline(baseInput('row', {
      onCheckpoint: c => { seen.push(c); },
    }));
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['staged', 'transcript-cached', 'aligned', 'built', 'ready']);
  });

  it('a crash after built resumes as a free ready mark, without aligning again', async () => {
    const built = await runFinishPipeline(baseInput('row'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const runFa = vi.fn();
    const result = await runFinishPipeline(baseInput('row', {
      project: built.project,
      checkpoint: 'built',
      runFa,
    }));
    expect(result.ok).toBe(true);
    expect(runFa).not.toHaveBeenCalled();
  });

  it('a crash between every stage resumes from that checkpoint (runner)', () => {
    const engine: QueueEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => 'r' };
    const memory = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => { m.set(k, v); },
        removeItem: (k: string) => { m.delete(k); },
      };
    };
    const stagesList = ['staged', 'transcript-cached', 'aligned', 'built'] as const;
    for (const checkpoint of stagesList) {
      const disk = memory();
      disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
        rows: [{ id: 'a', name: 'A', phase: checkpoint === 'built' ? 'finishing' : 'cloud', checkpoint, contentKey: 'h|s|e' }],
      }));
      const seen: string[] = [];
      const runner = new BulkBatchRunner({
        queue: new SyncQueue(engine), exists: () => true, storage: disk,
        enqueue: rows => { seen.push(rows[0]!.checkpoint ?? 'none'); },
      });
      runner.resume();
      if (checkpoint === 'built') {
        expect(seen).toEqual([]);
        expect(runner.snapshot()[0]!.phase).toBe('cloud-done');
        expect(runner.snapshot()[0]!.checkpoint).toBe('built');
      } else {
        expect(seen).toEqual([checkpoint]);
      }
    }
  });
});

describe('U4 — a finished background row is ready to Open, with no project switch', () => {
  it('marks the row done/ready without a switchProject call', async () => {
    const engine: QueueEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => 'r' };
    const disk = {
      getItem: () => JSON.stringify({ rows: [{ id: 'a', name: 'A', phase: 'cloud-done', checkpoint: 'aligned' }] }),
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const switchProject = vi.fn();
    const runner = new BulkBatchRunner({
      queue: new SyncQueue(engine), exists: () => true, storage: disk, enqueue: () => undefined,
    });
    runner.setFinalizer(async id => {
      const result = await runFinishPipeline(baseInput(id));
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    });
    runner.resume();
    await vi.waitFor(() => expect(runner.snapshot()[0]!.phase).toBe('done'));
    expect(runner.snapshot()[0]!.checkpoint).toBe('ready');
    expect(switchProject).not.toHaveBeenCalled();
  });
});

describe('1.3.1 — a finished bulk project carries its staged media', () => {
  const img = (name: string): Asset => ({ id: `a-${name}`, name, url: 'blob:x', type: 'image', addedAt: 2 } as Asset);

  it('staged media files and zips are committed into the project, and the scenes are planned WITH them', async () => {
    const { staged } = stagedFor('m');
    staged.assetFiles = [{ file: new File(['i'], 'one.png'), key: 'k1' }, { file: new File(['j'], 'two.jpg'), key: 'k2' }];
    staged.zipFiles = [{ file: new File(['z'], 'more.zip'), key: 'k3' }];
    const seen: { staged: StagedFiles; before: string[] }[] = [];
    const planned: string[][] = [];
    const result = await runFinishPipeline(baseInput('m', {
      staged,
      persistMedia: async (_pid, st, assets) => {
        seen.push({ staged: st, before: assets.map(a => a.name) });
        return { assets: [...assets, img('one.png'), img('two.jpg'), img('from-zip.png')] };
      },
      stages: { ...stages, parseProjectData: async (_s, _c, assets) => { planned.push(assets.map(a => a.name)); return [segment()]; } },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.staged.assetFiles.map(f => f.file.name)).toEqual(['one.png', 'two.jpg']);
    expect(seen[0]!.staged.zipFiles.map(f => f.file.name)).toEqual(['more.zip']);
    // The voiceover is already in the list the media step adds to (dedup is against everything).
    expect(seen[0]!.before).toEqual(['vo-m.m4a']);
    expect(result.project.assets.map(a => a.name)).toEqual(['vo-m.m4a', 'one.png', 'two.jpg', 'from-zip.png']);
    expect(planned[0]).toEqual(['vo-m.m4a', 'one.png', 'two.jpg', 'from-zip.png']);
    expect(result.project.voiceoverId).toBe('vo-m');
  });

  it('a zip that carries the audio names the voiceover, as the editor does', async () => {
    const { staged } = stagedFor('z');
    const zipAudio = { id: 'zip-audio', name: 'vo.wav', url: 'blob:z', type: 'audio', addedAt: 3, duration: 1, file: new File(['a'], 'vo.wav') } as Asset;
    const result = await runFinishPipeline(baseInput('z', {
      staged: { ...staged, voiceoverFile: null, zipFiles: [{ file: new File(['z'], 'all.zip'), key: 'k' }] },
      persistMedia: async (_pid, _st, assets) => ({ assets: [...assets, zipAudio], voiceoverId: 'zip-audio' }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.voiceoverId).toBe('zip-audio');
  });

  it('both call sites hand the pipeline the editor’s own media step', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    const calls = app.split('runFinishPipeline({').slice(1).map(c => c.slice(0, c.indexOf('});')));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).toContain('persistMedia: persistStagedMedia');
    // …and the editor's own Build Timeline uses that same step (extracted, not copied).
    expect(app).toContain('await persistStagedMedia(projectRef.current.id, staged, allAssets)');
  });
});

describe('1.3.1 — a bulk-built project gets the editor’s sync log', () => {
  it('the run log comes from the injected editor builder (with the run’s real data), then the billing line', async () => {
    const seen: { kept: number; final: number; assets: string[] }[] = [];
    const result = await runFinishPipeline(baseInput('log', {
      stages: {
        ...stages,
        buildRunLog: run => {
          seen.push({ kept: run.kept.length, final: run.finalSegments.length, assets: run.assets.map(a => a.name) });
          return {
            entries: [
              { id: 'w', syncRunId: run.syncRunId, type: 'warning', message: 'pace', timestamp: run.at },
              { id: 'i', syncRunId: run.syncRunId, type: 'info', message: 'Sync completed', timestamp: run.at },
            ],
            silenceErrorCount: 0,
            noAssetCount: 1,
          };
        },
      },
      extraLogEntries: (runId, at) => [{ id: 'b', syncRunId: runId, type: 'info', message: 'Cloud billing (bulk build): 42 s worked · about $0.01.', timestamp: at }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toEqual([{ kept: 1, final: 1, assets: ['vo-log.m4a'] }]);
    expect(result.project.syncLog!.map(e => e.message)).toEqual(['pace', 'Sync completed', 'Cloud billing (bulk build): 42 s worked · about $0.01.']);
    const summary = result.project.syncRunSummaries!.at(-1)!;
    expect(summary.noAssetCount).toBe(1);
    expect(summary.silenceErrorCount).toBe(0);
  });

  it('App wires the editor’s builders (one shared run-log function) and the billing line at both call sites', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toContain('buildRunLog: buildFinishRunLog,');
    const calls = app.split('runFinishPipeline({').slice(1).map(c => c.slice(0, c.indexOf('});')));
    for (const call of calls) expect(call).toMatch(/extraLogEntries: \(runId, at\) => bulkBillingLog\(/);
  });
});
