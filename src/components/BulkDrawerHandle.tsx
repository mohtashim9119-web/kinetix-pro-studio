/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// The editor's way back to the bulk drawer.
//
// The drawer hides and never closes, and opening a row's project hides it — so
// once you are in the editor the dashboard's "Bulk builds (n)" button is out of
// reach. This slim left-edge tab (the drawer's own edge) is the same door from the editor: present
// whenever a batch exists, carrying the batch's project count, and gone while
// the drawer itself is open. It sits on the DRAWER layer (above editor
// content, below every modal) and is rendered only when the caller says the
// drawer is closed, so it can never sit on top of the drawer it opens.
// ---------------------------------------------------------------------------

import { BULK_COPY } from '../services/bulkContext';
import { Z } from './overlayLayers';

export interface BulkDrawerHandleProps {
  /** Projects in the current batch; 0 renders nothing. */
  count: number;
  /** True while the drawer is on screen — the handle is not shown then. */
  drawerOpen: boolean;
  /** The SAME open logic as the dashboard's "Bulk builds (n)" button. */
  onOpen: () => void;
}

export function BulkDrawerHandle({ count, drawerOpen, onOpen }: BulkDrawerHandleProps): React.JSX.Element | null {
  if (count <= 0 || drawerOpen) return null;
  return (
    <button
      type="button"
      data-testid="bulk-drawer-handle"
      onClick={onOpen}
      title={BULK_COPY.batchButton(count)}
      aria-label={BULK_COPY.batchButton(count)}
      className={`fixed left-0 top-1/2 -translate-y-1/2 ${Z.drawer} flex flex-col items-center gap-2
                  rounded-r-xl border border-l-0 border-[#282828] bg-[#111] px-1.5 py-3 shadow-2xl
                  text-gray-400 hover:text-white hover:border-gray-500 transition-colors
                  focus:outline-none focus:ring-2 focus:ring-gray-500`}
    >
      <span
        data-testid="bulk-drawer-handle-count"
        className="min-w-[18px] rounded-full bg-[#F27D26] px-1 text-center text-[10px] font-black leading-[18px] text-white"
      >
        {count}
      </span>
      <span className="text-[9px] font-black uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
        Bulk
      </span>
    </button>
  );
}
