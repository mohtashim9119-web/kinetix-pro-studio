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
  runBuildTimeline,
  stagedOwnerMismatch,
  STAGED_FOR_ANOTHER_PROJECT_MESSAGE,
  type FinishStages,
  type FinishPipelineInput,
} from './finishPipeline';
import { VOICEOVER_DURATION_ABORT_PREFIX } from './applySyncAbort';
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
  it('the editor’s Apply Sync and the batch finalizer both call runBuildTimeline', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toContain('runBuildTimeline({');
    const finishCount = app.split('runBuildTimeline({').length - 1;
    expect(finishCount).toBeGreaterThanOrEqual(2);
    expect(app).not.toContain('runFinishPipeline({');
  });
});

describe('v1.2.2 owner-id check lives on the extracted pipeline', () => {
  it('refuses a set staged for another project before anything is hashed or saved', async () => {
    const saved: Project[] = [];
    const hashed: string[] = [];
    const result = await runBuildTimeline(baseInput('B', {
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

describe('voiceover probe failures keep a typed cause', () => {
  it('sidecar-blocked is named in the abort, not relabeled as a corrupt file', async () => {
    const result = await runBuildTimeline(baseInput('row', {
      persistVoiceover: async (_pid, file) => ({
        id: 'vo-row', name: file.name, url: 'blob:test', type: 'audio', file, addedAt: 1, duration: 0,
      } as Asset),
      probeDuration: async () => {
        throw new Error('sidecar: resolved exe outside allowed install/dev roots');
      },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.startsWith(VOICEOVER_DURATION_ABORT_PREFIX)).toBe(true);
    expect(result.message).toContain('sidecar-blocked');
    expect(result.message).not.toMatch(/Try re-adding the audio file/);
  });
});

describe('U2 — background finish is byte-identical to the editor finish', () => {
  it('word timings and provenance match when both callers use runBuildTimeline', async () => {
    const editor = await runBuildTimeline(baseInput('row', { save: undefined }));
    const backgroundSaves: Project[] = [];
    const background = await runBuildTimeline(baseInput('row', {
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
    const result = await runBuildTimeline(baseInput('row', {
      onCheckpoint: c => { seen.push(c); },
    }));
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['staged', 'transcript-cached', 'aligned', 'built', 'ready']);
  });

  it('a crash after built resumes as a free ready mark, without aligning again', async () => {
    const built = await runBuildTimeline(baseInput('row'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const runFa = vi.fn();
    const result = await runBuildTimeline(baseInput('row', {
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
      const result = await runBuildTimeline(baseInput(id));
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
    const result = await runBuildTimeline(baseInput('m', {
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
    const result = await runBuildTimeline(baseInput('z', {
      staged: { ...staged, voiceoverFile: null, zipFiles: [{ file: new File(['z'], 'all.zip'), key: 'k' }] },
      persistMedia: async (_pid, _st, assets) => ({ assets: [...assets, zipAudio], voiceoverId: 'zip-audio' }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.voiceoverId).toBe('zip-audio');
  });

  it('both call sites hand the pipeline the editor’s own media step', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toContain('persistMedia: persistStagedMedia');
    expect(app).toContain('bulkBillingLog');
  });
});

describe('1.3.1 — a bulk-built project gets the editor’s sync log', () => {
  it('the run log comes from the injected editor builder (with the run’s real data), then the billing line', async () => {
    const seen: { kept: number; final: number; assets: string[] }[] = [];
    const result = await runBuildTimeline(baseInput('log', {
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
    expect(app).toContain('bulkBillingLog');
  });
});

describe('F4 — cache-hit finish wall time (bulk-only pipeline; park if unify deletes it)', () => {
  it('records per-seam milliseconds on a cache-hit finish', async () => {
    const ms: Record<string, number> = {};
    const wrap = <A extends unknown[], T>(name: string, fn: (...a: A) => Promise<T>) => async (...a: A): Promise<T> => {
      const t0 = performance.now();
      try { return await fn(...a); } finally { ms[name] = performance.now() - t0; }
    };
    const t0 = performance.now();
    const result = await runBuildTimeline(baseInput('f4', {
      persistVoiceover: wrap('persistVoiceover', async (_pid, file) => ({
        id: 'vo-f4', name: file.name, url: 'blob:test', type: 'audio', file, addedAt: 1, duration: 1,
      } as Asset)),
      persistMedia: wrap('persistMedia', async (_pid, _st, assets) => ({ assets })),
      lookupTranscript: wrap('lookupTranscript', async () => ({ tokens: TOKENS, language: 'en' })),
      runFa: wrap('runFa', async () => ({
        status: 'ok' as const,
        tokens: FA_WORDS,
        unscriptedRuns: [],
        cloudProvenance: { engine: 'fa-cloud', model: 'fa-en', modelVersion: 'rev-1' },
        cloudCached: true,
      })),
      alignFromCache: wrap('alignFromCache', async () => aligned()),
      stages: {
        ...stages,
        parseProjectData: wrap('parse', async () => [segment()]),
      },
    }));
    ms.total = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.info('[F4 cache-hit finish ms]', ms);
    expect(result.ok).toBe(true);
    expect(ms.total).toBeGreaterThan(0);
  });
});

function paritySlice(p: Project): unknown {
  return {
    segments: p.segments.map(s => ({
      order: s.order,
      startTime: s.startTime,
      duration: s.duration,
      text: s.text,
      assetId: s.assetId,
      locked: !!s.locked,
      effectGrade: s.effectGrade ?? null,
    })),
    faWordTimings: p.faWordTimings,
    transcriptTokens: p.transcriptTokens,
    timingProvenance: p.timingProvenance,
    lastSyncSpine: p.lastSyncSpine,
    findings: [
      ...(p.timingProvenance?.transcription?.findings ?? []),
      ...(p.timingProvenance?.alignment?.findings ?? []),
    ],
    logs: (p.syncLog ?? []).map(e => ({ type: e.type, message: e.message })),
  };
}

describe('P4 — no-difference gate: editor door === bulk door', () => {
  it('the word-timings-only slice is replaced by a full project slice', async () => {
    const editor = await runBuildTimeline(baseInput('row', { save: undefined }));
    const bulkSaves: Project[] = [];
    const bulk = await runBuildTimeline(baseInput('row', { save: async p => { bulkSaves.push(p); } }));
    expect(editor.ok && bulk.ok).toBe(true);
    if (!editor.ok || !bulk.ok) return;
    expect(JSON.stringify(paritySlice(bulk.project))).toBe(JSON.stringify(paritySlice(editor.project)));
    expect(bulkSaves).toHaveLength(1);
  });

  it('14-segment amount fixture: both doors match on segments, timings, boundaries, findings, provenance, logs', async () => {
    const { parseProjectData } = await import('../App');
    const repo = resolve(import.meta.dirname, '../..');
    const script = readFileSync(resolve(repo, 'scripts/fixtures/amount-14seg-script.txt'), 'utf-8');
    const scene = readFileSync(resolve(repo, 'scripts/fixtures/amount-14seg-scene-details.txt'), 'utf-8');
    const tokens = JSON.parse(
      readFileSync(resolve(repo, 'scripts/fixtures/amount-14seg-cloud-tokens.json'), 'utf-8'),
    ).tokens as TranscriptToken[];
    const tags = Array.from({ length: 14 }, (_, i) => String(i + 2).padStart(3, '0')).map((n, i) => {
      const names = [
        'age_24', 'year_2003', 'savings_account', 'need_a_car', 'used_lot', 'saturday_april',
        'salesman_walks', 'civic_stats', 'technically_gray', 'cloth_seats', 'tape_deck',
        'cd_adapter', 'pay_cash', 'drive_home',
      ];
      return `${n}_${names[i]}`;
    });
    const media: Asset[] = tags.map(n => ({
      id: `img-${n}`, name: `${n}.jpg`, url: 'blob:x', type: 'image', addedAt: 2,
    } as Asset));
    const duration = 32.69;
    const cover = (segs: VideoSegment[]) => segs.map(s => ({
      t0: s.startTime, t1: s.startTime + s.duration, firstTokenIdx: 0, lastTokenIdx: tokens.length - 1,
      confidence: 1, matched: true, matchedWords: 2, totalWords: 2, longestRun: 2,
    }));
    const extras: Partial<FinishPipelineInput> = {
      persistMedia: async (_pid, _st, assets) => ({ assets: [...assets, ...media] }),
      probeDuration: async () => duration,
      persistVoiceover: async (_pid, file) => ({
        id: 'vo-14', name: file.name, url: 'blob:test', type: 'audio', file, addedAt: 1, duration,
      } as Asset),
      lookupTranscript: async () => ({ tokens, language: 'en' }),
      runFa: async () => ({
        status: 'ok' as const,
        tokens,
        unscriptedRuns: [],
        cloudProvenance: { engine: 'fa-cloud', model: 'fa-en', modelVersion: 'rev-1' },
        cloudCached: true,
      }),
      alignFromCache: async (_vo, segs, toks) => ({
        segments: segs, coverage: cover(segs), silences: [], tokens: toks,
        malformedTokenCount: 0, totalTokenCount: toks.length,
      }),
      hashAudio: async () => 'audio-14seg',
      hashScript: async () => 'script-14seg',
      stages: {
        ...stages,
        parseProjectData: async (s, c, assets, dur) => parseProjectData(s, c, assets, dur),
      },
      staged: {
        scriptFile: { file: new File([script], 'script.txt', { type: 'text/plain' }), key: 's' },
        sceneFile: { file: new File([scene], 'scenes.txt', { type: 'text/plain' }), key: 'c' },
        voiceoverFile: { file: new File(['audio'], 'vo.m4a', { type: 'audio/mp4' }), key: 'v' },
        assetFiles: [],
        zipFiles: [],
      },
    };
    const editor = await runBuildTimeline(baseInput('amt', extras));
    const bulk = await runBuildTimeline(baseInput('amt', { ...extras, save: async () => undefined }));
    expect(editor.ok && bulk.ok).toBe(true);
    if (!editor.ok || !bulk.ok) return;
    expect(editor.project.segments).toHaveLength(14);
    expect(JSON.stringify(paritySlice(bulk.project))).toBe(JSON.stringify(paritySlice(editor.project)));
    expect(editor.project.segments.every(s => s.assetId)).toBe(true);
  });

  it('autoMatch + locked scenes: both doors restore the lock and the effect', async () => {
    const clip = { id: 'clip-1', name: 'hello.jpg', url: 'blob:x', type: 'image', addedAt: 2 } as Asset;
    const previous: VideoSegment[] = [{
      ...segment(),
      assetId: 'clip-1',
      locked: true,
      startTime: 0,
      duration: 1,
      effectGrade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0.3 },
    }];
    const extras: Partial<FinishPipelineInput> = {
      project: { ...project('lock'), segments: previous } as Project,
      persistMedia: async (_pid, _st, assets) => ({ assets: [...assets, clip] }),
      stages: {
        ...stages,
        parseProjectData: async () => [{ ...segment(), id: 'fresh', assetId: undefined }],
      },
    };
    const editor = await runBuildTimeline(baseInput('lock', extras));
    const bulk = await runBuildTimeline(baseInput('lock', { ...extras, save: async () => undefined }));
    expect(editor.ok && bulk.ok).toBe(true);
    if (!editor.ok || !bulk.ok) return;
    expect(JSON.stringify(paritySlice(bulk.project))).toBe(JSON.stringify(paritySlice(editor.project)));
    expect(editor.project.segments[0]!.assetId).toBe('clip-1');
    expect(editor.project.segments[0]!.locked).toBe(true);
    expect(editor.project.segments[0]!.effectGrade?.temperature).toBe(0.3);
  });
});

describe('progress events and post-save voiceover release', () => {
  it('emits stage progress messages', async () => {
    const seen: string[] = [];
    const result = await runBuildTimeline(baseInput('p', { onProgress: m => { seen.push(m); } }));
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['Reading files…', 'Planning scenes…', 'Aligning…', 'Placing boundaries…', 'Saving…']);
  });

  it('releases the outgoing voiceover only after save', async () => {
    const order: string[] = [];
    const old = { id: 'old-vo', name: 'old.m4a', url: 'blob:old', type: 'audio', addedAt: 1 } as Asset;
    const result = await runBuildTimeline(baseInput('rel', {
      project: { ...project('rel'), voiceoverId: 'old-vo', assets: [old] } as Project,
      save: async () => { order.push('save'); },
      releaseSupersededVoiceover: () => { order.push('release'); },
    }));
    expect(result.ok).toBe(true);
    expect(order).toEqual(['save', 'release']);
    if (result.ok) expect(result.supersededVoiceover?.id).toBe('old-vo');
  });
});
