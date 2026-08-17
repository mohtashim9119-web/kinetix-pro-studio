# Stage 1 Lock — Live Acceptance Run Preparation (WS1 Session I, 2026-08-18)

> **What this is:** everything the live acceptance run needs, **prepared and not executed**.
> Nothing in this file was run against the app; every claim below is a verification of
> readiness, and the one gap found is reported rather than fixed.
>
> **Prepared at HEAD `726112b`.** Run this only after `stage1-mover-audit.md` scores clean —
> the audit is pass one, this walkthrough is pass two.

---

## 1. Invocation — CONFIRMED

```bash
npm run tauri:dev:fa
```

Resolves to `tauri dev -f fa-inference` (`package.json`). Verified at this HEAD:

| check | result |
|---|---|
| `cargo check --features fa-inference` | **clean** |
| `cargo test --features fa-inference` | **209 passed / 20 ignored** |
| `npm run lint` (`tsc --noEmit`) | **clean** |
| `npm test` | **87 files / 2283 passed / 1 skipped** |

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

**Fail-clean, so a silent fallback is possible and must be watched for:** any failure —
unsupported language, absent model, hash mismatch, inference error, empty chunk plan — returns
`null` and the run proceeds on Whisper tokens. It never throws and never aborts. Which is
exactly why §4 matters.

---

## 4. What the sync logs must capture — and the gap, reported not fixed

### 4.1 The requirement

Every **warning**, **fallback**, **skip**, and **rule firing**, each carrying **timestamp**,
**segment index**, and **owning rule**.

### 4.2 What the current logging already emits

`SyncLogEntry` (`src/types.ts:506`) is persisted to `project.syncLog`, grouped per run by
`syncRunId`, rendered in the Sync Log panel and exportable via its Copy button.

| requirement | status | evidence |
|---|---|---|
| timestamp | ✅ | `SyncLogEntry.timestamp` (`Date.now()`), on every entry |
| run grouping | ✅ | `syncRunId`, on every entry |
| **skips** | ✅ **fully** | `type: 'skip'` with `segmentIndex`, `segmentText`, `segmentTag`, `reason`, `matchedWords`, `totalWords`, `confidence`, `longestRun` |
| **warnings** | ✅ | `type: 'warning'` + the `severity`/`fixHint` axis; `silence-error`, `malformed-token`, `unsupported-language`, `lock-*` all have their own types |
| character-timing **fallback** | ✅ | the `unexpectedFallback` branch emits a real `'warning'` entry |
| **segment index** | ⚠️ **partial** | the field exists but is documented and used as *"Skip entries only"* |
| **FA fallback** (gate open, FA returned `null`) | ❌ **absent** | `console.warn` only, inside `runForcedAlignmentForSync`; no `SyncLogEntry` is created on any of its five failure paths |
| **rule firings** (R.5 / R.10 / R.11 / R.12) | ❌ **absent** | `console.warn` only — `App.tsx:2957` (R.10), `:3113` (R.11), `:3140` (R.12); R.5 fires inside `computeFaChunkPlan` before inference and logs nothing at all |
| **owning rule** | ❌ **absent** | `SyncLogEntry` has no rule field, and `SyncLogEntryType` has no rule-firing member |

### 4.3 The gap, stated plainly

**The current logging does NOT satisfy the requirement.** Three of the four categories are
covered; **rule firings are not logged at all**, and **no log entry can name an owning rule**.
Today a rule correction is visible only in the devtools console of a dev build — it is not in
`project.syncLog`, not in the Sync Log panel, not in the Copy export, and gone the moment the
window closes. The FA fallback is equally invisible: a run where FA silently failed and
committed Whisper timing is **indistinguishable in the log from a run where FA succeeded**.

For a live acceptance run whose entire purpose is to record what the rules did, that is
disqualifying — the run would produce no durable evidence of the thing being accepted.

### 4.4 The additive change this needs — **DESCRIBED, NOT WRITTEN. Stopping for approval.**

Per the session brief, this is described and left unbuilt. It is genuinely additive: no
existing entry changes shape, no existing behaviour changes, and with no rule firing the log is
byte-identical to today's.

