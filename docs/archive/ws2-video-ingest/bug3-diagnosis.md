# WS2 Bug 3 — video-ingest playback freeze — diagnosis + decision memo

> Session: `.work-phase4/session-ws2-06/`. One build, one project, four bugs (WS2). Bugs 1/2/4
> status is out of scope here — see `docs/work-in-progress.md`. This file covers Bug 3 only:
> diagnosis (measured) + decision memo. No code changed this session.

## Symptom, precisely (B1 in the operator's numbering, reported not measured)

Operator-reported, single symptom, no variants observed since only one asset was tested:
- Asset imports into the timeline and the preview shows a static frame — plays in the asset
  library thumbnail sense, but frozen (not advancing) once dropped onto the timeline and played.
- The SAME asset, exported through this app's own export pipeline, plays correctly start to end.
- The same asset plays correctly in QuickTime, a plain browser tab, and CapCut.

## B0 — reproduction status: **NOT CONFIRMED IN THE LIVE APP THIS SESSION**

No native-app UI driver was available this session (the `computer-use` MCP server disconnected
mid-session — see the system notice — and the Browser-pane tools only reach a web preview, not
Tauri's native shell/IPC bridge, so `npm run tauri:dev` could not be exercised interactively).
**What IS confirmed:** a targeted reproduction against the real, unmodified production code
(`src/services/videoDecoderPool.ts`, via the project's own existing mock-`VideoDecoder` test
pattern from `videoDecoderPool.test.ts`, fed the asset's actual measured 120fps/600-frame/
single-video-track profile) shows a periodic frozen-frame pattern under simulated playback
that structurally matches the reported symptom (detail: §B4 below). This is code-level
evidence of a real, previously-latent bug in the preview decode path with the right shape to
produce the observed symptom — not a live-app confirmation. Flagged as the session's one
NOT-DETERMINED item; see "Next action."

Only one asset (`1.mp4`) was probed — operator reports "all [tool-generated assets] behave the
same" but no second file was examined, so whether every failing asset shares this exact
profile (120fps CFR) is unverified.

## B1 — media characterisation (MEASURED)

Asset: `1.mp4`, exported by a Gemini-Canvas-built tool (per operator), copied to
`.work-phase4/session-ws2-06/1.mp4` for analysis (gitignored, not committed; original lives
outside the repo at `~/Downloads/Failed Export Project Data/Assets/1.mp4`).

```
$ ffprobe -v error -show_format -show_streams -print_format json 1.mp4
```
- Container: genuine ISOBMFF/MP4 (`file` confirms "ISO Media, MP4 Base Media v1
  [ISO 14496-12:2003]" — not a misnamed/other-wrapped format).
- Video: H.264 (`avc1`), profile **High**, level **4.2**, `yuv420p`, **8-bit**
  (`bits_per_raw_sample: 8`), 1920×1080, `color_range/space/transfer/primaries: bt709` (all
  standard Rec.709, not HDR).
- **`r_frame_rate` = `avg_frame_rate` = `120/1`** — nominal rate is 120fps.
- `nb_frames: 600`, `duration: 5.000000s` → 600/5.0 = **exactly 120fps**.
- No B-frames (`has_b_frames: 0`).
- `nal_length_size: 4`, `is_avc: true` — standard AVCC-in-MP4 framing.
- No rotation matrix / no `side_data_list` on the stream (`ffprobe -show_entries
  stream_side_data` returns empty).
- **No audio track at all** — `format.nb_streams: 1`, video only.
- `tags.handler_name: "mp4-muxer-hdlr"` — consistent with a browser/WebCodecs-based JS muxer
  (e.g. the `mp4-muxer` npm package), not a traditional NLE/ffmpeg export.

Per-packet PTS distribution (`ffprobe -show_entries packet=pts_time,dts_time,duration_time`,
600 packets, all consecutive deltas computed):
- **Two unique deltas across all 599 gaps: `0.008333` and `0.008334`** (rounding-noise only,
  both ≈ 1/120s). **This is genuine hardware-precision CFR, not VFR.** No VFR-treated-as-CFR
  question applies to this file.

Edit list / duration agreement (direct box walk — `MP4Box`/`gpac`/`mp4dump`/`AtomicParsley` are
not installed on this machine; wrote a standalone Python ISOBMFF box walker instead, see
`.work-phase4/session-ws2-06/` transcript):
```
ftyp @ 0 size=28
moov @ 28 size=3167
  mvhd @ 36 size=108
  trak @ 144 size=3051
    tkhd @ 152 size=92
    mdia @ 244 size=2951
      mdhd @ 252 size=32
      hdlr @ 284 size=47
      minf @ 331 size=2864
        vmhd, dinf, stbl (stsd, stts, stss, stsc, stsz, stco) — no edts/elst box anywhere
mdat @ 3195 size=7234345
```
- **No `edts`/`elst` box exists in this file at all** — moov→trak→mdia→minf→stbl has no `edts`
  child box, so there is no edit list to have an offset.
- `mvhd` timescale=1000, duration=5000 → 5.0s. `tkhd` duration=5000 (movie-timescale units) →
  5.0s. `mdhd` timescale=57600, duration=288000 → 5.0s. **All three agree exactly at 5.0s** —
  no movie/track/media duration mismatch either.
- `stss` (sync-sample/keyframe table) has 22 entries over 600 frames — roughly one keyframe per
  27 frames, unremarkable GOP structure for a web encoder.

## B2 — the elst hypothesis (MEASURED, arithmetic)

**Zero contribution — the hypothesis does not apply to this file.** There is no `elst` box to
have an offset (§B1). This rules out edit-list handling as Bug 3's cause for this asset. (It
remains possible some *other* failing asset in the operator's folder carries an elst box — only
`1.mp4` was examined this session — but it cannot be the general explanation, since this file
reproduces the symptom without one.)

## B3 — where playback derives timing (MEASURED, file:line)

Playback timing/decode for the WebCodecs preview path lives in
[`src/services/videoDecoderPool.ts`](../../src/services/videoDecoderPool.ts). Two constants
govern the decode-ahead window and its buffer:

- `WINDOW_AHEAD_SEC = 1.5` ([videoDecoderPool.ts:76](../../src/services/videoDecoderPool.ts#L76))
  — a **time**-based decode-ahead horizon: `feedWindow` decodes every chunk whose presentation
  timestamp is `<= (targetSec + WINDOW_AHEAD_SEC) * 1e6`
  ([videoDecoderPool.ts:586](../../src/services/videoDecoderPool.ts#L586)), in one synchronous
  loop of `decoder.decode(chunk)` calls with no yield between them
  ([videoDecoderPool.ts:598-605](../../src/services/videoDecoderPool.ts#L598-L605)).
- `MAX_BUFFERED_FRAMES_PER_SESSION = 90`
  ([videoDecoderPool.ts:107](../../src/services/videoDecoderPool.ts#L107)) — a **frame-count**
  cap on simultaneously-buffered decoded `VideoFrame`s. `handleDecoderOutput`
  ([videoDecoderPool.ts:1081-1094](../../src/services/videoDecoderPool.ts#L1081-L1094)) drops
  (closes without buffering) any decoder output arriving once this cap is hit, unless
  `slideWindowForward` can first evict already-passed frames to make room.
- `slideWindowForward` ([videoDecoderPool.ts:1062-1079](../../src/services/videoDecoderPool.ts#L1062-L1079))
  can only evict frames older than `session.windowTargetUs - RETAIN_BEHIND_SEC`, and
  `windowTargetUs` is only updated at the **start** of a `fillWindow` call
  ([videoDecoderPool.ts:660](../../src/services/videoDecoderPool.ts#L660)) — i.e. once per
  `getFrameAt` turn, not once per decoded frame.

Both constants' own comments state the tuning assumption explicitly: `MAX_BUFFERED_FRAMES_
PER_SESSION`'s doc says "roughly 3s of 30fps content"
([videoDecoderPool.ts:97](../../src/services/videoDecoderPool.ts#L97)); `RETAIN_BEHIND_SEC`'s
doc says "0.5s is ~12 frames at 24fps / ~15 at 30fps"
([videoDecoderPool.ts:83](../../src/services/videoDecoderPool.ts#L83)). **The code assumes
content in the ~24-30fps range; nothing reads the source's actual `avg_frame_rate` to adjust
either constant.** This is not a VFR-treated-as-CFR bug (the file genuinely is CFR, §B1) — it is
a fixed TIME window sized against a frame-count cap that was never made proportional to the
source's real fps.

## B4 — the decisive measurement (MEASURED, code-level reproduction)

**Mechanism, reproduced against the real, unmodified `VideoDecoderPool` class** using a scratch
test file (`src/services/__bug3diag.test.ts`, written, run, and deleted this session — no
source or permanent test changes) that reused the project's own existing mock-`VideoDecoder`
harness pattern (`videoDecoderPool.test.ts`'s `MockVideoDecoder`/`MockVideoFrame`), fed a
600-chunk, 8_333µs-cadence (120fps), 27-frame-GOP chunk list matching `1.mp4`'s measured
profile, and simulated a preview tick calling `getFrameAt` every 33ms of target time (a 30fps
UI tick) — i.e. exactly the constants and cadence the real preview loop uses.

Result, first `ensureSession`+`getFrameAt(0)` call alone:
```
session.frames.length after 1st call = 90       (hit MAX_BUFFERED_FRAMES_PER_SESSION exactly)
session.frames first/last ts = 0 .. 0.741637s     (buffer covers only 0.74s of real time)
session.feedCursor = 181, feedFrontierUs = 1499940 (1.5s)  (but 181 chunks were FED — decode() called for all of them)
fullyFed = false
```
The single `feedWindow` call for the FIRST target (0s) synchronously calls `decode()` for 181
chunks (everything up to the 1.5s window boundary) — because at 120fps, 1.5s of content is 180
frames, double the 90-frame cap. Since `windowTargetUs` is still pinned at 0 (nothing has called
`fillWindow` for a later target yet — that only happens on the NEXT `getFrameAt` call, which
hasn't run), `slideWindowForward` has nothing evictable, so **every output past the 90th is
silently dropped** (`videoDecoderPool.ts:1087-1094`). Because `feedCursor` has already advanced
past all 181 of those chunks, they are never re-fed — `fullyFed=false` but the next feed batch
only continues from chunk 181 onward (1.5s+), never revisiting the dropped 0.75s-1.5s range.

Simulated playback (targets 0 → 2.0s, one `getFrameAt` call per 33ms, matching a 30fps UI tick):
```
target=0.00s -> frame @ 0.000s   (delta   0ms)   OK
target=0.33s -> frame @ 0.325s   (delta   5ms)   OK — still inside the surviving 90-frame buffer
target=0.66s -> frame @ 0.658s   (delta   2ms)   OK
target=0.99s -> frame @ 0.742s   (delta 248ms)   STALE — buffer's last surviving frame, no closer one exists
target=1.32s -> frame @ 0.742s   (delta 578ms)   STALE — same frame again, playback frozen
target=1.65s -> frame @ 1.650s   (delta   0ms)   recovers (a new feed batch reaches this target)
target=1.98s -> frame @ 1.767s   (delta 213ms)   STALE again — same pattern repeats
```
18 of 61 simulated ticks (0-2.0s) land more than 200ms stale on a repeated frame — a periodic
freeze-then-jump pattern, not a smooth advance and not a decoder rejection. **This fully
explains "freezes, looks like an image" without needing to invoke decoder rejection at all.**

**Is the file actually REJECTED by `VideoDecoder`?** NOT DETERMINED empirically (no live
WebCodecs runtime reachable this session — see B0). Indirect evidence against rejection: the
codec/profile/level/pixel-format/color-space combination (`avc1.640c2a`, High@4.2, 8-bit
`yuv420p`, bt709) is entirely mainstream — nothing in it resembles a known WebCodecs
`configure()` rejection case (no B-frames complexity, no exotic profile, no 10-bit/HDR, no
rotation). The reproduced buffer-overflow mechanism above is sufficient on its own to explain
the symptom, with no rejection required. Given that, and that export (which decodes the exact
same chunks with the exact same `VideoDecoder` config via `getOrCreateDemux`, just through a
different, non-windowed code path — see B5) succeeds, rejection is unlikely but not proven
false.

## B5 — what CapCut tolerates that this app doesn't (measured from OUR code, not CapCut's)

Not a claim about CapCut's implementation — a statement of what's different on our side.
`src/services/webcodecsExport/sequentialDecode.ts`'s own header states it explicitly
(`sequentialDecode.ts:10-17`): *"Deliberately NOT a retrofit of videoDecoderPool.ts. That
module's windowed decode-ahead ... machinery exists to serve a scrubbable, randomly-seekable
PREVIEW timeline ... Export has none of those requirements — it walks each ... source range
exactly once, start to end ... this file drives one dedicated VideoDecoder per call, with no
pooling."* It reuses only `getOrCreateDemux` and the pure `findChunkRange` function from
`videoDecoderPool.ts` — none of `WINDOW_AHEAD_SEC`, `MAX_BUFFERED_FRAMES_PER_SESSION`, or the
windowed-buffer/eviction machinery. **The concrete property difference is: export decodes this
file sequentially with no time-window/frame-count mismatch to overflow; preview decodes it
through a buffer whose sizing assumption (§B3) this file's frame rate breaks by 4x.** This is
exactly consistent with "plays fine in exported video, freezes in preview."

## Root cause (one sentence)

`videoDecoderPool.ts`'s preview decode-ahead buffer sizes its frame-count cap
(`MAX_BUFFERED_FRAMES_PER_SESSION = 90`) against a fixed TIME window
(`WINDOW_AHEAD_SEC = 1.5s`) tuned for ~24-30fps source content without ever reading the
source's actual frame rate, so a 120fps asset (4x the assumption) overflows the cap within the
very first decode-ahead batch and permanently drops the frames in the overflow range — because
`feedCursor` has already advanced past them — producing a periodic stale-frame freeze in
preview while export (a separate, non-windowed sequential decode path) is unaffected.

## Phase C — decision memo

**Recommendation: (i) — a narrow fix in the existing playback/decode code.**

Under 200 words: B1-B2 rule out edit lists and duration mismatches entirely (no `elst` box
exists in this file; mvhd/tkhd/mdhd durations agree exactly). B3-B4 pin the actual cause to one
module, `videoDecoderPool.ts`, whose two governing constants were tuned as a matched pair for
~24-30fps content and never made proportional to source fps. B5 shows export is unaffected
because it uses an entirely separate, non-windowed decode path. Nothing here indicates
`VideoDecoder` rejects the file — codec/profile/color are all mainstream — so the "genuinely
rejected, needs re-encoding before decode will even start" case that would justify (ii)/(iii)
has no supporting evidence. The fix is scoped to one file: make the decode-ahead window (or the
buffer cap) proportional to the source's actual `avg_frame_rate` (already available from
`getOrCreateDemux`'s probed config) instead of the current fixed 1.5s/90-frame pair. This is
strictly cheaper than a new normalization subsystem and touches none of the frozen sync-pipeline
files.

**C1-C8 (import-time proxy pipeline design gaps): not answered — not applicable.** They're
scoped to option (ii)/(iii), which this memo does not recommend. Answering them in full would
be designing a subsystem the evidence doesn't call for. Flagging one relevant fact for the
record regardless: this asset carries **no audio track**, so C1's audio-invariant risk cannot be
exercised by this specific file — it would need to be re-verified against an audio-bearing
failing asset if a proxy pipeline is ever revisited.

## What remains NOT DETERMINED

1. **Live-app confirmation** — the reproduction above is a code-level, mocked-decoder
   reproduction against the real production module, not an observation in the running Tauri
   app (no UI driver reachable this session). The mechanism is sound and matches the reported
   symptom precisely, but has not been watched happen on screen.
2. **Whether `VideoDecoder` genuinely accepts this codec config in real WKWebView/Chromium** —
   inferred likely (mainstream profile) from the codec fields, not measured against a live
   decoder.
3. **Whether other assets in the operator's folder share this exact 120fps profile** — only
   `1.mp4` was probed; operator reports "all behave the same" but this is unverified against
   file properties.

## Next action

Get live-app confirmation: run `npm run tauri:dev`, import `1.mp4`, drop it on the timeline,
and watch whether playback freezes at the pattern this session's reproduction predicts (a stall
around 0.7-1.5s into playback, recovering briefly near 1.5s, stalling again) — ideally with
`console.log` instrumentation temporarily added to `handleDecoderOutput`'s drop branch
(`videoDecoderPool.ts:1092`) to confirm real decoder output is actually being dropped there, not
just in the mock. Only once that live confirmation lands should the fix (make the window/cap fps-aware) be designed and implemented — this session is diagnosis-only by the operator's own
scope.

## Session WS2-07 — Phase A attempt (live confirmation BLOCKED)

**A3/A4 (MEASURED, `ffprobe`, all 10 assets in the operator's failed-export folder — command +
output: `.work-phase4/session-ws2-07/asset-probe.txt`):**

All 10 video assets (`1.mp4`-`10.mp4`) in
`/Users/mohtashim/Downloads/Failed Export Project Data/Assets/` are **byte-for-byte identical in
profile**: `h264 High@4.2`, `1920x1080`, `yuv420p`, `bt709`, `r_frame_rate=avg_frame_rate=120/1`,
`nb_streams=1` (no audio track), `duration=5.000000`. There is no low-fps asset in the set to
compare against and no asset that diverges from `1.mp4`'s profile — the failure set (per the
operator's report that "all behave the same") and the high-fps set are the same 10 files, with no
evidence of a second, distinct defect. **A4: the ceiling to size the fix against is 120fps @
1920x1080 (1080p, not 4K)** — no higher fps or resolution exists anywhere in this asset set.

**A1/A2 (BLOCKED, not performed):** Attempted to open `Kinetix Pro Studio` via computer-use to
drive `npm run tauri:dev`'s native WKWebView window, import `1.mp4`, and watch preview playback
directly. `request_access` for `Kinetix Pro Studio` (and `Finder`, needed to navigate the import
file picker) was **denied by the user** in-session. No other tool in this environment can see or
interact with a native macOS window — the Browser-pane preview tools drive a Chromium tab, not a
Tauri/WKWebView app window; there is no headless/CLI path to `VideoDecoder` accept/reject or to
watch the preview `<canvas>` update. Per the gate in this step's instructions, **Phase C
(implementation) does not proceed** — the freeze mechanism remains a code-level reproduction
against the real, unmodified `videoDecoderPool.ts` (§B4 above), not an on-screen observation, and
whether `VideoDecoder` genuinely accepts this codec config in real WKWebView remains unmeasured.

**Exact steps for the operator to run this manually:**
1. `npm run tauri:dev` from the project root (leave it running).
2. In the app window that opens, start/open a project and import
   `/Users/mohtashim/Downloads/Failed Export Project Data/Assets/1.mp4` as an asset, then place it
   on the timeline.
3. Press play (or scrub) and watch the preview: does it stall ~0.7-1.5s in, briefly recover near
   1.5s, then stall again periodically? Note actual timings if the pattern differs.
4. Open the WKWebView dev console (right-click the preview → Inspect Element, or enable the Tauri
   dev menu) and watch for any `VideoDecoder` `configure()`/`decode()` error — this settles A2
   (accept vs. reject) directly; none was found in the code-level reproduction, but that used a
   mock decoder, not the real one.
5. Report back what was actually seen (or paste a screen recording) so this session can proceed to
   Phase B/C fix design and implementation with a confirmed mechanism.

**Bug 3 remains OPEN. Not closed this session — the Phase A gate was not met.**
