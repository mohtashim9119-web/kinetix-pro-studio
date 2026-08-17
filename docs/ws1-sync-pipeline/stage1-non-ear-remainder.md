# Stage 1 Lock — Non-Ear Remainder Dossier (WS1 Session I, 2026-08-18)

> **What this is:** every remaining Stage 1 lock item that **cannot be settled by listening**,
> assembled as one document answerable in a single sitting. The ear-answerable remainder lives
> in `stage1-mover-audit.md`; between the two, the Stage 1 lock's open set is fully covered.
>
> **Every row carries a recommended answer**, so it can be agreed or overridden rather than
> researched. Nothing here needs a fresh investigation to answer — where a measurement is
> genuinely required (P6 only), the exact measurement is specified and scoped.
>
> **Verified at HEAD `726112b`.** Nine items, in four groups.
>
> ---
>
> ## OWNER SIGN-OFF — all nine answered, 2026-08-18 (WS1 Session J)
>
> **Every one of the nine was answered AS RECOMMENDED.** Recorded here at the head of the
> file so the dossier is self-contained: a reader no longer has to hold "recommended" and
> "decided" apart in their head, and nothing below needs re-deciding.
>
> | # | item | recommended | **owner's answer** | where it landed |
> |---|---|---|---|---|
> | A1 | Contract 1→2 **P6** normalizer symmetry | BUILD the measurement | ✅ **BUILT** | `src/services/normalizerSymmetry.test.ts` — 7 tests. **Zero asymmetries found.** See the P6 result block below |
> | B1 | Contract 1→2 **A4** | ACCEPT as written | ✅ **ACCEPTED AS WRITTEN**, scoped to Stage 1 only; returns as close-or-accept at the Stage 2 lock | text in §B1, unedited |
> | B2 | Contract IN **A3** | ACCEPT as written | ✅ **ACCEPTED AS WRITTEN**, with the fr/de/pt carve-out intact | text in §B2, unedited |
> | C1 | **R-S(iii) / R7** runtime | ACCEPT-for-toggle, DEFER for default | ✅ **ACCEPTED FOR THE TOGGLE; DEFERRED FOR THE DEFAULT.** The digest memo is recorded as the precondition that must land before the default flip is re-attempted | §C1 |
> | D1 | **Step T** | CONFIRM out of Stage 1 | ✅ **CONFIRMED OUT OF STAGE 1** — release-build-phase work, ≈10.5 engineer-days + ≈1 day for R-N's implementation | §D1 |
> | D2 | D-1 item 4 (no-voiceover) | ACCEPT subset + re-word | ✅ **ACCEPTED**; the item is re-worded to drop the reference to an "estimated timeline" surface the app does not implement | §D2–D5 acceptance text |
> | D3 | D-1 item 5 (silence-scan failure) | ACCEPT subset | ✅ **ACCEPTED** — the fallback sits inside CLAUDE.md §6's standing, documented manual-verification gap for hooks | same |
> | D4 | D-1 item 8 (export/preview) | ACCEPT subset, discharge in the live run | ✅ **ACCEPTED**, to be discharged by the live acceptance run's preview walkthrough | same |
> | D5 | D-1 item 9 (DEV harnesses) | ACCEPT as permanently unautomated | ✅ **ACCEPTED AS PERMANENTLY UNAUTOMATED** — a deliberate permanent exclusion, not a deferral, so it stops reappearing as an open item every session | same |
>
> **D-1's automated count therefore stands at 5 of 9, with the remaining four ACCEPTED rather
> than pending — and item 9 closed for good rather than deferred.**
>
> ---
>
> ## A1 / P6 — THE RESULT, since this was the one item that was built rather than accepted
>
> **PASS. Zero asymmetries. P6 moves PARTIAL → DIRECT, and Stage 1 does not reopen.**
>
> Built as `src/services/normalizerSymmetry.test.ts` (a standing test in the `npm test` pass,
> not a one-off harness), importing the production functions `canonicalize` /
> `stripStageDirections` / `normalize` / `normalizeSceneDoc` and reading the same committed
> fixtures the golden replay already reads. Four things were measured:
>
> 1. **Cross-side lexical agreement** — every raw word appearing on either side mapped to a
>    normalized form, both sides pooled. **Zero words reach two different forms.** This is
>    P6's own question answered directly.
> 2. **Compositionality** — the transcript side normalizes ONE TOKEN AT A TIME while the
>    script side normalizes a WHOLE SEGMENT. This was the real risk and had never been
>    checked: `canonicalize` performs genuinely multi-word rewrites (`1985` → nineteen eighty
>    five, `26` → twenty six, `don't` → do not), which is exactly the shape that breaks
>    compositionality if it reaches across a whitespace boundary. **It does not.** Per-token
>    and whole-text normalization produce byte-identical word streams on all three corpora
>    (v6 3998 = 3998, 173 1837 = 1837, spanish 363 = 363).
> 3. **Language keying** — both wrappers thread `languageCode` into the same `canonicalize`,
>    verified on the Spanish corpus where the key does real work.
> 4. **The one deliberate asymmetry**, `stripStageDirections` (script-side only, by design).
>
> **TWO COVERAGE LIMITS, REPORTED RATHER THAN ABSORBED — neither is an asymmetry, both bound
> what this discharge is entitled to claim:**
>
> - **The Spanish corpus exercises the compositionality property not at all.** 363 tokens, and
>   **zero** of them expand: no digit, no contraction, no hyphen. Its pass is *vacuously*
>   true. P6's English half is verified for real; its Spanish half rests on a corpus
>   containing no construct capable of falsifying it. Asserted in the test (pinned at 0) so
>   the note fails loudly if Spanish material with digits is ever added.
> - **`stripStageDirections` never fires on any corpus in scope** — measured at 0 of 444 v6,
>   0 of 172 in 173, 0 of 26 in Spanish. So the one deliberate script-side-exclusive step
>   contributes no asymmetry *because it never runs on this material*, not because it was
>   shown benign. The "it only ever removes words" assertion is kept as the guard for a
>   future corpus that does contain directions, and earns no credit for P6 today.
>
> Both limits are pinned as assertions rather than prose, so neither can outlive its truth.

