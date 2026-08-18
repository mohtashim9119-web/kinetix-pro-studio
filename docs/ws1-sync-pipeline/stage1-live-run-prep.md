# Stage 1 Lock — Live Acceptance Run Preparation (WS1 Sessions I–J, 2026-08-18)

> **What this is:** everything the live acceptance run needs, **prepared and not executed**.
> Nothing in this file was run against the app; every claim below is a verification of
> readiness.
>
> **Prepared at HEAD `726112b` (Session I); REFRESHED at Session J's HEAD.** Run this only
> after `stage1-mover-audit.md` scores clean — the audit is pass one, this walkthrough is
> pass two.

---

## ⚠ CRITICAL CORRECTION — WS1 SESSION M, READ THIS FIRST

Everything below this notice was written on the assumption that following it would make FA
actually run. **It would not have.** Reproduced directly from the code: `fa_onnx.rs::load_session`
reads the `ORT_DYLIB_PATH` environment variable first and returns `OrtInit("ORT_DYLIB_PATH not
set")` when it is absent — and the app process **never set it**. Every prior session's FA
measurements were produced by the `cargo test`/Python-spike driver, which set that variable
itself, pointing at a dylib inside `.work-phase4/spike-runtime` (gitignored scratch). Any walkthrough
run against a pre-Session-M build would have hit an FA fallback on all three projects, exactly
as three real attempts on the owner's own machine did (`unsupported-language` on v6 auto-detect,
`inference-error` — silently, before this session — on v6 English and Spanish).

**Session M fixes this.** As of this HEAD, the onnxruntime C runtime is bundled as a Tauri
resource and the app resolves it itself (ruling R-N, `sync-pipeline-v2-plan.md`'s new "WS1
SESSION M" section) — no shell-set variable required. Two things change what to expect below:

1. **§3's toggle steps and §6's "what a clean run looks like" now have a real chance of
   matching**, where before every run in the walkthrough would have silently landed on Whisper
   timing regardless of the toggle.
2. **A new pre-flight entry appears in the Sync Log before FA runs**, `type: 'fa-preflight'` —
   check it FIRST. `severity: 'info'` and "ready" in the message means runtime + model + language
   are all confirmed before inference starts; `severity: 'warning'` names the exact blocking
   cause (verbatim backend text) and the fix. If pre-flight says "ready" and an `fa-fallback`
   entry still appears afterward, that is a new, more surprising finding worth its own report —
   it means readiness was confirmed but the actual run still failed.
3. **If any `fa-fallback` entry appears at all, read its detail line before treating it as "the
   toggle didn't take."** As of Session M's Step 1 fix, the panel now shows the backend's
   verbatim error (`error: ...`) plus the fix hint — the fallback is no longer a dead end.

**§1's numbers table below is now STALE** (89 files / 2314 passed / 45/45 gate — the Session J
snapshot). Current numbers, HEAD after Session M: **93 files / 2387 passed / 1 skipped; `cargo
test --features fa-inference` 209 passed / 20 ignored; golden replay 6/6; FA replay gate 50/50
green at rest, RED under M5/M6/M7/M8-A/M8-B/M9/M10.** Wall-clock expectations in §1 (~5 min v6
debug, ~2.5 min 173) are **unchanged in shape** — the runtime-load fix adds milliseconds, not
minutes, to a run; `verify_model_manifest`'s per-call SHA-256 is still the dominant cost in a
debug build. If a run's wall-clock comes in far under that budget, treat it as a signal FA did
not actually run (the fallback path is fast) and check the `fa-preflight`/engine log entries.

**Everything else in this file — the toggle mechanics, the source-project paths, the per-project
walkthrough tables, the fixture cross-references — is unchanged and still the correct procedure.
Follow it as written; only the framing above changes.**

