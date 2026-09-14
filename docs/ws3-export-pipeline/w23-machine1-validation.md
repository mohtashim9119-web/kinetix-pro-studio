# W23 validation script — does a mux-stage failure retain and resume on Windows?

> Companion runbook for `windows-validation.md` row **W23**. One question only:
> when a mux-stage disk-full failure hits a multi-piece export whose pieces are
> already fully rendered, does Round 24a's fix (a) retain the pieces + manifest
> instead of erasing them, and (b) resume to a finished file without
> re-rendering anything or spinning up a render worker? Everything below is
> built to make ONE run conclusive — read the whole document before you start
> the timed part (Step 4 onward); the setup steps are cheap, the timed part is
> not.

## 0. Enable diagnostic logging on the release installer

Test the actual release installer — you no longer need a debug build for
this. Native logging (`tauri_plugin_log`) now attaches in release too, but
only when opted in: it is OFF by default so an end user never gets a log
file. Turn it on for this run by setting an environment variable on the
launching process before starting the app:

```powershell
$env:KINETIX_DIAGNOSTIC_LOG = "1"
Start-Process "path\to\kinetix-pro-studio.exe"
```

(macOS/Linux equivalent: `KINETIX_DIAGNOSTIC_LOG=1 open "/Applications/Kinetix Pro Studio.app"`,
or `KINETIX_DIAGNOSTIC_LOG=1 ./kinetix-pro-studio` for a raw binary.) Any
value that isn't exactly `1` or `true` (case-insensitive) is treated as off —
unset, empty, or `0` all mean no logging, matching the default.

**The exact log file path** (`src-tauri/src/lib.rs`'s `setup`, the
`KINETIX_DIAGNOSTIC_LOG` branch): `<app_local_data_dir>/diagnostic-logs/kinetix-diagnostic.log` —

- **Windows:** `%LOCALAPPDATA%\com.kinetix.pro-studio\diagnostic-logs\kinetix-diagnostic.log`
- **macOS:** `~/Library/Application Support/com.kinetix.pro-studio/diagnostic-logs/kinetix-diagnostic.log`

This is a `Folder` target with a pinned filename, not `tauri_plugin_log`'s own
`LogDir` default — you do not need to hunt for an app-name-derived filename
under the OS log directory; it is exactly this path, every time, on every
platform. The file accumulates across launches (it is not truncated on
restart) — if you're running this validation more than once, note the file's
size or delete it before your timed run so the entries you're looking for
aren't mixed in with a prior attempt's.

**What lands in it:** every `ffmpeg_retain_session_for_resume` and
`ffmpeg_destroy_session` call, each as one line carrying the session id, the
`failureKind` the frontend passed (or `none` for a call with no failure
context), and the full native result — `RetainForResumeReport`'s disposition
+ retained/reclaimed bytes + removed-file list, or `DestroySessionOutcome`'s
disposition. This is INDEPENDENT of DevTools/the frontend diagnostics blob
below — if the WebView crashes or DevTools wasn't open at the right moment,
this file still has the native side's own record of what happened. No other
call is enriched by this opt-in; it does not turn the app noisy — every
`log::info!`/`log::warn!` in the codebase is technically eligible once the
plugin is attached, but the volume in a normal export run is a handful of
lines, not a firehose.

DevTools does NOT auto-open in a release build (that guard is unchanged,
still debug-only) — open it yourself. Right-click anywhere in the app window
and choose "Inspect Element", or use the WebView2 DevTools keyboard shortcut
(F12) if the release build doesn't block it.

**WS3 item I addition** — as of this round the log also carries a
`disk_preflight` line, target `kinetix::disk_preflight`, one per export
attempt: `disk_preflight session_id=... ok=<bool> estimate_temp_required=...
estimate_dest_required=... estimate_temp_peak=... estimate_final=...
estimate_annexb=... estimate_voiceover=... estimate_aac=... volumes=[...]
shortfall=<{...}|none>`. This is the preflight's OWN computed numbers
(`estimateExportDiskBytes`/`decideDiskPreflight` in `diskFull.ts`) — before
this round they only ever reached `console.info('[ws3-disk] preflight', ...)`
and the diagnostics blob, both WebView-side and both gone the moment a
release build's WebView crashes or DevTools was not open at the right
moment. A `disk_preflight ok=false` line, on its own, is now enough to
diagnose a refusal — required/available/shortfall bytes and the volume(s)
involved — without DevTools ever having been open.

