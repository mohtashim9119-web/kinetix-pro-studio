# WS3 — 120fps preview vs export analysis

> **Session:** analysis-only on branch `ws3-120fps-preview` @ `2703850` (doc move), base `main` @ `4d4922c`.
> **Scope:** map preview vs export decode paths, evaluate the buffer-cap hypothesis, rank Windows-specific factors, measure what Mac can, design the permanent fix. **No `src/` or `src-tauri/` changes this round.**

---

## Step 0 — Worktree and bookkeeping

| Item | Value |
|---|---|
| Main repo pwd | `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio` |
| Worktree pwd | `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-ws3-120fps-preview` |
| Branch | `ws3-120fps-preview` |
| Base HEAD | `4d4922c` (`main` == `origin/main`, clean before worktree) |
| Doc-move commit | `2703850` |
| `docs/work-in-progress.md` line count after move | **210** (cap 300) |

Prior diagnosis preserved in `docs/ws2-video-ingest/bug3-diagnosis.md` (sessions ws2-06/07). This report re-verifies against **current** `main` code, including the WS3 sparse-keyframe / sliding-window changes in `videoDecoderPool.ts`.

---

## Step 2 — Preview vs export path map

### 2a — Preview path (disk → pixels)

| Stage | What happens | File:line |
|---|---|---|
| **Import / URL** | File persisted to IndexedDB via `putAsset`; asset gets `url = URL.createObjectURL(file)` and retains `asset.file`. | `App.tsx:375-386` (`persistFileToAsset`) |
| **Native fps probe (import only)** | Optional `probeVideoFps(blob)` → Tauri `probe_video_fps` → ffmpeg stderr parse; stored as `Asset.nativeFps` for export UI suggestion only — **not read by preview decode**. | `App.tsx:341-347`, `384`; `tauriFfmpeg.ts:64-69`; `ffmpeg.rs:643-659`, `596-609` |
| **Capability gate** | `isWebCodecsPreviewSupported()` checks `VideoDecoder` + `EncodedVideoChunk` on `window`. Legacy `<video>` dual-slot path used when false. | `webcodecsSupport.ts:17-23`; `PreviewStage.tsx:380`, `900-905` |
| **Clock** | Voiceover: `usePlayback.ts` rAF loop reads `audioRef.current.currentTime` (~60 Hz ticks, `CURRENT_TIME_EPSILON_SEC = 0.01`). No-voiceover: 100 ms `setInterval`. Preview pulls frames; it does not run its own fps clock. | `usePlayback.ts:9-12`, `69-80`, `useWebCodecsPreview.ts:113-124` |
| **Segment → source time** | `toSourceTime(segment, currentTime, asset.duration)` maps timeline position to source trim window (native rate, no per-segment speed). | `useWebCodecsPreview.ts:141-151` |
| **Hook orchestration** | `useWebCodecsPreview`: owns one `VideoDecoderPool`; `ensureSession` on segment change; chase-coalesced `getFrameAt` on every `currentTime` tick; exposes `pool` to `useGlPreview` for transitions. | `useWebCodecsPreview.ts:478-479`, `542-601`, `617-680`; `PreviewStage.tsx:535-552` |
| **Demux** | `getOrCreateDemux(url)` → `fetch(url)` → whole-file `arrayBuffer()` → mp4box `createFile(true)` → all `EncodedVideoChunk`s cached per blob URL. **Does not use `asset.file`.** | `videoDemuxer.ts:79-84`, `166-177` |
| **Decode / buffer** | `VideoDecoderPool`: windowed decode-ahead (`WINDOW_AHEAD_SEC = 1.5`), per-session frame cap (`MAX_BUFFERED_FRAMES_PER_SESSION = 90`), sliding eviction (`slideWindowForward`), scrub reset, LRU across sessions. | `videoDecoderPool.ts:76-107`, `583-635`, `655-730`, `1062-1105` |
| **Frame selection** | Latest buffered frame at-or-before `targetSec`; serialised per session via `getFrameAt` queue. | `videoDecoderPool.ts:791-869` |
| **Composite (GL path)** | `useGlPreview` pulls current + outgoing frames from same pool; `glCompositor.ts` WebGL2 transition/animation/zoom. | `useGlPreview.ts:13-15`, `321`; `PreviewStage.tsx:584+` |
| **Composite (non-GL fallback)** | `PreviewCanvas.tsx` draws `VideoFrame` to canvas with object-contain fit. | `PreviewCanvas.tsx:6-11`, `PreviewStage.tsx` (non-GL branch) |
| **Legacy fallback** | Dual `<video>` elements, `seekToTime`, `waitForVideoFrame`, browser-native decode — **not used when WebCodecs supported**. | `PreviewStage.tsx:881-959` |

### 2b — Export decode path (same asset)

