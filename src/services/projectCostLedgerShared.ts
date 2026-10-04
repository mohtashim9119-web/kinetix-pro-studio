/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The app's one cost ledger, wired to the real rate card, the tombstones and
// the cloud stage tap. Created lazily so importing stays side-effect free.

import { ProjectCostLedger } from './projectCostLedger';
import { onCloudStageFinished } from './cloudStageObserver';
import { CLOUD_USD_PER_WORKER_SEC } from './cloudQueueJob';
import { deletedProjectIds } from './projectStore';

let shared: ProjectCostLedger | undefined;

export function projectCostLedger(): ProjectCostLedger {
  if (!shared) {
    const ledger = new ProjectCostLedger({
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
      usdPerSec: CLOUD_USD_PER_WORKER_SEC,
      isDeleted: id => deletedProjectIds().has(id),
    });
    onCloudStageFinished(ev => ledger.noteStage(ev));
    shared = ledger;
  }
  return shared;
}