---
>
> **WHAT SESSION J CHANGED, so a reader knows which parts are new:**
>
> - **§4's logging gap is CLOSED.** It was the one blocker this file reported and did not
>   fix. The rule-firing / engine / FA-fallback logging is built, and §4 now describes what
>   ships rather than what is missing.
> - **§5's index convention is CORRECTED.** The 173 table previously mixed *committed*
>   indices (what the app's Segments tab shows) with *parse* indices (what the detectors
>   use) — they differ by 2 after R.10's two drops, so half that table pointed at the wrong
>   row. Both are now given explicitly, per project.
> - **§5 is now COMPLETE rather than representative:** all ten recitations, all 31 movers,
>   all 24 audit rows and every previously ear-scored row, each listed by index.

---

## 1. Invocation — CONFIRMED

```bash
npm run tauri:dev:fa
```

Resolves to `tauri dev -f fa-inference` (`package.json`). Verified at Session J's HEAD:

| check | result |
|---|---|
| `cargo check --features fa-inference` | **clean** |
| `cargo test --features fa-inference` | **209 passed / 20 ignored** |
| `npm run lint` (`tsc --noEmit`) | **clean** |
| `npm test` | **89 files / 2314 passed / 1 skipped** |
| golden replay | **6/6**, `scripts/fixtures/phase4-baseline-*.csv` byte-identical |
| FA replay gate | **45/45 green at rest**; RED under M5/M6/M7 |

`ort` uses `load-dynamic`, so this compiles without an onnxruntime dylib present. **This is a
DEBUG build** — the only mode FA can currently run in (release packaging and Step T are
unresolved, R-AL/D1). Budget accordingly: `verify_model_manifest`'s full-file SHA-256 costs
**~77 s per FA call in debug** versus ~5.25 s in release, and it is uncached, so it is paid on
**every** Apply Sync. Expect roughly **77 s + ~231 s ≈ 5 minutes per v6 Apply Sync** and
**77 s + ~76 s ≈ 2.5 minutes for 173**.

## 2. Source projects — CONFIRMED, and the path is clean

All three exist at `/Users/mohtashim/Downloads/All Projects Test Data` (outside the repo, per
D.0), each complete with script, scene doc, and voiceover:

| project | script | scene doc | voiceover | assets |
|---|---|---|---|---|
| `V6 Natural Long Pause Segs` | `All Text Files/Script.txt` | `All Text Files/Sync.txt` | `6.m4a` (32.9 MB, 1421.3 s) | `Images (2).zip` |
| `173 Segs Project` | `script.txt` | `sync.txt` | `voiceover.m4a` (17.2 MB, 709.0 s) | `assets.zip` |
| `Spanish Project` | `Spanish Script.txt` | `Spanish Sync.txt` | `Spanish VOiceover.m4a` (2.2 MB, 92.0 s) | `Images (3).zip` |

**No fixture, capture, or harness sits anywhere in that path — verified, not assumed.** The
in-app path is: pick these files in the UI → Whisper transcribes the real `.m4a` → FA runs on
the real audio. It never reads `scripts/fixtures/` (replay-test-only), never reads
`.work-phase4/replay/` (the capture directory: `tokens_fa.json`,
`fa_production_words.json`, `audio_16k.wav` and siblings are all measurement artifacts written
BY earlier harness runs, never read by the app), and never touches `__faDevAlign` (the DEV-only
observational harness, which `forcedAlignmentRun.ts` is explicitly the production counterpart
of).

**Note the audio differs from the audit's.** The walkthrough plays the app's own decode of the
`.m4a`; `stage1-mover-audit.md` plays `.work-phase4/replay/*/audio_16k.wav`, a 16 kHz mono
capture of the same source. Same content, different sample rate — expected, and the reason the
walkthrough is a second *independent* pass rather than a repeat of the first.

## 3. The FA toggle path a user actually takes — CONFIRMED

The default is **OFF** since Session H (`FA_PROJECT_DEFAULT_ON = false`, `faGate.ts`), so FA
must be turned on **per project, by hand, for each of the three projects**:

1. Create the project and run Apply Sync once **without** FA (this is what a real user gets by
   default today, and it produces the Whisper-only baseline to compare against).
2. Open **Project Settings** → the high-precision sync control
   (`ProjectSettingsModal.tsx`) → enable → **Save**.
   - `shouldPersistFaChoice(draft, effective)` writes `Project.faHighPrecisionSync = true`
     only because the control actually moved. An unchanged control writes nothing, so an
     absent key stays absent — this is why step 1 does not silently opt the project in.
3. Run **Apply Sync again**. `isFaGateOpenForProject()` = `isFaCapable()` (Tauri IPC present)
   AND `isFaEnabledForProject()` (now explicitly `true`).

**Enabling it triggers REAL inference, not a cached artifact — verified by reading the
production path, not inferred.** `runForcedAlignmentForSync` (`forcedAlignmentRun.ts`) fetches
the voiceover blob, base64s it, runs `detectSilences` on it, computes a fresh chunk plan via
`computeFaChunkPlan`, and invokes the Tauri command `fa_align_production` over a
`Channel<FaEvent>`, awaiting a real `Done` event. **There is no result memo, no cache read,
and no stored-artifact branch anywhere in the function** — every Apply Sync re-runs ONNX
inference end to end. (The only caching in the vicinity is Whisper's *transcript* cache, keyed
by file identity, which is an FA *input*, not an FA result.)

**Fail-clean, and as of Session J no longer fail-SILENT.** Any failure — unsupported language,
absent model, hash mismatch, inference error, empty chunk plan, zero words — returns a
`{status:'fallback', reason}` result and the run proceeds on Whisper tokens. It never throws
and never aborts. What changed is that the reason is now **named in the persisted log**
(`type: 'fa-fallback'`), and every audio-timed run additionally records **which engine
produced its timing**. The operator therefore no longer has to infer FA engagement from
`anchorSource` alone or from a devtools console that dies with the window — see §4.

**Re-confirmed at Session J's HEAD, by reading the function rather than recalling it:**
`runForcedAlignmentForSync` still contains **no result memo, no cache read, and no
stored-artifact branch**. The Session J signature change added a `computeUnscriptedRuns` call
and a discriminated return; it introduced no caching, so "every Apply Sync re-runs ONNX
inference end to end" remains true at this HEAD.

---

## 4. What the sync logs capture — the gap is CLOSED

### 4.1 The requirement

Every **warning**, **fallback**, **skip**, and **rule firing**, each carrying **timestamp**,
**segment index**, and **owning rule**.

### 4.2 Status at Session J's HEAD: SATISFIED

`SyncLogEntry` (`src/types.ts`) is persisted to `project.syncLog`, grouped per run by
`syncRunId`, rendered in the Sync Log panel and exportable via its Copy button.

| requirement | status | evidence |
|---|---|---|
| timestamp | ✅ | `SyncLogEntry.timestamp`, on every entry |
| run grouping | ✅ | `syncRunId`, on every entry |
| **skips** | ✅ | `type: 'skip'` with `segmentIndex`, `segmentText`, `segmentTag`, `reason`, `matchedWords`, `totalWords`, `confidence`, `longestRun` |
| **warnings** | ✅ | `type: 'warning'` + the `severity`/`fixHint` axis; `silence-error`, `malformed-token`, `unsupported-language`, `lock-*` all have their own types |
| character-timing **fallback** | ✅ | the `unexpectedFallback` branch emits a real `'warning'` entry |
| **segment index** | ✅ | contract widened to "skip **and rule-correction** entries"; every detector already returned one |
| **FA fallback** (gate open, FA did not produce the timing) | ✅ **NEW** | `type: 'fa-fallback'`, one per run, naming which of the four failure paths fired |
| **which engine ran** | ✅ **NEW** | an unconditional `'info'` entry per audio-timed run: forced alignment (with aligned-word count) or Whisper |
| **rule firings** (R.5 / R.10 / R.11 / R.12) | ✅ **NEW** | `type: 'rule-correction'`, one entry per finding, all four rules |
| **owning rule** | ✅ **NEW** | `SyncLogEntry.owningRule` — a field, not a message prefix |