| Stage | What happens | File:line |
|---|---|---|
| **Export fps** | User/`exportFps` state (24 \| 30 \| 60); timeline walked at `currentTime = runStartSec + i / fps`. **Independent of source native fps.** | `useExport.ts:27`, `exportWorker.ts:993`, `950-951` |
| **Worker entry** | `exportWorker.ts` GL run loop; per-segment `DecodeCursor` wrapping `decodeSegmentFrames`. | `exportWorker.ts:21`, `296-345`, `800-802` |
| **Demux** | Same `getOrCreateDemux(assetUrl)` → `fetch(blob:…)` (shared cache with preview). | `sequentialDecode.ts:126`, `videoDemuxer.ts:166-177` |
| **Decode** | Dedicated `VideoDecoder` per `decodeSegmentFrames` call; forward-only async generator; internal queue cap `DECODE_AHEAD_CAP = 8` undelivered frames. **No** `WINDOW_AHEAD_SEC`, **no** `MAX_BUFFERED_FRAMES_PER_SESSION`, **no** sliding window, **no** pool. | `sequentialDecode.ts:10-17`, `37-43`, `117+` |
| **Frame pick** | `frameAt(cursor, targetSec)` walks generator strictly forward; export playhead monotone. | `exportWorker.ts:364-391` |
| **Cursor lifetime** | `DecodeCursorRegistry`; max 2 open cursors; released when playhead passes segment (+ transition tail). | `decodeCursorLifetime.ts:10-21`, `53-74`, `exportWorker.ts:800-802` |
| **Legacy plain tier** | `segmentEncoder.ts` ffmpeg re-encode; uses `asset.file` when present (avoids blob fetch). | `segmentEncoder.ts:417-419` |
| **Mux** | AnnexB pieces → concat → H.264/AAC MP4 at chosen export fps. | `exportPipelineWebCodecs.ts` |

### 2c — Side-by-side divergence table

| Stage | Preview | Export | Differs? |
|---|---|---|---|
| Asset URL | `blob:` from `createObjectURL` | Same `asset.url` in WebCodecs path | No |
| Demux | `videoDemuxer.getOrCreateDemux` whole-file fetch+mp4box | Same | No |
| Demux → file bytes | **`fetch(url)` only** | Same in WebCodecs path (`segmentEncoder` plain tier uses `.file`) | Partial (plain tier only) |
| Decoder instance | Pooled, reused per asset; windowed sessions per segment | Fresh decoder per `decodeSegmentFrames`; closed in `finally` | **Yes** |
| Decode scheduling | Rolling `target + 1.5s` window; async fill + waiters | Strict sequential `[startSec,endSec)` once | **Yes** |
| Buffer limit | `MAX_BUFFERED_FRAMES_PER_SESSION = 90` + pool `MAX_TOTAL_BUFFERED_FRAMES = 150` | `DECODE_AHEAD_CAP = 8` (export generator only) | **Yes** |
| Eviction | `slideWindowForward` + drop when full & can't slide | Consumer-paced; closes superseded frames in `frameAt` | **Yes** |
| Seek / reset | `needsReset` + `resetSessionWindow` on backward scrub / big jump | None (monotone playhead) | **Yes** |
| Output fps | Displays at source frame timestamps (pull at audio clock rate) | Re-sampled on export timeline at `exportFps` | **Yes** |
| Uses `Asset.nativeFps` | No | Only for UI auto-suggest (`nearestExportFps`) | N/A |

**Primary divergence row:** preview alone combines a **time-based feed horizon** (`WINDOW_AHEAD_SEC`) with a **fixed frame-count cap** (`MAX_BUFFERED_FRAMES_PER_SESSION`) on a randomly-seekable pool; export uses **sequential decode** with no matching window/cap interaction.

---

## Step 3 — Buffer cap hypothesis

### 3a — Limits on the preview path

| Limit | Unit | Literal value | File:line |
|---|---|---|---|
| Decode-ahead horizon | **seconds** | `WINDOW_AHEAD_SEC = 1.5` | `videoDecoderPool.ts:76` |
| Retain behind playhead | **seconds** | `RETAIN_BEHIND_SEC = 0.5` | `videoDecoderPool.ts:93` |
| Per-session buffered frames | **frames** | `MAX_BUFFERED_FRAMES_PER_SESSION = 90` | `videoDecoderPool.ts:107` |
| Pool session count | sessions | `MAX_CACHED_SESSIONS = 3` | `videoDecoderPool.ts:114` |
| Pool total buffered frames | **frames** | `MAX_TOTAL_BUFFERED_FRAMES = 150` | `videoDecoderPool.ts:130` |
| Idle decoder handles / asset | count | `MAX_IDLE_DECODER_HANDLES_PER_ASSET = 2` | `videoDecoderPool.ts:136` |
| Export generator ahead (preview N/A) | **frames** | `DECODE_AHEAD_CAP = 8` | `sequentialDecode.ts:43` |

