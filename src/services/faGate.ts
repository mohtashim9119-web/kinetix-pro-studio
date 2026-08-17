/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forced-alignment production capability gate (WS1 Task 5 Slice D17,
 * originally owner ruling D2; RESHAPED by WS1 Session G under owner ruling
 * R-AK). Two independent conditions, combined into one accessor: a memoized
 * runtime capability probe AND the PROJECT's own switch — either being false
 * means no FA call anywhere in the Apply-Sync path.
 *
 * WHAT SESSION G CHANGED, AND WHY IT HAD TO. The switch used to be a
 * per-MACHINE `uiStateStore` key read fresh on every Apply Sync. That shape
 * is what made a default flip unshippable in Session F (finding F6): with
 * one global key there is no way to turn FA on for new work without also
 * reaching backward into every project already on the machine, and no way
 * for two projects to disagree. Moving the switch onto `Project` fixes both,
 * and is what let the default become ON (R-AK) without that default being a
 * silent, unaskable global act.
 *
 * THE INVARIANT THIS MODULE EXISTS TO HOLD: an absent
 * `Project.faHighPrecisionSync` means "no preference", resolves to the
 * default at READ time, and is NEVER written back. Nothing here persists
 * anything — every function below is pure. The only writer in the app is
 * Project Settings' Save, and only on an actual user change
 * (`shouldPersistFaChoice`).
 *
 * Capability probe: unlike WebCodecs export (a set of browser APIs), FA
 * runs through a Tauri backend command (`fa_align`) — the same reason
 * `npm run dev` alone can never run Whisper or ffmpeg (CLAUDE.md §2). The
 * probe reuses `tauriFfmpeg.ts`'s own `isTauri()` check rather than
 * reimplementing it, since "is the Tauri IPC bridge present" is exactly and
 * only what FA additionally requires beyond a plain browser runtime.
 */

import { isTauri } from './tauriFfmpeg';
import type { Project } from '../types';

/**
 * The former per-MACHINE toggle key (`uiStateStore`). RETIRED as a gate
 * input by WS1 Session G (owner ruling R-AK) in favour of the per-project
 * `Project.faHighPrecisionSync` field below. Kept as a named constant, and
 * deliberately NOT deleted from any user's stored ui-state, for two reasons:
 *
 *  1. It carried no recoverable intent. `ProjectSettingsModal`'s Save wrote
 *     it UNCONDITIONALLY on every save, for any setting — so a stored
 *     `false` was indistinguishable from "this user once changed their
 *     resolution tier", while the only unambiguous value (`true`) agrees
 *     with the new default anyway. Migrating it would therefore have let an
 *     incidental Save silently disable the owner's chosen default; reading
 *     it is strictly worse than ignoring it. (Measured, not assumed: the
 *     unconditional `setFaToggle(draftFaEnabled)` call is visible in the
 *     pre-change `handleSave`.)
 *  2. Deleting a key is a destructive migration run against every profile to
 *     buy nothing — a dead key costs one unread string.
 */
export const LEGACY_GLOBAL_FA_TOGGLE_KEY = 'faHighPrecisionSyncEnabled';

