import { describe, it, expect } from 'vitest';
import { preflightBulkExport, BULK_EXPORT_OFFLINE, BULK_EXPORT_SOFT_FLAG } from './bulkExportPreflight';
import { findMediaIssues } from './exportFailure/missingMediaMessage';
import type { Asset, VideoSegment } from '../types';

const seg = (id: string, assetId?: string): VideoSegment => ({
  id, startTime: 0, duration: 1, assetId, text: '',
} as VideoSegment);

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, name: id, type: 'image', url: extra.url ?? 'blob:x', ...extra,
} as Asset);

describe('preflightBulkExport — reuses findMediaIssues', () => {
  it('blocks offline media and never includes the row', () => {
    const segments = [seg('s1', 'a1')];
    const assets = [asset('a1', { url: '', unresolved: true })];
    expect(findMediaIssues(segments, assets).offline).toEqual([1]);
    const r = preflightBulkExport(segments, assets);
    expect(r).toMatchObject({ kind: 'block', message: BULK_EXPORT_OFFLINE });
  });

  it('flags missing/damaged media but still includes (Start was clicked)', () => {
    const segments = [seg('s1'), seg('s2', 'a2')];
    const assets = [asset('a2', { corrupt: 'image-decode', url: 'blob:ok' })];
    const r = preflightBulkExport(segments, assets);
    expect(r.kind).toBe('include');
    if (r.kind === 'include') expect(r.flags).toContain(BULK_EXPORT_SOFT_FLAG);
  });

  it('does not copy findMediaIssues — same object shape from the shared helper', () => {
    const segments = [seg('s1', 'a1')];
    const assets = [asset('a1')];
    const issues = findMediaIssues(segments, assets);
    const r = preflightBulkExport(segments, assets);
    expect(r.kind).toBe('include');
    if (r.kind === 'include') expect(r.issues).toEqual(issues);
  });
});