**No byte cap** on the preview decode buffer was found in `src/` (grep for byte-cap / MAX_*BYTE on preview path: none). The original WS2 item name ("byte-capping") describes **effective** behaviour: the cap is **frame-count**, not bytes.

Eviction policy when per-session cap hit (`handleDecoderOutput`): try `slideWindowForward`; if no slot freed, **close (drop) the newest frame**. | `videoDecoderPool.ts:1087-1093`

Removed historical limit (not present on `main`): `findChunkRange` no longer clamps to 600 chunks — comment at `videoDecoderPool.ts:320-331`.

### 3b — Arithmetic (measured asset + constants)

**Reference asset:** `~/Downloads/Failed Export Project Data/Assets/1.mp4` (probed this session via bundled ffmpeg):

| Property | Value |
|---|---|
| Container | MP4 / ISOBMFF |
| Codec | H.264 High @ **Level 4.2**, `yuv420p`, bt709 |
| Resolution | 1920×1080 |
| Frame rate | **120 fps** CFR (`120 tbr`; 600 frames / 5.0 s) |
| Bitrate | **~11.58 Mb/s** (`11580 kb/s` ffmpeg summary) |
| File size | 7,237,540 bytes |
| Audio | none |
| Duration | 5.000 s |

**Effective time held by `MAX_BUFFERED_FRAMES_PER_SESSION = 90`:**

| Source fps | Seconds in 90 frames | vs 1 frame interval (1/fps) | vs `WINDOW_AHEAD_SEC` (1.5 s) |
|---|---|---|---|
| 30 fps | **3.00 s** | 90× interval ✓ | 1.5s window → ~45 frames (cap not binding on first batch) |
| 60 fps | **1.50 s** | 90× interval ✓ | 1.5s window → ~90 frames (**at cap**) |
| 120 fps | **0.75 s** | 90× interval ✓ | 1.5s window → **~180 frames**; cap holds **0.75 s** while feed issues **181** chunks |

At **120 fps**, the first `feedWindow` for `targetSec = 0` synchronously calls `decode()` for all chunks with `timestamp ≤ 1.5s` (`videoDecoderPool.ts:599-605`) — **181 chunks** — while `windowTargetUs` is still **0** (`fillWindow` sets it once per turn: `videoDecoderPool.ts:660`). With `keepFromUs = 0 - 0.5s < 0`, `slideWindowForward` cannot evict (`videoDecoderPool.ts:1063-1065`). Once 90 frames are buffered, **91 frames in the 0.75–1.5 s range are dropped** and **`feedCursor` has already advanced past them** (`videoDecoderPool.ts:1087-1093`, `603`), matching the mechanism in `docs/ws2-video-ingest/bug3-diagnosis.md` §B4.

**Lead time vs one frame interval at 120 fps:** interval = **8.33 ms**; cap holds **750 ms** → cap holds ~**90 frame intervals** (not sub-interval). The defect is not sub-frame lead time; it is **feed horizon (1.5 s) exceeding cap horizon (0.75 s at 120 fps)** during incremental playback.

**Hypothetical byte-cap equivalent (for intuition only — no byte cap exists):** at 11.58 Mb/s, 0.75 s ≈ **1.09 MiB** of elementary stream; 3.0 s @ 30 fps ≈ **4.34 MiB**. A byte cap tied to a 30 fps assumption would **quarter** effective seconds when fps quadruples — same shape as the frame-cap mismatch.

### 3c — Unit choice

| Question | Finding |
|---|---|
| Cap expressed in | **Frames** (decoded `VideoFrame` count), not bytes or seconds |
| Feed horizon expressed in | **Seconds** (`WINDOW_AHEAD_SEC`) |
| Is unit mismatch the bug? | **PROBABLE YES** — constants documented for ~24–30 fps (`videoDecoderPool.ts:83-86`, `97-98`); **`avg_frame_rate` / `nativeFps` is never read** by `videoDecoderPool.ts` to scale either value. Higher source fps shrinks wall-clock coverage of the frame cap while the feed window stays 1.5 s of **source** time. |

**Interaction with WS3 sliding-window fix:** tests at `videoDecoderPool.test.ts:1353-1506` prove a **single** deep `getFrameAt` (e.g. 9.6 s on a 24 fps clip) succeeds because `windowTargetUs` is set to the deep target for the whole fill, enabling eviction. **Incremental playback** (successive `getFrameAt` with `windowTargetUs` tracking the current playhead) still hits the 120 fps arithmetic above — **NOT COVERED** by existing tests (all use 24 fps fixtures).

---

## Step 4 — Why Windows specifically

Ranked by likelihood given export succeeds on the same asset (demux + `VideoDecoder.configure` must work).

