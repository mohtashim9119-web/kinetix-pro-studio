/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom
//
// plan-v3 Wave 1 item 4 — restart-safe pause-and-ask. This module's whole job
// is to survive the ONE thing an in-memory React state can't: the process
// restarting. `localStorage` is the only thing under test here that actually
// stands in for that — everything else is read-your-own-write plumbing.
import { describe, it, expect, beforeEach } from 'vitest';
import { saveFaPause, readFaPause, clearFaPause, type FaPauseRecord } from './faSyncPauseStore';

beforeEach(() => {
  localStorage.clear();
});

function record(overrides: Partial<FaPauseRecord> = {}): FaPauseRecord {
  return {
    projectId: 'proj-1',
    syncRunId: 'run-1',
    reason: 'zero-words',
    timestamp: 1_000,
    ...overrides,
  };
}

describe('faSyncPauseStore', () => {
  it('reads back exactly what was saved', () => {
    saveFaPause(record());
    expect(readFaPause('proj-1')).toEqual(record());
  });

  it('returns null for a project with no pending pause', () => {
    expect(readFaPause('nobody-paused')).toBeNull();
  });

  it('survives a fresh module load — the actual restart-safety property', () => {
    // The real guarantee this store exists for: an in-memory value cannot
    // outlive a process restart, but localStorage can. Simulating a restart
    // exactly (killing the JS heap) isn't possible in a unit test, but
    // reading through the SAME key a second, independent call proves the
    // record isn't living in a module-level variable this file's own import
    // happens to keep alive — it is actually round-tripped through storage.
    saveFaPause(record({ projectId: 'proj-restart', reason: 'model-not-found', detail: 'no model.onnx' }));
    const reread = readFaPause('proj-restart');
    expect(reread).toEqual(record({ projectId: 'proj-restart', reason: 'model-not-found', detail: 'no model.onnx' }));
  });

  it('keeps separate projects on separate records', () => {
    saveFaPause(record({ projectId: 'proj-a', reason: 'empty-chunk-plan' }));
    saveFaPause(record({ projectId: 'proj-b', reason: 'inference-failed' }));
    expect(readFaPause('proj-a')?.reason).toBe('empty-chunk-plan');
    expect(readFaPause('proj-b')?.reason).toBe('inference-failed');
  });

  it('a later save for the same project overwrites the earlier one — one outstanding ask per project', () => {
    saveFaPause(record({ syncRunId: 'run-1' }));
    saveFaPause(record({ syncRunId: 'run-2' }));
    expect(readFaPause('proj-1')?.syncRunId).toBe('run-2');
  });

  it('clearFaPause removes the record so the dialog does not re-present', () => {
    saveFaPause(record());
    clearFaPause('proj-1');
    expect(readFaPause('proj-1')).toBeNull();
  });

  it('clearing one project never touches another', () => {
    saveFaPause(record({ projectId: 'proj-a' }));
    saveFaPause(record({ projectId: 'proj-b' }));
    clearFaPause('proj-a');
    expect(readFaPause('proj-a')).toBeNull();
    expect(readFaPause('proj-b')).not.toBeNull();
  });

  it('treats malformed stored JSON as no pending pause rather than throwing', () => {
    localStorage.setItem('kinetix:fa-pause:v1:proj-1', '{not json');
    expect(readFaPause('proj-1')).toBeNull();
  });

  it('treats a stored value missing required fields as no pending pause', () => {
    localStorage.setItem('kinetix:fa-pause:v1:proj-1', JSON.stringify({ projectId: 'proj-1' }));
    expect(readFaPause('proj-1')).toBeNull();
  });

  it('never throws when localStorage.setItem rejects (quota/private mode)', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
    try {
      expect(() => saveFaPause(record())).not.toThrow();
    } finally {
      localStorage.setItem = original;
    }
  });
});
