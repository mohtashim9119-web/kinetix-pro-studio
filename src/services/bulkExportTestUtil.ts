/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BulkExportRunner } from './bulkExportQueue';

/** Test helper: select every project in the runner's catalog (the pane's own
 *  Select all goes through `setSelected` per visible row). */
export function selectAll(runner: BulkExportRunner): void {
  for (const p of runner.listCatalog()) runner.setSelected(p.id, true);
}