| # | Factor | Status | Evidence |
|---|---|---|---|
| 1 | **Frame-cap × window mismatch at 120 fps on incremental preview** | **PROBABLE** (platform-agnostic code; would affect any OS unless timing masks it) | §3; `bug3-diagnosis.md` §B4; no 120 fps test in `videoDecoderPool.test.ts` |
| 2 | **WebView2 vs WKWebView decode/output timing** | **UNTESTABLE WITHOUT WINDOWS** (and Mac live repro not run this session) | Preview uses same WebCodecs APIs (`webcodecsSupport.ts:19-22`); async `output` callback timing may differ; no platform branches in pool |
| 3 | **Tauri asset protocol / range requests** | **RULED OUT for this app** | Video assets use **`blob:` URLs** from `URL.createObjectURL`, not `asset://` / `http://asset.localhost` — no matches in `src-tauri/` or `src/` for asset protocol serving |
| 4 | **`fetch(blob:)` failure on WebView2** | **RULED OUT as primary cause when export works** | `videoDemuxer.ts:81-83` uses `fetch(url)`; WebCodecs export uses same demux (`sequentialDecode.ts:126`). Voiceover blob-fetch failures documented (`useWhisper.ts:30-31`, `exportPipelineWebCodecs.test.ts:157-158`) but **plain video WebCodecs export would fail demux too** if fetch failed |
| 5 | **H.264 Level 4.2 vs 1080p120** | **UNTESTABLE WITHOUT WINDOWS** (secondary) | Asset is High@**4.2** (`1.mp4` probe). 1080p @ 120 fps ≈ 979,200 macroblocks/s vs Level 4.2 MaxMBPS 245,760 — **exceeds level MBPS budget**. HW decoders may reject or behave badly on Windows while SW decode succeeds; **export also uses `VideoDecoder`** so total rejection is unlikely if export works — could still affect **preview decode throughput** |
| 6 | **60 Hz display / rAF clamp** | **RULED OUT as root cause of freeze** | Preview pulls **latest frame at-or-before** source time (`videoDecoderPool.ts:865-868`); displaying ≤60 updates/s is normal and does not require 120 Hz. Would cause judder, not permanent static frame |
| 7 | **CFR / timestamp units** | **RULED OUT for operator asset** | `1.mp4`: stable 8.333 ms deltas, no VFR (`bug3-diagnosis.md` §B1); chunks use µs (`videoDemuxer.ts:105-106`) consistently in preview and export |
| 8 | **2026-08-26 Mac non-repro** | **INCONCLUSIVE** | `docs/history-2.md` (~786-807): operator Mac run showed no freeze; **not instrumented** for buffer drops; code may have changed since; **does not disprove Windows report** |

---

## Step 5 — Mac reproduction (this session)

### 5a — Local 120 fps assets

| File | Probed |
|---|---|
| `~/Downloads/Failed Export Project Data/Assets/1.mp4`–`10.mp4` | `1.mp4` this session; `bug3-diagnosis.md` + `history-2.md` attest **10/10 identical** profile |

`1.mp4` probe command: bundled `src-tauri/binaries/ffmpeg-x86_64-apple-darwin -hide_banner -i <path>` (see §3b table).

### 5b — Live preview measurement on Mac

**NOT PERFORMED** — no interactive Tauri/WKWebView driver this session (same constraint as `bug3-diagnosis.md` §B0). No fabricated fps / drop counters.

### 5c — Does the bug reproduce on Mac?

**NOT DETERMINED live.** Prior operator attestation: **no freeze on Mac** on 2026-08-26 (`docs/history-2.md`). Code-level analysis: **120 fps incremental playback remains vulnerable** on current `main` (§3); WS3 sliding-window tests use **24 fps only**.

### 5d — Windows handoff checklist

1. Build/run: `CARGO_TARGET_DIR="$PWD/src-tauri/target" npm run tauri:dev` on Windows.
2. Import `/Users/mohtashim/Downloads/Failed Export Project Data/Assets/1.mp4` (copy to Windows machine).
3. Place on timeline; play 0–5 s. **Expect** if cap bug: stall ~0.75–1.5 s, brief recovery, repeat (`bug3-diagnosis.md` §B4).
4. DevTools → Console: watch for `VideoDecoder` configure/decode errors.
5. **Temporary instrumentation** (implementation round): log in `handleDecoderOutput` when the drop branch fires (`videoDecoderPool.ts:1087-1092`); log `session.frames.length`, `feedCursor`, `windowTargetUs`, selected frame timestamp in `getFrameAtInternal`.
6. Export same project at 30 or 60 fps; confirm output plays smoothly.
7. Optional: `chrome://gpu` / WebView2 internals for HW decode status; ffprobe exported MP4 for fps.
8. Record: presented preview smoothness, whether stalls match predicted timings, drop-branch log count, any configure errors.

---

## Step 6 — Native asset export frame rates