1. **`src/types.ts`** — add two `SyncLogEntryType` members, `'rule-correction'` and
   `'fa-fallback'`. Add two optional fields to `SyncLogEntry`:
   - `owningRule?: string` — `'R.5' | 'R.10' | 'R.11' | 'R.12' | 'R-U' | 'R-AA'`, kept a
     widened `string` so a future rule needs no type edit.
   - `ruleDetail?: { committedValue: number; correctedValue: number; reason: string }`.
   Both optional, matching the file's own stated convention for later-added fields.
2. **Widen `segmentIndex`'s contract** from "Skip entries only" to "skip and rule-correction
   entries", and say so in its doc comment. No code change — the field already exists.
3. **`App.tsx`** — at the three existing `console.warn` sites (R.10 `:2957`, R.11 `:3113`,
   R.12 `:3140`), push one `makeSyncLogEntry` per finding into `pendingLogEntries` alongside
   the existing warn. Each detector already returns `segmentIndex`, the committed value and
   the corrected value, so **no detector changes and no new measurement is required** — this
   is transcription of data that already exists at the call site.
4. **R.5** needs one extra step, and it is the only non-trivial part: it fires inside
   `computeFaChunkPlan` *before* inference, so its excisions must be returned out to the
   caller to be logged. Recommended scope: return the excision list alongside the chunk plan
   rather than logging from inside the service (services stay React-free, CLAUDE.md §6).
5. **`forcedAlignmentRun.ts`** — the fail-clean contract says it never throws; extend it to
   also never fail *silently*. Return a discriminated result (`{tokens} | {failed, reason}`)
   so `App.tsx` can emit one `'fa-fallback'` warning entry naming which of the five failure
   paths fired. This is the change with real blast radius — it touches the FA entry point's
   signature — and is the one most worth ruling on separately.

**Estimated cost:** items 1–3 ≈ 2 hours; item 4 ≈ 2 hours; item 5 ≈ 2–3 hours including tests.

**Recommendation:** approve items 1–3 before the live run (they are what make the run's
evidence durable, and they are near-zero risk), and treat items 4 and 5 as a separate decision
— the run can proceed without them provided the operator captures the devtools console for
the whole session, which covers R.5 and the FA fallback in a non-durable but sufficient form.

**Nothing above has been written. Awaiting approval.**

---

## 5. The walkthrough index

Everything the walkthrough must visit, by segment index, so no searching is needed. Roles:
**mover** = a rule changed its committed value at some point; **audit row** = scored in
`stage1-mover-audit.md`; **previously scored** = Session H's 12-row pass; **ear-verified
(earlier sitting)** = a register closure scored before Session H.

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

### 5.2 Per-project index — every mover, audit row and previously scored row

### V6 Natural Long Pause Segs (447 segments)

| seg idx | segment | value at HEAD | rule(s) | role in the walkthrough |
|---|---|---|---|---|
| 35 | `036_outward_sentry` | 105.55 | — | **audit control row** |
| 41 | `042_eleven_years` | 125.54 | R.5, R.12 | **mover**; previously scored (Session H) |
| 42 | `043_night_migration` | 130.96 | R.5 | **mover**; ear-verified (earlier sitting) |
| 59 | `060_reassuring_hand` | 184.02 | R-U | **mover**; **audit row** |
| 84 | `085_the_spear_bearer` | 250.69 | R.12 | **mover**; **STRUCTURAL — audit row** |
| 86 | `087_throwing_spear_poise` | 259.88 | R.5 | **mover**; previously scored (Session H) |
| 124 | `125_night_circle` | 370.75 | R.5, R.12 | **mover**; previously scored (Session H) |
| 132 | `133_wake_man` | 399.79 | — | **audit control row** |
| 151 | `152_frozen_brush_mice` | 451.03 | R.11 | **mover**; ear-verified (earlier sitting) |
| 157 | `158_scout_false_alert` | 466.09 | — | previously scored (Session H) — unmoved control |
| 175 | `176_twenty_six_scout` | 521.71 | R.5, R.12 | **mover**; previously scored (Session H) |
| 191 | `192_scout_listening` | 571.07 | R.11 | **mover**; previously scored (Session H) |
| 223 | `224_thirty_three` | 663.785 | R-U, R-AA, R.12 | **mover**; **STRUCTURAL — audit row** |
| 224 | `225_night_scouts` | 667.47 | R-U, R-AA | **mover**; **audit row** |
| 225 | `226_four_scouts` | 671.18 | R-U, R-AA, R.11 | **mover**; ear-verified (earlier sitting) |
| 241 | `242_fen_excited_run` | 710.11 | R-U | **mover**; **audit row** |
| 244 | `245_seasonal_contrast` | 719.91 | — | **audit control row** |
| 265 | `266_forty_one_burden` | 788.65 | R.5, R.12 | **mover**; previously scored (Session H) |
| 306 | `307_forty_nine_years` | 924.92 | R.12 | **mover**; **STRUCTURAL — audit row** |
| 307 | `308_scouts_leading` | 931.4 | R.5 | **mover**; ear-verified (earlier sitting) |
| 317 | `318_scout_on_ridge` | 969.3 | — | previously scored (Session H) — unmoved control |
| 331 | `332_fading_sound` | 1020.65 | — | **audit control row** |
| 339 | `340_fifty_eight` | 1044.67 | R-U, R.5, R.12 | **mover**; previously scored (Session H) |
| 382 | `383_sixty_four` | 1188.95 | R.12 | **mover**; **STRUCTURAL — audit row** |
| 411 | `412_youngest_scout` | 1312.15 | — | **audit control row** |

