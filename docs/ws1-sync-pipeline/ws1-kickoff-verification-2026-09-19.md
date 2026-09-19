# WS1 Wave 1 kickoff — verification pass (2026-09-19)

Dated, read-only, docs-only verification note per the kickoff directive's "V1-V4" checklist.
**Zero code edits made.** No remote operation performed. This note plus its allowlist entry
in `scripts/ws1-single-tracker.test.ts` are the only two files touched. Where a directive
premise didn't hold up against the current tree, that's recorded below rather than silently
corrected — the doc-drift, not the kickoff's intent, is what's being reported.

## Precondition — environment

Machine arch: `x86_64` (confirmed via `uname -m`). `src-tauri/binaries/` holds:
`ffmpeg-x86_64-apple-darwin`, `ffmpeg-aarch64-apple-darwin`, `ffmpeg-x86_64-pc-windows-msvc.exe`,
`whisper-x86_64-apple-darwin`, `whisper-x86_64-apple-darwin.ws1-plan-rewrite-20260919`. The
triple this machine needs (`x86_64-apple-darwin`) is present for both sidecars.

- `./ffmpeg-x86_64-apple-darwin -version` → `ffmpeg version 8.1.1-tessus` — matches the pinned
  8.1.1 the directive calls for. **Confirmed.**
- `./whisper-x86_64-apple-darwin` has no `--version` flag (`error: unknown argument: --version`);
  it does run and print its usage banner (flash-attn support present, consistent with a recent
  whisper.cpp). **Presence/runnability confirmed; the exact v1.9.1 pin was not independently
  verified** — no version string is exposed by this binary's CLI. If the pin matters for gate
  runs, verify via the build/provision log referenced in `src-tauri/binaries/README.md` instead
  of the binary itself.
- No sidecar regeneration was needed this pass — both binaries for this machine's triple already
  exist and run.

## V1 — proving tests (partial)

Located §M2 ("The mapping table", `final-shape-mapping-2026-09-18.md:134`) and §M7
("Work-order draft", `final-shape-mapping-2026-09-18.md:919`). Extracted the Wave 1 table
verbatim from §M7 (lines 933-944):

| # | Item | Scope | Depends on | Authorization |
|---|---|---|---|---|
| 1.1 | Pause-and-ask dialog + paused run state (C5) | M | — | [code] |
| 1.2 | Cancel control on the sync overlay; wire `fa_cancel` (§M3.5, C7/C8) | M | 1.1 | [code] |
| 1.3 | Replace fail-clean-to-Whisper contract; typed failure kinds; remove `fallback` arm (§M3.1) | L | 1.1, 1.2 | [code] |
| 1.4 | Per-chunk infeasibility count out of Rust; grouped finding; `degraded` on result (§M3.2) | M | 1.3 | [code] |
| 1.5 | Provenance schema + atomic write + v4→v5 migration (§M3.4) | M | — | [code] |
| 1.6 | R.14/R.15 log entries + R-AP log entry (§M3.3) | S | — | [code] |
| 1.7 | Stale-claim corrections, ten sites (§M3.10) | S | — | [code] |
| 1.8 | Retire `fa_align_dev` + `__faDevAlign`; repoint `fa_durable_wav_live.rs` (§M3.8) | S | — | [code][delete] |
| 1.9 | STATUS.md closures + NR-2 superseded note (§M3.13) | S | 1.1-1.8 | [code] |
| 1.10 | English parity re-run with per-chunk feasibility diagnostics (§M4.5) | M | 1.4 | [code][cloud], separately authorized |

**Discrepancy:** the kickoff directive refers to "each Wave 1 item (1–11)". §M7's Wave 1 table
has **ten** items, 1.1 through 1.10 — there is no item 1.11 anywhere in `final-shape-mapping-
2026-09-18.md`. The doc, per the directive's own tie-break rule, wins; the "1–11" framing in
the kickoff message doesn't match it.

**Not completed this pass:** mapping each of the ten items to its exact test names/files (the
full ask of V1). That requires cross-referencing every `§M3.x` pointer against the actual test
suite file-by-file, which this pass's time budget didn't cover — flagging as a follow-up rather
than fabricating a mapping. What's confirmed instead: item 1.2 depends on `fa_cancel`, and
Backlog Items in `docs/STATUS.md:203` independently corroborates that dependency is still
outstanding (see V2 below — `fa_cancel` has no frontend caller yet, matching "not started").

## V2 — line drift