### 4.3 What shipped, by the five items this file specified

1. **`src/types.ts`** — two `SyncLogEntryType` members (`'rule-correction'`, `'fa-fallback'`)
   and two optional fields (`owningRule?: string`, `ruleDetail?`). `owningRule` is a widened
   `string` as recommended, so a fifth rule needs no type edit.
2. **`segmentIndex`'s contract widened** to skip + rule-correction entries. No code change —
   the field already existed and every detector already returned one on the same PRE-filter
   convention.
3. **`App.tsx`** — the three existing `console.warn` sites (R.10, R.11, R.12) now also push
   log entries. The `console.warn`s are KEPT: they are the live debugging surface, and
   removing them would have been an unrequested behaviour change.
4. **R.5** — taken, and NOT by the recommended route. This file proposed returning the
   excision list out of `computeFaChunkPlan`. That turned out to be unnecessary:
   `computeUnscriptedRuns` is **already exported** from `faChunkPlan.ts` (R.12 added it in
   Session H for exactly this kind of need, and its own doc comment names R.5's deferred
   `unscripted-gap` entry as a future caller). So `runForcedAlignmentForSync` calls it with
   the *identical four arguments* it gave `computeFaChunkPlan`, and returns the result. No
   signature change to the chunk planner, and — the reason it is done there rather than in
   `App.tsx` — it is the only place holding the exact silence array the plan was built
   against. `App.tsx`'s `aligned.silences` is a **separate detection pass**; logging R.5's
   excisions against those would have reported spans R.5 never acted on. That provenance
   requirement is asserted in `forcedAlignmentRun.test.ts`, not just commented.
5. **`forcedAlignmentRun.ts`** — taken. The return type moved from
   `TranscriptToken[] | null` to a discriminated `FaRunResult`
   (`{status:'ok', tokens, unscriptedRuns, silenceError?} | {status:'fallback', reason, detail?}`).
   The **fail-clean contract is unchanged** — it still never throws, and the caller still has
   exactly one branch. What changed is that `null` no longer has to mean five different
   things. A silence-detection failure *inside* the FA pass is reported on the **success**
   result, because it degrades the chunk plan without preventing alignment — previously that
   was `console.warn`-only and a run degraded that way would have recorded as clean.

### 4.4 Why this mattered for the acceptance run

Before this change, a run where FA silently fell back to Whisper timing was
**indistinguishable in `project.syncLog`** from a run where FA succeeded: same entries, same
summary, same committed shape. The user got Whisper timing under an explicit "high-precision
sync" choice and no persisted artifact disagreed. A run whose purpose is to record what the
rules did could not have produced that record.

**Inertness, measured not asserted.** The change is additive: with no rule firing and no
fallback, every builder returns `[]`. Proven at Session J's HEAD — all 31
`scripts/fixtures/*.csv` byte-identical before and after; all nine anchor/run/chunk digests
byte-identical on all three corpora; FA replay gate 45/45; golden replay 6/6;
`faAnchors.ts` sha256 `b61e94cb…` unchanged.

---

## 5. The walkthrough index — complete, and indexed correctly

**READ THIS BEFORE USING THE TABLES.** There are two different indices in play and Session I's
version of this file mixed them, which would have sent the operator to the wrong row.

- **committed idx** — position in the app's committed segment array. **This is what the
  Segments tab shows and what you navigate by.** Use this column.
- **parse idx** — position in the complete PRE-skip parse. This is what every detector
  (`UnspokenScriptFinding`, `SeamFitFinding`, `RunPlacementFinding`) and every
  `'rule-correction'` log entry reports, because those run before the skip filter.