---

## Group A — the one item that needs a measurement (1 item)

### A1. Contract 1→2 **P6** — normalizer symmetry

**The guarantee.** *Both text sides pass through the SAME language-keyed normalizer; the
English path is byte-identical to pre-v2.*

**Status.** PARTIAL. There is one module and one entry point (`textNormalize.ts`'s
`canonicalize` / `stripStageDirections`) — the structural half is DIRECT. Phase 3b is DONE
and Phase 3c CLOSED 2026-08-15 **by written acceptance, not by fix** (the hyphen asymmetry is
documented and accepted). What is unverified is the *property itself*: that the script side
and the transcript side are, in fact, normalized identically on real inputs. The plan's own
enforcement text is "symmetry property manually-verified" — which means **the verification is
the enforcement**. There is no automated gate to point at.

**The question, stated once:** *is there any case in the en/es corpora where the script text
and the transcript text are normalized differently?*

**The measurement that answers it — specified, not hand-waved.** This is a self-contained,
read-only script; no production code changes, no rebuild, no listening.

1. For each corpus (v6, 173, spanish), load the committed script segments and the committed
   Whisper token texts from the existing fixtures
   (`scripts/fixtures/phase4-baseline-{corpus}-segments.csv` and
   `-words.csv` — both already read by the golden replay, so no new fixture path is created).
2. Push **both** sides through `textNormalize.ts`'s `canonicalize` at the project's language,
   importing the production function rather than reimplementing it (the same discipline the
   R.11 evidence artifact used).
3. Compare the resulting token streams. Report every position where the two sides produce a
   different normalized form for what is lexically the same word.
4. **Pass condition:** zero asymmetries outside the already-accepted Phase 3c hyphen class.
   Any asymmetry outside that class reopens Stage 1.

**Cost.** One new test file under `src/services/`, ~120 lines, no new fixtures, runs in the
existing `npm test` pass. Estimated **1–2 hours**, entirely inside Stage 1 scope.