## 1. Size the volume from a real dry run — don't compute it blind

Guessing the byte threshold from the bitrate formula alone risks either no
failure (volume too big) or a render-stage failure instead of mux-stage
(volume too small) — either wastes the whole run. Do a dry run first, on
normal storage, of the EXACT project you'll use for the real test:

1. Export the project normally (no constrained disk). Before it finishes,
   open DevTools → Application → note nothing; instead, after it completes,
   copy the diagnostics blob (the app's own "Copy diagnostics" action) and
   find `appendLedger`/piece sizes, OR simpler: while that normal export is
   still mid-flight, run in PowerShell:
   ```powershell
   Get-ChildItem "$env:TEMP\kinetix-export-*" -Recurse -Force |
     Select-Object Name, Length | Sort-Object Name
   ```
   right after the LAST piece's checkpoint would have been written (watch for
   `export_state.json`'s `mtime` to stop advancing, or just do this once the
   progress bar shows 100% render / "finishing up"). Record the sum of all
   `piece_*.h264` sizes — call this `P`. Also note whether a voiceover asset
   is attached and its byte size (`W`) — from the same directory listing
   (`voiceover_audio`/the copied WAV) or the asset's own file size.

2. **CORRECTED — this used to say "P to 2P", which is wrong and is why
   twelve exports were refused before frame one.** That number modelled
   ONLY the concat step's own doubling (`P` pieces + up to `P` more for
   `video_all.h264`) and ignored the premux copy, the delivered
   `export_final.mp4`, and the voiceover bytes — all of which coexist at the
   SAME instant, the audio-mux step (`diskFull.ts`'s own derivation,
   § "The model, in bytes"):
   ```
   peak(1 piece)   = 3P + W + AAC·D
   peak(≥2 pieces) = 4P + W + AAC·D        (+ video_all)
   ```
   and the LIVE preflight (`estimateExportDiskBytes` / `decideDiskPreflight`,
   the same code this validates) does not gate on that raw peak — it gates
   on the peak WITH headroom, `tempRequiredBytes` = `applyHeadroom(peak)` =
   `ceil(peak × 1.10) + 64 MiB`. Rounding AAC's ~2.4%-of-`P` contribution in:
   ```
   required ≈ 4.4·P + 1.1·W + 64 MiB      (≥2 pieces, with voiceover)
   ```
   **This is now the FLOOR, not the target.** A volume with less available
   space than `required` refuses the export at the preflight, before a
   single frame renders — correct behavior, not a bug, but it means the old
   "P to 2P" sizing guarantees a preflight refusal on any real project, every
   time. See step 3 below for how to still land a genuine MUX-stage failure
   now that the preflight actually gates on the true peak.

3. **How a genuine mux-stage ENOSPC is still reachable.** Because the
   preflight requires `required` bytes to be free before it lets the export
   start, and real usage tracks the raw peak `4P + W + AAC·D` closely (the
   Machine-1 field sample measured 998,485 B/s against the modelled
   1,000,000 B/s — 0.15% under), a volume sized at exactly `required` has
   its whole 10%-plus-64-MiB margin BY DESIGN and should complete without
   hitting ENOSPC. Reproducing the failure deterministically means consuming
   part of that margin AFTER the preflight has already measured it as free,
   not shrinking the volume itself:
   - Create the VHD sized at `required` plus a small operator margin (step 2
     below uses `required + 150 MB`, comfortably above the floor so the
     preflight passes).
   - Once render completes (same `export_state.json` mtime-stop signal as
     step 1 above — this is BEFORE concat starts, decision point 2 in §4's
     table), write a filler file into the SAME volume, in a directory the
     export does not use, sized to consume everything except roughly `2P`
     of headroom. At that point the temp tree already holds `P` (the
     pieces); concat needs another `~P` for `video_all.h264`, then the
     premux/final/voiceover steps need the rest of the `4P + W` peak — a
     ~`2P` remainder is enough to get PAST concat's own doubling but fail
     during the premux/final/voiceover portion of the mux step, which is
     the field failure's actual shape (`error.phase === 'concat'` is set for
     ANY ENOSPC during `concat_annexb_pieces`'s phase, which in the live
     pipeline spans through the mux step — see `exportPipelineWebCodecs.ts`
     phase transitions cross-referenced in §4 decision point 3 below).
   - Delete the filler file immediately after the run (pass or fail) — it is
     not part of anything W23 or a later run needs, and leaving it defeats
     `diskpart`'s own cleanup at the end of §5.

