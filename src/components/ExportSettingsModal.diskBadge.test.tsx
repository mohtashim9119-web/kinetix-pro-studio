// @vitest-environment jsdom
/**
 * Q2 (Round 28 quick-close batch): the export settings modal must show a
 * live "estimated export size" badge, computed from
 * `estimateExportDestinationDiskBytes` in diskFull.ts (not a re-derived
 * local calculation) — the frozen 1680s/8000kbps triplet
 * (1,720,320,000 bytes) is the pin.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExportSettingsModal } from './ExportSettingsModal';
import { estimateExportDestinationDiskBytes, formatBytes } from '../services/webcodecsExport/diskFull';

describe('ExportSettingsModal — Q2 disk size badge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the estimator's own formatted output, not a duplicated calculation", async () => {
    const durationSeconds = 1680;
    await act(async () => {
      root.render(
        <ExportSettingsModal
          aspectRatio="16:9"
          exportResolution="1080p"
          exportFps={30}
          mixedNativeFpsWarning={false}
          durationSeconds={durationSeconds}
          hasAudio={true}
          onContinue={() => {}}
          onCancel={() => {}}
        />,
      );
    });
    const expected = estimateExportDestinationDiskBytes({
      bitrateKbps: 8000,
      durationSeconds,
      hasAudio: true,
    });
    // Frozen pin: 1680s @ 8000kbps with audio = 1,720,320,000 raw bytes.
    expect(expected.videoBytes + expected.audioBytes).toBe(1_720_320_000);

    const badge = container.querySelector('[data-testid="export-size-estimate"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain(formatBytes(expected.destinationRequiredBytes));
  });
});