**RECOMMENDED ANSWER: build the measurement.** It is the cheapest item in this dossier, it is
the only one whose absence can hide a live Stage 1 defect, and — unlike everything below — it
converts a PARTIAL to a DIRECT rather than accepting it. Accepting P6 in writing instead would
be accepting a property nobody has ever checked, which is a different act from accepting P4/P8
(known-absent, scheduled) or A4 (known-dormant, measured).

---

## Group B — the two written acceptances (2 items)

Both are Phase-4-scope by the plan's own scheduling. Neither needs to be built now. Both need
**written acceptance on record**, which is what is missing. The exact text to accept or reject
is given verbatim — sign it as written, edit it, or reject it.

### B1. Contract 1→2 **A4** — alignment cost is bounded for real inputs

**Status.** ABSENT / UNENFORCED. `__ALIGN_INSTRUMENT__` exists
(`src/services/whisperService.ts:94-95`) and is **dormant by default**. This is old R12. The
plan schedules A4 as "close-or-accept at Stage 2 lock".

> **Proposed acceptance text — Contract 1→2 A4.**
>
> *Contract 1→2's consumer assumption A4 (alignment cost is bounded for real inputs) is
> ACCEPTED UNENFORCED for the Stage 1 lock. The Hirschberg aligner's cost is bounded in
> theory and has never exceeded its budget on any of the three corpora in any measured run;
> `__ALIGN_INSTRUMENT__` remains available but dormant, and no runtime bound is asserted in
> code. This acceptance is scoped to Stage 1 only: A4 returns as a close-or-accept decision at
> the Stage 2 lock, where alignment is the stage under test rather than a dependency of it.
> Accepting A4 here does not accept it there.*

**RECOMMENDED ANSWER: ACCEPT as written.** Stage 1's job is producing prepared tokens and
silences; alignment cost is Stage 2's own subject. Enforcing a bound here would be building a
Stage 2 gate inside Stage 1's lock.

### B2. Contract **IN** **A3** — script/scene language vs. `Project.language`

**Status.** No written acceptance on record. This is Contract IN rather than 1→2, and it is
listed with B1 because it is the other half of the same lock criterion — the gate reads
"Contract IN **and** Contract 1→2 verified guarantee-by-guarantee", so passing it with one
contract half-done would not be passing it.

> **Proposed acceptance text — Contract IN A3.**
>
> *Contract IN's assumption A3 (the script and scene-document text are in the language
> `Project.language` names) is ACCEPTED AS AN UNVERIFIED USER-INPUT ASSUMPTION for the Stage 1
> lock. The app does not detect the language of the script or scene document and does not
> cross-check either against `Project.language`; a user who supplies English text on a project
> marked `es` will get a silently degraded alignment. This is accepted because (a)
> `Project.language` is itself sticky-once-set from Whisper's own detection of the AUDIO, so
> the common path derives it from real evidence rather than from a guess, and (b) the
> mismatch case is a user-input error with no silent-corruption consequence beyond that
> project's own timing. It is NOT accepted for the non-English expansion: R-T's deferred
> fr/de/pt work must state whether a script-language check becomes a requirement there.*

**RECOMMENDED ANSWER: ACCEPT as written.** It is a genuine gap, but it is a user-input
assumption of the kind every contract has at its inlet, and the sticky-language invariant
already covers the path that matters. The fr/de/pt carve-out is the part worth keeping.

---

## Group C — the runtime item (1 item)

### C1. **R-S(iii) / R7** — FA runtime, undischarged for the DEFAULT

**Status.** Live and undischarged. R-S(iii) says criterion (iii) "cannot be marked met until a
runtime figure — optimized or otherwise — is separately ruled acceptable for a change that
runs on every Apply Sync, not an opt-in one." R-AD deliberately re-opened it. R7 is
undischarged alongside it.

**The current measured numbers, restated (not re-measured this session):**

| quantity | figure | source |
|---|---|---|
| v6 full chunked FA run, wall-clock | **~231 s** | 2026-08-15 smoke test |
| 173 full chunked FA run, wall-clock | **~76 s** | same |
| `verify_model_manifest` full-file SHA-256, **debug** build | **77.43 s** | WS1 Session F, real 1.26 GiB model |
| `verify_model_manifest` full-file SHA-256, **release** build | **5.25 s** | WS1 Session F |
| missing `ORT_DYLIB_PATH` | near-instant, before any file I/O | WS1 Session F |
| absent model file | **266.7 µs** | WS1 Session F |

