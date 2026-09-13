// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ExportSettingsModal, type ExportModalChoice } from './ExportSettingsModal';
import { createFakeExportTargetFs, type ExportTargetFs } from '../services/exportTargetFs';
import { DEFAULT_EXPORT_BITRATE_KBPS, estimateExportOutputBytes } from '../services/exportOutputEstimate';
import { formatBytes } from '../services/webcodecsExport/diskFull';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const D28 = 28 * 60;

function fakeFs(overrides: Parameters<typeof createFakeExportTargetFs>[0] = {}): ExportTargetFs {
  return createFakeExportTargetFs({
    pickedDirectory: '/Users/name/Movies',
    freeSpace: {
      path: '/Users/name/Movies',
      probedPath: '/Users/name/Movies',
      volumeKey: 'fake:movies',
      availableBytes: 50 * 1024 ** 3,
    },
    ...overrides,
  });
}

async function renderModal(opts: {
  targetFs?: ExportTargetFs;
  onExport?: (choice: ExportModalChoice) => void;
  onCancel?: () => void;
  lastExportPath?: string | null;
  exportBitrateKbps?: number;
  durationSeconds?: number;
  hasAudio?: boolean;
} = {}): Promise<{ onExport: ReturnType<typeof vi.fn<(c: ExportModalChoice) => void>>; onCancel: ReturnType<typeof vi.fn> }> {
  const onExport = opts.onExport ?? vi.fn<(c: ExportModalChoice) => void>();
  const onCancel = opts.onCancel ?? vi.fn();
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ExportSettingsModal
        aspectRatio="16:9"
        exportResolution="1080p"
        exportFps={30}
        exportBitrateKbps={opts.exportBitrateKbps}
        mixedNativeFpsWarning={false}
        projectName="Demo Project"
        durationSeconds={opts.durationSeconds ?? D28}
        hasAudio={opts.hasAudio ?? true}
        lastExportPath={opts.lastExportPath}
        targetFs={opts.targetFs ?? fakeFs()}
        onExport={onExport}
        onCancel={onCancel}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { onExport: onExport as ReturnType<typeof vi.fn<(c: ExportModalChoice) => void>>, onCancel: onCancel as ReturnType<typeof vi.fn> };
}

function selectEl(testId: string): HTMLSelectElement {
  return container.querySelector(`[data-testid="${testId}"]`)!;
}

function inputEl(testId: string): HTMLInputElement {
  return container.querySelector(`[data-testid="${testId}"]`)!;
}

