/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The queued ids with `dragId` moved before `beforeId` (null = to the end). */
export function moveQueued(order: readonly string[], dragId: string, beforeId: string | null): string[] {
  if (beforeId === dragId) return [...order];
  const rest = order.filter(id => id !== dragId);
  if (beforeId === null) return [...rest, dragId];
  const at = rest.indexOf(beforeId);
  if (at < 0) return [...rest, dragId];
  return [...rest.slice(0, at), dragId, ...rest.slice(at)];
}

/**
 * Where a dragged row would land: the first OTHER queued row whose middle is
 * below the pointer (insert before it), or null (after the last one).
 */
export function dropTarget(
  pointerY: number,
  rows: readonly { id: string; top: number; bottom: number }[],
  dragId: string,
): string | null {
  for (const r of rows) {
    if (r.id === dragId) continue;
    if (pointerY < (r.top + r.bottom) / 2) return r.id;
  }
  return null;
}