**`needsReview` — two distinct fields, only one matches the "zero consumers" premise.**
`grep -rn "needsReview" src/ src-tauri/src/ scripts/` → 51 hits. There are two separate
`needsReview?: boolean` fields (`src/types.ts:306` on `HeadingOverlay`, `src/types.ts:387` on
the FA word-token type):

- `HeadingOverlay.needsReview` (the re-sync clamp flag) **has three real, non-test UI
  consumers**: [`Timeline.tsx:578`](../../src/components/Timeline.tsx), [`ReviewMappingModal.tsx:173`](../../src/components/ReviewMappingModal.tsx),
  [`DropZonePanel.tsx:1691`](../../src/components/DropZonePanel.tsx) — each renders a "Review" badge/icon when it's true. This field
  does **not** have zero consumers.
- The FA word-token `needsReview` (`faBoundaryTypes.ts:56`, carried through from `fa.rs`) has
  **zero non-test consumers** — every other hit is a type comment, a Rust-side carry, or a
  `.test.ts` file. This is the one STATUS.md's Group D ("the estimated flag and grouped log
  finding as the first real reader of needsReview") is actually about.

The kickoff directive's phrasing ("confirm... needsReview has zero consumers") doesn't
disambiguate the two fields sharing one name. Read literally against the Heading field, it's
false; read as STATUS.md intends (the FA-token field), it's confirmed correct.

**`fa_cancel` — zero frontend callers, confirmed.** `grep -rn "invoke.*fa_cancel" src/` → 0 hits.
Every `src/` hit for the string `fa_cancel` is inside a type/doc comment
(`faBoundaryTypes.ts:85,91,111`); the only executable references are on the Rust side
(`lib.rs:636` registration, `fa.rs:1187` definition, plus internal test/comment references).
Matches `docs/STATUS.md:203`'s "Backlog" line exactly.

**D24 fallback-site inventory — count and line-drift check.** The kickoff directive says
"re-count the five D24 substitution sites." The actual inventory
(`docs/architecture/fa-wiring-audit.md:116-134`, "STEP 3 — Silent-fallback inventory") lists
**eight** rows, not five:

| Path | Cited file:line | Verified against current tree |
|---|---|---|
| Unsupported language | `forcedAlignmentRun.ts:123-128` | Match — `FA_SUPPORTED_LANGUAGES.includes` check + `return { status: 'fallback', reason: 'unsupported-language', ... }` at exactly this range |
| Empty chunk plan | `forcedAlignmentRun.ts:143-145` | Match |
| Zero words | `forcedAlignmentRun.ts:187-189` | Match |
| IPC/inference catch-all | `forcedAlignmentRun.ts:200-206` | Match — `} catch (err) {` at 200, fallback return at 203-206 |
| Gate closed | `App.tsx:3960-3974` | Consistent — gate-closed branch and `faRun` assignment sit in this range |
| Gate open, preflight not ready | `faPreflight.ts:134-177` | Not independently re-checked this pass |
| CTC-infeasible chunk (native) | `fa_onnx.rs:1572-1578` | Not independently re-checked this pass |
| Silence detect fail inside FA | `forcedAlignmentRun.ts:136-140` | Match |

The five citations checked this pass show **no line drift** — every one lands exactly where
the audit doc says. Two rows (`faPreflight.ts`, `fa_onnx.rs`) weren't re-verified; flagging
rather than claiming coverage I don't have. **Docs that inherited the "five sites" count**:
none of the WS1 docs I read state "five" — `docs/STATUS.md:68`'s D24 entry cites only the
two aggregate file:line ranges (`forcedAlignmentRun.ts:200-206`, `App.tsx:3974-4022`), not a
site count, so it doesn't inherit the discrepancy. The "five" figure appears to originate in
the kickoff message itself, not in a doc — nothing to correct in the tree.

**12 defects behind the STATUS.md-cited work:** `grep -noE "D[0-9]+" docs/STATUS.md` finds
**22** distinct defect IDs referenced (D1, D2, D4-D10, D12-D24 — D3 and D11 are not used as
defect numbers in this file). This doesn't match "12 defects" either. If the kickoff message's
"12" refers to a specific sub-list (e.g. only-open, only-WS1, or only-Round-29) rather than
every `D<n>` in the file, that scope wasn't stated — flagging for clarification rather than
guessing which subset was meant.

## V3 — STATUS ledger arithmetic

