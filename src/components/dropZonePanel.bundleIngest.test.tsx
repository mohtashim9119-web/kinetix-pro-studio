// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G5 — master bundle ingest, DropZonePanel-level routing. `bundleIngest.test.ts`
// covers `classifyAndIngestBundleZip`'s own classification/validation logic in
// isolation; this file covers what THIS component does with its outcome: a
// zip dropped on ANY slot (including one that would otherwise reject it, like
// forceSlot 'voiceover' rejecting a non-audio file) is checked for bundle
// shape, and a successful bundle fills all four slots in one go while a
// failure touches none of them.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { DropZonePanel, type StagedFiles } from './DropZonePanel';
import { TransitionType } from '../types';
import type { BundleZipOutcome } from '../services/bundleIngest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClassify = vi.fn<(...args: unknown[]) => Promise<BundleZipOutcome>>();
vi.mock('../services/bundleIngest', () => ({
  classifyAndIngestBundleZip: (...args: unknown[]) => mockClassify(...args),
}));

// DropZonePanel persists staged slots to IndexedDB via stagedFilesStore —
// stubbed so this suite exercises only the routing logic, not persistence
// (already covered by dropZonePanel.stagedPersistence.test.tsx).
vi.mock('../services/stagedFilesStore', () => ({
  putStagedFile: vi.fn().mockResolvedValue(undefined),
  deleteStagedFile: vi.fn().mockResolvedValue(undefined),
  getStagedFilesForProject: vi.fn().mockResolvedValue([]),
}));

type DropZonePanelProps = ComponentProps<typeof DropZonePanel>;

function makeProps(overrides: Partial<DropZonePanelProps> = {}): DropZonePanelProps {
  const noop = () => {};
  return {
    projectId: 'bundle-ingest-project',
    segments: [], headings: [], assets: [],
    onUndo: noop, onRedo: noop, canUndo: false, canRedo: false,
    voiceoverId: undefined, script: '',
    persistedScript: '', persistedScriptName: '', persistedScriptUpdatedAt: undefined,
    persistedSceneDetails: '', persistedSceneDetailsName: '', persistedSceneDetailsUpdatedAt: undefined,
    persistedVoiceoverName: '', persistedAssetCount: 0, isSynced: true,
    onClearScript: noop, onClearSceneDetails: noop,
    onDeleteAsset: noop, onDeleteAllAssets: noop, onDeleteVoiceover: noop, onOpenRelinkMedia: noop,
    onHighlightUsage: noop, onIngestComplete: noop, onIngestError: noop, onBundleImportFailed: noop,
    onApplySync: noop, onStagedFilesChange: noop, stagedFilesClearSignal: 0,
    onVoiceoverStaged: noop, onVoiceoverUnstaged: noop, applySyncDisabled: false,
    onVoiceoverRestored: () => Promise.resolve(true),
    onVoiceoverTranscribeRequested: noop,
    voiceoverNeedsExplicitTranscribe: false,
    onSegmentClick: noop, onToggleLock: noop, onLockAll: noop, onUnlockAll: noop,
    allLocked: false, onOpenReviewMapping: noop, onInsertHeading: noop,
    selectedSegmentId: undefined, currentSegmentId: undefined,
    selectedSegmentIds: new Set(), onToggleSegmentSelect: noop,
    onSelectAllSegments: noop, onClearSegmentSelection: noop, onApplyEffect: noop,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: 'none', globalOverlayFilter: 'none',
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    currentTransition: 'none', currentAnimation: 'none', currentOverlayFilter: 'none',
    currentOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    onTransitionChange: noop, onTransitionDurationChange: noop, onApplyTransitionToAll: noop,
    onAnimationChange: noop, onApplyAnimationToAll: noop, onFilterChange: noop,
    onApplyFilterToAll: noop, onOverlayConfigChange: noop,
    onApplyTransitionPreset: noop, onApplyAnimationPreset: noop,
    onApplyOverlayFilterPreset: noop, onApplyOverlayConfigPreset: noop,
    onBackToProjects: noop, projectName: 'Test Project', onRename: noop,
    activeLeftTab: 'files', onActiveLeftTabChange: noop, isPlaying: false,
    ...overrides,
  };
}

function mountPanel(props: Partial<DropZonePanelProps> = {}): {
  container: HTMLDivElement;
  root: Root;
  published: () => StagedFiles | null;
  unmount: () => void;
} {
  let last: StagedFiles | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DropZonePanel {...makeProps({ ...props, onStagedFilesChange: (s: StagedFiles) => { last = s; } })} />,
    );
  });
  return {
    container, root,
    published: () => last,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

/** The four SlotRow file inputs render in this order (Script, Scene, Voiceover),
 *  followed by the generic assets input — see DropZonePanel.tsx's own render order. */
function slotInput(container: HTMLElement, index: 0 | 1 | 2 | 3): HTMLInputElement {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  expect(inputs.length).toBeGreaterThanOrEqual(4);
  return inputs[index]!;
}

async function dropZipOn(container: HTMLElement, index: 0 | 1 | 2 | 3, file: File): Promise<void> {
  const input = slotInput(container, index);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));
  });
}

function zipFile(name = 'bundle.zip'): File {
  return new File([new Uint8Array([0])], name);
}

beforeEach(() => {
  mockClassify.mockReset();
});

