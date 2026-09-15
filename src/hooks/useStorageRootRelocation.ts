/**
 * WS3 Batch 2 (STEP 3, 3A) — the copy-verify-commit relocation flow, owned
 * here so it's testable without a full App.tsx render harness (App.tsx
 * itself has none — see the STEP 2 report's "Decisions taken").
 *
 * Fed only from the two existing endpoints named in 3A's scope
 * (`getStorageRootStatus`, and `relocateStorageRoot`'s own thrown message
 * on refusal, parsed by `parseInsufficientSpaceError`) — no new native
 * preview command. "Commit" is `relocateStorageRoot` itself, which already
 * does the real copy-verify-commit work and insufficient-space rejection
 * natively (storage_root.rs); this hook's only job is surfacing that as
 * `StorageRootRelocationView`'s props, before and after the pick.
 */
import { useCallback, useState } from 'react';
import { getStorageRootStatus, relocateStorageRoot } from '../services/storageRoot';
import { relinkPickFolder } from '../services/relinkNative';
import { parseInsufficientSpaceError } from '../services/storageRootRelocationParse';
import type { StorageRootValidationState } from '../components/recovery/StorageRootRelocationView';

export interface RelocationViewState {
  currentRoot: string;
  targetVolume: string;
  requiredBytes: number;
  availableBytes: number;
  validationState: StorageRootValidationState;
}

export interface UseStorageRootRelocation {
  view: RelocationViewState | null;
  open: () => void;
  close: () => void;
  chooseFolder: () => void;
}

export function useStorageRootRelocation(onRelocated?: (to: string) => void): UseStorageRootRelocation {
  const [view, setView] = useState<RelocationViewState | null>(null);

  const open = useCallback(() => {
    setView({ currentRoot: '', targetVolume: '', requiredBytes: 0, availableBytes: 0, validationState: 'error' });
    void (async () => {
      try {
        const status = await getStorageRootStatus();
        setView((prev) =>
          prev ? { ...prev, currentRoot: status.currentRoot, requiredBytes: status.managedBytes ?? 0 } : prev,
        );
      } catch {
        // Leave the placeholder — Choose folder still works; the real
        // check happens at relocateStorageRoot regardless.
      }
    })();
  }, []);

  const close = useCallback(() => setView(null), []);

  const chooseFolder = useCallback(() => {
    void (async () => {
      const picked = await relinkPickFolder();
      if (!picked) return;
      setView((prev) => (prev ? { ...prev, targetVolume: picked } : prev));
      try {
        const report = await relocateStorageRoot(picked);
        setView(null);
        onRelocated?.(report.to);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const parsed = parseInsufficientSpaceError(message);
        setView((prev) =>
          prev
            ? {
                ...prev,
                targetVolume: picked,
                requiredBytes: parsed?.requiredBytes ?? prev.requiredBytes,
                availableBytes: parsed?.availableBytes ?? 0,
                validationState: parsed ? 'insufficient' : 'error',
              }
            : prev,
        );
      }
    })();
  }, [onRelocated]);

  return { view, open, close, chooseFolder };
}