On **v6** and **spanish** the two are identical (nothing is dropped). On **173** they diverge:
R.10 drops `perilous_realms` (parse 0) and `blue_monkey` (parse 12), so committed = parse − 1
for parse 1–11 and committed = parse − 2 from parse 13 on. **A dropped row has a parse index
and no committed index at all.** Both columns below are read from the committed fixtures at
Session J's HEAD, not transcribed.

Roles: **mover** = a rule changed its committed value at some point (all 31 are listed);
**audit row** = scored in `stage1-mover-audit.md`'s 24; **control** = blinded unmoved control
in that same 24; **scored** = ear-verified in Session H's 12-row pass or an earlier sitting.

### 5.1 V6's ten unscripted "Level N" recitations — R.12's evidence

These are the intervals R.12 exists to keep committed boundaries out of. Walk each one and
confirm no scene change lands *inside* it:

| # | recitation | interval | boundary R.12 corrected |
|---|---|---|---|
| R0 | "Level one…" | [0.08, 3.40] | **none** — no preceding token, so R.12 structurally cannot fire (nine of ten, not ten of ten) |
| R1 | "Level two. The boy who carries fire." | [125.54, 129.01] | `042_eleven_years` → 125.54 |
| R2 | "Level three. The scout." | [251.56, 253.11] | `085_the_spear_bearer` → 250.69 |
| R3 | "Level four. The night guard." | [371.54, 373.27] | `125_night_circle` → 370.75 |
| R4 | "Level 5. The hunter who fights at night." | [522.00, 525.63] | `176_twenty_six_scout` → 521.71 |
| R5 | "Level 6. The one they follow." | [663.91, 666.48] | `224_thirty_three` → 663.785 |
| R6 | "Level 7. The one the band depends on." | [789.26, 791.69] | `266_forty_one_burden` → 788.65 |
| R7 | "Level 8. The one who teaches what cannot be taught easily." | [925.14, 928.93] | `307_forty_nine_years` → 924.92 |
| R8 | "Level 9. The one whose name the stories use." | [1044.72, 1050.00] | `340_fifty_eight` → 1044.67 |
| R9 | "Level 10. The one the fire remembers." | [1189.76, 1192.17] | `383_sixty_four` → 1188.95 |

**With Session J's logging, these are now checkable from the log as well as by ear:** each of
the nine produces a `'rule-correction'` entry with `owningRule: 'R.12'` naming the run it
moved the boundary out of and the interval it was allowed to land in.

### 5.2 V6 Natural Long Pause Segs — 447 segments, 447 committed, 0 dropped

`committed idx` = `parse idx` throughout.

