/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS2 ws2-26 Commit 2 — the Forced Restore confirmation modal. Static-markup
// pattern (renderToStaticMarkup, no DOM/testing-library dependency), same as
// SyncLogPanel.test.tsx / timeline.render.test.tsx.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForceRestoreConfirmModal } from './ForceRestoreConfirmModal';
import type { PendingForceRestoreCluster } from '../services/absorbedGapRestore';

function cluster(overrides: Partial<PendingForceRestoreCluster> = {}): PendingForceRestoreCluster {
  return {
    hostId: 'host-1',
    gapSegmentIds: ['d1'],
    items: [{ segmentId: 'd1', text: '"The blue monkey jumped over the moon".' }],
    ...overrides,
  };
}

describe('ForceRestoreConfirmModal', () => {
  it('names a single segment in the singular and lists its text plus the evidence disclosure', () => {
    const html = renderToStaticMarkup(
      <ForceRestoreConfirmModal clusters={[cluster()]} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(html).toContain('Force restore this scene?');
    expect(html).toContain('The blue monkey jumped over the moon');
    expect(html).toContain('0 matched words');
    expect(html).toContain('no timestamp data');
  });

  it('names a multi-segment batch in the plural and lists every row exactly once', () => {
    const clusters: PendingForceRestoreCluster[] = [
      cluster({
        hostId: 'host-1',
        gapSegmentIds: ['d1', 'd2', 'd3'],
        items: [
          { segmentId: 'd1', text: 'But something stayed in you.' },
          { segmentId: 'd2', text: 'Small and permanent.' },
          { segmentId: 'd3', text: 'A new understanding of what the night actually is.' },
        ],
      }),
      cluster({ hostId: 'host-2', gapSegmentIds: ['d4'], items: [{ segmentId: 'd4', text: 'Unheard line.' }] }),
    ];
    const html = renderToStaticMarkup(
      <ForceRestoreConfirmModal clusters={clusters} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(html).toContain('Force restore 4 scenes?');
    for (const text of ['But something stayed in you.', 'Small and permanent.', 'A new understanding of what the night actually is.', 'Unheard line.']) {
      expect(html).toContain(text);
    }
    // One row per item, not one modal per cluster/row — the per-row badge
    // ("0 matched words · no timestamp data") is distinct from the shared
    // intro paragraph's own single mention of the same evidence.
    expect((html.match(/0 matched words · no timestamp data/g) ?? []).length).toBe(4);
  });

  it('renders exactly one Cancel and one Force Restore control', () => {
    const html = renderToStaticMarkup(
      <ForceRestoreConfirmModal clusters={[cluster()]} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect((html.match(/>Cancel</g) ?? []).length).toBe(1);
    expect((html.match(/>Force Restore</g) ?? []).length).toBe(1);
  });

  it('accepts distinct onCancel/onConfirm callbacks without invoking either at render time', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderToStaticMarkup(
      <ForceRestoreConfirmModal clusters={[cluster()]} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