| Question | Answer | Citation |
|---|---|---|
| What fps does export assign for 120 fps source? | **User-selected `exportFps`** ∈ {24, 30, 60} — timeline frame grid uses that fps, **not** 120 | `useExport.ts:27`; `exportWorker.ts:993`, `950` |
| Where decided? | `App.tsx` `exportFps` state; passed through `useExport` → worker payload | `App.tsx:3103`; `useExport.ts:490` |
| Auto-suggest rule | On asset change, if all video assets agree, `nearestExportFps(nativeFps)` — for 120 → **60** (closest of 24/30/60) unless user override | `App.tsx:350-360`, `3139-3153` |
| Is 120 preserved? | **No** — no 120 in `ExportFps` type; export **always** samples source on a 24/30/60 Hz output grid via `frameAt` + GL loop | `useExport.ts:27` |
| Downsample rule | Sequential decode yields all source frames; **export discards via at-or-before selection** on the output timeline (implicit drop of intermediate 120 fps frames when exporting at 60) | `exportWorker.ts:364-391`, `993` |
| Separate defect from preview bug? | **YES — related symptom, different mechanism.** Preview bug: pool buffer/scheduling. Export "120 fps → 60" is **by design** (export fps cap) plus missing 120 export tier — judder risk if user forces 30 fps on 120 fps source (`ffmpeg.rs:635-638` comment). Not the Windows static-preview defect. |

---

## Step 7 — Root cause and fix design

### 7a — Most probable root cause

**Name:** **Fps-blind preview buffer sizing** — fixed `MAX_BUFFERED_FRAMES_PER_SESSION` (90 frames) paired with fixed `WINDOW_AHEAD_SEC` (1.5 s) without scaling to source frame rate, causing the first decode-ahead batch at 120 fps to feed ~180 frames, retain only ~90 (~0.75 s), drop the rest permanently while `feedCursor` advances, producing stale/frozen frames during incremental playback.

**Label:** **PROBABLE** (strong code-level chain + prior mock reproduction; **CONFIRMED** would require Windows live run with drop-branch logging or equivalent).

**Evidence chain:** §3 arithmetic → `feedWindow` feeds 1.5 s at 120 fps → `handleDecoderOutput` drop path → export unaffected because `sequentialDecode.ts:10-17` bypasses pool → operator: preview broken / export OK.

**Note on WS3 sliding-window fix:** fixed deep-scrub / single-keyframe **seek** stalls (`videoDecoderPool.test.ts:1353+`); **does not** rescale cap vs window for **playback** at high fps.

### 7b — Candidate designs

| Design | Correctness 30/60/120 | Memory 1080p | Win / Mac | Export blast radius | Testability |
|---|---|---|---|---|---|
| **A. Fps-aware cap** — set `maxBufferedFrames = ceil(WINDOW_AHEAD_SEC * sourceFps) + retainSlack` using demux-derived fps or `Asset.nativeFps` | Scales automatically | ~1.5 s × fps frames (~45/90/180) — bounded | Same logic both OSes | **Zero** (preview-only) | Unit tests with 120 fps mock chunks |
| **B. Time-based cap** — limit buffer by **seconds** of source time covered (evict by timestamp, cap e.g. 2.0 s wall in buffer) | Fps-agnostic | ~2 s of frames regardless of fps | Same | **Zero** | Property tests on eviction |
| **C. Display-paced preview** — decode only `[target - retain, target + small_margin]` each tick; never feed 1.5 s ahead on every incremental tick | Fps-agnostic; may add latency on scrub | Lowest peak | Same | **Zero** | Playback simulation tests |
| **D. Platform-specific Windows decode path** | Unknown without HW probe | N/A | Maintenance burden | Risk coupling | Needs Windows CI/manual |
| **E. Use `asset.file` in demuxer** (avoid blob fetch) | Does not fix cap | N/A | Helps other WebView2 fetch bugs | Low if export shares demux | Integration test |

### 7c — Recommendation

**Recommend Design B (time-based buffer cap), optionally combined with A (derive fps once from demux for sizing hints).**

Reasoning:

- **Fps-agnostic** — survives 120, 240, VFR edge cases better than hard-coding 90 frames.
- **Zero export blast radius** — changes confined to `videoDecoderPool.ts` (+ tests).
- **Alternatives lose:** **C** is larger behaviour change (latency/scrub feel). **D** special-cases OS without evidence fetch/configure fails when export works. **E** is good hygiene (mirror `segmentEncoder.ts:417-419`) but **does not address** cap mismatch per `bug3-diagnosis.md` + §3.

Also add **120 fps playback regression test** (mock): incremental `getFrameAt` every 33 ms on 120 fps single-keyframe fixture — must not return stale timestamps >200 ms behind target.

Separate follow-up (not this fix): **`ExportFps` 120 tier** + UI — tracked as export-framerate policy, not preview blocker.