### 173 Segs Project (173 segments)

| seg idx | segment | value at HEAD | rule(s) | role in the walkthrough |
|---|---|---|---|---|
| 0 | `hostile_landscape` | 0 | R.10 | **mover**; ear-verified (earlier sitting) |
| 0 | `perilous_realms` | — | R.10 | **mover**; **dropped — must NOT reappear** |
| 4 | `abysmal_opinion` | 17.88 | R-U, R-AA, R.11 | **mover**; ear-verified (earlier sitting) |
| 11 | `eternal_focus` | 37.73 | R-U, R-AA | **mover**; **audit row** |
| 12 | `blue_monkey` | — | R-U, R-AA, R.10 | **mover**; ear-verified (earlier sitting); **dropped — must NOT reappear** |
| 35 | `vessel_access` | 138.54 | — | **audit control row** |
| 45 | `vessel_damage_clue` | 174.74 | R-U | **mover**; ear-verified (earlier sitting) |
| 67 | `earthwork_corridor` | 256.33 | — | previously scored (Session H) — unmoved control |
| 91 | `safety_passage` | 361.37 | — | **audit control row** |
| 123 | `fallen_regiment_site` | 507.01 | — | previously scored (Session H) — unmoved control |
| 141 | `unstable_spirit_journey` | 586.28 | R-U, R-AA | **mover**; **audit row** |
| 142 | `broken_link` | 593.88 | R-U, R-AA | **mover**; **audit row** |
| 143 | `battle_network` | 597.83 | R-U, R-AA | **mover**; **audit row** |
| 144 | `protection_failure` | 603.69 | R-U, R-AA | **mover**; **audit row** |
| 145 | `entry_clash` | 609.24 | R-U, R-AA | **mover**; **audit row** |
| 146 | `unstable_energy_consequence` | 612.51 | R-U, R-AA | **mover**; **audit row** |
| 149 | `team_disperse` | 624.68 | — | **audit control row** |

### Spanish Project (27 segments)

| seg idx | segment | value at HEAD | rule(s) | role in the walkthrough |
|---|---|---|---|---|
| 5 | `006_attack_setup` | 12.87 | — | **audit control row** |
| 13 | `014_keep_moving` | 37.98 | — | **audit control row** |
| 15 | `016_prepares_weapons` | 44.9 | — | previously scored (Session H) — unmoved control |
| 22 | `023_scylla_six_sailors` | 65.12 | R-U | **mover**; ear-verified (earlier sitting) |

---

## 6. What a clean run looks like

- Every one of the three projects syncs to completion with FA engaged (`anchorSource:
  'forced-alignment'` on the committed segments — the one durable in-app signal that FA
  actually ran rather than falling back).
- Every value in §5.2 matches the "value at HEAD" column. A mismatch means the live path and
  the committed fixture disagree, which is a bigger finding than any single boundary.
- `perilous_realms` and `blue_monkey` do **not** appear as timed segments in 173.
- No committed boundary in V6 falls inside any interval in §5.1.
- Preview plays correctly on all three — this is also what discharges **D-1 item 8**
  (see `stage1-non-ear-remainder.md`, D4).
