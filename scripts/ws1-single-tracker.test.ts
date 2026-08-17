// WS1 close-out audit (2026-08-15) — C7: single-tracker enforcement.
//
// WHY THIS FILE EXISTS. The 2026-08-14 consolidation (commit `9cf5867`) collapsed
// 29 scattered WS1 tracking/slice/decision/measurement files into
// `docs/work-in-progress.md` §1-§11 plus `sync-pipeline-v2-plan.md`'s append-only
// Part M, specifically so a reader never has to chase cross-references into files
// that don't exist. `docs/work-in-progress.md` itself carries a "SINGLE-TRACKER
// RULE" callout stating this — but a prose warning does not fail a build. This
// test is the enforcement: it runs on every `npx vitest run`, so a new WS1
// tracking/status/decision `.md` file fails at the moment someone creates it, not
// weeks later when a second tracker has silently drifted from the first.
//
// SCOPE: every `.md` file anywhere under `docs/ws1-sync-pipeline/` (recursive).
// Non-`.md` files (the `watcher-revert-2026-08-03.diff` resumption pointer, raw
// `.csv`/`.json` measurement exports) are explicitly out of scope — CLAUDE.md §7
// already governs those, and this rule is deliberately narrower than a general
// docs-tree lockdown.
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS1_DIR = resolve(REPO, 'docs/ws1-sync-pipeline');

/**
 * Every `.md` file the WS1 tree is allowed to contain, repo-relative path.
 * Adding a new tracking/status/decision/design-memo file here requires a
 * deliberate decision, not a silent addition — that's the entire point of the
 * 2026-08-14 consolidation this test enforces.
 */
const ALLOWLIST = new Set<string>([
  // The design/contract source of truth — stages, phases, contracts, risk
  // register, plus its own append-only Part M pointing at the live tracker.
  'docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md',
  // The measurement data index (restored 2026-08-15 close-out audit — CLAUDE.md
  // §7 asserts its existence; deleting it during the 2026-08-14 consolidation
  // was itself a defect, see docs/work-in-progress.md §3/§4).
  'docs/ws1-sync-pipeline/measurements/README.md',
  // Provenance manifest for the rescued-2026-08-07-model-p-park/ data subtree —
  // not a tracking/status file, a fixed record of where that data came from.
  'docs/ws1-sync-pipeline/measurements/rescued-2026-08-07-model-p-park/PROVENANCE.md',
  // The two Stage 1 lock PROCEDURES (WS1 Session G). Not tracking documents —
  // they are worked THROUGH, like docs/wkwebview-drag-checklist.md, CLAUDE.md
  // §7's own standing-procedure exception to the folder-deletion rule: a
  // blinded ear pass with a sealed answer key, and a guarantee-by-guarantee
  // contract checklist with a verdict column. Their RESULTS belong in
  // docs/work-in-progress.md §11 and docs/history.md; the run sheets cannot,
  // because a blinded pass whose key sits inline in the tracker is not blinded.
  'docs/ws1-sync-pipeline/stage1-lock-ear-list.md',
  'docs/ws1-sync-pipeline/stage1-lock-contract-1to2.md',
  // The two Stage 1 lock procedures added by WS1 Session I, same class as the
  // pair above and admitted for the same reason: both are worked THROUGH, not
  // read. The mover audit is a blinded listening pass with a sealed key (which
  // cannot live in the tracker without un-blinding it); the remainder dossier
  // is a decision sheet with a recommended answer per row awaiting owner
  // sign-off. Their RESULTS go to docs/work-in-progress.md §11.
  'docs/ws1-sync-pipeline/stage1-mover-audit.md',
  'docs/ws1-sync-pipeline/stage1-non-ear-remainder.md',
  // The live acceptance run's own run sheet (WS1 Session I) — a walkthrough
  // index worked through against the running app, not a status file. Its
  // RESULTS go to docs/work-in-progress.md §11.
  'docs/ws1-sync-pipeline/stage1-live-run-prep.md',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue; // .DS_Store etc — not git-tracked, not our concern
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('WS1 single-tracker rule — no new .md file outside the allowlist', () => {
  it('every .md under docs/ws1-sync-pipeline/ is on the allowlist', () => {
    const mdFiles = walk(WS1_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => relative(REPO, f).split('\\').join('/')); // normalize on Windows

    expect(mdFiles.length).toBeGreaterThan(0); // the scan itself must not be vacuous

    const offenders = mdFiles.filter(f => !ALLOWLIST.has(f));

    expect(
      offenders,
      'A new .md file appeared under docs/ws1-sync-pipeline/ outside the allowlist ' +
      'in scripts/ws1-single-tracker.test.ts. The 2026-08-14 consolidation ' +
      '(commit 9cf5867) deliberately collapsed 29 scattered WS1 tracking files ' +
      'into docs/work-in-progress.md §1-§11 (execution/status) plus ' +
      'sync-pipeline-v2-plan.md Part M (design-of-record pointer) — see ' +
      'docs/work-in-progress.md\'s "SINGLE-TRACKER RULE" callout. Add new WS1 ' +
      'status/decision/slice content to docs/work-in-progress.md §1-§11 instead ' +
      'of creating a new file. If this file is genuinely not a tracking document ' +
      '(e.g. a data-index or provenance record analogous to the existing ' +
      'allowlist entries), add it to ALLOWLIST above with a one-line reason.\n' +
      'Offenders:\n' + offenders.join('\n'),
    ).toEqual([]);

    // Also verify every allowlisted file still exists — an entry pointing at a
    // path nobody restored is exactly the kind of drift this test exists to
    // prevent, just in the other direction.
    const missing = [...ALLOWLIST].filter(f => !mdFiles.includes(f));
    expect(
      missing,
      'ALLOWLIST names a .md file that does not exist on disk under ' +
      'docs/ws1-sync-pipeline/. Either the file was deleted and this entry is ' +
      'now stale (remove it), or it needs restoring.\nMissing:\n' + missing.join('\n'),
    ).toEqual([]);
  });
});
