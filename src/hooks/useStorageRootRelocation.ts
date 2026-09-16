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
import { useCallback, useRef, useState } from 'react';
import {
  cancelStorageRootRelocation,
  getStorageRootStatus,
  relocateStorageRoot,
  RELOCATION_CANCELLED_MESSAGE,
} from '../services/storageRoot';
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
   * True for the span between `chooseFolder` handing `picked` to
   * `relocateStorageRoot` (the native copy-verify-commit call,
   * `storage_root_relocate` in `storage_root.rs`) and that call settling.
   *
   * D15 fix (WS3 Round 29) — `storage_root_relocate` used to be a
   * synchronous Tauri command with no cancellation channel at all, so
   * `cancel` while this was true could only refuse (see the old comment
   * this replaced). It is now `async` and polls a cancellable flag
   * (`storage_root_relocate_cancel`) once per file/subtree, so `cancel` can
   * genuinely stop it — see `cancel`'s own comment.
   */
  copying: boolean;
  /** D15 fix (WS3 Round 29) — true from the Cancel click until the in-flight relocation actually rejects. */
  cancelling: boolean;
  /** D18 fix (WS3 Round 29) — live copy progress, from `RelocationEvent::Progress`. `null` until the first event lands. */
  progress: { bytesDone: number; bytesTotal: number } | null;
  /** D-verify-feedback fix (WS3 Round 29) — true once the copy loop has moved into post-copy digest verification, so the UI shows real feedback instead of a stale "100%" for what can be a real 30+ second span. */
  verifying: boolean;
  /** D17 fix (WS3 Round 29) — the verbatim refusal message when `validationState === 'error'` (never set for 'insufficient', which already has real required/available numbers). */
  errorMessage: string | null;
  /** "Reset to default location" fix (WS3 Round 29, approved) — the OS-default root, fetched alongside `currentRoot`. Empty until `open()`'s status fetch resolves. */
  defaultRoot: string;
  /** Whether `currentRoot` already IS `defaultRoot` — hides "Reset to default location" when it would be a no-op. */
  isDefault: boolean;
}

export interface UseStorageRootRelocation {
  /**
   * Background-continuation fix (WS3 Round 29, operator decision) — `null`
   * whenever the modal should not be RENDERED, which is now a narrower
   * condition than "no relocation session exists": a session that's
   * `copying` survives being hidden (see `dismiss`) and this becomes
   * non-null again the next time `open()` runs, picking up wherever the
   * still-running relocation's own progress events have taken it — never a
   * freshly-reset placeholder while a copy is actually in flight.
   */
  view: RelocationViewState | null;
  open: () => void;
  /** Full dismiss: only valid pre-copy (see `dismiss` for the general-purpose close). */
  close: () => void;
  chooseFolder: () => void;
  /** "Reset to default location" fix (WS3 Round 29, approved) — relocates straight to the OS default, no folder picker. No-op if already at default or `defaultRoot` hasn't loaded yet. */
  resetToDefault: () => void;
  /**
   * Background-continuation fix (WS3 Round 29, operator decision) — the X
   * button and Escape key both call this now, NOT `cancel`. Before a copy
   * starts, this is a plain dismiss (same as `close`). Once `view.copying`
   * is true, this only HIDES the modal (`view` becomes `null` so nothing
   * renders) — it does not touch the in-flight `relocateStorageRoot` call,
   * which keeps running to completion in the background exactly as if the
   * modal had stayed open. The next `open()` re-shows the SAME session with
   * whatever progress has accumulated since, live.
   */
  dismiss: () => void;
  /**
   * The bottom "[ Cancel ]" button's actual cancel — genuinely stops the
   * in-flight relocation (D15 fix, WS3 Round 29): signals
   * `cancelStorageRootRelocation`, and the modal itself only closes once
   * that call actually rejects (`startRelocation`'s catch block, on seeing
   * `RELOCATION_CANCELLED_MESSAGE`), never optimistically, so it can never
   * report "cancelled" while a partial copy is, in fact, still running.
   */
  cancel: () => void;
}

