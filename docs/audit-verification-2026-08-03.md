# Audit Verification Report — 2026-08-03

> **Point-in-time audit** (2026-08-03). Findings absorbed into
> `docs/sync-pipeline-v2-plan.md`; retained here as raw evidence, not a live
> plan. Verified against HEAD `8587cac` (recorded below); re-confirmed
> 2026-08-03 that `8587cac` is an ancestor of current HEAD `d09a976` with no
> intervening source-file changes (`git diff --name-only 8587cac d09a976`
> touches only `CLAUDE.md`, `project-state.md`, and two `docs/` plan files),
> so every citation below still holds at current HEAD.

Read-only verification pass against current HEAD (branch `webgl2-effects-engine`, HEAD = `8587cac`). No source files were modified, no resync was run, no commit was made. Every claim below cites `file:line` as read at HEAD unless marked **UNVERIFIED**.

Note on scope: the task brief references "the 4-stage proposal" as the source of the five claims in Section B. No document by that name (or matching that description) exists anywhere in this repository — not in `docs/`, not in git history (see §A/§C.7 methodology, same search technique). I have therefore verified each of the five claims directly against the running code, independent of that unlocated document.

---

## A. The missing document

**1. Does `docs/sync-redesign-audit-report.md` exist?**

Yes. It is an **untracked** file (`git status --short` shows `?? docs/sync-redesign-audit-report.md`), 569 lines, last modified 2026-08-03 16:59, and it has **never been committed** — `git log --all --oneline -- docs/sync-redesign-audit-report.md` returns nothing, and it does not appear in `git fsck --dangling` output either. It exists only on disk, in this working tree, right now.

