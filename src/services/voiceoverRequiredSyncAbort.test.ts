/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  NO_SCENE_DOC_MESSAGE,
  NO_VOICEOVER_MESSAGE,
  emptySceneDocAbortMessage,
} from '../App';
import { classifySyncAbortMessage } from './applySyncAbort';
import {
  armRecoveryBannerFromPersistedProject,
  shouldShowRecoveryBanner,
} from './recoveryBannerVisibility';
import {
  buildUnappliedTranscript,
  salvageTranscriptWithoutTimeline,
  withUnappliedTranscript,
} from './unappliedTranscript';
import { TransitionType, AnimationType, type Project, type TranscriptToken } from '../types';

const APP_TSX = resolve(import.meta.dirname, '../App.tsx');

function tok(text: string, startSec: number): TranscriptToken {
  return { text, startSec, endSec: startSec + 0.4 };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...over,
  };
}

const TOKENS = [tok('hello', 0), tok('world', 0.5)];
const REC = buildUnappliedTranscript(TOKENS, 'asset-1', 'vo.mp3|123|999');

describe('NO_VOICEOVER_MESSAGE — abort classification', () => {
  it('classifies as transcript_unrelated so banner salvage retains tokens', () => {
    expect(classifySyncAbortMessage(NO_VOICEOVER_MESSAGE)).toBe('transcript_unrelated');
  });

  it('scene-doc abort messages are unchanged', () => {
    expect(emptySceneDocAbortMessage(0, '')).toBe(NO_SCENE_DOC_MESSAGE);
    expect(classifySyncAbortMessage(NO_SCENE_DOC_MESSAGE)).toBe('transcript_unrelated');
  });
});

describe('NO_VOICEOVER_MESSAGE — banner salvage path', () => {
  it('salvages tokens, clears unappliedTranscript, and does not re-arm the banner', () => {
    const start = withUnappliedTranscript(project(), REC);
    const after = salvageTranscriptWithoutTimeline(start, REC);
    expect(after.transcriptTokens).toEqual(TOKENS);
    expect(after.unappliedTranscript).toBeUndefined();
    expect(after.segments).toEqual([]);
    expect(shouldShowRecoveryBanner(false, after.unappliedTranscript !== undefined)).toBe(false);
    expect(armRecoveryBannerFromPersistedProject(after.unappliedTranscript !== undefined)).toBe(false);
  });
});

describe('NO_VOICEOVER_MESSAGE — App.tsx wiring (source guards)', () => {
  const PIPE = readFileSync(resolve(import.meta.dirname, './finishPipeline.ts'), 'utf-8');

  it('aborts before parseProjectData when no voiceover asset resolves', () => {
    const voiceoverAbort = PIPE.indexOf('return { ok: false, message: NO_VOICEOVER_FOR_FINISH }');
    const parseCall = PIPE.indexOf('stages.parseProjectData(');
    expect(voiceoverAbort, 'NO_VOICEOVER abort path missing from runBuildTimeline').toBeGreaterThan(-1);
    expect(parseCall, 'parseProjectData call missing').toBeGreaterThan(-1);
    expect(voiceoverAbort).toBeLessThan(parseCall);
  });

  it('panel abort does not reach the segment commit', () => {
    const voiceoverAbort = PIPE.indexOf('NO_VOICEOVER_FOR_FINISH');
    const commit = PIPE.indexOf('segments: finalTimed');
    expect(voiceoverAbort).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(voiceoverAbort);
    expect(PIPE.slice(voiceoverAbort, commit)).not.toContain('segments: committedSegments');
  });

  it('does not fall through to character-based timing without a voiceover', () => {
    const noVoiceoverGuard = PIPE.indexOf('if (!voiceover)');
    expect(noVoiceoverGuard).toBeGreaterThan(-1);
    expect(PIPE.indexOf('NO_VOICEOVER_FOR_FINISH')).toBeGreaterThan(-1);
    expect(PIPE).not.toContain('buildCharacterTimingEntry(');
  });
});