## 2. Create a volume sized for the CORRECTED requirement, and redirect only the app's TEMP to it

**Do not put this VHD on the volume holding `%LOCALAPPDATA%`.** The WebView2
profile directory lives there too (see the ledger note below), so starving
that volume of free space risks triggering origin-storage eviction — the
exact class of loss item A/B of the incident fix exists to close, not
something a validation run should risk reproducing as a side effect. Put the
VHD on a different physical/logical volume than `%LOCALAPPDATA%`'s.

Don't redirect the machine's global `%TEMP%` (`setx` at the system level) —
that's a standing change to your whole Windows session that's easy to forget
to revert. Redirect it for the app process only, via a launcher:

```powershell
# CORRECTED sizing — see §1 step 2. Replace P and W with your Step 1
# measurements (bytes). This is `required` (what the live preflight itself
# demands to let the export start) plus a small operator margin so the
# preflight passes comfortably; §1 step 3 explains how the run still reaches
# a genuine mux-stage ENOSPC despite that margin.
$P = 1.2GB   # your Step 1 measurement of the summed piece_*.h264 bytes
$W = 0.05GB  # your Step 1 measurement of the voiceover asset's byte size (0 if none)
$required = [math]::Ceiling((4.4 * $P + 1.1 * $W) * 1) + 64MB   # matches diskFull.ts's applyHeadroom() to within rounding
$sizeBytes = $required + 150MB
$vhdPath = "$env:USERPROFILE\kinetix-w23-test.vhdx"
$diskpartScript = @"
create vdisk file="$vhdPath" maximum=$($sizeBytes/1MB) type=fixed
select vdisk file="$vhdPath"
attach vdisk
create partition primary
format fs=ntfs quick label="W23TEST"
assign letter=W
"@
$diskpartScript | diskpart

# Launch the app with TEMP/TMP redirected for THIS PROCESS ONLY.
# session_dir() in ffmpeg.rs is literally std::env::temp_dir().join("kinetix-export-<uuid>"),
# so redirecting TEMP/TMP is sufficient — no other config controls this path.
$env:TEMP = "W:\temp"
$env:TMP = "W:\temp"
New-Item -ItemType Directory -Force -Path "W:\temp" | Out-Null
# Adjust the path to wherever your dev build / installed app .exe actually is.
Start-Process "path\to\kinetix-pro-studio.exe"
```

Confirm in DevTools (or Task Manager → the running app's environment, or just
trust the child-process inheritance) that the app actually sees `W:\temp` —
easiest proof: start ANY export and confirm `W:\kinetix-export-<uuid>\...`
exists while it's running, not a path under the real `C:\Users\...\AppData\Local\Temp`.

**Ledger note — the `%LOCALAPPDATA%` overlap is real, not hypothetical.** On
Windows, the WebView2 user data folder and `app_local_data_dir()` (where
native project storage, the diagnostic log, and — pre-item-C — every asset
byte live) both resolve under `%LOCALAPPDATA%\com.kinetix.pro-studio`. Free-
space pressure on that volume therefore affects both the browser engine's own
storage (eviction risk) and the app's native stores at once. Item C's
relocatable storage root moves assets off that volume; it is a durability
improvement there, not merely a capacity one — this VHD warning is the same
concern applied to how W23 itself must be run.

## 3. Negative controls to run FIRST, on normal (unconstrained) storage

