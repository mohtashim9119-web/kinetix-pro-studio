// @vitest-environment jsdom
/**
 * plan-v3 Wave 1 item 8 — provenance stamp + projectStore v4→v5.
 *
 * Fixture proofs:
 *  - a v4 project with tokens loads as engine-unknown and saves as v5
 *  - a new Whisper/FA stamp records the engine that actually ran
 *  - no writer infers an engine from the FA toggle or from token presence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { saveProject, loadProject } from './projectStore';
import {
  describeTimingEngine,
  migrateLegacyTimingProvenance,
  stampFaProvenance,
  stampWhisperProvenance,
  unknownTimingProvenance,
  WHISPER_MODEL_ID,
  WHISPER_MODEL_VERSION,
  TIMING_PROVENANCE_SCHEMA_VERSION,
} from './timingProvenance';
import { AnimationType, TransitionType } from '../types';
import type { Project, TranscriptToken } from '../types';

const PROJECT_KEY = (id: string): string => `kinetix:project:${id}:v1`;

function baseProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-prov-v5',
    name: 'provenance fixture',
    script: 'hello',
    sceneDetails: 'hello',
    segments: [{
      id: 's0',
      text: 'hello',
      order: 0,
      startTime: 0,
      duration: 1,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
    }],
    assets: [],
    headings: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    ...over,
  };
}

const TOKEN: TranscriptToken = { text: 'hello', startSec: 0, endSec: 0.4 };

function writeV4Envelope(id: string, project: Project): void {
  localStorage.setItem(PROJECT_KEY(id), JSON.stringify({
    version: 4,
    savedAt: 1,
    project,
  }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('legacy v4 load — engine-unknown, never a guess', () => {
  it('a v4 project with transcriptTokens loads as engine-unknown and saves as v5', async () => {
    const legacy = baseProject({
      transcriptTokens: [TOKEN],
      faHighPrecisionSync: true,
    });
    writeV4Envelope(legacy.id, legacy);

    const loaded = await loadProject(legacy.id);
    expect(loaded, 'v4 fixture must load').not.toBeNull();
    expect(loaded!.project.timingProvenance?.transcription?.engine).toBe('unknown');
    expect(loaded!.project.timingProvenance?.transcription?.model).toBe('unknown');
    expect(loaded!.project.timingProvenance?.transcription?.modelVersion).toBe('unknown');
    expect(loaded!.project.timingProvenance?.transcription?.schemaVersion)
      .toBe(TIMING_PROVENANCE_SCHEMA_VERSION);
    expect(describeTimingEngine(loaded!.project.timingProvenance?.transcription?.engine))
      .toBe('Engine not recorded (synced before engine tracking)');
    // FA toggle ON is not evidence of what ran (D24) — never guessed as 'fa'.
    expect(loaded!.project.timingProvenance?.transcription?.engine).not.toBe('fa');
    expect(loaded!.project.timingProvenance?.transcription?.engine).not.toBe('whisper');
    expect(loaded!.project.timingProvenance?.alignment).toBeUndefined();

    await saveProject(loaded!.project);
    const raw = JSON.parse(localStorage.getItem(PROJECT_KEY(legacy.id))!) as {
      version: number;
      project: Project;
    };
    expect(raw.version).toBe(5);
    expect(raw.project.timingProvenance?.transcription?.engine).toBe('unknown');
  });

  it('a v4 project with faWordTimings labels alignment engine-unknown too', async () => {
    const legacy = baseProject({
      transcriptTokens: [TOKEN],
      faWordTimings: [{ ...TOKEN, wordIndex: 0, confidence: 0.9 }],
    });
    writeV4Envelope(legacy.id, legacy);

    const loaded = await loadProject(legacy.id);
    expect(loaded!.project.timingProvenance?.transcription?.engine).toBe('unknown');
    expect(loaded!.project.timingProvenance?.alignment?.engine).toBe('unknown');
    expect(describeTimingEngine(loaded!.project.timingProvenance?.alignment?.engine))
      .toBe('Engine not recorded (synced before engine tracking)');
  });

  it('a v4 project with no timing arrays gains no invented provenance', async () => {
    const legacy = baseProject();
    writeV4Envelope(legacy.id, legacy);
    const loaded = await loadProject(legacy.id);
    expect(loaded!.project.timingProvenance).toBeUndefined();
  });

  it('migrateLegacyTimingProvenance never reads the FA toggle or anchorSource', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'timingProvenance.ts'), 'utf-8');
    const fnStart = src.indexOf('export function migrateLegacyTimingProvenance');
    const fnEnd = src.indexOf('function hasTokens', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).not.toMatch(/faHighPrecisionSync/);
    expect(body).not.toMatch(/anchorSource/);
    expect(body).toContain("unknownTimingProvenance");
  });
});

describe('new-run stamps record the engine that actually ran', () => {
  it('a new Whisper stamp is whisper + model id/version + schema version', async () => {
    const stamp = stampWhisperProvenance({ language: 'en', completedAt: 42 });
    expect(stamp.engine).toBe('whisper');
    expect(stamp.model).toBe(WHISPER_MODEL_ID);
    expect(stamp.modelVersion).toBe(WHISPER_MODEL_VERSION);
    expect(stamp.schemaVersion).toBe(TIMING_PROVENANCE_SCHEMA_VERSION);
    expect(stamp.language).toBe('en');
    expect(stamp.degraded).toBeUndefined();

    const project = baseProject({
      transcriptTokens: [TOKEN],
      timingProvenance: { transcription: stamp },
    });
    await saveProject(project);
    const loaded = await loadProject(project.id);
    expect(loaded!.project.timingProvenance?.transcription).toEqual(stamp);
  });

  it('a new FA stamp is fa, and a degraded Whisper-only run stays whisper + degraded', () => {
    const fa = stampFaProvenance({ language: 'en', completedAt: 9 });
    expect(fa.engine).toBe('fa');
    expect(fa.model).toBe('fa-en');
    expect(fa.modelVersion).toBe('569a6236e92bd5f7652a0420bfe9bb94c5664080');

    const degraded = stampWhisperProvenance({
      language: 'en',
      completedAt: 9,
      degraded: { kind: 'user-chose-whisper' },
    });
    expect(degraded.engine).toBe('whisper');
    expect(degraded.degraded?.kind).toBe('user-chose-whisper');
    expect(degraded.engine).not.toBe('fa');
  });

  it('unknownTimingProvenance is never whisper or fa', () => {
    const u = unknownTimingProvenance();
    expect(u.engine).toBe('unknown');
    expect(u.model).toBe('unknown');
    expect(u.modelVersion).toBe('unknown');
  });
});

describe('Apply Sync commit writes provenance in the same object as faWordTimings', () => {
  it('the atomic setProject literal includes timingProvenance next to faWordTimings', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    const commit = app.indexOf('// 8. Single atomic state update');
    expect(commit, 'atomic commit marker missing').toBeGreaterThan(-1);
    const end = app.indexOf('}));', commit);
    const body = app.slice(commit, end);
    expect(body).toContain('faWordTimings:');
    expect(body).toContain('timingProvenance:');
  });

  it('useWhisper writes transcription provenance in the same update as transcriptTokens', () => {
    const src = readFileSync(resolve(import.meta.dirname, '..', 'hooks', 'useWhisper.ts'), 'utf-8');
    const start = src.indexOf('onProjectUpdated(p => ({');
    expect(start, 'useWhisper token commit missing').toBeGreaterThan(-1);
    const end = src.indexOf('}));', start);
    const body = src.slice(start, end);
    expect(body).toContain('transcriptTokens: tokens');
    expect(body).toContain('timingProvenance:');
    expect(body).toContain('stampWhisperProvenance');
  });
});