async function setSelect(testId: string, value: string): Promise<void> {
  const el = selectEl(testId);
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ExportSettingsModal — shell, no Tauri', () => {
  it('defaults bitrate to today\'s 1080p encoder target (8000 kbps)', async () => {
    await renderModal();
    expect(selectEl('export-bitrate').value).toBe(String(DEFAULT_EXPORT_BITRATE_KBPS));
    expect(DEFAULT_EXPORT_BITRATE_KBPS).toBe(8000);
  });

  it('bitrate dropdown is generated in 500 kbps steps from 1500 to 8000', async () => {
    await renderModal();
    const values = Array.from(selectEl('export-bitrate').options).map((o) => Number(o.value));
    expect(values[0]).toBe(1500);
    expect(values[values.length - 1]).toBe(8000);
    expect(values).toContain(3000);
    expect(values.every((v) => v % 500 === 0)).toBe(true);
  });

  it('live size badge matches the estimator at 1500 / 3000 / 8000 kbps for a 28-min 1080p30 export', async () => {
    await renderModal();
    const badge = (): string => container.querySelector('[data-testid="export-size-badge"]')!.textContent ?? '';

    const at8000 = estimateExportOutputBytes({
      bitrateKbps: 8000, fps: 30, resolution: '1080p', aspectRatio: '16:9',
      durationSeconds: D28, hasAudio: true,
    });
    expect(badge()).toContain(formatBytes(at8000.estimatedFileBytes));

    await setSelect('export-bitrate', '1500');
    const at1500 = estimateExportOutputBytes({
      bitrateKbps: 1500, fps: 30, resolution: '1080p', aspectRatio: '16:9',
      durationSeconds: D28, hasAudio: true,
    });
    expect(at1500.estimatedFileBytes).toBe(355_320_000);
    expect(badge()).toContain(formatBytes(355_320_000));

    await setSelect('export-bitrate', '3000');
    expect(badge()).toContain(formatBytes(670_320_000));
  });

  it('disables Export when free space is below destinationRequiredBytes', async () => {
    const tiny = fakeFs({
      pickedDirectory: '/Users/name/Movies',
      freeSpace: {
        path: '/Users/name/Movies',
        probedPath: '/Users/name/Movies',
        volumeKey: 'fake:tmp',
        availableBytes: 1_000,
      },
    });
    await renderModal({
      targetFs: tiny,
      lastExportPath: '/Users/name/Movies/prev.mp4',
    });
    const confirm = container.querySelector<HTMLButtonElement>('[data-testid="export-confirm"]')!;
    expect(confirm.disabled).toBe(true);
    expect(container.querySelector('[data-testid="export-free-space"]')!.textContent).toMatch(/need/i);
  });

  it('disables Export when no folder is selected', async () => {
    await renderModal({
      targetFs: fakeFs({ pickedDirectory: null, freeSpace: null }),
      lastExportPath: null,
    });
    expect(container.querySelector<HTMLButtonElement>('[data-testid="export-confirm"]')!.disabled).toBe(true);
    expect(container.querySelector('[data-testid="export-path-error"]')!.textContent).toMatch(/folder/i);
  });

  it('Browse writes the injected picker\'s directory into the location field', async () => {
    const pick = vi.fn(async () => '/Volumes/Media');
    const base = fakeFs({ pickedDirectory: '/Volumes/Media' });
    const targetFs: ExportTargetFs = { ...base, pickOutputDirectory: pick };
    await renderModal({ targetFs, lastExportPath: '/Users/name/old/prev.mp4' });
    expect(container.querySelector('[data-testid="export-output-directory"]')!.textContent).toBe('/Users/name/old');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="export-browse"]')!.click();
    });
    await act(async () => { await Promise.resolve(); });
    expect(pick).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="export-output-directory"]')!.textContent).toBe('/Volumes/Media');
  });

  it('Export commits name, folder, resolution, fps and bitrate', async () => {
    const { onExport } = await renderModal({
      lastExportPath: '/Users/name/Movies/prev.mp4',
    });
    await act(async () => {
      const name = inputEl('export-file-name');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(name, 'final_cut');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await setSelect('export-resolution', '720p');
    await setSelect('export-fps', '24');
    await setSelect('export-bitrate', '3000');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="export-confirm"]')!.click();
    });
    expect(onExport).toHaveBeenCalledTimes(1);
    const choice = onExport.mock.calls[0]![0];
    expect(choice.resolution).toBe('720p');
    expect(choice.fps).toBe(24);
    expect(choice.bitrateKbps).toBe(3000);
    expect(choice.outputDirectory).toBe('/Users/name/Movies');
    expect(choice.fileName).toBe('final_cut.mp4');
    expect(choice.outputPath).toBe('/Users/name/Movies/final_cut.mp4');
  });

  it('Cancel writes nothing', async () => {
    const { onExport, onCancel } = await renderModal({ lastExportPath: '/Users/name/Movies/prev.mp4' });
    await setSelect('export-bitrate', '3000');
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')!.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('Escape cancels and does not export', async () => {
    const { onExport, onCancel } = await renderModal({ lastExportPath: '/Users/name/Movies/prev.mp4' });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('does not import or invoke Tauri — the fake is the only filesystem', async () => {
    const pick = vi.fn(async () => '/Users/name/Movies');
    const query = vi.fn(async () => ({
      path: '/Users/name/Movies',
      probedPath: '/Users/name/Movies',
      volumeKey: 'fake:tmp',
      availableBytes: 50 * 1024 ** 3,
    }));
    const validate = vi.fn(async (directory: string, fileName: string) => ({
      ok: true as const,
      fullPath: `${directory}/${fileName}`,
    }));
    await renderModal({
      lastExportPath: '/Users/name/Movies/prev.mp4',
      targetFs: { pickOutputDirectory: pick, queryVolumeFreeSpace: query, validateOutputPath: validate },
    });
    expect(query).toHaveBeenCalled();
    expect(validate).toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
  });
});
