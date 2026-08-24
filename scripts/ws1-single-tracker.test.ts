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
  // WS1 Session K's root-cause record for the two mover-audit failures, and the
  // annotated ear list drawn from it. Same class as the procedures above: the
  // ear list is a blinded pass with a sealed key and is worked THROUGH, and the
  // root-cause file is the evidence the owner rules from. CLAUDE.md's rule that
  // an audit report must be persisted into docs/ rather than left in a chat
  // transcript is what requires the first one to exist at all.
  'docs/ws1-sync-pipeline/stage1-session-k-rootcause.md',
  'docs/ws1-sync-pipeline/stage1-session-k-ear-list.md',
  'docs/ws1-sync-pipeline/stage1-non-ear-remainder.md',
  // The live acceptance run's own run sheet (WS1 Session I) — a walkthrough
  // index worked through against the running app, not a status file. Its
  // RESULTS go to docs/work-in-progress.md §11.
  'docs/ws1-sync-pipeline/stage1-live-run-prep.md',
  // WS1 Session S's R.12 placement ear list — the same class again: a run
  // sheet worked THROUGH against the audio, five clips with a play command per
  // row, whose RESULT (which candidate placement is right) goes to
  // docs/work-in-progress.md §11. It is deliberately NOT blinded — the owner
  // has already scored all five of these EARLY, and the question this pass
  // asks is which of two or three named timestamps is correct, which cannot be
  // asked without naming them. R.12's value change is blocked on it.
  'docs/ws1-sync-pipeline/stage1-session-s-ear-list.md',
  // WS1 Session W's 173 pre-fix capture — same class again: a run sheet worked
  // THROUGH against the audio (Section A/B rows, ffmpeg+afplay commands per
  // row), sealed CAPTURE ONLY with blank Ear Verdict/Class columns at the time
  // it was written. Its RESULTS (the Session X ear pass) go to
  // docs/work-in-progress.md §11 and `scripts/ws1-ear-pass-ledger.ts`. Missing
  // from this allowlist since its own landing commit (`dc96fef`) — an
  // oversight in that commit, not a new exception; added here rather than
  // deleting the file, since CLAUDE.md's audit-persistence rule and this
  // test's own stated purpose (run sheets are worked THROUGH, not read) both
  // apply to it exactly as they do to its Session K/S siblings above.
  'docs/ws1-sync-pipeline/stage1-session-w-173-ear-list.md',
  // WS1 Session AC's open-Class-A/B ear list — same class again: a run sheet
  // worked THROUGH against the audio (ffplay commands per row), sealed CAPTURE
  // ONLY with blank Ear Verdict/Class columns. Its RESULTS go to
  // docs/work-in-progress.md §11 and scripts/ws1-ear-pass-ledger.ts.
  'docs/ws1-sync-pipeline/stage1-session-ac-ear-list.md',
  // WS1 Session AE's follow-up root-cause investigation into the FA "phantom
  // text" mechanism. NOT a tracking/status file: it is a single-question
  // forensic report (why does FA place segment 231's words on segment 230's
  // audio), of the same class as `stage1-session-k-rootcause.md` above, and
  // CLAUDE.md §5's rule that an audit/investigation report must be persisted
  // into docs/ rather than left in a chat transcript is what requires it to
  // exist as a file at all. Its STATUS (what was done about it) lives in
  // docs/work-in-progress.md §11, not here.
  'docs/ws1-sync-pipeline/fa-chunk-phantom-root-cause.md',
  // WS1 Session AG's S1-collateral ear list — the same class as the Session
  // K/S/W/AC run sheets above: a listening sheet worked THROUGH against the
  // audio, one ffplay command per row, with blank Verdict/Class columns. It is
  // the adjudication gate S1 was measured against; it came back 18/18 REGRESSION
  // and S1 was rolled back in Session AH. Its RESULTS go to
  // docs/work-in-progress.md §11 and ws1-ear-pass-ledger.ts.
  'docs/ws1-sync-pipeline/stage1-session-ag-ear-list.md',
  // WS1 Session AI's S2-measurement ear list — same class, same discipline: a
  // listening sheet worked THROUGH against the audio, blank Verdict/Class
  // columns. This is the adjudication gate S2 (`computeFaChunkPlanS2`, not
  // shipped) is measured against — 372 rows, decisively over the session's own
  // 25-row cap, on top of 36 ear-verified-control regressions measured
  // independently of any listening pass. Its RESULTS go to
  // docs/work-in-progress.md §11 and ws1-ear-pass-ledger.ts.
  'docs/ws1-sync-pipeline/stage1-session-ai-ear-list.md',
  // WS1 Session AL's v6 arm-D chunk inspection table. NOT a tracking/status
  // file: it is a single-run MEASUREMENT DUMP — one row per chunk, every chunk,
  // written by `scripts/ws1-session-al-step2-generate.test.ts` — and the
  // operator's brief for that session requires it committed and allowlisted in
  // the same commit that produces it. It is admitted for the same reason the
  // run sheets above are: it is read row by row against the audio and the plan,
  // never maintained as a status page, and CLAUDE.md §5's rule that an
  // audit/investigation artefact must be persisted into docs/ rather than left
  // in a chat transcript is what requires it to exist as a file at all. Its
  // STATUS (what was concluded from it) lives in docs/work-in-progress.md §11n.
  // It is .md rather than .csv deliberately — CLAUDE.md §7 keeps CSV/JSON data
  // out of docs/, and the machine-readable twin lives in .work-phase4/.
  'docs/ws1-sync-pipeline/session-al-v6-chunk-inspection.md',
  // WS1 Session AM's substitution-surface measurement. Same class as the arm-D
  // dump above and admitted for the same reason: a single-run MEASUREMENT
  // DUMP, written by `scripts/ws1-session-am-step2-surface.test.ts`, one row
  // per internal chunk edge plus the anchor-coverage and front-loading tables
  // the session's gate is adjudicated against. It is read against the plan, not
  // maintained as a status page; its STATUS lives in
  // docs/work-in-progress.md §11o.
  'docs/ws1-sync-pipeline/session-am-substitution-surface.md',
  // WS1 Session AM's arm-F chunk inspection table — one row per chunk, every
  // chunk, written by `scripts/ws1-session-am-step3-armf.test.ts`. Same class
  // and same reason as the two entries above.
  'docs/ws1-sync-pipeline/session-am-armf-inspection.md',
  // WS1 Session AM's arm-G chunk inspection table, written by
  // `scripts/ws1-session-am-step4-armg.test.ts`. Same class as the entry above,
  // and it additionally carries the standing DIAGNOSTIC-ONLY notice for that
  // arm — it consumes ground truth and can never ship — which is exactly the
  // kind of caveat that must live in a file rather than a chat transcript.
  'docs/ws1-sync-pipeline/session-am-armg-inspection.md',
  // WS1 Session AM's six-arm accuracy measurement and Step 6 adjudication,
  // written by `scripts/ws1-session-am-step5-measure.test.ts`. Same class as
  // the three entries above — a single-run MEASUREMENT DUMP with the gate,
  // predictions-vs-outcomes and the pre-committed conclusion quoted verbatim,
  // not a status page. Its STATUS lives in docs/work-in-progress.md §11o.
  'docs/ws1-sync-pipeline/session-am-six-arm-measurement.md',
  // WS1 Session AN Step 2's edge-accuracy budget: the 67-residual attribution
  // table, the |edge error| vs |boundary error| correlation, and the
  // inferred budget curve, written by
  // `scripts/ws1-session-an-step2-budget.test.ts`. Same class as the AM
  // entries above — a single-run MEASUREMENT DUMP, not a status page.
  'docs/ws1-sync-pipeline/session-an-edge-budget.md',
  // WS1 Session AN Step 3's arm H structural check and per-seam resolution
  // table, written by `scripts/ws1-session-an-step3-armh.test.ts`. Same class
  // as the entries above.
  'docs/ws1-sync-pipeline/session-an-armh-inspection.md',
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
