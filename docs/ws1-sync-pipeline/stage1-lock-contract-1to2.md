# Stage 1 Lock — Contract 1→2 Guarantee-by-Guarantee Pass (WS1 Session G, 2026-08-17)

> **What this is:** the twelve-row Contract 1→2 verification the Stage 1 lock gate requires
> ("Contract IN and Contract 1→2 verified guarantee-by-guarantee by owner inspection",
> `sync-pipeline-v2-plan.md:5048`). The evidence dossier was assembled in-chat at `0d8420f`
> and never committed; this file is that pass, **re-verified live at HEAD** rather than
> transcribed, so every claim below was re-grepped this session and is annotated with what
> actually produced it.
>
> **This is a document to work through, not a report to read.** Each row has a verdict
> column for you to fill and a single concrete question to answer.

**Contract 1→2 = Stage 1 → Stage 2** (prepared tokens / silences / normalized text →
alignment). Source text: `sync-pipeline-v2-plan.md:5570-5590`. Twelve rows: **P1–P8**
(producer guarantees, Stage 1) and **A1–A4** (consumer assumptions, Stage 2).

---

## 0. The one thing that changed this session, before the table

**WS1 Session G moved the FA gate's default from OFF to ON** (per-project,
`Project.faHighPrecisionSync`, owner ruling R-AK). That does not add, remove, or reword any
row below. It changes the **severity of one already-recorded finding**, and the change is
material enough to state before the table rather than inside it:

> **The `validate1to2` gap is now on the live path.** `validate1to2` — which wraps P2
> (`validateTokenOrdering`) and P3 (`analyzeDropDistribution`) — is invoked from exactly one
> place: `useWhisper.ts:290`, inside `startTranscription`'s fresh-transcription staging path.
> It is **never** invoked from `alignFromCache`, which is the function the Apply-Sync commit
> path actually calls, including the FA branch. So P2 and P3 have never validated the array
> Apply Sync commits from.
>
> This was true before FA existed. What changed: while the FA gate defaulted OFF, the
> FA-substituted token array was a path almost nobody took. **With the gate now defaulting
> ON, the unvalidated array is the default array** on any Tauri-capable machine with a model
> and a supported project language. The defect did not get worse; its exposure did.
>
> Verified live this session: `grep -rn "validate1to2" src/` → 3 hits, one import, one call
> site (`useWhisper.ts:290`), one definition (`syncContracts.ts:179`).

---

## 1. Producer guarantees (Stage 1) — P1..P8