Two facts that changed the shape of this item since R-S was written, both already on record:

1. **Verification cost is per-call and uncached.** `verify_model_manifest` re-hashes the whole
   model on **every** FA call, so a healthy model pays roughly the release-mode figure
   (~5–8 s/language) on top of inference. In a debug build it pays ~77 s — which is the only
   build FA can currently run in at all.
2. **The default is OFF again.** Session H reverted `FA_PROJECT_DEFAULT_ON` `true → false`.
   R-S(iii) gates the DEFAULT specifically, so with the default OFF this item **does not block
   the Stage 1 lock** — it blocks the next attempt to flip the default.

**RECOMMENDED ANSWER: rule R-S(iii) ACCEPTED-FOR-TOGGLE and explicitly DEFERRED for the
default, with one cheap precondition attached.** Concretely: accept ~231 s v6 / ~76 s 173 as
the opt-in toggle's cost (already accepted once, in R-S itself); keep (iii) live for the
default; and record that **the digest memo is the prerequisite that must land before the
default flip is re-attempted**, because a per-call full-file re-hash is a defect rather than a
cost — caching it removes ~5–8 s/call in release and ~77 s/call in debug for zero accuracy
change. Do not scope inference optimization: 231 s is the model's, not the app's.

---

## Group D — Step T, and the D-1 automation choices (5 items)

### D1. **Step T** — on-demand model download

**Status.** **Design COMPLETE, zero implementation.** T.0–T.8 are fully specified in
`sync-pipeline-v2-plan.md:3106-3300`: the size problem, cache location, SHA-256 pinning,
resumable range-request download, eviction, three manual-ingestion entry points, failure
modes, the fr/de/pt UNVALIDATED labelling, and an explicit "what this does not cover". R-N is
now CLOSED by R-AL (`load-dynamic` + bundled dylib), which was the blocker on finalizing the
design. **No Rust exists.**

**Scope and build estimate, by subsection:**

| unit | work | estimate |
|---|---|---|
| T.0 prerequisite | remove `bundle.resources: {"models/*": "models/"}` from `tauri.conf.json`; move to per-architecture installers | **0.5 day** (the config edit is minutes; per-arch installers are the real cost) |
| T.1 + T.2 | `app_local_data_dir()` cache layout, `manifest.json` read/write, build-time pinned SHA-256 registry (`models/registry.rs`) | **1.5 days** |
| T.3 | resumable HTTP range download, `.partial/<sha256>.part` staging, atomic promote | **2 days** |
| T.4 + T.5 | eviction policy + three manual-ingestion entry points onto one code path | **1.5 days** |
| T.6 | failure modes (the section that explicitly matters more than the happy path) | **1 day** |
| T.7 | fr/de/pt UNVALIDATED on three user-facing surfaces | **0.5 day** |
| UI | download progress, cancel, per-language install state | **2 days** |
| tests | unit + a real end-to-end download against a pinned artifact | **1.5 days** |

**Total: ≈ 10.5 engineer-days**, plus the R-N implementation R-AL created (bundle and sign the
dylib, set `ORT_DYLIB_PATH` at runtime) at **≈ 1 day**. Call it **two to two-and-a-half
weeks** of focused work, all of it in `src-tauri/`.

**RECOMMENDED ANSWER: confirm Step T is OUT of Stage 1 scope and belongs to the release-build
phase.** It is not a sync-pipeline item — it is distribution. Nothing in Stage 1's lock depends
on it, and the live acceptance run does not need it (the models are already resident on this
machine). Recording it as release-phase work with the estimate above is the answer; building it
now would stall the lock behind two weeks of packaging work.

### D2–D5. **D-1 items 4, 5, 8, 9** — build the real test, or accept the automated subset

Five of D-1's nine are automated for real in `src/services/d1RegressionChecklist.test.ts`
(items 1, 2, 3, 6, 7 — 23 tests, through production functions against real corpus fixtures).
These four are not. Each needs an explicit choice.

