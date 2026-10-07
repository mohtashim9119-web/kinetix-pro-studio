// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U6 — DropZonePanel routing: the main upload area stays
// spine-only; a bundle's keyword-routed doc goes to Layer 2; a SECOND scene-format
// doc dropped loose is offered once ("looks like a Layer-2 doc — add to Layer 2?").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DropZonePanel, type StagedFiles } from './DropZonePanel';
import { makeProps } from './dropZonePanelTestProps';
import type { Layer2PanelProps } from './Layer2Panel';
import type { BundleZipOutcome } from '../services/bundleIngest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClassify = vi.fn<(...args: unknown[]) => Promise<BundleZipOutcome>>();
vi.mock('../services/bundleIngest', () => ({ classifyAndIngestBundleZip: (...a: unknown[]) => mockClassify(...a) }));
vi.mock('../services/stagedFilesStore', () => ({
  putStagedFile: vi.fn().mockResolvedValue(undefined),
  deleteStagedFile: vi.fn().mockResolvedValue(undefined),
  getStagedFilesForProject: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/zipIngest', () => ({ ingestZip: vi.fn(), ZipTooLargeError: class extends Error {} }));

const noop = () => {};
function layer2(onDropDoc: (f: File) => void): Layer2PanelProps {
  return {
    segments: [], assets: [], spots: [], resolved: {}, pendingDoc: null, findings: [],
    onDropDoc, onClearPending: noop, onPatchSpot: noop, onDeleteSpot: noop, onAddManual: noop,
    onSetDefaultAsset: noop, onSprinkle: noop,
  };
}

function mount(onDropDoc: (f: File) => void) {
  let last: StagedFiles | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<DropZonePanel {...makeProps({ layer2: layer2(onDropDoc), onStagedFilesChange: (s: StagedFiles) => { last = s; } })} />);
  });
  return { container, published: () => last };
}

async function dropLoose(container: HTMLElement, files: File[]) {
  const slot = container.querySelector('[data-testid="media-slot"]')!;
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files, types: ['Files'] } });
  await act(async () => {
    slot.dispatchEvent(drop);
    await new Promise(r => setTimeout(r, 20));
  });
}

beforeEach(() => mockClassify.mockReset());

describe('Layer 2 routing in DropZonePanel', () => {
  it('a SECOND scene-format doc is offered once, never staged as script or scene', async () => {
    const onDropDoc = vi.fn();
    const p = mount(onDropDoc);
    await dropLoose(p.container, [
      new File(['[a] one\n[b] two\n[c] three'], 'scene.txt'),
      new File(['[a] x.mp4\n[b]\n[c]'], 'extra.txt'),
    ]);
    expect(p.published()?.sceneFile?.file.name).toBe('scene.txt');
    expect(p.published()?.scriptFile).toBeNull();
    const offer = p.container.querySelector('[data-testid="layer2-offer"]');
    expect(offer?.textContent).toContain('extra.txt');
    expect(offer?.textContent).toContain('add to Layer 2?');
    expect(onDropDoc).not.toHaveBeenCalled();

    const yes = Array.from(offer!.querySelectorAll('button')).find(b => b.textContent === 'Add to Layer 2')!;
    await act(async () => { yes.click(); });
    expect(onDropDoc).toHaveBeenCalledTimes(1);
    expect((onDropDoc.mock.calls[0]![0] as File).name).toBe('extra.txt');
    expect(p.container.querySelector('[data-testid="layer2-offer"]')).toBeNull(); // asked once
  });

  it('a single scene doc is just the scene doc: no offer', async () => {
    const p = mount(vi.fn());
    await dropLoose(p.container, [new File(['[a] one\n[b] two\n[c] three'], 'scene.txt')]);
    expect(p.published()?.sceneFile?.file.name).toBe('scene.txt');
    expect(p.container.querySelector('[data-testid="layer2-offer"]')).toBeNull();
  });

  it('a bundle that carries a keyword doc routes it to Layer 2 and says so', async () => {
    const spot = new File(['[a] avatar.mp4'], 'avatar-scenes.txt');
    mockClassify.mockResolvedValue({
      kind: 'success',
      scriptFile: new File(['s'], 'script.txt'), sceneFile: new File(['[a]'], 'scene.txt'),
      voiceoverFile: new File([new Uint8Array([1])], 'voice.mp3'),
      mediaAssets: [], counts: { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [], nestedZipsSkipped: [], spotDocFile: spot,
    });
    const onDropDoc = vi.fn();
    const p = mount(onDropDoc);
    await dropLoose(p.container, [new File([new Uint8Array([0])], 'bundle.zip')]);
    expect(onDropDoc).toHaveBeenCalledWith(spot);
    expect(p.container.textContent).toContain('Routed "avatar-scenes.txt" to Layer 2');
  });
});