| idx | segment | value at HEAD | rule(s) | role |
|---|---|---|---|---|
| 35 | `036_outward_sentry` | 105.55 | — | **audit #9 — control** |
| 41 | `042_eleven_years` | 125.54 | R.5, R.12 | **mover**; scored (Session H, NO at 127.17 → corrected) |
| 42 | `043_night_migration` | 130.96 | R.5 | **mover**; scored (earlier sitting) |
| 59 | `060_reassuring_hand` | 184.02 | R-U | **mover**; **audit #11** |
| 84 | `085_the_spear_bearer` | 250.69 | R.12 | **mover**; **audit #23 — structurally-derived** |
| 86 | `087_throwing_spear_poise` | 259.88 | R.5 | **mover**; scored (Session H, YES) |
| 124 | `125_night_circle` | 370.75 | R.5, R.12 | **mover**; scored (Session H, NO at 372.35 → corrected) |
| 132 | `133_wake_man` | 399.79 | — | **audit #20 — control** |
| 151 | `152_frozen_brush_mice` | 451.03 | R.11 | **mover**; scored (earlier sitting) |
| 157 | `158_scout_false_alert` | 466.09 | — | scored (Session H, YES) — unmoved control |
| 175 | `176_twenty_six_scout` | 521.71 | R.5, R.12 | **mover**; scored (Session H, NO at 524.39 → corrected) |
| 191 | `192_scout_listening` | 571.07 | R.11 | **mover**; scored (Session H, YES) |
| 223 | `224_thirty_three` | 663.785 | R-U, R-AA, R.12 | **mover**; **audit #24 — structurally-derived** |
| 224 | `225_night_scouts` | 667.47 | R-U, R-AA | **mover** (net-unmoved); **audit #12** |
| 225 | `226_four_scouts` | 671.18 | R-U, R-AA, R.11 | **mover**; scored (earlier sitting) |
| 241 | `242_fen_excited_run` | 710.11 | R-U | **mover**; **audit #4** |
| 244 | `245_seasonal_contrast` | 719.91 | — | **audit #21 — control** |
| 265 | `266_forty_one_burden` | 788.65 | R.5, R.12 | **mover**; scored (Session H, NO at 790.33 → corrected) |
| 306 | `307_forty_nine_years` | 924.92 | R.12 | **mover**; **audit #13 — structurally-derived** |
| 307 | `308_scouts_leading` | 931.4 | R.5 | **mover**; scored (earlier sitting) |
| 317 | `318_scout_on_ridge` | 969.3 | — | scored (Session H, YES) — unmoved control |
| 331 | `332_fading_sound` | 1020.65 | — | **audit #6 — control** |
| 339 | `340_fifty_eight` | 1044.67 | R-U, R.5, R.12 | **mover**; scored (Session H, NO at 1047.57 → corrected) |
| 382 | `383_sixty_four` | 1188.95 | R.12 | **mover**; **audit #14 — structurally-derived** |
| 411 | `412_youngest_scout` | 1312.15 | — | **audit #10 — control** |

### 5.3 173 Segs Project — 175 parsed, 173 committed, 2 dropped

**This is the table Session I got wrong.** Both indices given; navigate by `committed`.

| committed idx | parse idx | segment | value at HEAD | rule(s) | role |
|---|---|---|---|---|---|
| — | 0 | `perilous_realms` | *dropped* | R.10 | **mover**; **must NOT reappear** |
| 0 | 1 | `hostile_landscape` | 0 | R.10 | **mover**; scored (earlier sitting) |
| 4 | 5 | `abysmal_opinion` | 17.88 | R-U, R-AA, R.11 | **mover**; scored (earlier sitting) |
| 11 | 13 | `eternal_focus` | 37.73 | R-U, R-AA | **mover** (net-unmoved); **audit #22** |
| — | 12 | `blue_monkey` | *dropped* | R-U, R-AA, R.10 | **mover**; scored (earlier sitting); **must NOT reappear** |
| 35 | 37 | `vessel_access` | 138.54 | — | **audit #7 — control** |
| 45 | 47 | `vessel_damage_clue` | 174.74 | R-U | **mover**; scored (earlier sitting) |
| 67 | 69 | `earthwork_corridor` | 256.33 | — | scored (Session H, YES) — unmoved control |
| 91 | 93 | `safety_passage` | 361.37 | — | **audit #19 — control** |
| 123 | 125 | `fallen_regiment_site` | 507.01 | — | scored (Session H, YES) — unmoved control |
| 141 | 143 | `unstable_spirit_journey` | 586.28 | R-U, R-AA | **mover** (net-unmoved); **audit #8** |
| 142 | 144 | `broken_link` | 593.88 | R-U, R-AA | **mover** (net-unmoved); **audit #16** |
| 143 | 145 | `battle_network` | 597.83 | R-U, R-AA | **mover** (net-unmoved); **audit #3** |
| 144 | 146 | `protection_failure` | 603.69 | R-U, R-AA | **mover** (net-unmoved); **audit #1** |
| 145 | 147 | `entry_clash` | 609.24 | R-U, R-AA | **mover** (net-unmoved); **audit #18** |
| 146 | 148 | `unstable_energy_consequence` | 612.51 | R-U, R-AA | **mover** (net-unmoved); **audit #15** |
| 149 | 151 | `team_disperse` | 624.68 | — | **audit #2 — control** |