| # | item | what exists | what a real test would cost | **RECOMMENDED** |
|---|---|---|---|---|
| **D2** | **item 4 — no-voiceover** | WEAK PROXY. Half of it is **untestable because the thing it names does not exist**: `grep "estimated timeline" src/` → 0 hits | Building the missing feature first, then testing it — this is a feature request wearing a checklist row's clothes | **ACCEPT the subset, in writing, and RE-WORD the item.** Do not build. The row names a behaviour the app does not have; the honest fix is to correct the checklist, not to fake coverage. The `applyAnchorBasedTiming` bootstrap guard found while building item 6 already pins the load-bearing half |
| **D3** | **item 5 — silence-scan failure** | WEAK PROXY. The error *shape* is a tested discriminated union (P5, `silenceDetector.ts:20-22`); the *fallback* lives in `useWhisper.ts` | A hook test — squarely inside CLAUDE.md §6's **accepted** manual-verification gap for `useWhisper.ts`/`usePlayback.ts`/`useGlPreview.ts`/`useExport.ts` | **ACCEPT the subset, in writing.** Overriding a standing, documented architectural gap for one checklist row is the wrong trade. The type-level half is genuinely covered |
| **D4** | **item 8 — export/preview consumers** | WEAK PROXY. Shape invariants covered; *"reads correctly"* is a render claim | A running-app render assertion — real, but it is the **live acceptance run's** job, and the walkthrough already exercises preview on every project | **ACCEPT the subset, in writing, and DISCHARGE it in the live run.** Cheapest real coverage available: it costs nothing extra because the walkthrough plays preview anyway |
| **D5** | **item 9 — DEV harnesses** | **NO PROXY AT ALL.** The globals are attached by DEV-gated `App.tsx` effects; nothing short of mounting `App` exercises them | Mounting `App` in a test environment — a first-of-its-kind harness in this repo, **2–3 days**, and it would test DEV-only scaffolding that never ships to a user | **ACCEPT, in writing, as PERMANENTLY UNAUTOMATED.** This is the one to say "no" to outright rather than "not yet". Spending three days building an App-mounting harness to cover DEV-gated debug globals inverts the cost/value ratio; state it as a deliberate permanent exclusion so it stops reappearing as an open item every session |

> **Proposed acceptance text — D-1 items 4, 5, 8, 9.**
>
> *D-1 items 4, 5, 8 and 9 are ACCEPTED at their current automated subset. Item 4 is re-worded
> to remove the reference to an "estimated timeline" surface the app does not implement; item 5
> is covered at the type level and its fallback falls inside CLAUDE.md §6's accepted
> manual-verification gap for hooks; item 8's render claim is discharged by the live acceptance
> run's preview walkthrough rather than by a unit test; item 9 is accepted as PERMANENTLY
> UNAUTOMATED, on the grounds that mounting `App` to exercise DEV-gated debug globals costs
> more than the coverage is worth and would test scaffolding that never reaches a user. D-1's
> automated count stands at 5 of 9, with the remaining four accepted rather than pending.*

---

## Summary — nine decisions, one sitting

| # | item | recommended answer |
|---|---|---|
| A1 | Contract 1→2 **P6** normalizer symmetry | **BUILD** the measurement (1–2 h) — the only item that can hide a live Stage 1 defect |
| B1 | Contract 1→2 **A4** | **ACCEPT** as written, scoped to Stage 1 only |
| B2 | Contract IN **A3** | **ACCEPT** as written, with the fr/de/pt carve-out |
| C1 | **R-S(iii) / R7** runtime | **ACCEPT-for-toggle, DEFER for default**; attach the digest memo as the flip's precondition |
| D1 | **Step T** | **CONFIRM out of Stage 1**; release-phase, ≈10.5 days + 1 day R-N |
| D2 | D-1 item 4 | **ACCEPT** subset + re-word the item |
| D3 | D-1 item 5 | **ACCEPT** subset (hooks gap) |
| D4 | D-1 item 8 | **ACCEPT** subset, discharge in the live run |
| D5 | D-1 item 9 | **ACCEPT as permanently unautomated** |

**Eight accepts, one build.** If all nine are answered as recommended, the non-ear remainder
closes and the Stage 1 lock's only open work is the mover audit in `stage1-mover-audit.md`
plus the live acceptance run.
