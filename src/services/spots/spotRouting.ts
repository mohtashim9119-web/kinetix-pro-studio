/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer-2 routing rules outside the dedicated field. The MAIN upload area stays
 * spine-only: nothing is auto-detected into Layer 2 from content. Two narrow,
 * explicit doors exist: (1) inside a zip, filename-only keywords (the only
 * mechanism available there); (2) a SECOND scene-format doc arriving in the same
 * drop on the main area is offered to Layer 2 (ask-once), never silently used.
 */

const LAYER2_NAME_RE = /avatar|overlay|layer2/i;

/** Filename-only (callers pass the base name; a folder name never routes). */
export function isLayer2Filename(name: string): boolean {
  return LAYER2_NAME_RE.test(name);
}

/**
 * `names` = the scene-format (bracket-tagged) text files of ONE drop, in order.
 * Exactly one claims the scene slot — preferring a doc whose name is NOT a
 * Layer-2 keyword, so `avatar-scenes.txt` + `scene.txt` resolves correctly in
 * either order; every other doc is offered for Layer 2. A lone doc is always
 * the scene doc (never offered): only a second doc is ambiguous.
 */
export function planLooseSceneDocs(names: readonly string[]): { sceneIndex: number | undefined; offerIndexes: number[] } {
  if (names.length === 0) return { sceneIndex: undefined, offerIndexes: [] };
  let sceneIndex = names.findIndex(n => !isLayer2Filename(n));
  if (sceneIndex < 0) sceneIndex = 0;
  return { sceneIndex, offerIndexes: names.map((_, i) => i).filter(i => i !== sceneIndex) };
}