Run these two before the expensive constrained-disk run, so a failure in the
constrained run can't be blamed on a regression these would have caught
cheaper:

**N1 — user cancel must still delete the session.** Start any export, click
Cancel mid-render. Expected: `cancelExportWebCodecs` → `teardown(true)` (force)
→ `ffmpeg_destroy_session(force: true)` → `DestroySessionOutcome.disposition
== "destroyed"` regardless of any manifest. Verify: the session directory is
gone immediately, and it does NOT appear in the resumable-sessions list on
next launch. If it survives or appears as resumable, force wiring broke —
stop, this is a bigger regression than what W23 is testing and must be fixed
first.

**N2 — a genuine disk_full (render-stage, not mux-stage) must still retain.**
**CORRECTED sizing note (WS3 item I):** "size the volume well under `P`" has
the SAME problem §1 step 2 just fixed for the main run — the corrected
preflight refuses any volume with less than `required` (§1 step 2) available
BEFORE render starts, so a volume at 40% of `P` now gets
`error.phase === 'preflight'`, not `'append'`, and N2 as originally written
can no longer reach the append stage at all. Use the same "pass preflight,
then consume the margin" approach as §1 step 3, timed differently: size the
VHD at `required` plus a small margin (as in §2) so the preflight passes,
then write a filler file sized to leave well under `P` of headroom BEFORE
starting the export (there is no render-complete signal to wait for here —
the filler has to land before the first append batch, which is harder to
time precisely than §1 step 3's post-render window). Confirm `error.phase`
actually reads `'append'` before trusting the result; if the filler landed
too late (or the timing raced) and you instead observe `'concat'` or a clean
completion, resize the filler and retry — do not report N2 against a run
where the phase does not match.

Same VHD technique otherwise. Expected: `error.kind === 'disk_full'`,
`error.phase === 'append'` (not `'concat'`) this time, and
`RetainForResumeReport.disposition === "retained"` — this is the ORIGINAL
Round 21 D3d case; Round 24a only BROADENED the gate to every failure kind, it
must not have narrowed or broken this one. If this regresses, Round 24a's
`decideSessionRetentionOnFailure` wiring has a bug, not just an unconfirmed
hardware row.

Both must pass before the real W23 run below is worth doing.

## 4. The real run

With the VHD from Step 2 mounted and `TEMP`/`TMP` redirected, start the export
of the same project used in Step 1. Let it render normally — it must reach
100% of the render/append phase (all pieces written, checkpoint closed)
before hitting ENOSPC. If it fails during append instead of concat, the
volume is too small — stop, this run doesn't test W23, resize up and restart
from Step 2 (this is why Step 1's dry run matters: get it right the first
real attempt).

### Decision points and the exact expected value at each

| Point | What to check | Expected value | Where it comes from |
|---|---|---|---|
| 1. Render completes | `export_state.json` exists in the session dir, all `piece_N.h264` present | file exists, `"closed":true`-shaped content | `session_claim.rs::has_manifest` |
| 2. Concat starts | DevTools console / phase log | `enterPostEncodePhase('concat')` fires | `exportPipelineWebCodecs.ts:3769` |
| 3. Concat hits ENOSPC | the returned error object | `error.kind === 'disk_full'`, `error.phase === 'concat'` — NOT `'append'`, NOT a bare `'concat'`-kind generic message | `exportPipelineWebCodecs.ts:3788`/`3894`, cross-check against ledger E11 |
| 4. Retention decision | Three independent readings, which must all agree: (a) `RetainForResumeReport.disposition` (NOT the same enum as step 6 below — `retain_session_for_resume`'s own field), (b) the diagnostics-log line `retain_session_for_resume session_id=... failure_kind=concat disposition=...` (§0), (c) the frontend diagnostics blob's `retentionAttempted`/`sessionDisposition.source`/`sessionDisposition.disposition` | (a)/(b)/(c) all `"retained"`, `retentionAttempted: true`, `sessionDisposition.source: "retainForResume"` | `session_claim.rs:715`; reached via `decideSessionRetentionOnFailure` in `exportSessionRetentionDecision.ts`; logged in `ffmpeg_retain_session_for_resume` (`ffmpeg.rs`); blob fields from `ExportError`/`exportDiagnosticsBlob.ts` |
| 5. Files after the failure, before any relaunch | `Get-ChildItem W:\kinetix-export-<uuid> -Force`, cross-checked against the blob's `diskStateAfterFailure` (an INDEPENDENT post-hoc directory read the app itself took — `manifestPresent`/`pieceCount`/`pieceTotalBytes` should match your own listing exactly) | **Present:** every `piece_N.h264`, `export_state.json` (+ `.tmp`/`.bak` if mid-write), `session_claim.json`. **Absent:** `video_all.h264`, any `export_final*`/`.part` file | `is_resume_retained_file`, `session_claim.rs:583-597`; `diskStateAfterFailure` from `ffmpeg_session_disk_snapshot` (`ffmpeg.rs`) |
| 6. If step 4 unexpectedly is NOT `"retained"` | fallback path taken | `teardown(false)` → `ffmpeg_destroy_session(force:false)` → `DestroySessionOutcome.disposition`, ALSO visible as the blob's `sessionDisposition.source: "destroySession"` and the diagnostics-log line `destroy_session session_id=... failure_kind=concat disposition=...` | if this reads `"refused_manifest"`, the native backstop caught a bug in step 4 — the session still survives, but report this as a defect, not a pass. If it reads `"destroyed"`, Round 24a's fix failed outright — this is the Machine 1 loss recurring; capture everything in §6 immediately, don't retry blind |
| 7. Relaunch the app | resumable-sessions list (dev IPC console: whatever surfaces `ffmpeg_list_resumable_sessions`, or the in-app resume offer UI) | the session from this run appears as resumable | `exportResumeDiscovery.ts` |
| 8. Take the resume offer | phase log, THE ORDERING invariant | native picture-count (`count(...)`) never called before `prepareCheckpointResume` (the fence) succeeds | `exportResumeDiscovery.test.ts`'s `'THE ORDERING'` test — same invariant, now checked live not just in a fake harness |
| 9. Resume with nothing left to render | DevTools console / no new `Worker` instantiation for `exportWorker.ts`, diagnostics blob's `encoderSessionsOpened` for this run | **zero** — resume goes straight to concat/mux, no render worker spun up, no piece re-encoded | `useExport.ts:146` creates the render `Worker` only when there's rendering left to do; a fully-rendered-but-unmuxed session should skip straight past it |
| 10. Resume finishes | the saved output file | a complete, playable MP4; picture count matches what an uninterrupted run of the same project would produce (compare against Step 1's dry run, same project) | operator-facing outcome |

### What the resumed run must prove, stated plainly

1. **Completes to a finished file** — not another failure, not a stall.
2. **No piece re-rendered** — every `piece_N.h264`'s SHA-256 after resume
   matches its SHA-256 captured right after the original failure (Step 5
   above). Compute both with `Get-FileHash -Algorithm SHA256` and diff.
3. **No worker spun up** — no `exportWorker.ts` module load in DevTools'
   Network/Sources tab during the resume, and `encoderSessionsOpened` (from
   the resumed run's own diagnostics blob) is `0`.

If all three hold, W23 passes and can move from PENDING to closed with this
run's numbers recorded in the ledger. If any fails, you have a real defect,
not a hardware-unconfirmed row — do not soften the write-up.

## 5. Diagnostics to capture, in this order, WITHOUT closing the app between them

Capture these as you go, not after — a stopped app loses the DevTools console
buffer, and a second run costs you the whole setup again:

1. **Right after the ENOSPC failure, before touching anything else:**
   - Screenshot (or copy) the DevTools console tail — look for the
     `[ws3-resume]` tag lines (`useExport.ts`'s existing warn-level logs) and
     any uncaught error.
   - `Get-ChildItem W:\kinetix-export-<uuid> -Force | Select Name,Length,LastWriteTime | Format-Table` — save to a text file.
   - `Get-FileHash W:\kinetix-export-<uuid>\piece_*.h264 -Algorithm SHA256` — save.
   - The app's own "Copy diagnostics" output (paste to a file) — this is the
     `ExportWorkerDiagnosticsPayload`/liveness snapshot merged with
     `ExportError`; it has `failureVia`, `appendLedger`,
     `encoderSessionsOpened/Closed` for the FAILED run, PLUS (as of this
     round) `retentionAttempted`, `sessionDisposition` (with its `source`
     field — see §4's decision-point table), and `diskStateAfterFailure` —
     the app's own independent post-hoc directory read, to diff against your
     own `Get-ChildItem`/`Get-FileHash` above.
   - Copy `<app_local_data_dir>\diagnostic-logs\kinetix-diagnostic.log`
     (§0) — this is native-side, independent of the WebView/DevTools
     entirely; if the app hard-crashes right after the failure and you lose
     the console, this file is what's left. Confirm it has a
     `retain_session_for_resume` or `destroy_session` line with this run's
     session id before moving on — an empty or missing file at this point
     means `KINETIX_DIAGNOSTIC_LOG` wasn't actually set for this process
     (check now, not after the run).
2. **On relaunch, before taking the resume offer:** screenshot the resumable-
   sessions UI / dev-IPC console output showing this session listed.
3. **During resume:** leave DevTools open the whole time; do not refresh the
   page (a refresh loses the console buffer and the Worker/Network history
   Step 4.9 needs).
4. **After resume completes:** the same captures as item 1 (console tail,
   directory listing + hashes, Copy-diagnostics output including the three
   new fields, and the diagnostic log file) for the RESUMED run, so the
   before/after diff in §4's "what must prove" table is evidence, not
   recollection.
5. **Finally:** `Get-FileHash` the delivered output file, and if you have an
   uninterrupted reference export of the same project (Step 1's dry run
   output), record both picture counts side by side.

Bundle all of the above (text files + screenshots + the diagnostic log file)
into one folder named after the run before you tear down the VHD —
`diskpart`'s `detach vdisk` and delete the `.vhdx` only after you've copied
everything out.

**Why this order is still conclusive in one pass:** every capture in items
1–5 is either a snapshot of state that doesn't change once taken (a file
hash, a directory listing, the log file's tail) or is read from something
that survives independently of the others — the diagnostic log file survives
a WebView crash that would lose the DevTools console; the diagnostics blob's
`diskStateAfterFailure` survives a scenario where you forgot to run
`Get-ChildItem` yourself; your own `Get-ChildItem`/`Get-FileHash` survive a
bug in the app's own snapshot function. No single capture is load-bearing —
§4's decision-point table cross-references at least two independent sources
for both the retention decision (row 4) and the disk state (row 5), so
losing any ONE capture (a missed screenshot, a DevTools refresh) still
leaves enough to reach a conclusive pass/fail without a second run. The one
thing that is NOT recoverable after the fact is the resume-phase Worker/
Network history (item 3) — that is the single point where "don't refresh
DevTools" is a hard requirement, not a nice-to-have.

## 6. If it fails

Do not re-run blind. With the diagnostics from §5 already captured, you have
enough to tell which of these it was without a second attempt:
- Wrong `phase` at step 3 (e.g. `'append'` instead of `'concat'`) → the VHD
  was undersized for the render phase too; not a W23 result either way, but
  cheap to tell apart from a real defect using the Step 5 directory listing's
  timestamps (did ALL pieces finish before the error, per `export_state.json`'s
  own content, or did the render phase itself get cut short?).
- Step 4/6 shows `"destroyed"` or `"refused_manifest"` where `"retained"` was
  expected → real Round 24a defect, `useExport.ts`'s
  `decideSessionRetentionOnFailure` or `retain_session_for_resume` itself;
  file with the exact disposition value, the Copy-diagnostics output, and the
  directory listing attached.
- Step 9 shows a new `Worker` / nonzero `encoderSessionsOpened` on resume →
  the resume-vs-render decision (not this round's own code, pre-existing
  resume-planning logic) is re-rendering already-complete pieces; a
  correctness bug, not a data-loss one, but still worth its own report since
  it defeats the point of retention.
