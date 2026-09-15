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
  /**
   * Round 28 Increment 1 — true for the span between `chooseFolder` handing
   * `picked` to `relocateStorageRoot` (the native copy-verify-commit call,
   * `storage_root_relocate` in `storage_root.rs`) and that call settling.
   * `storage_root_relocate` is a synchronous Tauri command: there is no IPC
   * cancellation channel for an in-flight invocation, so once this is true
   * `cancel` refuses rather than pretending to abort a copy nothing can
   * actually stop — see `cancel`'s own comment.
   */
  copying: boolean;
}

export interface UseStorageRootRelocation {
  view: RelocationViewState | null;
  open: () => void;
  close: () => void;
  chooseFolder: () => void;
  /**
   * Dismisses the modal without initiating or committing any relocation.
   * Refuses (no-op, view stays open) while `view.copying` is true — see the
   * field's own doc comment for why a mid-copy cancel can't be honored.
   */
  cancel: () => void;
}

export function useStorageRootRelocation(onRelocated?: (to: string) => void): UseStorageRootRelocation {
  const [view, setView] = useState<RelocationViewState | null>(null);

  const open = useCallback(() => {
    setView({
      currentRoot: '',
      targetVolume: '',
      requiredBytes: 0,
      availableBytes: 0,
      validationState: 'error',
      copying: false,
    });
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

  // Round 28 Increment 1 — cancel affordance. `storage_root_relocate` is a
  // synchronous native command with no abort channel, so this cannot stop
  // an in-flight copy; it only refuses to dismiss the modal while one is
  // running (Option (a) from the increment's brief), so the modal can never
  // be dismissed leaving a partial copy the user believes was cancelled.
  // Before any copy starts (`view.copying === false`, including the whole
  // window before "Choose folder" is even clicked), cancel is a plain
  // dismiss: no copy is initiated, nothing is committed.
  const cancel = useCallback(() => {
    setView((prev) => (prev && prev.copying ? prev : null));
  }, []);

  const chooseFolder = useCallback(() => {
    void (async () => {
      const picked = await relinkPickFolder();
      if (!picked) return;
      setView((prev) => (prev ? { ...prev, targetVolume: picked, copying: true } : prev));
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
                copying: false,
              }
            : prev,
        );
      }
    })();
  }, [onRelocated]);

  return { view, open, close, chooseFolder, cancel };
}
