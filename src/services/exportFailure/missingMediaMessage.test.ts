import { describe, it, expect, vi } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import {
  buildMissingMediaMessage,
  buildUnassignedMediaWarning,
  findMissingMediaSegmentNumbers,
  findUnassignedSegmentNumbers,
} from './missingMediaMessage';

vi.mock('../segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1])),
}));
import { exportProject } from '../exportPipeline';
import type { FfmpegLike } from '../segmentEncoder';

const seg = (n: number, assetId?: string): VideoSegment => ({
  id: `seg-uuid-${n}`, text: '', startTime: n, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: n, assetId,
});

describe('buildMissingMediaMessage', () => {
  it('uses the exact plain shape', () => {
    expect(buildMissingMediaMessage([3, 7, 9]))
      .toBe('Export blocked: media is missing for segments 3, 7, 9. Add it to unblock export.');
  });
  it('lists the first 10 then "+N more"', () => {
    const nums = Array.from({ length: 15 }, (_, i) => i + 1);
    expect(buildMissingMediaMessage(nums)).toBe(
      'Export blocked: media is missing for segments 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 +5 more. Add it to unblock export.',
    );
  });
  it('exactly 10 has no "+N more"', () => {
    const nums = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(buildMissingMediaMessage(nums)).not.toContain('more');
  });
});

describe('findMissingMediaSegmentNumbers', () => {
  it('returns 1-based timeline numbers; unassigned segments are not missing', () => {
    const assets = new Map<string, Asset>([['a', { id: 'a', name: 'a', url: 'blob:a', type: 'image' } as Asset]]);
    const segments = [seg(0, 'a'), seg(1), seg(2, 'gone'), seg(3, 'a'), seg(4, 'a-nourl')];
    assets.set('a-nourl', { id: 'a-nourl', name: 'x', url: '', type: 'image' } as Asset);
    expect(findMissingMediaSegmentNumbers(segments, assets)).toEqual([3, 5]);
  });
});

describe('exportProject — missing media', () => {
  it('headline is plain with all missing segment numbers; technical detail goes to cause', async () => {
    const project = {
      id: 'p', name: 'p', script: '', sceneDetails: '',
      segments: [seg(0, 'gone1'), seg(1), seg(2, 'gone2')],
      assets: [], globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
      globalAnimation: AnimationType.NONE,
      globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    } as unknown as Project;
    const r = await exportProject(project, {} as FfmpegLike);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('asset_missing');
    expect(r.error.message).toBe('Export blocked: media is missing for segments 1, 3. Add it to unblock export.');
    expect(r.error.cause ?? '').not.toContain('seg-uuid');
  });
});

describe('unassigned-media pre-export warning', () => {
  it('finds 1-based numbers of segments with no assetId only', () => {
    expect(findUnassignedSegmentNumbers([seg(0, 'a'), seg(1), seg(2, 'gone'), seg(3)])).toEqual([2, 4]);
    expect(findUnassignedSegmentNumbers([seg(0, 'a'), seg(1, 'b')])).toEqual([]);
  });
  it('uses the exact plural copy', () => {
    expect(buildUnassignedMediaWarning([3, 7])).toBe(
      'Segments 3, 7 have no media and will export as black frames, using slower export path. Add media or continue.',
    );
  });
  it('uses singular for one segment', () => {
    expect(buildUnassignedMediaWarning([3])).toBe(
      'Segment 3 has no media and will export as black frames, using slower export path. Add media or continue.',
    );
  });
  it('caps at 10 then "+N more"', () => {
    const nums = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(buildUnassignedMediaWarning(nums)).toContain('1, 2, 3, 4, 5, 6, 7, 8, 9, 10 +2 more have no media');
  });
});
