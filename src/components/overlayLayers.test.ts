// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Z, Z_INDEX } from './overlayLayers';

// The overlay scale is the contract that keeps the dashboard page under every modal. jsdom does not paint, so the order is
// pinned here at the source: the tokens, and the absence of raw overlay z-values.

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'dev') continue; // spikes and fixtures, not the app
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && name !== 'overlayLayers.ts') {
      out.push(p);
    }
  }
  return out;
}
const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

describe('overlay scale', () => {
  it('is the full ordered scale, strictly increasing', () => {
    expect(Object.keys(Z_INDEX)).toEqual([
      'editorControls', 'reviewMapping', 'dashboard', 'modal', 'appSettings', 'relocation',
      'popup', 'banner', 'blocker', 'dialog', 'previewFullscreen', 'devPanel',
    ]);
    const values = Object.values(Z_INDEX);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps the ruled relationships: editor < dashboard < modal < app settings < toasts', () => {
    expect(Z_INDEX.editorControls).toBeLessThan(Z_INDEX.dashboard);
    expect(Z_INDEX.dashboard).toBe(200);
    expect(Z_INDEX.modal).toBe(205);
    expect(Z_INDEX.appSettings).toBe(210);
    expect(Z_INDEX.popup).toBe(300);
    expect(Z_INDEX.dashboard).toBeLessThan(Z_INDEX.modal);
    expect(Z_INDEX.modal).toBeLessThan(Z_INDEX.appSettings);
    expect(Z_INDEX.appSettings).toBeLessThan(Z_INDEX.popup);
    // A dialog that can open over the dashboard must beat it, whatever its name.
    for (const above of ['modal', 'appSettings', 'relocation', 'popup', 'banner', 'blocker', 'dialog'] as const) {
      expect(Z_INDEX[above]).toBeGreaterThan(Z_INDEX.dashboard);
    }
  });

  it('each literal class string matches its number (Tailwind needs whole class names)', () => {
    for (const [name, value] of Object.entries(Z_INDEX)) {
      expect(Z[name as keyof typeof Z]).toBe(`z-[${value}]`);
    }
  });

  it('no component writes a raw overlay z-value — every overlay comes from the scale', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        if (/\bz-\[(\d{3,})\]/.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the dashboard and every former z-200 modal sit on their ruled layers', () => {
    const src = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
    // Dashboard revamp — Bulk Sync is a pane inside the dashboard's left panel
    // (the dashboard's own stacking context), no longer a drawer layer of its own.
    expect(Object.keys(Z)).not.toContain('drawer');
    // (Its count popup is gone — adding projects is inline; its confirms are ConfirmDialog, on Z.dialog.)
    expect(src('components/ConfirmDialog.tsx')).toContain('${Z.dialog}');
    expect(src('components/ProjectDashboard.tsx')).toContain('Z.dashboard');
    for (const rel of [
      'components/NewProjectModal.tsx', 'components/ProjectSettingsModal.tsx', 'components/ManageModelsModal.tsx',
      'components/ExportSettingsModal.tsx', 'components/StockSearchModal.tsx', 'components/DropZonePanel.tsx',
      'components/recovery/DegradedProjectRecoveryScreen.tsx',
    ]) {
      expect(src(rel), rel).toContain('${Z.modal}');
    }
    expect(src('components/AppSettingsModal.tsx')).toContain('${Z.appSettings}');
  });

  it('the dashboard lifts itself to the modal layer while its own confirm dialog is open', () => {
    // The dialog lives inside the dashboard's stacking context, so it can only
    // beat the modals' siblings if the whole dashboard lifts for that moment.
    const dash = readFileSync(join(SRC, 'components/ProjectDashboard.tsx'), 'utf8');
    expect(dash).toMatch(/showBulkConfirm \? Z\.modal : Z\.dashboard/);
  });
});
