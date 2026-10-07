/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U6 — pure routing helpers shared by the zip door and the main
// upload area's ask-once.
import { describe, it, expect } from 'vitest';
import { isLayer2Filename, planLooseSceneDocs } from './spotRouting';

describe('isLayer2Filename', () => {
  it.each(['avatar-scenes.txt', 'My_Overlay.TXT', 'layer2.rtf', 'x-AVATAR.txt'])('%s -> true', n => expect(isLayer2Filename(n)).toBe(true));
  it.each(['scene.txt', 'script.txt', 'overlays/notes.txt'.split('/').pop()!])('%s -> false', n => expect(isLayer2Filename(n)).toBe(false));
});

describe('planLooseSceneDocs (main area stays spine-only)', () => {
  it('one scene-format doc: it is the scene doc, nothing offered', () => {
    expect(planLooseSceneDocs(['scene.txt'])).toEqual({ sceneIndex: 0, offerIndexes: [] });
  });
  it('two scene-format docs: first claims scene; the second is offered for Layer 2', () => {
    expect(planLooseSceneDocs(['scene.txt', 'extra.txt'])).toEqual({ sceneIndex: 0, offerIndexes: [1] });
  });
  it('a layer-2-named doc is the one offered, whatever the order', () => {
    expect(planLooseSceneDocs(['avatar-scenes.txt', 'scene.txt'])).toEqual({ sceneIndex: 1, offerIndexes: [0] });
  });
  it('a lone layer-2-named doc is still the scene doc — only a SECOND doc is ever offered (non-destructive)', () => {
    expect(planLooseSceneDocs(['avatar-scenes.txt'])).toEqual({ sceneIndex: 0, offerIndexes: [] });
  });
  it('three docs: one scene, two offered', () => {
    expect(planLooseSceneDocs(['a.txt', 'b.txt', 'c.txt'])).toEqual({ sceneIndex: 0, offerIndexes: [1, 2] });
  });
  it('none: nothing', () => {
    expect(planLooseSceneDocs([])).toEqual({ sceneIndex: undefined, offerIndexes: [] });
  });
});