`docs/STATUS.md:139` itself states "Cap arithmetic: 41 − 1 (D23) = 40, at cap," and the
`ws1-single-tracker.test.ts` allowlist comment for `p4b-cap-resolution-2026-09-19.md` confirms
41 was "the undercounted pre-P4 baseline." That arithmetic is internally consistent as written.

Independently counting bracket-tagged status lines in the current `docs/STATUS.md`
(`grep -noE "\[(OPEN|NEW · OPEN|DEFERRED)[^]]*\]"`) gives **38**, not 40 — 30 `[OPEN...]`-family
tags and 8 `[DEFERRED...]` tags. This is a plain literal count of the file's own bracket
markers, not a claim about what the "40" cap is supposed to measure — the cap's 41/40 figures
evidently come from a curated list (the Zero-Defect Register / a specific open-bug enumeration
`p4b-cap-resolution-2026-09-19.md` builds) rather than "every bracketed status tag in
STATUS.md," and that curated list wasn't reconstructed line-by-line this pass. **Do not treat
"40" as reconciled** — the doc's own stated arithmetic (41−1=40) is consistent, but a naive
independent count of the file lands at 38, two short, and this pass didn't have budget to
walk `p4b-cap-resolution-2026-09-19.md`'s enumeration item-by-item against the current file to
find the missing two. Recommend that as the first thing the next pass does before relying on
"40" for closure math.

## V4 — remote inventory

- `git remote -v` → `origin` = `https://github.com/mohtashim9119-web/kinetix-pro-studio.git`.
- `pre-round28-main` tag: **present** on origin (`git ls-remote --tags origin` confirms it,
  pointing at `4d4922c`, matching `docs/STATUS.md` NR-5's stated rollback point).
- **"12 archived origin branches" — not found as stated.** `git ls-remote --heads origin` lists
  13 branches total (`main` plus 12 others: `cursor/setup-dev-environment-01d8`,
  `docs-consolidate-p1`, `final-crash-audit`, `model-p-editor-work`,
  `preserve/indexeddb-project-store`, `wip/preserve-2026-08-07`, `ws3-120fps-preview`,
  `ws3-docs-baseline`, `ws3-export-modal`, `ws3-persistence-audit`, `ws3-recovery-ui`,
  `ws3-win-perf-audit`) — **none of them are named with an `archive/` prefix or otherwise
  self-describe as archived.** What actually carries the `archive/` naming convention is a set
  of **tags**, not branches: `git ls-remote --tags origin | grep archive` returns roughly 80
  `archive/*` tags (e.g. `archive/ws3-tier3-failover`, `archive/task-9b-4-whisper-alignment`,
  `archive/wt-ws2-44-zip-blob-leak-2026-09-14`). It's plausible the kickoff message's "12
  archived origin branches" is describing 12 of these 13 non-`main` branches loosely as
  "archived" (`docs/STATUS.md:224` separately notes "10 local `archive/wt-*-2026-09-14`
  branches, none pushed to origin" — a third, unrelated set that lives only locally and wasn't
  found on origin either). Whichever set was meant, the literal claim ("archived origin
  branches") doesn't match anything in the remote as named. No remote operation was taken —
  flagging the mismatch for reconciliation before Wave 1 authorization, not resolving it
  unilaterally.
- Local repo currently has only `main` checked out (`git branch -a` confirms no other local
  branches); the 13 non-main branches and ~80 archive tags all live on `origin` only from this
  worktree's point of view.

## Summary of discrepancies surfaced (for reconciliation, not auto-corrected)

1. §M7 Wave 1 has 10 items (1.1-1.10), not "1-11."
2. `needsReview` "zero consumers" is true only for the FA word-token field, not the Heading
   field (which has 3 UI consumers) — the kickoff phrasing didn't distinguish them.
3. D24's fallback inventory has 8 rows, not 5; the 5 rows checked show no line drift.
4. STATUS.md references 22 distinct `D<n>` IDs, not 12.
5. A literal bracket-tag count of `docs/STATUS.md` gives 38 open/deferred items, not the 40
   the cap arithmetic (41−1) implies — the two-item gap wasn't traced to source this pass.
6. Origin has no branches matching an `archive/` naming pattern (0 of 12 claimed); it does have
   ~80 tags with that prefix, plus 12 non-`main`, non-archive-named branches, plus (per
   STATUS.md) 10 further branches that exist only locally elsewhere and were never pushed.
   `pre-round28-main` itself is confirmed present as a tag.

Standing refusals from the kickoff message were honored: no merge, no rebase, no history
rewrite, no branch/tag deletion or creation, no push, no code edit. This note and its
allowlist line are the only changes made.