describe('DropZonePanel — a bundle zip dropped on ANY slot is detected before slot-specific routing', () => {
  it('dropped on the VOICEOVER slot (forceSlot), a successful bundle still fills all four slots', async () => {
    const scriptFile = new File(['script body'], 'script.txt', { type: 'text/plain' });
    const sceneFile = new File(['[a] tag'], 'scene.txt', { type: 'text/plain' });
    const voiceoverFile = new File([new Uint8Array([1])], 'voice.mp3');
    mockClassify.mockResolvedValue({
      kind: 'success',
      scriptFile, sceneFile, voiceoverFile,
      mediaAssets: [{ id: 'a1', name: 'shot.jpg', url: 'blob:1', type: 'image' }],
      counts: { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
      nestedZipsSkipped: [],
    });

    const onIngestComplete = vi.fn();
    const panel = mountPanel({ onIngestComplete });
    // index 2 = Voiceover slot — forceSlot 'voiceover' would normally reject
    // a non-audio file outright (the pre-G5 "Wrong file" behavior).
    await dropZipOn(panel.container, 2, zipFile());

    expect(mockClassify).toHaveBeenCalled();
    const staged = panel.published();
    expect(staged?.scriptFile?.file.name).toBe('script.txt');
    expect(staged?.sceneFile?.file.name).toBe('scene.txt');
    expect(staged?.voiceoverFile?.file.name).toBe('voice.mp3');
    expect(onIngestComplete).toHaveBeenCalledWith(expect.objectContaining({ source: 'bundle' }));
    // No "Wrong file" slot error — the bundle path pre-empted forceSlot routing.
    expect(panel.container.textContent).not.toContain('Wrong file');
  });

  it('dropped on the SCRIPT slot, a successful bundle still fills the scene and voiceover slots too', async () => {
    const scriptFile = new File(['script body'], 'script.txt', { type: 'text/plain' });
    const sceneFile = new File(['[a] tag'], 'scene.txt', { type: 'text/plain' });
    const voiceoverFile = new File([new Uint8Array([1])], 'voice.mp3');
    mockClassify.mockResolvedValue({
      kind: 'success',
      scriptFile, sceneFile, voiceoverFile,
      mediaAssets: [],
      counts: { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
      nestedZipsSkipped: [],
    });

    const panel = mountPanel();
    await dropZipOn(panel.container, 0, zipFile()); // index 0 = Script slot

    const staged = panel.published();
    expect(staged?.sceneFile?.file.name).toBe('scene.txt');
    expect(staged?.voiceoverFile?.file.name).toBe('voice.mp3');
  });

  it('a plain (non-bundle) media zip keeps the deferred zipFiles path, unchanged', async () => {
    mockClassify.mockResolvedValue({ kind: 'not-a-bundle' });
    const panel = mountPanel();
    await dropZipOn(panel.container, 2, zipFile('photos.zip'));

    const staged = panel.published();
    expect(staged?.zipFiles).toHaveLength(1);
    expect(staged?.zipFiles[0]!.file.name).toBe('photos.zip');
    expect(staged?.scriptFile).toBeNull();
    expect(staged?.voiceoverFile).toBeNull();
  });

  it('a failed bundle (partial/corrupt) touches no slot and reports through onBundleImportFailed', async () => {
    mockClassify.mockResolvedValue({ kind: 'failure', message: '"partial.zip" is missing a voiceover audio file — nothing was imported.' });
    const onBundleImportFailed = vi.fn();
    const onIngestComplete = vi.fn();
    const panel = mountPanel({ onBundleImportFailed, onIngestComplete });
    await dropZipOn(panel.container, 1, zipFile('partial.zip')); // index 1 = Scene slot

    expect(onBundleImportFailed).toHaveBeenCalledWith(expect.stringContaining('voiceover audio file'));
    expect(onIngestComplete).not.toHaveBeenCalled();
    const staged = panel.published();
    expect(staged?.scriptFile).toBeNull();
    expect(staged?.sceneFile).toBeNull();
    expect(staged?.voiceoverFile).toBeNull();
    expect(staged?.zipFiles).toHaveLength(0);
  });

  it('a bundle\'s nestedZipsSkipped reaches onIngestComplete for the grouped finding', async () => {
    mockClassify.mockResolvedValue({
      kind: 'success',
      scriptFile: new File(['s'], 'script.txt'), sceneFile: new File(['[a]'], 'scene.txt'),
      voiceoverFile: new File([new Uint8Array([1])], 'voice.mp3'),
      mediaAssets: [], counts: { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [], nestedZipsSkipped: ['media.zip/deeper.zip'],
    });
    const onIngestComplete = vi.fn();
    const panel = mountPanel({ onIngestComplete });
    await dropZipOn(panel.container, 3, zipFile());
    expect(onIngestComplete).toHaveBeenCalledWith(expect.objectContaining({ nestedZipsSkipped: ['media.zip/deeper.zip'] }));
  });
});

describe('DropZonePanel — a loose Finder drop: macOS metadata never claims a slot', () => {
  it('`._` twins and .DS_Store are dropped before slot routing; the real files fill the slots', async () => {
    const appleDouble = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02]);
    const files = [
      new File([appleDouble], '._1. Script.txt'),
      new File(['A lone figure crests the ridge.'], '1. Script.txt'),
      new File(['[a] one\n[b] two\n[c] three'], '2. Scene.txt'),
      new File([new Uint8Array([9])], '3. voiceover.mp3', { type: 'audio/mpeg' }),
      new File([appleDouble], '._3. voiceover.mp3', { type: 'audio/mpeg' }),
      new File([new Uint8Array([0, 0, 1])], '.DS_Store'),
    ];
    const panel = mountPanel();
    const input = slotInput(panel.container, 3);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
    });
    const staged = panel.published();
    expect(staged?.scriptFile?.file.name).toBe('1. Script.txt');
    expect(staged?.sceneFile?.file.name).toBe('2. Scene.txt');
    expect(staged?.voiceoverFile?.file.name).toBe('3. voiceover.mp3');
    expect(staged?.assetFiles).toHaveLength(0);
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