### 7d — Implementation plan (ordered commits)

1. **`test(ws3): add 120fps incremental playback regression for VideoDecoderPool`** — mock 600-chunk/120 fps fixture; simulate 33 ms ticks; assert no stale frames; **expect red on current main**.
2. **`fix(ws3): scale preview buffer budget to source frame rate or wall-clock window`** — implement Design B in `videoDecoderPool.ts`; derive fps from chunk timestamps or pass from demux.
3. **`refactor(ws3): thread demux avg fps into ensureSession`** — optional; avoids re-deriving.
4. **`fix(ws3): prefer asset.file over fetch in videoDemuxer when caller provides File`** — optional hygiene; keep `getOrCreateDemux(url)` API, add parallel entry if needed without breaking cache keys.
5. **`docs(ws3): close WS3 item after Windows verification`** — operator sign-off.

### 7e — Regression tests required

| Test | Catches this bug? | Windows live? |
|---|---|---|
| 120 fps incremental mock playback (`videoDecoderPool.test.ts`) | **Yes** | No |
| Existing WS3 sliding-window deep-target tests | Partial (seek only) | No |
| Export golden / frame digest | No (export path) | No |
| Manual Windows 120 fps preview play | **Yes (confirmation)** | **Yes** |
| Optional: `videoDemuxer` reads `File` not `fetch(blob:)` on Windows | Separate fetch class | Yes |

---

## Gates (analysis round)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean (worktree @ `2703850`) |
| `npm run lint` | clean |
| `npm test` | **3193 passed / 77 skipped / 0 failed** |
| `git diff --name-only main -- src/` | empty |
| `git diff --name-only main -- src-tauri/` | empty |
| Cargo | **skipped** — empty `src-tauri/` diff |

---

## NOT DETERMINED (explicit)

1. Live Windows preview stall with instrumentation (drop branch counts). **Still open** — see Windows verification handoff below.
2. Live Mac preview behaviour on 120 fps with instrumentation. **Still open** — no Tauri/WKWebView driver this session.
3. Whether Mac "works" due to timing luck, different test asset, or older build. **Still open**.
4. `VideoDecoder` HW vs SW path on Windows WebView2 for High@4.2 1080p120. **Still open**.
5. ~~Whether all 10 operator assets remain byte-identical profile~~ **CLOSED** — all 10 reprobed 2026-09-07 (see Implementation § asset table).
6. Exact presented preview fps on any platform. **Still open** — no live preview run.
7. ~~Whether a byte cap exists anywhere outside preview decode~~ **CLOSED** — none outside preview; preview now has explicit byte caps in `previewBufferBudget.ts`.

---

## Implementation round (2026-09-07, branch `ws3-120fps-preview`)

Worktree: `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-ws3-120fps-preview` @ `910ea7e` (after implementation commits). Base `main` @ `4d4922c` untouched.

### Step 1 — Root cause verdict: **CONFIRMED**

Synthetic confirmation (no live app):

| Source fps | Frames dropped (first batch) | Frames admitted | Dropped timestamps re-delivered? |
|---|---:|---:|---|
| **120** | **91** | **90** | **No** — pre-fix only |
| **30** | **0** | **46** | N/A |

Mechanism: `feedWindow` issued **181** chunks (0–1.5 s @ 120 fps) while `MAX_BUFFERED_FRAMES_PER_SESSION=90` held **0.75 s**; with `windowTargetUs=0`, `slideWindowForward` could not evict (`keepFromUs < 0`), so the drop branch at `handleDecoderOutput` permanently discarded **91** frames while `feedCursor` advanced past them.

Post-fix: same 120 fps fixture admits **181** frames, **0** drops.

Live Mac preview on `1.mp4`: **NOT DETERMINED** (no interactive Tauri driver).

Dev instrumentation: `VideoDecoderPool.getDevDropStats()` / `resetDevDropStats()` (DEV builds only); drop branch logs `[videoDecoderPool] preview buffer drop` with session id, source fps, `windowTargetUs`, `feedCursor`, admitted/dropped counts.

### Step 2 — Failing regression (pre-fix)

`test(ws3): add 120fps incremental playback regression` @ `2d314f6` failed:

```
AssertionError: expected 0.21536300000000064 to be less than or equal to 0.200001
```

Stale frame ~215 ms behind playhead once incremental ticks passed the 0.75 s cap horizon. **Passes after fix.**

### Step 3 — Design B implemented

**Module:** `src/services/previewBufferBudget.ts` (single source of truth).

