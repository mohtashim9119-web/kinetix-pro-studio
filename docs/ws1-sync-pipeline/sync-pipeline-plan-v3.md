# Sync pipeline plan v3

Operator-signed 2026-09-19; supersedes sync-pipeline-v2-plan (archived e0e3653)

Assembled from the committed record — not written from scratch this pass:
- Rulings: `docs/ws1-sync-pipeline/operator-product-rulings-2026-09-19.md` (recorded from
  `9d50d58`, superseding NR-6 in `docs/STATUS.md`'s NEW RULINGS).
- Waves: `docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md` §M2 (the mapping table)
  and §M7 (the work-order draft).

**Operator signature (binding):** the operator's directive of the zero-leftover-finish
session — including the instruction to commit this plan with this header — is the sign-off
of this document, dated 2026-09-19.

---

## Goal

Honest, fast, stamped, cloud-backed: every failure visible, every timing labelled, every
case covered. No rebuild of what already works.

## Definition of done (8 scorecard criteria)

1. Zero silent fallbacks — enforced at the type level, and tested (no `fallback` arm on
   `FaRunResult`; every failure path is a typed, named outcome).
2. Zero fabricated timings — no synthesized or estimated duration presented as measured.
3. 100% provenance-stamped, with `legacy=engine-unknown` for pre-stamp data rather than a
   guessed engine.
4. All 29 failure-mode cells (§M5 of the final-shape mapping) tested, not just the common
   paths.
5. All compute is bounded, cancellable, and restart-safe — Hirschberg included.
6. Six gates green from `main` (tsc, lint, `npm test`, `cargo test`, `cargo test --features
   fa-inference`, golden replay) before any wave is called done.
7. Frozen assets and their digests recorded — Part AL of `sync-pipeline-v2-plan.md` remains
   the canonical registry; this plan does not restate it.
8. Docs equal tree — the WS1 single-tracker rule (`scripts/ws1-single-tracker.test.ts`) holds,
   and `CLAUDE.md`'s ~400-line cap is held, not worked around.

## Wave 0 — DONE (baseline)

Merge `05b011f`; consolidation `6e09176` → `a0120f7`. Baseline is clean, six gates green,
frozen assets registered (Part AL).

## Wave 1 — Trust (lands as its own merge)

Local-only, independently shippable, and the prerequisite for deleting the FA gate in
Wave 2 — failure has to be visible before FA can be made unconditional.

1. `fa_dev.rs` cache-clear race fix.
2. `whisper.rs` 16-entry terminal-buffer eviction race fix. (Both 1 and 2: verified via 20
   consecutive clean runs — a repro-count gate, not a one-shot pass.)
3. Delete the `fallback` arm from `FaRunResult` — every failure becomes a typed
   `paused` / `cancelled` outcome instead of a silent substitution.
4. Restart-safe pause-and-ask dialog (paused run state survives a restart).
5. Cancel wired everywhere on the sync path, including `fa_cancel`.
6. Infeasible chunks surface as an estimated flag plus a grouped finding — the first thing
   `needsReview` reads, not a per-chunk count buried in Rust.
7. R.14 / R.15 log entries, plus the R-AP log entry.
8. Provenance stamp + `projectStore` v5 migration (pre-stamp data labelled
   `legacy=engine-unknown`, never guessed).
9. Atomic staged-audio write.
10. Whisper weight-integrity gate.
11. Partition invariant test (Model P gapless partition — approved per the operator rulings,
    no further sign-off needed to rely on it in planning).

**Exit:** scorecard criteria 1, 3, and 8 pass in full; criterion 5 partial (Hirschberg's
bound is Wave 2). Six gates green from `main` before merge.

## Wave 2 — One engine, speed, spine

1. Engine resolver + picker — both existing toggle UIs deleted, `faGate` retired. FA becomes
   unconditional once failure is visible (Wave 1 prerequisite satisfied).
2. Settings → Sync tab: Local becomes savable once Whisper is ready AND at least one selected
   language pack is ready — evaluated per-pack, not gated on the slowest pack.
3. `computeRunContext`/matcher deduplicated from 6 call sites to 1; moved to a worker; bound
   from measured timings (3s / 12s), not a guess.
4. Content-hash spine: `audioHash` + normalized `scriptHash`.
5. WPM sanity check: warn range 140–180, warn-only — never blocks or auto-corrects.
6. Local pre-FA coverage check.
7. Language/vocabulary normalization wired end to end (runtime data loader + packaging).
8. ~180 dead lines stripped (`fa_align_dev` / `__faDevAlign` retired); `fa_dev.rs` renamed to
   reflect that it is production code, not a dev harness.
9. Six-group sync log UI.
10. Build-flag unification — `tauri:build` gains `-f fa-inference` so the production build
    path and the dev-with-FA path stop diverging.
11. Scene-anchor IDs + an honest Apply Sync (no silent re-anchoring).
12. Content-addressed import.
13. Offline contract documented: pause-and-offer-local, never auto-switch — losing
    connectivity mid-job pauses and presents the local option; it never silently reroutes.
14. Stale-doc sweep (the ten stale-claim sites named in the mapping's §M3.10).

**Exit:** scorecard criterion 5 passes in full (Hirschberg bound measured, not guessed).

## Wave 3 — Cloud

1. Gateway + CSP `connect-src` + 16kHz mono Opus upload.
2. One job on the wire per project, two cached pipeline stages behind it (not atomic-or-
   nothing) — the cloud pipeline's one-job/two-stage shape is an operator ruling, not an
   implementation default.
3. Mid-coverage abort before FA compute runs, on a script/audio mismatch discovered after
   transcription has already happened — the user bears the transcription cost already
   incurred; this is a deliberate cost-allocation decision, not a bug to route around.
4. Retry-once, then pause (never a silent infinite retry).
5. Cloud cancel is zero-charge.
6. Cloud provenance values recorded distinctly from local/legacy.
7. English parity re-run (authorized spend, per the Wave 1.10 cloud authorization).
8. French, German, Portuguese validated via public-domain native-speaker audio — not
   synthetic TTS and not English-accented readings.
9. One-hour job cap, with a test enforcing it.
10. Cloud becomes the actual default engine only once the above is complete and green
    (Local is savable per Wave 2, but cloud-default is a Wave 3 exit condition, not a Wave 1
    assumption).

## Non-goals (this plan)

- Phase 4–6 deep rebuild.
- Propose/arbitrate engine-selection UX.
- SaaS billing / credits mechanics — stripped from this pass's scope per the operator ruling
  on `docs/architecture/saas-target-architecture.md`; the product is planned
  internal-product-first here.
- A local-FA-first swap with model-conditional selection.

## Merge cadence

Every wave lands green on all six gates, from `main`, before the next wave opens. Merge
never rebase — no history rewrites, ever, including via `git lfs migrate` (published SHAs
are cited across these docs).

---

Wave 1 opens on the final SHA of the zero-leftover-finish pass that commits this document.
