/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { Asset, Project } from '../types';
import type { StagedFiles } from '../components/DropZonePanel';
import { resetBuiltRecord, verifyBulkRecords, type BulkRepairDeps } from './bulkRepair';

const staged = (tag: string): StagedFiles => ({
  scriptFile: { file: new File([`script ${tag}`], `script-${tag}.txt`), key: `s${tag}` },
  sceneFile: { file: new File([`[Scene 1] ${tag}`], `scenes-${tag}.txt`), key: `c${tag}` },
  voiceoverFile: { file: new File([`audio ${tag}`], `vo-${tag}.m4a`), key: `v${tag}` },
  assetFiles: [],
  zipFiles: [],
});

const asset = (id: string, addedAt: number | undefined, contentHash?: string): Asset =>
  ({ id, name: id, url: '', type: id.startsWith('vo') ? 'audio' : 'image', addedAt, contentHash } as Asset);

/** A record as the v1.2.1 finish left it: built from `source`'s files. */
function built(id: string, own: string, source: string): Project {
  return {
    id, name: `Row ${own}`, confirmed: true, bulkContext: true,
    script: `script ${source}`, sceneDetails: `[Scene 1] ${source}`,
    segments: [{ id: `seg-${source}`, assetId: `media-${source}` }],
    headings: [],
    // Own bundle media (drop time), then what the build added.
    assets: [asset(`bundle-${own}`, 100, `h-bundle-${own}`), asset(`vo-${source}@${id}`, 500), asset(`media-${source}@${id}`, 501, `h-media-${source}`)],
    voiceoverId: `vo-${source}@${id}`,
    transcriptTokens: [{ text: source, start: 0, end: 1 }],
    lastTranscribedAudioHash: `audio:audio ${source}`,
    lastSyncSpine: { audioHash: `audio:audio ${source}`, scriptHash: `script:script ${source}|[Scene 1] ${source}` },
    timingProvenance: { transcription: { engine: 'whisper-cloud' } },
  } as unknown as Project;
}

function deps(records: Map<string, Project>, stagedById: Map<string, StagedFiles>) {
  const loads: string[] = [];
  const dropped: { projectId: string; id: string }[] = [];
  const d: BulkRepairDeps = {
    load: async id => { loads.push(id); return records.get(id) ?? null; },
    loadStaged: async id => stagedById.get(id) ?? null,
    readText: f => f.text(),
    hashAudio: async f => `audio:${await f.text()}`,
    hashScript: async (s, c) => `script:${s}|${c}`,
    save: vi.fn(async (p: Project) => { records.set(p.id, p); return { ok: true }; }),
    dropAsset: async (projectId, a) => { dropped.push({ projectId, id: a.id }); },
  };
  return { d, loads, dropped };
}

describe('bulk records — verified and repaired from their OWN inputs', () => {
  it('row 1 is ok; rows 2 and 3 (built from row 1) are reset to their own pre-build state', async () => {
    const records = new Map([
      ['p1', built('p1', '1', '1')],
      ['p2', built('p2', '2', '1')],
      ['p3', built('p3', '3', '1')],
    ]);
    const stagedById = new Map([['p1', staged('1')], ['p2', staged('2')], ['p3', staged('3')]]);
    const { d, loads, dropped } = deps(records, stagedById);

    const verdicts = await verifyBulkRecords(['p1', 'p2', 'p3'], d);
    expect(verdicts.map(v => [v.id, v.status])).toEqual([['p1', 'ok'], ['p2', 'repaired'], ['p3', 'repaired']]);
    // Each record was read for itself only — nothing is copied across records.
    expect(loads).toEqual(['p1', 'p2', 'p3']);

    for (const [id, own] of [['p2', '2'], ['p3', '3']] as const) {
      const r = records.get(id)!;
      expect(r.segments).toEqual([]);
      expect(r.script).toBe('');
      expect(r.sceneDetails).toBe('');
      expect(r.lastSyncSpine).toBeUndefined();
      expect(r.transcriptTokens).toBeUndefined();
      expect(r.voiceoverId).toBeUndefined();
      expect(r.timingProvenance).toBeUndefined();
      expect(r.bulkContext).toBe(true);
      expect(r.name).toBe(`Row ${own}`);
      // Its own bundle media stays; row 1's voiceover and media are gone.
      expect(r.assets.map(a => a.id)).toEqual([`bundle-${own}`]);
      expect(JSON.stringify(r)).not.toContain('script 1');
    }
    expect(dropped).toEqual([
      { projectId: 'p2', id: 'vo-1@p2' }, { projectId: 'p2', id: 'media-1@p2' },
      { projectId: 'p3', id: 'vo-1@p3' }, { projectId: 'p3', id: 'media-1@p3' },
    ]);
    // Row 1 was never written.
    expect((d.save as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as Project).id)).toEqual(['p2', 'p3']);
  });

  it('a record whose own staged files are gone, or that is not built, is left alone', async () => {
    const records = new Map([['p2', built('p2', '2', '1')], ['p4', { ...built('p4', '4', '4'), lastSyncSpine: undefined }]]);
    const { d } = deps(records, new Map());
    const verdicts = await verifyBulkRecords(['p2', 'p4', 'missing'], d);
    expect(verdicts.map(v => v.status)).toEqual(['unverifiable', 'unverifiable', 'unverifiable']);
    expect(d.save).not.toHaveBeenCalled();
  });

  it('a refused save is reported, and nothing is dropped', async () => {
    const records = new Map([['p2', built('p2', '2', '1')]]);
    const { d, dropped } = deps(records, new Map([['p2', staged('2')]]));
    d.save = async () => ({ ok: false });
    const [v] = await verifyBulkRecords(['p2'], d);
    expect(v!.status).toBe('repair-failed');
    expect(dropped).toEqual([]);
  });

  it('reset keeps assets added before the build and those with no timestamp', () => {
    const p = built('p2', '2', '1');
    p.assets.push(asset('legacy', undefined));
    const { project, dropped } = resetBuiltRecord(p);
    expect(project.assets.map(a => a.id)).toEqual(['bundle-2', 'legacy']);
    expect(dropped.map(a => a.id)).toEqual(['vo-1@p2', 'media-1@p2']);
  });
});