/**
 * What `Project.faHighPrecisionSync === undefined` means — owner ruling
 * R-AK, WS1 Session G: "keep toggle default ON for all projects. in case i
 * wanna turn it off, i'll go to specific project settings and turn it off
 * myself."
 *
 * WS1 SESSION H — FLIPPED BACK TO false, a VALUE-ONLY change. R-AK's design
 * is entirely unchanged: the per-project field, the absent-key-means-
 * no-preference semantics, the G1 load-path proof, the migration handling,
 * and `runForcedAlignmentForSync`'s fail-clean precheck all stay exactly as
 * built. Only this literal moves. Session H's own 12-row listening pass (five
 * wrong of twelve) found real defects — R.12's nine — that FA had been
 * shipping to every new project by default, with no rule built yet to catch
 * them when R-AK shipped this default ON. New projects default back to
 * Whisper-only until the corpus is re-verified against R.12; a project whose
 * owner already chose `true` explicitly is untouched (the absent-key
 * semantics this constant only governs the fallback for).
 *
 * THE EXACT CONDITION THAT FLIPS THIS BACK TO true, recorded so it is
 * checkable rather than remembered: (1) a FRESH blind 12-row listening pass
 * scored 12/12 correct, on rows drawn clear of every boundary any rule has
 * ever touched or sits adjacent to; (2) a SECOND clean draw on a disjoint set
 * of rows, also 12/12, so one lucky sample cannot carry the decision alone;
 * (3) the live acceptance run itself. None of the three has happened as of
 * this session — Session H's own sealed, unscored Step 12 draw is the FIRST
 * of the two required blind passes (`docs/work-in-progress.md` §9).
 *
 * This is a READ-TIME fallback and must stay one. Persisting it on load
 * would convert "no preference" into "explicit choice" behind the user's
 * back, which is the one thing this design promises never to do.
 */
export const FA_PROJECT_DEFAULT_ON = false;

let cachedFaCapability: boolean | null = null;

/**
 * Capability probe: true only when the Tauri IPC bridge is present, i.e.
 * `fa_align`/`fa_align_dev` are reachable at all. Memoized — matches
 * `isWebCodecsExportCapable()`'s own memoization rationale (runtime
 * capability can't change mid-session).
 */
export function isFaCapable(): boolean {
  if (cachedFaCapability !== null) return cachedFaCapability;
  cachedFaCapability = isTauri();
  return cachedFaCapability;
}

/** Test-only: clears the memoized capability result. */
export function __resetFaCapabilityForTests(): void {
  cachedFaCapability = null;
}

/**
 * The per-project switch, resolved. `true`/`false` are explicit user
 * choices and are returned as-is; `undefined` (and a null/absent project)
 * resolves to `FA_PROJECT_DEFAULT_ON`.
 *
 * PURE AND READ-ONLY BY CONSTRUCTION — it takes a project and returns a
 * boolean. It cannot write, so no call site of it, however careless, can
 * turn an absent key into a stored one. That property is what makes the G1
 * load-path proof a proof rather than an audit of call sites.
 */
export function isFaEnabledForProject(
  project: Pick<Project, 'faHighPrecisionSync'> | null | undefined,
): boolean {
  const stored = project?.faHighPrecisionSync;
  return typeof stored === 'boolean' ? stored : FA_PROJECT_DEFAULT_ON;
}

/**
 * Project Settings' Save decision, extracted from the JSX handler so it can
 * be tested directly (CLAUDE.md §6 layering: decisions live in a service,
 * not inline in a component handler).
 *
 * TRUE only when the user actually moved the control. Saving an UNCHANGED
 * control must not write, because writing would convert "no preference"
 * into an explicit choice as a side effect of editing some unrelated
 * setting — precisely the defect that made the retired global key's stored
 * `false` meaningless (see LEGACY_GLOBAL_FA_TOGGLE_KEY above). This is the
 * load-bearing half of "an explicit user choice is never silently
 * overwritten": the other half is that nothing else in the app writes the
 * field at all.
 */
export function shouldPersistFaChoice(draft: boolean, effective: boolean): boolean {
  return draft !== effective;
}

/**
 * The gate itself — runtime capability AND the project's own switch.
 *
 * Note what this deliberately does NOT decide: whether a usable model
 * exists. `runForcedAlignmentForSync` owns that, and owns it fail-clean
 * (returns null, never throws), so a machine with the gate open but no
 * model simply syncs on Whisper tokens exactly as before. Duplicating a
 * model-presence probe here would add a second, slower, cache-invalidating
 * answer to a question that already has one.
 */
export function isFaGateOpenForProject(
  project: Pick<Project, 'faHighPrecisionSync'> | null | undefined,
): boolean {
  return isFaCapable() && isFaEnabledForProject(project);
}
