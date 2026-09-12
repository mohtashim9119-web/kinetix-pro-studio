# Windows encode-throughput collapse audit

Scope: installer built from `ws3-export-integration` at `9297de2`. This is an
observational audit and a wiring specification. It does not change pipeline
behavior.

## Field evidence

- Machine 1 — RX 580 8 GB, 12th-generation i3, 32 GB DDR4: about 96 fps
  sustained (roughly 25 frames per 260 ms phase-pulse interval); 50,911 frames
  encoded to completion.
- Machine 3 — same class: fast and completed.
- Machine 2 — RTX 3050 8 GB, 12th-generation i3, 32 GB DDR4: about 10% in
  6–7 minutes on a comparable job, extrapolating to 60–70 minutes; effective
  throughput about 12.8 fps; cancelled.
- Machine 1's append reference: 3,101 IPC calls for 50,911 encoded chunks,
  `msSinceLastAppendCompleted = 0.7 ms`, and `maxSilentMs = 655.8 ms`.

The observed ratio is about 7.5x. The GPU names alone do not establish the
active WebView2 rendering or encoding backends.

## 1. Codec-selection path

The worker owns selection in `createEncoder` (`exportWorker.ts`). The codec
loop is outermost and the `hardwareAcceleration` loop is inside it. On the
first unpinned session the exact attempt order is:

1. `avc1.640028` (H.264 High Profile, level 4.0) /
   `prefer-hardware`
2. `avc1.640028` / `no-preference`
3. `avc1.640028` / `prefer-software`
4. `avc1.42001f` (H.264 Baseline Profile, level 3.1) /
   `prefer-hardware`
5. `avc1.42001f` / `no-preference`
6. `avc1.42001f` / `prefer-software`

