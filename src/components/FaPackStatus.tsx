/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-project forced-alignment PACK DETECTOR (WS2 T4.1 Step 3) — the one place
 * Project Settings says anything about models, scoped to the ONE language the
 * language dropdown is currently showing.
 *
 * LIVE ON THE DRAFT, NOT ON THE SAVED VALUE. It re-probes as the dropdown
 * changes, before any Save. The question the user is asking while they move
 * that control is "would this language work?", and answering it only after a
 * commit answers it too late to inform the commit.
 *
 * FIVE STATES, and the two easy-to-conflate ones are the reason this component
 * exists rather than a green dot:
 *
 *   • auto        — Auto-detect. There is NO SINGLE PACK TO CHECK: the project
 *                   stores no language, and which pack it will need is decided
 *                   by Whisper on the first transcription. Rendering "missing"
 *                   here would be false (nothing is missing) and rendering
 *                   "installed" would be false too (nothing was checked). So
 *                   it renders neither indicator and no download prompt — it
 *                   says what the condition is and what would resolve it.
 *   • unsupported — a language outside the five FA packs.
 *   • unavailable — no desktop runtime (`isFaCapable()` false), or the probe
 *                   was rejected. Status unknown, stated as unknown.
 *   • unbuilt     — `featureCompiled === false`. THE PACK'S PRESENCE IS
 *                   IRRELEVANT HERE and this is deliberately NOT a download
 *                   prompt: this binary was compiled without `fa-inference`,
 *                   so `fa_align` returns `not_implemented` for every run no
 *                   matter what is on disk (`docs/work-in-progress.md` §5's
 *                   `[DEFERRED · BLOCKS T4.1 CLOSE]` entry). Offering a 1.2 GiB
 *                   download that cannot be used is the exact dishonesty this
 *                   step was told to avoid.
 *   • installed / missing — the ordinary two, and only reachable once the build
 *                   can actually run alignment.
 *
 * The "install it" affordance reveals `ModelsSection` FILTERED to this one
 * language, with `includeWhisper={false}` — the same component, the same
 * download engine, the same progress and completion refresh as the full list
 * in App Settings, because it IS that code path with a shorter list.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { ModelsSection } from './ModelsSection';
import { SUPPORTED_LANGUAGES } from '../constants';
import { checkInstalledModels, FA_MODEL_LANGUAGES } from '../services/models';
import { probeFaReadiness } from '../services/faPreflight';

/** Mirrors `ProjectSettingsModal`'s sentinel — the "no override" choice. */
export const AUTO_DETECT_VALUE = 'auto';

export type FaPackState =
  | { kind: 'loading' }
  | { kind: 'auto' }
  | { kind: 'unsupported'; language: string }
  | { kind: 'unavailable' }
  | { kind: 'unbuilt' }
  | { kind: 'installed'; language: string }
  | { kind: 'missing'; language: string };

const INSTALLED = '#00E676';
const WARN = '#fbbf24';

function labelFor(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/**
 * Resolves the detector's state for one language. Exported and pure-ish (its
 * only inputs are the two probes) so the decision table has a direct test
 * target that does not go through React.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY: it is the order the real run hits these
 * conditions. Build before runtime before disk — a missing pack is not the
 * user's problem when the binary could not have used it anyway.
 */
export async function resolveFaPackState(language: string): Promise<FaPackState> {
  if (language === AUTO_DETECT_VALUE) return { kind: 'auto' };
  if (!FA_MODEL_LANGUAGES.includes(language)) return { kind: 'unsupported', language };

  const report = await probeFaReadiness(language);
  if (report === null) return { kind: 'unavailable' };
  if (!report.featureCompiled) return { kind: 'unbuilt' };

  // Pack presence comes from `checkInstalledModels`, the SAME source the
  // Models section renders from, so the detector and the list it links to can
  // never disagree about what is on disk. (`fa_preflight` also reports
  // `modelPresent`; using it here would be a second answer to a question that
  // already has one, and the two resolve paths are not identical.)
  try {
    const installed = (await checkInstalledModels()).fa[language]?.installed ?? false;
    return installed ? { kind: 'installed', language } : { kind: 'missing', language };
  } catch {
    return { kind: 'unavailable' };
  }
}

interface Props {
  /** The DRAFT language value from the dropdown, re-probed on every change. */
  language: string;
}

export function FaPackStatus({ language }: Props): React.ReactElement {
  const [state, setState] = useState<FaPackState>({ kind: 'loading' });
  const [showInstaller, setShowInstaller] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    setShowInstaller(false);
    void resolveFaPackState(language).then((next) => {
      // A stale probe must never overwrite a newer one: the dropdown can move
      // faster than the IPC round-trip.
      if (!cancelled) setState(next);
    });
    return () => { cancelled = true; };
  }, [language]);

  const body = (): React.ReactElement => {
    switch (state.kind) {
      case 'loading':
        return (
          <span className="flex items-center gap-1.5 text-gray-500">
            <Loader2 size={11} className="animate-spin" />
            Checking the alignment pack…
          </span>
        );
      case 'auto':
        return (
          <span className="flex items-start gap-1.5 text-gray-500">
            <Info size={11} className="shrink-0 mt-0.5" />
            <span>
              Auto-detect has no single pack to check — the language is decided by the first
              transcription. Pick a language above to see whether its pack is ready.
            </span>
          </span>
        );
      case 'unsupported':
        return (
          <span className="flex items-start gap-1.5" style={{ color: WARN }}>
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span>
              No alignment pack exists for “{state.language}”. High-precision sync will fall back to
              standard timing for this project.
            </span>
          </span>
        );
      case 'unavailable':
        return (
          <span className="flex items-start gap-1.5 text-gray-500">
            <Info size={11} className="shrink-0 mt-0.5" />
            <span>Pack status is unavailable outside the desktop app.</span>
          </span>
        );
      case 'unbuilt':
        return (
          <span className="flex items-start gap-1.5" style={{ color: WARN }}>
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span>
              This build cannot run high-precision sync at all, so no pack would help. Syncs use
              standard timing.
            </span>
          </span>
        );
      case 'installed':
        return (
          <span className="flex items-center gap-1.5" style={{ color: INSTALLED }}>
            <CheckCircle2 size={11} className="shrink-0" />
            {labelFor(state.language)} alignment pack installed
          </span>
        );
      case 'missing':
        return (
          <span className="flex items-start gap-1.5" style={{ color: WARN }}>
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span>
              The {labelFor(state.language)} alignment pack is not installed — high-precision sync
              will fall back to standard timing.{' '}
              <button
                onClick={() => setShowInstaller(true)}
                data-testid="fa-pack-install-link"
                className="underline underline-offset-2 hover:text-[#F27D26] transition-colors"
              >
                Install it
              </button>
            </span>
          </span>
        );
    }
  };

  return (
    <div data-testid="fa-pack-status" data-state={state.kind} className="text-[9px] leading-snug">
      {body()}
      {showInstaller && state.kind === 'missing' && (
        <div data-testid="fa-pack-installer" className="mt-3">
          <ModelsSection
            faLanguages={[state.language]}
            includeWhisper={false}
            projectLanguage={state.language}
          />
        </div>
      )}
    </div>
  );
}