| Constant | Value |
|---|---|
| `WINDOW_AHEAD_SEC` | 1.5 |
| `RETAIN_BEHIND_SEC` | 0.5 |
| `PREVIEW_BUFFER_WINDOW_SEC` | 2.0 (= retain + ahead) |
| `PREVIEW_BUFFER_MAX_BYTES_PER_SESSION` | 805,306,368 (768 MiB) |
| `PREVIEW_BUFFER_MAX_BYTES_GLOBAL` | 1,610,612,736 (1536 MiB) |
| `MAX_CACHED_SESSIONS` | 3 |
| `I420_BYTES_PER_PIXEL` | 1.5 |

**Policy:** Remove fps-blind frame-count cap. Admit all frames within `[windowTarget − retain, windowTarget + feedAhead]` where `feedAhead = effectiveFeedAheadSec(resolution)` (byte-clamped). Under byte pressure, evict passed (`slideWindowForward`) then oldest before playhead; drop incoming only if outside admitted horizon or no evictable slot remains.

**Memory table (exact):**

| Resolution | fps | Frame bytes | Admitted sec | Frames | Admitted bytes | Byte-bound? |
|---|---:|---:|---:|---:|---:|---|
| 1080p | 30 | 3,110,400 | 2.0 | 60 | 186,624,000 | no |
| 1080p | 60 | 3,110,400 | 2.0 | 120 | 373,248,000 | no |
| 1080p | 120 | 3,110,400 | 2.0 | 240 | 746,496,000 | no |
| 4K | 30 | 12,441,600 | 0.533333 | 16 | 199,065,600 | **yes** |
| 4K | 120 | 12,441,600 | 0.533333 | 64 | 796,262,400 | **yes** |

When byte ceiling binds before the 2.0 s window fills (4K rows): `feedAheadSec` degrades below 1.5 s; feeder uses the clamped ahead so incoming frames are not issued beyond what the buffer can retain.

**Cross-session budget:** Global **1536 MiB** cap enforced in `enforceBudget()` (replaces `MAX_TOTAL_BUFFERED_FRAMES=150`). LRU session eviction when global bytes exceeded.

| Scenario | Old design (4×1080p120, 90 frames/session) | New design (4× full 2.0 s window) |
|---|---:|---:|
| Peak retained bytes | 1,121,587,200 (~1069 MiB) | 2,985,984,000 (~2848 MiB) theoretical; **capped at 1,610,612,736 bytes (1536 MiB)** → LRU evicts until ≤ global budget |

Operator assets are **1080p120 only** — per-session peak **746,496,000 bytes** (~712 MiB), four concurrent **2,985,984,000 bytes** before global LRU; acceptable with global backstop.

**VideoFrame lifetime audit (`videoDecoderPool.ts`):**

| Site | Line(s) | Path |
|---|---|---|
| Create (admit) | ~1210 | `handleDecoderOutput` push |
| Close — outside horizon / drop | 1191, 1198, 1205 | `handleDecoderOutput` |
| Close — slide evict | 1090 | `slideWindowForward` |
| Close — byte evict | 1137 | `evictOldestFrame` |
| Close — post-select trim | 894 | `getFrameAtInternal` filter |
| Close — scrub reset | 540–543 | `resetSessionWindow` |
| Close — session teardown | 947 | `closeSession` |
| Close — decoder handle | 975, 1039, 1048, 1059, 1302 | error / idle overflow / `dispose` |

Peak live `VideoFrame` count in 120 fps Step 1 test (first batch): **181** (mock `MockVideoFrame.instances` at `getFrameAt('seg', 0)` completion).

Display-paced preview refactor: **follow-up** (not this round).

### Step 4 — Test inventory

| Test file | New tests | Result |
|---|---|---|
| `videoDecoderPool.test.ts` Step 1 | 2 | pass |
| `videoDecoderPool.test.ts` Step 2 | 1 | pass (was red pre-fix) |
| `videoDecoderPool.test.ts` Step 4 | 6 (30/60/120 incremental, 119.88, deep seek, backward scrub) | pass |
| `previewBufferBudget.test.ts` | 3 | pass |

**VFR:** Pool accepts arbitrary chunk timestamps; no VFR-specific path. Operator assets are CFR (`r_frame_rate == avg_frame_rate == 120/1`). VFR would inherit time/byte caps without fps-derived sizing — **not separately tested** (no VFR fixture in repo).

### Step 5 — Export neutrality

`git diff --name-only main -- src/`:

- `src/services/previewBufferBudget.ts` (+ test)
- `src/services/videoDecoderPool.ts` (+ test)

**No export-path files.** Shared module `videoDecoderPool.ts` exports `findChunkRange` unchanged; export callers (`sequentialDecode.ts:35`) import only that pure function — pool buffer logic is preview-only via `useWebCodecsPreview.ts`.

Export suites: `npm test -- src/services/webcodecsExport/` → **168 passed / 0 failed**.

Frame-content digest gate (~40 s GL fixture, 2×): **NOT DETERMINED** — requires `npm run tauri:dev` + `src/dev/exportLivenessProbe/runPartC.ts` in a WKWebView session with binaries provisioned; not run this session.