After the first success, the selected codec string is pinned for later
sessions (and across a rewind's fresh worker), but the three-value
`hardwareAcceleration` ladder is walked again. A force-software recovery uses
only `prefer-software`, against the pinned codec where one exists.

Every attempt constructs this `VideoEncoderConfig`:

- `codec`: the current string above
- `width`, `height`, and `framerate`: requested export values
- `bitrate: 8_000_000`
- `latencyMode: "quality"`
- `avc: { format: "annexb" }`
- `hardwareAcceleration`: the current ladder value exactly as listed above

The code does consult `VideoEncoder.isConfigSupported(config)` before
construction. A throw or `supported !== true` descends to the next
combination. If support reports true, the code constructs a `VideoEncoder` and
calls `configure(config)`; a synchronous configure failure also descends.
Success records only the requested preference (`selectedHardwareRung`) and
codec, not a realized implementation.

`hardwareAcceleration: "prefer-hardware"` is a preference, not a guarantee.
WebCodecs does not expose which implementation Chromium ultimately selected;
the missing realized-backend signal is tracked in
[w3c/webcodecs#896](https://github.com/w3c/webcodecs/issues/896). There is no
post-configure backend check in this code, and no standard check it could make.
Therefore the current code cannot distinguish hardware from software encoding
after a successful prefer-hardware configure. **Yes: Machine 2 could be
running a software encoder while reporting selection success.**

This is separate from canvas rasterization. A hardware encoder can consume
frames produced through SwiftShader, and a software encoder can consume frames
from a hardware-composited canvas.

## 2. Can current telemetry separate the three costs?

**Verdict: no. The present telemetry can localize a stall coarsely, but it
cannot attribute a sustained 7.5x throughput deficit among canvas
draw/rasterization, asynchronous `VideoEncoder` work, and IPC plus disk
append.**

What exists:

- `image-bitmap` measures one-time image decode/bitmap creation, not per-frame
  canvas rasterization.
- During ordinary work the phase log says `frame-loop`; its approximately
  250 ms pulses carry frame progress but do not name the operation consuming
  each interval.
- Terminal `phaseMs` has useful aggregate sub-timers: `composite`,
  `encode-submit`, and `wait-dequeue` (plus decode/cursor buckets).
  `composite` times JavaScript-side texture upload/render/text calls, but GL
  work may complete later. `encode-submit` combines `new VideoFrame(canvas)`
  (where canvas realization/readback may occur), optional diagnostic hashing,
  and the synchronous `encoder.encode()` call. It does not time the encoder's
  asynchronous work.
- `wait-dequeue` is not an encoder-only counter: it combines adaptive sleep,
  encoder queue waits, and the append-backpressure gate. A large value cannot
  identify which downstream resource caused it.
- `encoder-rotate` and `encoder-flush` identify bounded flush windows.
  Flush chunk/byte deltas can distinguish a non-producing flush from chunks
  blocked behind an outstanding append, but this covers rotation/finalization,
  not steady-state throughput.
- The append ledger reports chunk and IPC counts, bytes, current queue depths,
  time since the last completed append, flush append counts, and terminal
  state. `appendDrainMs` measures only the final drain. It has no cumulative
  or distributional IPC/write duration for the frame-loop interval.
- `maxSilentMs` measures gaps between output events. It is a liveness metric,
  not a cost allocation. Machine 1's low append age and sub-second maximum
  silence establish a healthy reference, but do not provide the corresponding
  Machine 2 breakdown.

Minimum counters required (run totals plus sample count and maximum are
enough for a first field pass; p95 can be derived only if bounded histograms
are retained):

1. **Canvas/render:** keep `compositeMs`, but split and time
   `textureUploadAndDrawMs` and `videoFrameFromCanvasMs`. The latter must wrap
   only `new VideoFrame(canvas, ...)`, so deferred canvas realization is not
   charged to the encoder call.
2. **Encoder:** time synchronous `encodeCallMs` separately; report
   `encodeQueueSize` high-water and a bounded queue-size histogram; split
   `encoderThrottleSleepMs` and `encoderDequeueWaitMs`. For direct async
   latency, correlate submitted frame timestamps with output chunk timestamps
   and retain a bounded submit-to-output latency histogram.
3. **IPC/disk:** split `appendBackpressureWaitMs` from encoder dequeue waits;
   report append IPC count/bytes plus cumulative and maximum
   `appendFileRawMs`; separately report cumulative and maximum
   `sessionFileSizeMs`; retain append queue byte/chunk high-water marks.

These counters partition the ambiguous buckets without changing pacing,
recovery decisions, constants, or encoded bytes. Until they are collected on
Machine 2, “SwiftShader canvas” is a strong hypothesis, not a telemetry-proven
diagnosis.

## 3. Capability-probe contract

`gpuCapabilityProbe.ts` is deliberately independent of the pipeline. It
exports:

- the exact top-rung 1080p30 config (`avc1.640028`, 1920x1080, 30 fps,
  8 Mbit/s, quality latency, Annex B, `prefer-hardware`);
- `inspectWebGL2`, a pure function over an injected context factory;
- `isSoftwareRasterizer`, matching `SwiftShader`, `Google Inc. software
  renderer`, or `Software only` without misclassifying an ordinary ANGLE
  hardware identity whose vendor begins with `Google Inc.`; and
- `probeGpuCapabilities`, which combines the WebGL report with an injected
  `VideoEncoder.isConfigSupported` call.

The report contains `webgl2Available`, `unmaskedRendererWebGL`,
`unmaskedVendorWebGL`, `softwareRasterizationDetected`, the config probed, and
`top1080p30EncoderSupport` (`supported` plus an error string when the API
throws). `getContext("webgl2") === null` is represented as unavailable with
null renderer/vendor fields. An unavailable debug-renderer extension leaves
only those identity fields null. Neither case is guessed to be software.

This probe identifies the WebGL rasterizer and advertised encoder-config
support. It does **not** identify the realized WebCodecs encoder backend;
WebCodecs has no such standard signal.

## 4. WebView2 research: verified facts and bounded inferences

### GPU fallback and software rendering

Verified:

- Microsoft says WebView2 uses GPU rendering by default, that GPU use is
  critical for performance, and that `--disable-gpu` should be used only for
  troubleshooting
  ([WebView2 performance guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance#enable-hardware-acceleration)).
- WebView2 exposes Chromium flags including `disable-gpu`,
  `disable-gpu-driver-bug-workarounds`, and `ignore-gpu-blocklist`
  ([WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)).
  Chromium documents `--ignore-gpu-blocklist` as an override when
  `about:gpu` says the GPU is unsupported
  ([Chromium GPU debugging](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/debugging_gpu_related_code.md#checking-about:gpu)).
- The WebView2 team has confirmed field cases in which problematic drivers or
  the hardware blocklist automatically select software rendering. It also
  warns that bypassing the blocklist/driver workarounds is unsuitable as a
  general production fix because those rules avoid real rendering defects
  ([WebView2Feedback #1469](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1469),
  [WebView2Feedback #1864](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1864)).
- Remote/headless context matters. Microsoft documents Azure Virtual Desktop
  remote sessions as CPU-rendered by default until the relevant GPU policies
  are enabled
  ([AVD GPU acceleration](https://learn.microsoft.com/en-us/azure/virtual-desktop/graphics-enable-gpu-acceleration)).
  The SwiftShader policy documentation names headless environments and VMs as
  examples where hardware acceleration can be unavailable
  ([EnableUnsafeSwiftShader](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/enableunsafeswiftshader)).
- WebView2 is multi-process: a process group has a browser process, renderer
  process(es), and helpers including a separate GPU process
  ([WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)).

Inference:

- Thus a driver rule, an explicit GPU-disabling flag, or a remote/virtual
  session without GPU enablement can yield a functioning WebView2 whose
  rendering is software-backed. Hybrid graphics adds an adapter-selection
  problem, but Microsoft does not document a simple “hybrid means disable
  compositing” rule; that must be verified from the affected process's GPU
  report. The 7.5x Machine 2 result is consistent with this path, not proof of
  it.

### `EnableUnsafeSwiftShader`

The Microsoft policy is supported in Edge on Windows 139+ and permits
SwiftShader when hardware acceleration is unavailable. The current
documentation says that starting in Edge 144 SwiftShader fallback is
deprecated for security reasons, the policy temporarily defers that behavior,
and the policy will be removed
([policy documentation](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/enableunsafeswiftshader)).
If actually effective in a Chromium process, allowing SwiftShader can produce
exactly the “WebGL context succeeds but CPU rasterization is very slow”
profile.

However, this particular registry policy is documented as a **Microsoft Edge
browser policy**, not a WebView2 policy. Microsoft explicitly states that Edge
browser policies do not apply to WebView2 applications
([WebView2 enterprise policy separation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/enterprise#browser-policies-vs-webview2-policies)).
Therefore its mere presence cannot be blamed for this Tauri app. An equivalent
WebView2 command-line configuration, or Chromium/WebView2's own fallback
decision on an older runtime, remains possible and must be read from the
WebView2 process report.

A blocklisted driver is the more directly verified explanation: Microsoft has
confirmed that WebView2 can automatically use software rendering for drivers
with hardware-rendering issues
([WebView2Feedback #1469](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1469)).

### Passing WebView2 browser arguments from this Tauri app

For the versions locked at this source (`tauri 2.11.2`, `wry 0.55.1`), the
supported Tauri mechanisms are:

- declarative `app.windows[].additionalBrowserArgs` in `tauri.conf.json`
  ([Tauri v2 config schema](https://schema.tauri.app/config/2)); or
- Rust `tauri::WebviewWindowBuilder::additional_browser_args(&str)`
  ([Tauri 2.11.2 API](https://docs.rs/tauri/2.11.2/tauri/webview/struct.WebviewWindowBuilder.html#method.additional_browser_args)).

The Wry-level Windows extension is
`wry::WebViewBuilderExtWindows::with_additional_browser_args`
([Wry API](https://docs.rs/wry/latest/x86_64-pc-windows-msvc/wry/trait.WebViewBuilderExtWindows.html#tymethod.with_additional_browser_args)).
At the WebView2 layer, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is the supported
environment-variable override and must be inherited before environment
creation
([WebView2 debugging setup](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code#using-an-environment-variable),
[environment-option behavior](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions?view=webview2-1.0.4129.50#get_additionalbrowserarguments)).

Version/operational qualifications:

- `additionalBrowserArgs` is Windows-only in Tauri.
- Setting it replaces Wry's default
  `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`; preserve
  that switch if those defaults are still required.
- WebViews with different argument sets must use different writable
  `dataDirectory` values; same-directory environments must be configured
  identically. The Tauri v2 schema documents this constraint.
- `--force_high_performance_gpu` is only a candidate on Chromium/WebView2
  145+, based on the WebView2 team's issue resolution, not a stable
  WebView2-specific API
  ([WebView2Feedback #5072](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5072)).
  Gate any experiment on the actual runtime version.

### NVIDIA Optimus / preferred graphics processor

Verified: since Windows 10 20H1, Windows Graphics Settings takes precedence
over NVIDIA Control Panel's per-application preferred-processor setting
([NVIDIA documentation](https://www.nvidia.com/content/Control-Panel-Help/vLatest/en-us/mergedProjects/nv3d/Setting_the_Preferred_Graphics_Processor.htm)).
Verified: WebView2 rendering uses a separate GPU child process, not only the
Tauri host process (process-model link above).

The WebView2 team's open/closed design discussion reports that host-executable
settings and `NvOptimusEnablement` do not reliably affect the separate
WebView2 GPU process; this is why `--force_high_performance_gpu` was pursued
([WebView2Feedback #5072](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5072)).
Consequently “set the NVIDIA preferred processor for Kinetix” is a useful
experiment but not proof that the WebView2 child selected the RTX 3050. Verify
the child process's active adapter. Treat behavior on runtimes before 145 as
implementation-dependent, not as a guaranteed inheritance rule.

## 5. Ranked differential diagnosis

| Rank | Hypothesis and consistency | Predicted signature with the Step 2 counters | Cheapest discriminating test |
|---:|---|---|---|
| 1 | **GPU compositing/rasterization disabled, canvas on SwiftShader.** Best fit for a nominally stronger GPU losing about 7.5x while still functioning. | Software renderer marker; high `textureUploadAndDrawMs` and/or `videoFrameFromCanvasMs`; low encoder queue pressure; append timings and queue high-water remain healthy. | In the affected **WebView2**, navigate host-side to `edge://gpu` (not from page JavaScript, and not merely standalone Edge). Under **Graphics Feature Status**, read `Canvas`, `Compositing`, `Rasterization`, `WebGL`, `WebGL2`, and `Video Encode`; under **Driver Information**, read `GL_VENDOR`, `GL_RENDERER`, and active GPU; under **Problems Detected**, read each disabled-feature reason. `Software only`, `Hardware acceleration disabled`, or `SwiftShader` on the canvas/raster/WebGL lines confirms this hypothesis. Microsoft confirms host-side navigation works in [WebView2Feedback #1919](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1919). |
| 2 | **NVENC unavailable; Chromium uses software H.264.** Fully possible despite successful `prefer-hardware`; less explanatory if canvas counters dominate. | Hardware WebGL identity and normal canvas counters; sustained encoder queue high-water, high submit-to-output latency and `encoderDequeueWaitMs`; append path remains fast. | Run a 30-second sample while Windows Task Manager shows per-engine GPU graphs. Near-zero `Video Encode` engine utilization with a saturated CPU, plus `edge://gpu` → `Video Encode: Software only`, supports this path. The support probe alone does not prove it. |
| 3 | **Canvas and encoder use different adapters, causing per-frame cross-adapter copies.** Plausible on Optimus, but no current evidence names either realized encoder or copy path. | Hardware renderer names one adapter; both render and encoder latency are elevated, with neither append latency nor a pure software marker; GPU engines show render/3D on one adapter and video encode on the other. | In Task Manager, enable `GPU`, `GPU engine`, and per-GPU `3D`/`Video Encode` graphs during a short export; compare those adapters with the probe's unmasked renderer. |
| 4 | **Defender real-time scanning makes session writes dominant.** CC measured an approximately 8x per-write multiplier (W7a), strikingly close in magnitude, but Machine 2 lacks the append-duration counters needed to connect it. | High cumulative/max `appendFileRawMs` and/or `sessionFileSizeMs`, high append queue-water marks and `appendBackpressureWaitMs`; canvas and encoder latency otherwise normal. | One controlled A/B export with a temporary Defender exclusion limited to the export-session directory, then remove it. A throughput and append-latency step-change discriminates this cleanly. |
| 5 | **Thermal or power-profile throttling.** Possible, but the machine-class asymmetry and exact software-path alternatives are stronger. | Throughput decays with time; CPU/GPU clocks, power, or temperature throttle together; no stable single-bucket multiplier and no software renderer marker. | Repeat the same short export from a cold start on AC power in Windows Best Performance mode while logging clocks/temperature with the OEM or GPU tool. |

The standalone Edge `edge://gpu` page is only corroborative because it can
have a different process configuration. Hypothesis 1's confirming artifact is
the report from the affected WebView2 environment.

## 6. Minimal wiring specification for CC

### Call site and lifetime

In `exportProjectWebCodecs`, after validation/routing and construction of the
run diagnostics object, but before font loading and before entering the piece
loop, call `probeGpuCapabilities` exactly once. This is before the first
`driveGlRun` worker and therefore before the first `VideoEncoder` session.
Do not call per piece, per recovery, or per encoder rotation.

Production dependencies:

```ts
const gpuCapability = await probeGpuCapabilities({
  createWebGL2Context: () => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2');
  },
  isVideoEncoderConfigSupported: (config) =>
    VideoEncoder.isConfigSupported(config),
});
```

The main WebView and worker normally share WebView2's GPU process, but the
probe still describes the context it actually opened; retain this limitation
in field interpretation.

### Diagnostic routing

Use one nested field named `gpuCapability`, with this exact content:

- `webgl2Available`
- `unmaskedRendererWebGL`
- `unmaskedVendorWebGL`
- `softwareRasterizationDetected`
- `top1080p30EncoderConfig`
- `top1080p30EncoderSupport: { supported, error }`

Minimal route:

1. Add `gpuCapability: GpuCapabilityReport | null` beside `routing` /
   `glPieces` on `WebCodecsRunDiagnostics` and initialize it from the one
   probe.
2. Add the same optional field beside `encoderSessions` and `appendLedger` on
   `ExportLivenessSnapshot`.
3. Stamp the same immutable report into every `snapshotLiveness`,
   reconstructed failure, salvage mismatch, and post-encode liveness object;
   never recompute it.
4. Add top-level `gpuCapability: err.liveness?.gpuCapability ?? null` beside
   `appendLedger` in `buildExportDiagnosticsBlob`. Keep it inside `liveness`
   too, so the completeness invariant remains intact.
5. Extend the existing diagnostics completeness test so a sentinel probe
   survives both locations.

If the capability call itself unexpectedly rejects, catch at this boundary,
record an unavailable/null support report, and continue; diagnostics must not
become a new export gate.

### User warning

When `softwareRasterizationDetected === true` and the planned export is long,
surface this before encoding starts:

> Software graphics detected. This export is using a software rasterizer,
> which can make long exports several times slower. Update or select a
> hardware GPU, or run locally instead of through Remote Desktop, then restart
> Kinetix Pro Studio. Continue anyway?

“Long” should reuse an existing product threshold if one exists. Introducing
a new duration constant is a policy decision for CC; do not hide one in the
probe. Offer **Cancel** and **Continue anyway**. The warning must not claim
that NVENC is software, because this probe cannot know that.

### Remediation ladder (least invasive first)

1. Cancel, restart Kinetix locally (not RDP/headless), connect AC power, and
   retry a short sample.
2. Update the Evergreen WebView2 Runtime plus both Intel and NVIDIA/OEM display
   drivers, reboot, and recheck the affected WebView2's `edge://gpu` report.
3. Use Windows Settings → System → Display → Graphics to request **High
   performance** for Kinetix, restart, and verify the WebView2 child adapter;
   do not assume the host preference propagated.
4. If append counters implicate writes, run the narrow Defender exclusion A/B
   above; retain an exclusion only after security/product review.
5. On WebView2 145+, trial `--force_high_performance_gpu` through Tauri's
   supported browser-argument mechanism and verify the realized adapter.
6. Use `--ignore-gpu-blocklist` only as a temporary diagnostic. Never ship it
   broadly; repair/update the driver or machine configuration instead.

Enabling unsafe SwiftShader is not a performance remediation—it deliberately
permits software WebGL and lowers security guarantees.

### Review boundary

The probe and its diagnostics are observational. Any change to encoder
recovery order, failover eligibility, backpressure/recovery constants, session
or piece boundaries, frame timestamps, codec config, browser flags shipped by
default, or encoded bytes requires CC review. In particular, do not feed
`softwareRasterizationDetected` into the hardware-codec recovery ladder: the
canvas rasterizer and encoder backend are separate facts.
