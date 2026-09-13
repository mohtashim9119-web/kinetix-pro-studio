import { describe, it, expect } from 'vitest';
import type { ExportErrorKind } from '../exportPipeline';
import {
  EXPORT_FAILURE_COPY,
  NEVER_RESUME_KINDS,
  RESUME_UNAVAILABLE_COPY,
} from './exportFailureCopy';

const ALL_KINDS = [
  'cancelled',
  'disk_full',
  'encode',
  'concat',
  'mux',
  'unknown',
  'destination_path',
  'asset_missing',
  'timeline_gap',
  'ffmpeg_load',
  'grade_loss_refused',
] as const satisfies readonly ExportErrorKind[];

type MissingKind = Exclude<ExportErrorKind, (typeof ALL_KINDS)[number]>;
type ExtraKind = Exclude<(typeof ALL_KINDS)[number], ExportErrorKind>;
type _UnionLocked = [MissingKind] extends [never] ? ([ExtraKind] extends [never] ? true : never) : never;
const _unionLocked: _UnionLocked = true;
void _unionLocked;

describe('EXPORT_FAILURE_COPY — total record over ExportErrorKind', () => {
  it('has a title and body for every kind, with no invented names', () => {
    for (const kind of ALL_KINDS) {
      expect(EXPORT_FAILURE_COPY[kind].title.length).toBeGreaterThan(0);
      expect(EXPORT_FAILURE_COPY[kind].body.length).toBeGreaterThan(0);
    }
    expect(Object.keys(EXPORT_FAILURE_COPY).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('shared copy does not name a platform or an unproven GPU pause', () => {
    const joined = ALL_KINDS.map((kind) => {
      const row = EXPORT_FAILURE_COPY[kind];
      return `${row.title} ${row.body}`;
    }).join(' ');
    expect(joined).not.toMatch(/windows/i);
    expect(joined).not.toMatch(/graphics card paused/i);
  });

  it('never-resume kinds are only cancelled and asset_missing', () => {
    expect([...NEVER_RESUME_KINDS]).toEqual(['cancelled', 'asset_missing']);
  });

  it('resume-unavailable copy is kind-agnostic', () => {
    expect(RESUME_UNAVAILABLE_COPY.body).toMatch(/could not be preserved/i);
    expect(RESUME_UNAVAILABLE_COPY.body).not.toMatch(/disk_full|encode|mux/);
  });
});
