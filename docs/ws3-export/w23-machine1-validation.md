# W23 validation script — does a mux-stage failure retain and resume on Windows?

> Companion runbook for `windows-validation.md` row **W23**. One question only:
> when a mux-stage disk-full failure hits a multi-piece export whose pieces are
> already fully rendered, does Round 24a's fix (a) retain the pieces + manifest
> instead of erasing them, and (b) resume to a finished file without
> re-rendering anything or spinning up a render worker? Everything below is
> built to make ONE run conclusive — read the whole document before you start
> the timed part (Step 4 onward); the setup steps are cheap, the timed part is
> not.

## 0. Build choice — read this before you build

Use a **debug** build (`npm run tauri:dev`, or a debug bundle), not the release
installer, for this test. Reason, verified against source: `tauri_plugin_log`
is only attached `if cfg!(debug_assertions)` (`src-tauri/src/lib.rs:429-433`),
and DevTools only auto-opens on Windows under the same debug guard
(`src-tauri/src/lib.rs:435-439`). In a release build, every native `log::warn!`
call (including the orphan-sweep and resume-related ones) goes nowhere — no
file, nothing — so a failure in a release installer is only half-diagnosable.
If you must test the actual release installer for another reason, you can
still open DevTools manually and you still get the TS-side console tags below,
but you lose every native-side log line; say so explicitly in your notes if
you go that route so a clean-looking result isn't over-trusted.

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
   `piece_*.h264` sizes — call this `P`.
2. `P` is what the concat step (`concat_annexb_pieces`, phase `'concat'`) must
   write again into a NEW file (`video_all.h264`) before deleting nothing —
   both `P` bytes of pieces AND up to `P` more bytes of `video_all.h264` exist
   on disk simultaneously mid-concat. That's your target window.

## 2. Create an undersized volume and redirect only the app's TEMP to it

Don't redirect the machine's global `%TEMP%` (`setx` at the system level) —
that's a standing change to your whole Windows session that's easy to forget
to revert. Redirect it for the app process only, via a launcher:

```powershell
# Create a fixed-size VHD sized between P and 2P — e.g. P=1.2 GB -> 1.8 GB.
# Adjust $sizeBytes from your Step 1 measurement of P.
$sizeBytes = 1800MB
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
Same VHD technique, but size the volume so it runs out DURING append/render
(pick a size well under `P`, e.g. 40% of `P`). Expected: `error.kind ===
'disk_full'`, `error.phase === 'append'` (not `'concat'`) this time, and
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
| 4. Retention decision | `RetainForResumeReport.disposition` (NOT the same enum as step 6 below — this is `retain_session_for_resume`'s own field) | `"retained"` | `session_claim.rs:715`; reached via `decideSessionRetentionOnFailure` in `exportSessionRetentionDecision.ts` |
| 5. Files after the failure, before any relaunch | `Get-ChildItem W:\kinetix-export-<uuid> -Force` | **Present:** every `piece_N.h264`, `export_state.json` (+ `.tmp`/`.bak` if mid-write), `session_claim.json`. **Absent:** `video_all.h264`, any `export_final*`/`.part` file | `is_resume_retained_file`, `session_claim.rs:583-597` |
| 6. If step 4 unexpectedly is NOT `"retained"` | fallback path taken | `teardown(false)` → `ffmpeg_destroy_session(force:false)` → `DestroySessionOutcome.disposition` | if this reads `"refused_manifest"`, the native backstop caught a bug in step 4 — the session still survives, but report this as a defect, not a pass. If it reads `"destroyed"`, Round 24a's fix failed outright — this is the Machine 1 loss recurring; capture everything in §6 immediately, don't retry blind |
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
     `ExportWorkerDiagnosticsPayload`/liveness snapshot; it has `failureVia`,
     `appendLedger`, `encoderSessionsOpened/Closed` for the FAILED run.
   - If running a debug build: the log file under the app's log directory
     (`tauri-plugin-log`'s default target — check `%APPDATA%\com.kinetix.pro-studio\logs\` or wherever the plugin resolved to; confirm the exact path once by watching it get created during Step 3's negative controls, since you'll want it again here).
2. **On relaunch, before taking the resume offer:** screenshot the resumable-
   sessions UI / dev-IPC console output showing this session listed.
3. **During resume:** leave DevTools open the whole time; do not refresh the
   page (a refresh loses the console buffer and the Worker/Network history
   Step 4.9 needs).
4. **After resume completes:** the same three captures as item 1 (console
   tail, directory listing + hashes, Copy-diagnostics output) for the
   RESUMED run, so the before/after diff in §4's "what must prove" table is
   evidence, not recollection.
5. **Finally:** `Get-FileHash` the delivered output file, and if you have an
   uninterrupted reference export of the same project (Step 1's dry run
   output), record both picture counts side by side.

Bundle all of the above (text files + screenshots) into one folder named
after the run before you tear down the VHD — `diskpart`'s `detach vdisk` and
delete the `.vhdx` only after you've copied everything out.

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