const BLANK_VIEW: RelocationViewState = {
  currentRoot: '',
  targetVolume: '',
  requiredBytes: 0,
  availableBytes: 0,
  validationState: 'error',
  copying: false,
  cancelling: false,
  progress: null,
  verifying: false,
  errorMessage: null,
  defaultRoot: '',
  isDefault: false,
};

export function useStorageRootRelocation(onRelocated?: (to: string) => void): UseStorageRootRelocation {
  // Background-continuation fix (WS3 Round 29) — `session` is the relocation
  // session's own state, alive for as long as a relocation is genuinely in
  // flight (or a pre-copy picker is open), independent of whether the modal
  // is currently shown. `visible` is purely presentational. The hook
  // exposes `view = visible ? session : null`, so every existing consumer
  // (App.tsx's `{storageRelocation.view && <Modal/>}`) keeps working
  // unchanged — hiding is just `view` becoming `null` for render purposes,
  // never a reset of the underlying session.
  const [session, setSession] = useState<RelocationViewState | null>(null);
  const [visible, setVisible] = useState(false);
  // Verify-flicker fix (WS3 Round 29) — the backend fires `Verifying` once
  // PER SUBTREE (correctly — every subtree gets byte-verified, and which
  // one is slow enough to need a visible label has nothing to do with loop
  // position: the large `models`/fa-models data, the one verify that can
  // genuinely take 30-50s+, sorts near the FRONT of the managed list, while
  // small subtrees near the back finish in well under a second). Tying the
  // label to loop position (tried and reverted) either hid it during the
  // one verify that actually stalls the UI, or showed it too briefly to
  // read on a trivial one. The right signal is duration, which only the
  // frontend can observe live: `verifyShowTimerRef` delays actually turning
  // the label on until a verify has been running long enough to be worth
  // showing (so instant subtrees never flicker it), and `verifyShownAtRef`
  // records when it actually did turn on so the success path can hold the
  // modal open long enough to make it readable if the run ends while it's
  // still up.
  const verifyShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyShownAtRef = useRef<number | null>(null);
  const clearVerifyShowTimer = useCallback(() => {
    if (verifyShowTimerRef.current !== null) {
      clearTimeout(verifyShowTimerRef.current);
      verifyShowTimerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    setVisible(true);
    setSession((prev) => {
      if (prev) return prev; // a session (picking, or an in-flight copy) is already live — just re-show it
      return { ...BLANK_VIEW };
    });
    void (async () => {
      try {
        const status = await getStorageRootStatus();
        setSession((prev) =>
          // Only apply this fresh status fetch to a session that hasn't
          // moved past the placeholder yet (still `!targetVolume`) — a
          // reopen onto an in-flight copy must never overwrite its live
          // `currentRoot`/`requiredBytes` with values fetched fresh just
          // now, which could be stale relative to what's actually copying.
          prev && !prev.targetVolume
            ? {
                ...prev,
                currentRoot: status.currentRoot,
                requiredBytes: status.managedBytes ?? 0,
                defaultRoot: status.defaultRoot,
                isDefault: status.isDefault,
              }
            : prev,
        );
      } catch {
        // Leave the placeholder — Choose folder still works; the real
        // check happens at relocateStorageRoot regardless.
      }
    })();
  }, []);

  const close = useCallback(() => {
    setSession(null);
    setVisible(false);
  }, []);

  // Background-continuation fix (WS3 Round 29, operator decision) — X/Escape.
  // Pre-copy, identical to `close`. Mid-copy, hides ONLY: the relocation's
  // own promise chain (`startRelocation` below) is a plain JS closure over
  // `setSession`, entirely independent of `visible` — it keeps running,
  // keeps calling `setSession` on progress events, and keeps writing to
  // `session` right up to its own resolution/rejection, whether or not the
  // modal is currently rendered to see it.
  const dismiss = useCallback(() => {
    setVisible(false);
    setSession((prev) => (prev && prev.copying ? prev : null));
  }, []);

  // Round 28 Increment 1 — cancel affordance. `storage_root_relocate` is a
  // synchronous native command with no abort channel, so this cannot stop
  // an in-flight copy; it only refuses to dismiss the modal while one is
  // running (Option (a) from the increment's brief), so the modal can never
  // be dismissed leaving a partial copy the user believes was cancelled.
  // Before any copy starts (`view.copying === false`, including the whole
  // window before "Choose folder" is even clicked), cancel is a plain
  // dismiss: no copy is initiated, nothing is committed.
  //
  // D-double-invoke fix (WS3 Round 29) — the side effect (the actual
  // `cancelStorageRootRelocation` call) used to live INSIDE the `setSession`
  // updater function. React 18 StrictMode deliberately invokes a state
  // updater function twice in dev to catch exactly this class of bug (an
  // updater is supposed to be a pure function of its previous state) — so
  // every cancel click fired the native cancel command twice. Harmless on
  // its own (idempotent), but the identical mistake in `resetToDefault`
  // below fired TWO CONCURRENT relocations sharing one PID-keyed probe
  // filename, which is what actually broke ("could not remove writability
  // probe ... No such file or directory" — the second invocation's
  // `remove_file` raced the first's) and made progress flicker (two
  // independent copies both writing the same `session.progress`). Fixed
  // here too for the same reason, even though only `resetToDefault` had a
  // reported symptom — the two functions were the same anti-pattern.
  const cancel = useCallback(() => {
    if (!session) return;
    if (!session.copying) {
      setSession(null);
      setVisible(false);
      return;
    }
    if (session.cancelling) return; // already stopping — ignore a double-click
    // Fire-and-forget: the flag this sets is polled by the in-flight
    // `relocateStorageRoot` call itself. The modal only actually closes
    // once that call rejects (below), never optimistically here — see
    // this hook's own `cancel` doc comment for why.
    void cancelStorageRootRelocation().catch(() => {
      // Best-effort — if the native call itself fails, the relocation is
      // still running and will settle on its own (success or its own
      // error) regardless.
    });
    setSession((prev) => (prev ? { ...prev, cancelling: true } : prev));
  }, [session]);

  // "Reset to default location" fix (WS3 Round 29) — the actual
  // copy-verify-commit execution, shared by `chooseFolder` (native picker
  // supplies `picked`) and `resetToDefault` (already-known `defaultRoot`
  // supplies it) — was duplicated inline in `chooseFolder` before this;
  // extracted so the two entry points can't drift apart on error handling.
  const startRelocation = useCallback(
    (picked: string) => {
      void (async () => {
        clearVerifyShowTimer();
        verifyShownAtRef.current = null;
        setSession((prev) =>
          prev ? { ...prev, targetVolume: picked, copying: true, progress: null, verifying: false } : prev,
        );
        // Debounce threshold — a verify shorter than this never shows the
        // label at all (avoids flicker on the small subtrees); once shown,
        // it stays up at least this long (avoids a blink-and-you-miss-it
        // label if the run happens to finish right as it crosses the
        // threshold).
        const VERIFY_SHOW_DEBOUNCE_MS = 300;
        try {
          const report = await relocateStorageRoot(picked, (event) => {
            // Background-continuation fix (WS3 Round 29) — every branch
            // here fires regardless of `visible`; a hidden modal still
            // accumulates live progress/verifying state in `session`, which
            // the next `open()` shows exactly as-is.
            if (event.event === 'Progress') {
              // D-verify-feedback fix (WS3 Round 29) — `verifying` must
              // reset here: verification happens once PER SUBTREE,
              // interleaved with copying the next one, not once at the
              // very end — without this reset it latched `true` after the
              // first subtree's verify and never cleared, so every later
              // subtree's real copy progress rendered with a stale
              // "Verifying integrity…" label instead of its own numbers.
              // A new Progress event also means the previous subtree's
              // verify has genuinely ended, so any not-yet-fired debounce
              // timer for it is now stale.
              clearVerifyShowTimer();
              setSession((prev) => (prev ? { ...prev, progress: event.data, verifying: false } : prev));
            } else if (event.event === 'Verifying') {
              clearVerifyShowTimer();
              verifyShowTimerRef.current = setTimeout(() => {
                verifyShowTimerRef.current = null;
                verifyShownAtRef.current = Date.now();
                setSession((prev) => (prev ? { ...prev, verifying: true } : prev));
              }, VERIFY_SHOW_DEBOUNCE_MS);
            }
          });
          clearVerifyShowTimer();
          // If the label made it on screen before the run finished, hold
          // the modal open until it's been visible for the same debounce
          // floor, so the very last subtree's verify (however fast) can't
          // close the modal out from under a label the operator just saw
          // appear.
          if (verifyShownAtRef.current !== null) {
            const elapsed = Date.now() - verifyShownAtRef.current;
            if (elapsed < VERIFY_SHOW_DEBOUNCE_MS) {
              await new Promise((resolve) => setTimeout(resolve, VERIFY_SHOW_DEBOUNCE_MS - elapsed));
            }
          }
          setSession(null);
          setVisible(false);
          onRelocated?.(report.to);
        } catch (err) {
          clearVerifyShowTimer();
          const message = err instanceof Error ? err.message : String(err);
          if (message === RELOCATION_CANCELLED_MESSAGE) {
            // A genuine operator cancel — clean dismiss, not an error state.
            setSession(null);
            setVisible(false);
            return;
          }
          const parsed = parseInsufficientSpaceError(message);
          // A failure surfaces the modal again even if it had been
          // dismissed mid-copy (background-continuation fix, WS3 Round 29)
          // — an error/insufficient-space refusal is exactly the kind of
          // thing the operator needs to see, not one they'd want silently
          // swallowed just because they weren't looking at the modal when
          // it happened.
          setVisible(true);
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  targetVolume: picked,
                  requiredBytes: parsed?.requiredBytes ?? prev.requiredBytes,
                  availableBytes: parsed?.availableBytes ?? 0,
                  validationState: parsed ? 'insufficient' : 'error',
                  // D17 fix (WS3 Round 29) — an unparsed refusal used to show
                  // only the generic "Could not validate the target volume"
                  // label with a fake 0 B available figure, giving the
                  // operator no way to tell an actual free-space shortfall
                  // apart from every other possible refusal (not writable,
                  // same-as-current, a verification mismatch, etc). The real
                  // message from `storage_root_relocate` is now shown
                  // verbatim instead of being silently discarded.
                  errorMessage: parsed ? null : message,
                  copying: false,
                  cancelling: false,
                  progress: null,
                  verifying: false,
                }
              : prev,
          );
        }
      })();
    },
    [onRelocated],
  );

  const chooseFolder = useCallback(() => {
    void (async () => {
      const picked = await relinkPickFolder();
      if (!picked) return;
      startRelocation(picked);
    })();
  }, [startRelocation]);

  // D-double-invoke fix (WS3 Round 29) — see `cancel`'s own comment for the
  // full story: `startRelocation` (a real side effect — it calls the native
  // relocate command) used to run INSIDE the `setSession` updater, so React
  // 18 StrictMode's deliberate double-invoke of updater functions in dev
  // fired it twice, starting two concurrent relocations to the same target.
  const resetToDefault = useCallback(() => {
    if (!session || !session.defaultRoot || session.isDefault || session.copying) return;
    startRelocation(session.defaultRoot);
  }, [session, startRelocation]);

  return {
    view: visible ? session : null,
    open,
    close,
    dismiss,
    chooseFolder,
    resetToDefault,
    cancel,
  };
}