| # | Guarantee | Live evidence (re-verified at HEAD) | Label | Your verdict |
|---|---|---|---|---|
| **P1** | Every token has finite timestamps, `0 ≤ start < end ≤ audioDuration + tol`, text normalizes non-empty; malformed tokens dropped with reasons recorded | `filterMalformedTokens`, `whisperService.ts:1288` — exists, exported, invoked on the staging path and by R.10's own `detectUnspokenScriptSegmentsFromWhisper` | **DIRECT** | |
| **P2** | Tokens are ascending in time | `validateTokenOrdering`, `syncContracts.ts:152` — exists and is correct. **But** it is reachable only via `validate1to2`, which the commit path never calls (see §0) | **PARTIAL — implemented, not on the committed path** | |
| **P3** | Drop distribution reported; clustering flagged | `analyzeDropDistribution`, `syncContracts.ts:102` — same reachability defect as P2 | **PARTIAL — same defect as P2** | |
| **P4** | Silences ascending, disjoint, each ≥ minimum duration | Runtime assertion is a REQUIRED ADDITION and does not exist: `grep -rn "silence-scan-anomaly" src/` → **0 hits**, re-confirmed this session. True by construction today; unasserted | **ABSENT — Phase 4 scope** | |
| **P5** | "Silence scan failed" and "no silence found" are distinct states | `silenceDetector.ts:20-22` — `SilenceDetectResult = {status:'ok', silences} \| {status:'error', errorMessage}`. A discriminated union; callers cannot read `.silences` without narrowing | **DIRECT (type-level)** | |
| **P6** | Both text sides pass through the SAME language-keyed normalizer; English path byte-identical to pre-v2 | One module, one entry point (`textNormalize.ts`'s `canonicalize`/`stripStageDirections`, CLAUDE.md §3). Phase 3b DONE; Phase 3c CLOSED 2026-08-15 **by written acceptance, not by fix** — the hyphen asymmetry is documented and accepted. Symmetry itself remains manually-verified | **PARTIAL — this row is the one P6 asks you to verify** | |
| **P7** | The timing source that produced the timestamps is identified on the output | `types.ts:223` — `anchorSource?: 'forced-alignment' \| 'whisper' \| 'estimate'`. Set per-run at `App.tsx`'s FA branch (`faTokens ? 'forced-alignment' : 'whisper'`), demote-only per R-G | **PARTIAL — lives on the *segment*, not per-token / per-Stage-1-output as the contract literally specifies** | |
| **P8** | Tokens, silences, audioDuration, normalized script segments returned as ONE object | Not built. `project.transcriptTokens` remains separately reachable — **22 non-test references** at HEAD. `useWhisper.ts`'s own doc comment warns callers to prefer `AlignFromCacheResult.tokens`: discipline, not type enforcement. This is old R7 | **ABSENT — Phase 4 scope** | |

## 2. Consumer assumptions (Stage 2) — A1..A4

| # | Assumption | Live evidence (re-verified at HEAD) | Label | Your verdict |
|---|---|---|---|---|
| **A1** | Whitespace splitting yields words for the project language | Manually-verified for the supported five (H.0); guarded outside it — the `unsupported-language` entry exists (`types.ts:459`, `constants.ts:27`) and fires as an ERROR + banner | **DIRECT for en/es; the guard is real** | |
| **A2** | A token's text may hold multiple words / normalize oddly | Runtime token-word expansion exists and is carried; exercised by the sync-timing suite | **DIRECT** | |
| **A3** | Every parsed segment has an estimate `anchorStart` (rescue windows key off it) | `parseProjectData` (`App.tsx:569`) assigns `anchorStart` + `anchorSource: 'estimate'` on the character-weight bootstrap — every parsed segment, unconditionally | **DIRECT** | |
| **A4** | Alignment cost is bounded for real inputs | **UNENFORCED.** `__ALIGN_INSTRUMENT__` exists (`whisperService.ts:94-95`) and is **dormant by default**. Old R12 | **ABSENT — needs written acceptance or a bound** | |

---

## 3. Tally

| label | rows | which |
|---|---|---|
| **DIRECT** | 5 | P1, P5, A1, A2, A3 |
| **PARTIAL** | 4 | P2, P3, P6, P7 |
| **ABSENT** | 3 | P4, P8, A4 |

**5 DIRECT / 4 PARTIAL / 3 ABSENT out of 12.**

This is consistent with `docs/work-in-progress.md` §9's own "5 of 8 met" on the narrower
P1–P8 table, and refines it: the four PARTIALs are not near-misses of the same kind. P2/P3
are *built but unreachable from the committed path*; P6/P7 are *built and reachable but
narrower than the contract's literal wording*.

---

## 4. What actually blocks the Stage 1 lock here

Three of the twelve are Phase 4 scope by the plan's own scheduling (**P4, P8** — and **A4**
is explicitly "close-or-accept at Stage 2 lock"). Those are not Stage 1 regressions and do
not need to be built now. What they need is **written acceptance**, which two of them still
lack:

- **Contract 1→2 A4** (alignment cost bound / `__ALIGN_INSTRUMENT__` dormant) — no written
  acceptance on record.
- **Contract IN A3** (script/scene language vs. `Project.language`) — no written acceptance
  on record. *(Contract IN, not 1→2, but it is the other half of the same lock criterion and
  is listed here so the gate is not passed with one of its two contracts half-done.)*

The one that is **not** schedulable away is **P6**, because P6's enforcement is, by the
plan's own text, *"symmetry property manually-verified"* — i.e. this pass **is** its
enforcement. Phase 3c's closure was an acceptance of one manifestation (the hyphen
asymmetry), not a verification of the property.

**The single question P6 asks you to answer:** *both the script text and the transcript text
go through `textNormalize.ts`'s one entry point — is there any case in the en/es corpora
where they are normalized differently?* If yes, Stage 1 reopens. If no, P6 moves DIRECT and
this contract's blocking set reduces to the two written acceptances above.

---

## 5. Effect of R.5 / R.10 / R.11 on this contract: NONE

Carried forward, and re-confirmed this session rather than restated: all three rules run
**after** inference, on FA's own output, and none of them changes how many script words
exist or what `qi` index any word carries. `normalizeSceneDoc` word counts,
`computeRunContext` offsets and `assertQiMapConsistent` are untouched; all three
anchor/run/chunk digests are bit-identical, which is what the FA replay gate's `ANCHOR_PATH`
block pins — and it required **zero re-pin** across Sessions D, E and F.

**WS1 Session G adds one more no-op to that list:** the per-project FA toggle changes only
*whether* `runForcedAlignmentForSync` is called, never what any contract row's producer or
consumer does. `git diff` this session touches no file that participates in token
preparation, normalization, or silence detection. **No row above changes.** Golden replay
6/6.

The single non-no-op is the severity escalation in §0, which is a change in **exposure**,
not in the contract.