### Step 6 — Operator asset reprobe (all 10)

Probed via bundled ffmpeg sidecar (`ffmpeg-x86_64-apple-darwin -hide_banner -i`) + system ffprobe for level, 2026-09-07.

| File | Codec / profile / level | fps | CFR/VFR | Resolution | Bitrate (format) | Duration | Container |
|---|---|---|---:|---|---:|---:|---|
| 1.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,580,064 b/s | 5.000 s | MP4 |
| 2.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,321,360 b/s | 5.000 s | MP4 |
| 3.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,410,024 b/s | 5.000 s | MP4 |
| 4.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,182,470 b/s | 5.000 s | MP4 |
| 5.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,115,466 b/s | 5.000 s | MP4 |
| 6.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 10,962,482 b/s | 5.000 s | MP4 |
| 7.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 10,964,830 b/s | 5.000 s | MP4 |
| 8.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,347,822 b/s | 5.000 s | MP4 |
| 9.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 12,050,413 b/s | 5.000 s | MP4 |
| 10.mp4 | H.264 High / L4.2 | 120 | CFR | 1920×1080 | 11,816,862 b/s | 5.000 s | MP4 |

**>60 fps:** all 10. **VFR:** none. **Fix coverage:** all 10 — 1080p120 within byte/time budget; no 4K in operator set.

Presented preview fps on Mac: **NOT DETERMINED** (no live preview instrumentation).

### Step 7 — Export fps policy (no 120 fps tier this round)

Export remains `exportFps ∈ {24, 30, 60}`; 120 fps sources auto-suggest **60** (`nearestExportFps`). Export decodes all source frames sequentially but samples the output timeline at the chosen export fps (implicit drop of intermediate 120 fps frames at 60 fps export).

**Judder:** 120→60 export drops every other source frame. For the operator's high-motion 120 fps CFR clips, motion is sampled at half the capture rate — **judder is plausible on fast pans** but is a separate, by-design export-tier limitation, not the preview freeze defect. Not user-visible enough in static/slideshow-style use to warrant emergency 120 fps export tier; recommend ear-check on exported output before adding a tier.

**Documented policy:** No 120 fps export tier until explicitly product-approved. Preview plays source rate; export caps at 60 fps.

**Backlog (for `docs/work-in-progress.md` on merge):** `[OPEN · NON-BLOCKING] WS3 — Evaluate 120 fps export tier vs 120→60 judder on operator high-fps assets; preview fix does not change export sampling.`

### Step 8 — WINDOWS-VERIFICATION

**Until this checklist passes on Windows, the Windows preview symptom remains UNVERIFIED even with the fix landed.**

1. **Build:** clone/checkout `ws3-120fps-preview`, `npm install`, provision ffmpeg sidecar per `src-tauri/binaries/README.md`, then:
   ```bash
   set CARGO_TARGET_DIR=%CD%\src-tauri\target
   npm run tauri:dev
   ```
2. **Asset:** copy `1.mp4` from operator Assets folder (H.264 High@4.2, 1920×1080, **120 fps** CFR, 5 s).
3. **Actions:** import → place on timeline → play 0–5 s → scrub forward/back across 0–2 s.
4. **Pass criteria:**
   - Preview plays (no permanent freeze)
   - DevTools console: **`framesDropped: 0`** on first playthrough (read `[videoDecoderPool] preview buffer drop` — should be **absent**)
   - `getDevDropStats()` if invoked from console: `framesDropped === 0` after first 2 s
   - Presented motion smooth within ~60 Hz display limit (judder OK; **freeze not OK**)
5. **If fail:** capture console logs (drop counters, any `VideoDecoder` configure/decode errors), note stall time(s), screen recording, WebView2 version; file against WS3 open bug.

### Gates (implementation round)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` (full) | **3171 passed / 77 skipped / 33 failed** — failures are **pre-existing `scripts/ws1-*` / `ws2-27-*` env tests**, unrelated to preview diff |
| `npm test -- src/` | **3082 passed / 1 skipped** (includes **12 new** WS3 tests; baseline src ≈3070 + 12) |
| `npm test -- src/services/webcodecsExport/` | **168 passed** |
| `git diff --name-only main -- src-tauri/` | **empty** |
| Cargo | **skipped** — empty `src-tauri/` diff |

**Commits:** `f36df8c` (instrumentation + confirmation), `2d314f6` (regression red), `3500f58` (fix), `910ea7e` (fps coverage), `c367513` (docs).

---

## References

- `docs/ws2-video-ingest/bug3-diagnosis.md` — prior mock reproduction @ 120 fps
- `docs/history-2.md` — 2026-08-26 Mac non-repro; 2026-09-07 WS2→WS3 move
- `docs/work-in-progress.md` WS3 § — active blocker entry