### 5.4 Spanish Project — 27 segments, 27 committed, 0 dropped

`committed idx` = `parse idx` throughout.

| idx | segment | value at HEAD | rule(s) | role |
|---|---|---|---|---|
| 5 | `006_attack_setup` | 12.87 | — | **audit #5 — control** |
| 13 | `014_keep_moving` | 37.98 | — | **audit #17 — control** |
| 15 | `016_prepares_weapons` | 44.9 | — | scored (Session H, YES) — unmoved control |
| 22 | `023_scylla_six_sailors` | 65.12 | R-U | **mover**; scored (earlier sitting) |

### 5.5 Mover roll-call — all 31 accounted for

Every one of `stage1-mover-audit.md` §2.1's 31 movers appears above: **18 v6** (rows 1–18 of
that table), **12 in 173** (rows 19–30, two of them dropped), **1 spanish** (row 31).
Cross-checked against the committed fixtures at Session J's HEAD — every value in the "value
at HEAD" columns above was read from
`scripts/fixtures/phase4-fa-second-baseline-{corpus}-segments.csv`, not copied forward.

## 6. What a clean run looks like

- Every one of the three projects syncs to completion with FA engaged. **Two independent
  signals now, where Session I had one:** `anchorSource: 'forced-alignment'` on the committed
  segments, AND the run's own `'info'` engine entry in the Sync Log naming forced alignment
  with its aligned-word count. If those two ever disagree, that is a finding in itself.
- **No `'fa-fallback'` entry in any of the three runs' logs.** This is the check that could
  not be made before Session J: a run that fell back silently used to look identical to a
  clean one.
- Every value in §5.2–5.4 matches its "value at HEAD" column. A mismatch means the live path
  and the committed fixture disagree, which is a bigger finding than any single boundary.
- `perilous_realms` and `blue_monkey` do **not** appear as timed segments in 173. Each should
  additionally leave an `owningRule: 'R.10'` rule-correction entry naming it.
- No committed boundary in V6 falls inside any interval in §5.1. Expect **nine**
  `owningRule: 'R.12'` entries on v6 — one per recitation except R0 — and check their
  `correctedValue`s against §5.1.
- Expect **ten** `owningRule: 'R.5'` entries on v6 and **zero** on 173 and Spanish.
  **Measured, not estimated:** `computeUnscriptedRuns` run over the committed fixtures at
  Session J's HEAD returns 10 / 0 / 0, and v6's ten spans are *exactly* the ten recitation
  intervals in §5.1 — `[0.08, 3.40]`, `[125.54, 129.01]`, `[251.56, 253.11]`,
  `[371.54, 373.27]`, `[522.00, 525.63]`, `[663.91, 666.48]`, `[789.26, 791.69]`,
  `[925.14, 928.93]`, `[1044.72, 1050.00]`, `[1189.76, 1192.17]`. Note this is **ten**, not
  R.5's eight *movers*: a run is excised whether or not excising it ends up relocating a
  committed boundary, so the log count and the mover count are different quantities and
  should not be reconciled against each other.
- Expect **four** `owningRule: 'R.11'` entries (3 v6, 1 in 173) and **zero** rule entries of
  any kind on Spanish.
- Preview plays correctly on all three — this is also what discharges **D-1 item 8**
  (see `stage1-non-ear-remainder.md`, D4).

**Capture the Sync Log's Copy export for each of the three runs.** That export is now the
run's durable evidence; with the logging in place there is no longer any reason for the
acceptance run to depend on a devtools console that dies with the window.