Its content (verified by reading the file in full) is a separate, self-contained structural audit of the sync pipeline dated "2026-08-03," scoped explicitly to support "a future pipeline redesign." Full contents are not reproduced a second time here since the file is directly readable at that path; its key claims are cross-checked against source throughout this report below and generally hold up (see inline citations in §B–§D, which independently re-derive most of the same facts from source rather than trusting that document's prose).

---

## B. Five claims verified against source

### 2. `computeBoundarySearchWindow` — narrow-gap expansion

Quoted in full, [snapBoundaries.ts:330-348](../src/services/snapBoundaries.ts#L330):

```ts
export function computeBoundarySearchWindow(
  lastSpokenEnd: number,
  nextSpokenStart: number,
  currFirstSpokenStart: number,
  nextLastSpokenEnd: number,
): BoundarySearchWindow {
  const spokenMid = (lastSpokenEnd + nextSpokenStart) / 2;
  const spokenGapWidth = nextSpokenStart - lastSpokenEnd;
  const searchRadius = spokenGapWidth < 0.1
    ? 1.0
    : Math.max(0.5, spokenGapWidth / 2 + 0.4);
  const searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart);
  const searchEnd = Math.min(spokenMid + searchRadius, nextLastSpokenEnd);
  return { spokenMid, spokenGapWidth, searchStart, searchEnd };
}
```

**CONFIRMED exactly.** `spokenGapWidth < 0.1` → radius = fixed `1.0`s. Otherwise radius = `max(0.5, gap/2 + 0.4)`. The proposal's "<0.1s gap expands to a fixed 1.0s" is correct verbatim — this is the literal branch, no rounding or additional condition. A byte-identical duplicate of this same formula also lives inline (not via the shared function) in [whisperService.ts:1439-1441](../src/services/whisperService.ts#L1439) inside `alignScenestoTranscript`'s own gap-fill.

The window is additionally hard-clamped to `[currFirstSpokenStart, nextLastSpokenEnd]` — i.e., it can never extend past **either segment's own outermost spoken token**, not just the two boundary-adjacent tokens (this matters for §D below).

### 3. Every duration-floor site

| Site | Constant/expression | Value | What it floors |
|---|---|---|---|
| [snapBoundaries.ts:230](../src/services/snapBoundaries.ts#L230) | `MIN_SEGMENT_DURATION` | `0.1` | Engine floor: `curr.duration` in `snapCoveredBoundaries`'s Pass 3 ([:882](../src/services/snapBoundaries.ts#L882)) and the tail segment's duration ([:900](../src/services/snapBoundaries.ts#L900)). |
| [App.tsx:302](../src/App.tsx#L302) | `MIN_SEGMENT_DURATION` | `0.3` | **Different constant, same name** — display-only floor for the interactive timeline resize-drag UX (used at App.tsx:1120, 1125-1126, 1942, 3796, 3799, 3806, 3870, 3873, 3882 — all resize-drag/trim math, none of it in the Apply Sync commit path). |
| [whisperService.ts:1656](../src/services/whisperService.ts#L1656) | `Math.max(0.1, a.t1 - a.t0)` | `0.1` (bare literal) | `distributeSegmentTimes`'s per-segment duration, computed from `AlignResult.t0/t1` before `applyAnchorBasedTiming` re-derives it. |
| [whisperService.ts:1192](../src/services/whisperService.ts#L1192) | `Math.max(t0 + 0.05, rawT1)` | `0.05` (bare literal) | Minimum span for **every** segment's `t1` inside `extractSegmentAlignments` (not rescue-specific — this runs for every matched segment's result construction, not only rescued ones). |
| [App.tsx:868-871](../src/App.tsx#L868) | `nextDuration > 0 ? nextDuration : seg.duration` | n/a (no numeric floor — reuses prior duration) | `retileCoveredSegments`'s degenerate-duration guard: a non-monotonic/duplicate `startTime` keeps the segment's **original** duration rather than clamping to a number. Confirmed no log entry accompanies this (not even DEV-gated). |
| [headingLayer.ts:47](../src/services/headingLayer.ts#L47) | `MIN_HEADING_DURATION` | `0.3` | Explicitly documented as mirroring App.tsx's `MIN_SEGMENT_DURATION` (0.3), not the engine's 0.1. |

**Are `snapBoundaries.ts`'s and `App.tsx`'s `MIN_SEGMENT_DURATION` genuinely different concerns, or is one dead?** Genuinely different, not dead — confirmed by usage-site inspection: every one of App.tsx's 9 use sites is inside timeline drag/trim/speed-change handlers (interactive UI), never inside `handleApplySyncFromFiles` or any function it calls. `syncConstants.ts` itself documents this as a **known, deliberate non-consolidation** — [syncConstants.ts:19-27](../src/services/syncConstants.ts#L19): "`MIN_SEGMENT_DURATION` exists as TWO separate, unsynchronized local constants... NOT merged... because doing so risks changing engine behavior... as a side effect of a UI-only constant tweak, or vice versa." Both are live, both are read, neither is dead code.

### 4. If `alignScenestoTranscript`'s internal gap-fill were deleted

This required tracing the full data-flow, not just reading doc comments. Findings:

**(a) First kept segment's `startTime` — never written by `snapCoveredBoundaries`.** Confirmed directly in code: `snapCoveredBoundaries`'s Pass 3 loop ([snapBoundaries.ts:791-893](../src/services/snapBoundaries.ts#L791)) only ever writes `curr.duration` and `next.startTime`/`next.anchorStart` per pair `(i, i+1)`. For `i=0`, `curr` is the first kept segment — its `startTime` is never assigned in this loop. App.tsx's own comment confirms this explicitly at the call site: [App.tsx:2533-2536](../src/App.tsx#L2533) — *"the first segment's own startTime is untouched by either \[snapCoveredBoundaries or retileCoveredSegments\] (it's still wherever the aligner's matched span put it — the first spoken word, not necessarily 0). Stretch it back to 0 the same way."* — followed immediately by `finalTimedSegments = headExtendFirstSegment(finalTimedSegments)` ([App.tsx:2537](../src/App.tsx#L2537)).

Crucially, `alignScenestoTranscript`'s own gap-fill loop **also never writes `results[0].t0`** — its loop body is `for (i=0; i<results.length-1; i++) { curr.t1 = boundary; next.t0 = boundary; }` ([whisperService.ts:1496-1531](../src/services/whisperService.ts#L1496)), which only ever writes `t0` for index `i+1 ≥ 1`. So segment 0's `t0`/`startTime` is **already** untouched by gap-fill, with or without deletion. Deleting the gap-fill changes nothing about the first segment's timing.

**(b) Locked segments — already fully excluded, zero effect from deletion.** Both `distributeSegmentTimes` ([whisperService.ts:1648-1651](../src/services/whisperService.ts#L1648): `if (seg.locked) return seg;`) and the gap-fill's own two loops ([whisperService.ts:1413](../src/services/whisperService.ts#L1413): `if (segments[i]?.locked || segments[i+1]?.locked) { gapFillPlans.push(null); continue; }`, and [:1497](../src/services/whisperService.ts#L1497) identically for the resolve loop) skip locked segments/pairs entirely. Deleting the gap-fill has no effect on locked segments — they were never inside its scope.

**(c) The `retileCoveredSegments` fallback (tokens.length === 0) — `snapCoveredBoundaries` does NOT run there.** Confirmed by the exact ternary at [App.tsx:2521-2524](../src/App.tsx#L2521): `finalTimedSegments = transcriptTokens.length > 0 ? snapCoveredBoundaries(...) : retileCoveredSegments(kept, audioDuration);`. And in this same scenario, `alignScenestoTranscript`'s gap-fill **never executes either** — its own early-return guard, `if (!tokens.length || !segments.length) return segments.map(() => ({t0:0, t1:0, firstTokenIdx:-1, lastTokenIdx:-1, ...}));` ([whisperService.ts:1354-1359](../src/services/whisperService.ts#L1354)), fires on the exact same `tokens.length === 0` condition, before the gap-fill code is ever reached (it uses the same `usableTokens`/`aligned.tokens` array both places check — [App.tsx:2517-2521](../src/App.tsx#L2517) explicitly notes this array identity). So this fallback path is unaffected by gap-fill's existence either way.

**Is "100% redundant" true?** For the **only call site that ever reaches it with non-empty segments** — `alignFromCache` at [App.tsx:2388](../src/App.tsx#L2388), which is `alignSegmentsFromCachedTranscript` in [useWhisper.ts:66-116](../src/hooks/useWhisper.ts#L66) — **yes, for the final committed timing, under the normal (non-degenerate) path.** Grep confirms only two call sites of `alignScenestoTranscript` exist in the entire codebase ([whisperService.ts:4](../src/services/whisperService.ts), used at [useWhisper.ts:93](../src/hooks/useWhisper.ts#L93) and [useWhisper.ts:285](../src/hooks/useWhisper.ts#L285)):
- `useWhisper.ts:93` (inside `alignSegmentsFromCachedTranscript`, called only from `alignFromCache`) → **always followed by `snapCoveredBoundaries` or `retileCoveredSegments`** in App.tsx's Branch A.
- `useWhisper.ts:285` (the staging-time transcription path, `startTranscription`) is called **only once**, from [App.tsx:2173-2187](../src/App.tsx#L2173), with `segments: []` (literally an empty array, third argument) and `onSegmentsUpdated: () => {}` (a no-op, fourth argument) — confirmed by the code's own comment at [App.tsx:2095-2096](../src/App.tsx#L2095): *"onSegmentsUpdated is a no-op — this call is cache-only, it never mutates live segments."* Since `alignScenestoTranscript`'s guard is `!segments.length`, this call short-circuits **before reaching the gap-fill code at all**, every single time. This path never exercises gap-fill.

So the one real code path is: `alignFromCache` → gap-filled `t0/t1` → `distributeSegmentTimes` writes `startTime`/`duration`/`anchorStart` from `t0` → `applyAnchorBasedTiming` re-derives → `filterToCoveredSegments` (keeps on `alignment.matched`, confirmed at [App.tsx:806-816](../src/App.tsx#L806) — never reads `t0`/`t1`) → **`snapCoveredBoundaries` recomputes every interior pair boundary from scratch using `tokens[align.lastTokenIdx]`/`tokens[align.firstTokenIdx]` (index lookups, not `t0`/`t1` at all)**, and sets the tail's duration independently too. A grep for `.t0`/`.t1` field reads across `App.tsx` and `syncContracts.ts` returns **zero hits** — nothing downstream of `alignFromCache`'s return value ever reads `AlignResult.t0`/`.t1` again; `validateBoundaryQuality` (the post-hoc boundary-quality checker) also recomputes from `firstTokenIdx`/`lastTokenIdx` directly ([syncContracts.ts:296-302](../src/services/syncContracts.ts#L296)), not from `t0`/`t1`.

The only theoretical residual: `snapCoveredBoundaries`'s `??` fallbacks (e.g. [snapBoundaries.ts:710](../src/services/snapBoundaries.ts#L710): `tokens[currAlign.lastTokenIdx]?.endSec ?? (currOrig.startTime + currOrig.duration)`) would read the pre-snap `startTime`/`duration` (gap-fill-derived) **if** a matched segment's token index resolved to `undefined` — but `extractSegmentAlignments` only ever assigns non-sentinel `firstTokenIdx`/`lastTokenIdx` when `matched === true` ([whisperService.ts:1188-1189](../src/services/whisperService.ts#L1188)), so this fallback should never fire for a segment that survives `filterToCoveredSegments`. This is a theoretical edge case, not a normal-path dependency.

**Caveat — "redundant" ≠ "dead code."** `alignScenestoTranscript`'s gap-fill logic is directly exercised by 29 test call sites in `syncTiming.test.ts` (`describe('alignScenestoTranscript — ported gap-fill candidacy...')`, [syncTiming.test.ts:3845](../src/services/syncTiming.test.ts#L3845)), so deleting it would require updating those tests even though it has no observable effect on Apply Sync's final committed output. It is operationally redundant for the shipped feature, not untested or unreachable.

### 5. `isBreathSilence`'s `otherSideLastTokenIdx` — all call sites

Four real call sites (grep-confirmed, [snapBoundaries.ts](../src/services/snapBoundaries.ts) + [whisperService.ts](../src/services/whisperService.ts)):

| Site | Side | Argument passed |
|---|---|---|
| [snapBoundaries.ts:744](../src/services/snapBoundaries.ts#L744) (`snapCoveredBoundaries`, curr's own span) | CURR | `currOtherSideLastTokenIdx` = literal `-1` ([:738](../src/services/snapBoundaries.ts#L738)) |
| [snapBoundaries.ts:745](../src/services/snapBoundaries.ts#L745) (`snapCoveredBoundaries`, next's own span) | NEXT | `nextOtherSideLastTokenIdx` = `currAlign.lastTokenIdx` ([:739](../src/services/snapBoundaries.ts#L739)) |
| [whisperService.ts:1460](../src/services/whisperService.ts#L1460) (`alignScenestoTranscript` gap-fill, curr's own span) | CURR | `currOtherSideLastTokenIdx` = literal `-1` ([:1454](../src/services/whisperService.ts#L1454)) |
| [whisperService.ts:1461](../src/services/whisperService.ts#L1461) (`alignScenestoTranscript` gap-fill, next's own span) | NEXT | `nextOtherSideLastTokenIdx` = `curr.lastTokenIdx` ([:1455](../src/services/whisperService.ts#L1455)) |

**CONFIRMED exactly** — NEXT-side passes the immediately-preceding span's own `lastTokenIdx`; CURR-side passes literal `-1`, in both files, symmetrically.

A **fifth and sixth** call site exist that the brief's framing doesn't cover: `boundaryUsedFallback`'s own diagnostic calls, [snapBoundaries.ts:381](../src/services/snapBoundaries.ts#L381) and [:382](../src/services/snapBoundaries.ts#L382), call `isBreathSilence` with only 4 arguments (no 5th arg at all) for **both** curr and next sides — relying on the function's default parameter value (`otherSideLastTokenIdx: number = -1`, [snapBoundaries.ts:570](../src/services/snapBoundaries.ts#L570)). This is a diagnostic-only function (boundary-quality-checker measurement pass) and does not participate in committed timing, but it means the NEXT-side seam exemption is **not active** in that diagnostic's own candidacy replay — a documented, deliberate simplification per that function's own doc comment ([snapBoundaries.ts:356-365](../src/services/snapBoundaries.ts#L356)), not an oversight, but worth flagging since it means `boundaryUsedFallback`'s "did this pair use the fallback" measurement can disagree with what `snapCoveredBoundaries` itself actually did for a pair the seam exemption rescues.

### 6. Search window / boundary placement using timestamps beyond the two boundary tokens

**Yes — this happens in multiple places, not just the two boundary tokens (`A.lastTokenIdx`/`B.firstTokenIdx`):**

1. **`computeBoundarySearchWindow`'s outer clamp** ([snapBoundaries.ts:345-346](../src/services/snapBoundaries.ts#L345)): `searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart)`, `searchEnd = Math.min(spokenMid + searchRadius, nextLastSpokenEnd)`. `currFirstSpokenStart` = `tokens[currAlign.firstTokenIdx].startSec` — curr's **own first** token, not `A.lastTokenIdx`. `nextLastSpokenEnd` = `tokens[nextAlign.lastTokenIdx].endSec` — next's **own last** token, not `B.firstTokenIdx`. Confirmed at the call site: [snapBoundaries.ts:716-717](../src/services/snapBoundaries.ts#L716).
2. **`fillsTokenGapWithinSpan`** ([snapBoundaries.ts:426-446](../src/services/snapBoundaries.ts#L426)) reads **every consecutive token pair** inside `[firstTokenIdx, lastTokenIdx]` of a segment's **entire own span** — not just the boundary-adjacent token.
3. **`isBreathSilence`** ([snapBoundaries.ts:560-620](../src/services/snapBoundaries.ts#L560)) reads **every token** in `[firstTokenIdx, lastTokenIdx]` of the tested span to compute `covered`/`ratio`/`significantInteriorCount` — again the segment's whole span, not just its edge token.

The seam-exemption read (`tokens[otherSideLastTokenIdx]`, [snapBoundaries.ts:613](../src/services/snapBoundaries.ts#L613)) is the one exception that stays within "the two boundary tokens" for the NEXT-side call (`otherSideLastTokenIdx = curr.lastTokenIdx = A.lastTokenIdx` exactly), but items 1-3 above are genuinely reading beyond that pair. This directly explains why a hard clamp to just `[A.lastTokenIdx, B.firstTokenIdx]` (§D.12/13 below) breaks things — the real algorithm was never designed to stay within that pair.

---

## C. The 8 boundaries — recovered evidence

### 7. Is a tsx scoring harness committed anywhere?

**No — UNVERIFIED / not found.** Checked: `git log --all --oneline` (576 commits, none named/described as a scoring harness), `git stash list` (4 stashes, all predate 2026-07-31 and concern Timeline lag/transition-preview work, unrelated), `git reflog show --all` (most recent entries are the already-visible commit history), `git fsck --dangling` (28 dangling objects, all commit dates checked individually — the two most recent are `1683273d`/`c683c966` dated 2026-07-31, predating the 2026-08-02/03 seam-exemption work; none are from 2026-08-02 or 08-03 except the two already-reachable doc commits `30a32cd`/`8587cac`). `git status --short` shows only `docs/sync-redesign-audit-report.md` as untracked. The commit c593f1d's own message and test comments reference a harness by description — `/tmp/wexp-v6/compare/results/v6_diff_variantB.json` ([syncTiming.test.ts:3086-3089](../src/services/syncTiming.test.ts#L3086), quoted below) — but `/tmp` is outside the git repo entirely and is not present on this filesystem check (not verified further since it's explicitly a `/tmp` path, ephemeral by convention). **The harness that produced the comparison data was never committed and cannot be recovered from this repository.**

### 8. V6 project (`30e61c51-47d5-4049-98d9-e8373553cb24`) — persisted before/after timestamps

Found **real, concrete before/after timestamp data for 6 of the 8 segments**, committed as test fixtures in `c593f1d`, in [syncTiming.test.ts](../src/services/syncTiming.test.ts):

| Segment (1-based, "curr" of the pair) | Silence tested | Seam anchor (curr's real last token) | Result |
|---|---|---|---|
| 96 ([:2902-2937](../src/services/syncTiming.test.ts)) | `[289.380, 289.960]` | "look" ends 289.090 | `isBreathSilence(...)` → `false` (exempted) |
| 162 | `[481.400, 481.720]` | "alarm" ends 481.050 | → `false` |
| 316 | `[967.140, 967.460]` | "fear" ends 966.700 | → `false` |
| 338 | `[1041.080, 1042.040]` | "had" ends 1040.670 | → `false` |
| 352 | `[1091.960, 1092.340]` | "by" ends 1091.370 | → `false` |
| 405 | `[1290.240, 1290.720]` | "you" ends 1289.680 | → `false` |

Each fixture includes the **real per-token start/end timestamps** for the local window around that boundary (reproduced verbatim from the commit; e.g. segment 96's tokens run "look" 288.750-289.090, "A" 289.200-289.260, "predator" 289.260-289.800 [the token whose smear caused the false breath classification], etc.).

**Segments 34 and 412 have NO persisted timestamp fixture anywhere in the repo.** Confirmed by `grep -n "seg 34\|seg 412\|pairIdx 33\b\|pairIdx 411\b" src/services/syncTiming.test.ts` — the only hit is a single comment line ([syncTiming.test.ts:3086](../src/services/syncTiming.test.ts#L3086)) that names them as part of the "genuine 8" set (`pairIdx 33, 59, 404, 411 (segs 34, 60, 405, 412)`, later corrected to exclude 60) with **no accompanying token data, no before/after numbers**. For these two, **only the segment indices exist in the repo — no timestamps.** This matches the task's anticipated finding plainly: 6 of 8 have real recovered numbers; 2 of 8 (34, 412) exist only as bare index citations.

### 9. Are the segment numbers 0-based, 1-based, or pair indices?

**1-based display numbers, naming the "curr" (earlier) segment of an adjacent pair; internally `pairIdx = displayNumber - 1` (0-based array index of curr).** Established by cross-referencing the fixture comments against the commit message:

- Test title "seg 96→97" ([syncTiming.test.ts:134](../src/services/syncTiming.test.ts#L134)) with body comment *"Full real token indices: currAlign(seg95).lastTokenIdx=805..., nextAlign(seg96).firstTokenIdx=806"* — here the **comment's own internal variable names `seg95`/`seg96` are 0-based array indices** (curr = array index 95, next = array index 96), while the **test title's "96→97" is the 1-based display pair**.
- The commit message's list is `segs 34, 96, 162, 316, 338, 352, 405, 412` — each number equals `pairIdx + 1` for the pairIdx it names: pairIdx 33→34, 95→96, 161→162, 315→316, 337→338, 351→352, 404→405, 411→412. Verified consistent across all 8 (later corrected list at [syncTiming.test.ts:3078-3090](../src/services/syncTiming.test.ts#L3078): *"pairIdx 95/161/315/337/351/33/404/411 (segs 96/162/316/338/352/34/405/412)"* — direct 1:1 correspondence, `seg = pairIdx + 1`, quoted verbatim in-file).

So: "segment 96" in every doc/commit-message reference means the pair between **array index 95 and array index 96** (0-based), i.e., between 1-based display segments 96 and 97.

### 10. Test coverage of the 8 segments

| Test | Segments covered | Drives full pipeline? |
|---|---|---|
| `describe('isBreathSilence — index-based seam exemption (V6 production autopsy, 2026-08-03)')` ([syncTiming.test.ts:109 of the diff](../src/services/syncTiming.test.ts)) — 6 separate `it()` blocks | 96, 162, 316, 338, 352, 405 | **No.** Each calls `isBreathSilence(silence, tokens, firstIdx, lastIdx, otherSideIdx)` directly, with a small hand-assembled local `tokens` array (real timestamps extracted from the production project, but a tiny 8-13-token local slice, not the actual 4,517-token array). No `filterMalformedTokens`, no `extractSegmentAlignments`, no `snapCoveredBoundaries` call in any of these 6 tests. |
| `describe('snapCoveredBoundaries — curr-side seam exemption disabled (173-segment production project, 2026-08-03)')` — "pairIdx 4" test | *Not one of the 8* — this is the "They're the worst" fixture from the **separate 173-segment project**, used to lock the curr-side-disabled behavior | **Partial.** Calls `extractSegmentAlignments(segments, tokens)` then `snapCoveredBoundaries(...)` — no `filterMalformedTokens` (this fixture has no malformed tokens to drop). |
| Same describe block — "pairIdx 20" test | *Also not one of the 8* — same 173-segment project, a **separate, still-open, still-broken** defect (asserts the current wrong value 75.660, documents 76.470 as the un-achieved correct target) | **Yes, most complete of any test here** — `filterMalformedTokens(rawTokens, 90)` → `extractSegmentAlignments(...)` → `snapCoveredBoundaries(...)`, confirmed at [syncTiming.test.ts around the diff's end](../src/services/syncTiming.test.ts). |

**No test in the suite asserts on all 8 segments.** No test drives `handleApplySyncFromFiles`/Apply Sync's complete pipeline (staging, `alignFromCache`, `evaluateCoverageGate`, `filterToCoveredSegments`, the full 447-segment V6 project) for **any** of the 8 — every one of the 6 direct fixtures is a hand-built, isolated call to `isBreathSilence` alone. Segments **34 and 412 have zero test coverage of any kind** — no fixture, no assertion, nothing beyond the bare comment citation noted in §C.8.

---

## D. FENCE and QUIET

### 11. Surviving trace of FENCE/QUIET

**No code trace anywhere — prose only.** `git log --all --oneline -S"FENCE"` and `-S"QUIET"` both return only the two doc-only commits `30a32cd` and `8587cac` (docs commits already visible in the normal log — not hidden/dangling). `git fsck --dangling` objects were individually checked by commit date; none post-date 2026-07-31, so none could contain 2026-08-02/03 FENCE/QUIET work. No stash contains either string. A repo-wide grep for `FENCE|QUIET` outside `.git` hits only three files, all prose: [project-state.md:26](../project-state.md#L26), [docs/boundary-drift-investigation.md:212,218,270](../docs/boundary-drift-investigation.md#L212), [docs/history.md:2586](../docs/history.md#L2586). **No `.ts`/`.tsx` file, committed or dangling, contains either term.** The described clamp expression is never rendered as actual code — the doc's own text is the only artifact:

> "**FENCE.** Fences the picker's search window to prevent widening past a hard boundary. **Failed:** reverts all 8 Candidate-1 breath-exemption fixes... Fencing the window tight enough to stop word-shift also stops the multi-fragment override's NEXT-side exemption from ever having room to fire." ([boundary-drift-investigation.md:212-216](../docs/boundary-drift-investigation.md#L212))
>
> "**QUIET.** Biases the picker toward the quietest point in the candidate window rather than the geometric closest-centre point. **Failed:** fails 3 of 4 hard correctness checks at every window size tested — not a tuning problem, a structural one." ([boundary-drift-investigation.md:218-221](../docs/boundary-drift-investigation.md#L218))

Neither has a quotable "actual expression" — there is none in this repository, in any commit, stash, or dangling object.

### 12. Hard clamp to `[A.lastTokenIdx.endSec, B.firstTokenIdx.startSec]` — walked through segment 96 with real numbers

Using the actual seg-96 fixture data from `c593f1d` ([syncTiming.test.ts, "seg 96→97" test](../src/services/syncTiming.test.ts)):

- `A.lastTokenIdx` = "look", `288.750–289.090` → `A.lastTokenIdx.endSec = 289.090`
- `B.firstTokenIdx` = "A", `289.200–289.260` → `B.firstTokenIdx.startSec = 289.200`
- Candidate clamp: `[289.090, 289.200]` — width **0.11s**
- The silence this fix actually selects: `[289.380, 289.960]`

**The clamp excludes it outright.** `silence.startSec (289.380) > windowEnd (289.200)` — zero overlap. Under this clamp, `isBoundarySilenceCandidate` would return `false` regardless of what the breath/seam-exemption logic decides, because the window itself never reaches the silence. The committed boundary would fall back to the plain midpoint `(lastSpokenEnd + nextSpokenStart) / 2 = (289.090 + 289.260) / 2 = 289.175` — which sits in the small gap between "look" and "A," not inside the true, longer pause the exemption was built to recover ([snapBoundaries.ts:484-504](../src/services/snapBoundaries.ts#L484) documents the underlying mechanism: Whisper's declared onset for "A" — 289.200 — is smeared roughly 0.1-0.4s ahead of when the segment actually starts in the real audio, so the token-timestamp gap `[289.090,289.200]` badly understates where the segment truly begins).

This confirms, from the actual code and the actual committed test data (not from the doc's summary), that a naive two-token clamp reproduces exactly the failure mode the doc describes for FENCE: it structurally cannot see the silence the current fix depends on, because that silence sits **outside** even the immediate boundary-token pair, inside the smeared segment's own interior.

### 13. Same question, one token wider: `[A.lastTokenIdx.startSec, B.firstTokenIdx.endSec]`

- `A.lastTokenIdx.startSec` = "look" starts `288.750`
- `B.firstTokenIdx.endSec` = "A" ends `289.260`
- Candidate clamp: `[288.750, 289.260]` — width **0.51s**
- Silence: `[289.380, 289.960]`

**Still excludes it.** `silence.startSec (289.380) > windowEnd (289.260)` — still zero overlap, by 0.12s. Widening by one token on each side is not enough — the smear in this real case reaches past not just `B.firstTokenIdx` ("A") but into the **next** token after it ("predator," 289.260–289.800, which is what the silence actually overlaps). This is a direct, code/data-grounded confirmation that no small fixed-token-count clamp recovers this fix; the current implementation's un-clamped ±0.5s-to-1.0s radius (§B.2 above) is precisely why it works where a token-adjacency clamp would not.

---

## E. Whisper timestamp source

### 14. `whisper.rs` — stdout parser and `parse_timestamp`

Quoted in full, [whisper.rs:377-415](../src-tauri/src/whisper.rs#L377):

```rust
fn parse_stdout_tokens(lines: &[String]) -> Vec<TranscriptToken> {
    let mut tokens = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let close = match trimmed.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_part = &trimmed[1..close];
        let arrow = match ts_part.find(" --> ") {
            Some(i) => i,
            None => continue,
        };
        let start_sec = parse_timestamp(&ts_part[..arrow]);
        let end_sec = parse_timestamp(&ts_part[arrow + 5..]);
        let text = trimmed[close + 1..].trim().to_string();
        if !text.is_empty() {
            tokens.push(TranscriptToken { start_sec, end_sec, text });
        }
    }
    tokens
}

fn parse_timestamp(ts: &str) -> f64 {
    let ts = ts.trim().replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}
```

Line format expected: `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text`. A malformed timestamp (wrong colon count) silently returns `0.0` rather than erroring — no visible failure signal at this layer (though `filterMalformedTokens` downstream, [whisperService.ts:1291](../src/services/whisperService.ts#L1291), would likely catch a resulting `startSec=0`/inverted-duration token as malformed).

**No JSON output path exists.** Grepping the whole file for `json`/`-oj` returns no hits. The whisper-cli invocation args are `-m <model> -f <wav> -ml 1 -np -l en --dtw base.en` ([whisper.rs:244-250](../src-tauri/src/whisper.rs#L244)) — `-ml 1` forces one-word-per-line output specifically so this stdout-line parser can treat each line as one token; there is no `-oj`/`--output-json` flag anywhere in the arg list.

**What would switching to `-oj`/JSON require?** Concretely: (1) add `-oj` (or `--output-json`) to the args list at whisper.rs:244; (2) whisper-cli would then write a `<input>.json` file to the working directory rather than (or in addition to) stdout — the current code reads accumulated **stdout** lines (`accumulated`, [whisper.rs:314](../src-tauri/src/whisper.rs#L314)), so this would require reading a file instead, which changes the IPC completion path (currently keyed on process-exit code + accumulated stdout buffer, [whisper.rs:311-336](../src-tauri/src/whisper.rs#L311)); (3) `parse_stdout_tokens`/`parse_timestamp` would be replaced by JSON deserialization of whisper.cpp's segment/token schema (word-level timestamps live under a different key path in JSON output than the bracket-line stdout format); (4) the **progress-percentage mechanism** also depends on stdout — `parse_progress_line` ([whisper.rs:365-374](../src-tauri/src/whisper.rs#L365)) parses the same bracketed-timestamp lines to drive the live progress bar during transcription, so switching stdout parsing off (or changing its format) would require a **separate** progress mechanism, since JSON output is normally only written once, at the end, not streamed incrementally. This is a real, non-trivial coupling: nothing else in the codebase reads the JSON path today (no JSON parsing code exists anywhere in `src-tauri/`), so this would be new code, not a flag flip. `docs/boundary-drift-investigation.md`'s own "DO NOT RE-INVESTIGATE" list ([:255-256](../docs/boundary-drift-investigation.md#L255)) states *"JSON vs. stdout token parsing — identical (0.0ms median delta, 3,578 words)"* — implying this was already tried and measured equivalent for token content, though not implemented in the shipped parser (no `-oj` code exists in the file as it stands, confirmed above).

### 15. Bundled models

Only `ggml-base.en.bin` exists — confirmed by `find` across the whole repo: `src-tauri/models/ggml-base.en.bin` is the only model file (also present, expectedly, in `target/debug`/`target/release` build output copies and the packaged `.app` bundle — same file, not a second model). No multilingual or larger model (`ggml-base.bin`, `ggml-small*`, `ggml-medium*`, `ggml-large*`) is present anywhere. Provisioning is manual, documented at [src-tauri/models/README.md](../src-tauri/models/README.md): a `curl` download from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` (~141MB), gitignored (too large for git). This matches CLAUDE.md's own claim that language detection is "deliberately absent" because the bundled model is English-only.

---

## F. Determinism

### 16. Is Apply Sync deterministic for identical inputs?

**The pipeline's own TypeScript code is deterministic for identical inputs** (same script/scene text, same token array, same silence array, same audio duration) — no code-level source of nondeterminism feeds into committed `startTime`/`duration` values. Specifically:

- **`crypto.randomUUID()`** — used for `segment.id` ([App.tsx:508](../src/App.tsx#L508), inside `parseProjectData`) and `jobId`/asset ids elsewhere (App.tsx:232, 284, 1965, 2118, 2871, 2938, 4248; useWhisper.ts:193). This changes **segment identity** on every parse — a re-sync mints brand-new UUIDs for every segment, so no segment's `id` is ever stable across syncs. This is **cosmetic non-determinism**, not one that affects `startTime`/`duration` — id doesn't feed into any timing formula, and CLAUDE.md's own "Anchor-Based Segment Timing" section confirms this is by design ("clean-slate" re-sync: "anchors are never restored from previous segments").
- **`Date.now()`** — used for `syncRunAt`/`timestamp`/`addedAt`/`savedAt` fields (App.tsx:914, 961, 977, 992, 1041, 2214, 2610-2611, 3080, 3352; useWhisper.ts:256). All of these are **log/metadata timestamps** (`SyncLogEntry.timestamp`, asset `addedAt`, autosave `savedAt`) — none feed into segment timing math.
- **Map/Set iteration order** — `bestPairForSilence` (a `Map`, [snapBoundaries.ts:765](../src/services/snapBoundaries.ts#L765) and [whisperService.ts:1474](../src/services/whisperService.ts#L1474)) and `globallyClaimed`/`used` (`Set`s, [whisperService.ts:831](../src/services/whisperService.ts#L831), [:510](../src/services/whisperService.ts#L510)) — **not actually a nondeterminism risk in JavaScript**: the language spec guarantees `Map`/`Set` iteration order equals insertion order, and every insertion here happens in a fixed, array-index-driven loop order. This differs from languages with genuinely unordered hash maps.
- **Floating-point accumulation order** — `parseProjectData`'s character-weight duration proportioning accumulates a running `currentTimeAccumulator` sequentially over scenes in document order ([App.tsx](../src/App.tsx), same site as the `crypto.randomUUID()` segment-construction loop at :506-515) — this is a fixed, sequential, single-threaded accumulation; floating-point arithmetic is deterministic for a fixed instruction sequence on a fixed engine, so this is not a real nondeterminism source either (no parallelism, no engine-dependent reordering).

**Two genuine, code-external wildcards this static read cannot settle — UNVERIFIED:**
1. **whisper-cli's own determinism** for identical audio input across repeated runs — this is a native binary invoked via Tauri `spawn()` ([whisper.rs](../src-tauri/src/whisper.rs)); nothing in this repo's Rust/TS glue controls or can attest to whisper.cpp's internal determinism (thread-count-dependent floating point reduction order is a known potential source of run-to-run variance in some ML inference stacks). Would need an actual repeated-transcription experiment on the same audio file to verify.
2. **Web Audio API decode determinism** (`silenceDetector.ts`'s use of `AudioContext.decodeAudioData`) — a browser/WebView API, not controlled by this codebase; decode results could in principle vary marginally across WebView versions or platforms. Not verifiable from source alone.

### 17. Does resync reuse the cached transcript, or re-run whisper-cli?

**Reuses the cache when the voiceover file is unchanged; only re-runs whisper-cli for a genuinely different file.** The exact cache-validity check, [App.tsx:2346-2350](../src/App.tsx#L2346):

```ts
const cachedTokensReady = !!voiceoverAsset
  && (projectRef.current.lastTranscribedAssetId === voiceoverAsset.id
      || (!!voiceoverAsset.file
          && projectRef.current.lastTranscribedFileIdentity === getFileIdentity(voiceoverAsset.file)))
  && (projectRef.current.transcriptTokens?.length ?? 0) > 0;
```

`getFileIdentity`, [syncEngine.ts:259-261](../src/services/syncEngine.ts#L259):

```ts
export function getFileIdentity(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
```

So identity is `name|size|lastModified` — a coarse fingerprint, not a content hash. What **invalidates** the cache: [App.tsx:2142-2153](../src/App.tsx#L2142) (`handleVoiceoverStaged`) explicitly clears `transcriptTokens: undefined` whenever a staged file's `getFileIdentity` doesn't match either the currently-pending file or `project.lastTranscribedFileIdentity` — i.e., any change to filename, byte size, or OS last-modified timestamp forces re-transcription. A file with the identical name/size/mtime (e.g., re-uploading the exact same file) is treated as cache-valid and whisper-cli is **not** re-invoked — Apply Sync goes straight to `alignFromCache` ([App.tsx:2388](../src/App.tsx#L2388)), which does silence-detection + alignment against the already-cached `project.transcriptTokens`, never touching the Tauri whisper IPC commands at all.

---

## G. Gaps

### 18. Contradictions found against `docs/boundary-drift-investigation.md`, `docs/sync-pipeline-contract-plan.md`, or CLAUDE.md's sync entries

**None found that rise to a real contradiction.** Every claim independently re-derived above (the narrow-gap radius formula, the `MIN_SEGMENT_DURATION` duplication, the seam-exemption call-site asymmetry, the FENCE/QUIET failure mechanisms, the whisper.rs stdout format) matches what these three documents already state. Two minor precision notes, not contradictions:

- CLAUDE.md's `snapBoundaries.ts` entry describes the seam exemption as fixing "8 real boundaries... segs 34, 96, 162, 316, 338, 352, 405, 412" without flagging that only 6 of those 8 have committed test evidence (§C.8/10 above) — this is an omission of test-coverage detail, not a factual error; the commit message itself is accurate about which 8 segments were affected in production.
- `docs/sync-redesign-audit-report.md` (§A) states plainly, without hedging, that `alignScenestoTranscript`'s gap-fill and `snapCoveredBoundaries` are "two independently-maintained call sites of the same logic" with a "parity" claim pinned by one test — it does not go as far as this report's §B.4 finding that the earlier function's output is **operationally overwritten in every real case that reaches it**. This is a deeper finding than that report makes, not a contradiction of it.

### 19. Top 5 things that could not be verified, and what's needed

1. **The tsx scoring harness and its `/tmp/wexp-v6/compare/results/v6_diff_variantB.json` output** (§C.7) — never committed, not recoverable from this repository's git objects. Needed: the original session's `/tmp` directory (almost certainly gone) or the harness re-written from scratch against the V6 project's actual data (which itself is not in this repo — see #2).
2. **The V6 project's full 447-segment data** (project id `30e61c51-47d5-4049-98d9-e8373553cb24`) — not present in this repository (it's user data, extracted at the time via the browser-console technique `docs/boundary-drift-investigation.md` itself documents, [:239-249](../docs/boundary-drift-investigation.md#L239)). Only the small hand-extracted windows around 6 of the 8 boundaries survive, as test fixtures. Needed: the user's own `localStorage`/IndexedDB from the session where V6 was staged, if it still exists on their machine.
3. **whisper-cli's run-to-run determinism** (§F.16) — requires actually invoking the bundled whisper-cli sidecar twice on identical audio and diffing the token arrays; not answerable from reading Rust/TS source alone.
4. **Segments 34 and 412's actual before/after boundary timestamps** (§C.8) — genuinely absent from every artifact this repo contains (fixtures, docs, commit messages) beyond the bare segment-number citation. Needed: either the original V6 project data (see #2) or a fresh resync of that project with today's code, ear-verified again.
5. **Whether `-oj`/JSON output would actually change token content or only format** (§E.14) — `docs/boundary-drift-investigation.md`'s "DO NOT RE-INVESTIGATE" list asserts this was already measured equivalent ("0.0ms median delta, 3,578 words"), but no artifact (script, raw output, or diff) backing that specific measurement survives in this repo to re-verify against current whisper-cli/model versions.
