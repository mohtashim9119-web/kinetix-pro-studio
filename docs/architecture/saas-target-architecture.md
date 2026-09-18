# SaaS target architecture

Recorded 2026-09-16, source SHA `e8ffb6b` (Round 28 closeout on `ws3-export-integration`; integration tip at merge was `c463814`, then `45d5860` on `main` @ `42988f1`). Header refreshed 2026-09-19 (P4 lane re-charter pass, `ws1-plan-rewrite` @ `53449b9`) — `e8ffb6b` stays as the recorded-at SHA for provenance; `53449b9` is the current branch tip as of this refresh. Per NR-6 (`docs/ws1-sync-pipeline/operator-product-rulings-2026-09-19.md`), SaaS/credits mechanics are out of scope for this pass — the document's content is otherwise unchanged. This is a
target-state design record, not a description of current behaviour — everything below is a
destination the codebase does not yet occupy, except where a section is explicitly marked as
describing the present.

## Purpose and market position

Kinetix Pro Studio is channel production infrastructure for faceless YouTube creators, sold as a
monthly subscription. It is not trying to out-generate the cloud AI-video tools that compete on
raw generation quality and speed — that race is against companies whose entire business is
training and serving generation models, and this product does not build models. Every generation
capability — voice, image, video clips, whatever comes next — is bought through third-party APIs
and wrapped in product templates and workflow. The competitive position is built on three things
those cloud tools are structurally weaker at: editing precision (frame-accurate timing, real
color grading, real compositing, not a generation model's best guess at pacing), brand
consistency across a channel's entire output (the same intro, the same caption style, the same
color treatment, upload after upload, enforced by the tool rather than re-specified by the
creator each time), and volume throughput (a creator running a channel needs tens of videos a
month, reliably, not one impressive demo). The product wins by being the thing a serious channel
operator uses every day to turn already-generated or already-shot material into a consistent,
polished, on-brand upload at volume — not by generating better raw material than a cloud
competitor.

## Current state, honestly

Today the product is a Tauri desktop application: a Rust core, a React and TypeScript interface,
and video rendering and export that both happen inside the WebView, via WebCodecs and a worker
thread. This has a real cost, and it is worth stating plainly rather than treating each symptom
as an isolated bug. The liveness, watchdog, stall, and encoder-restart failure classes documented
in `docs/ws3-export-pipeline/pipeline-audit-round28.md` are not a series of unrelated defects to
be picked off one at a time — they are the structural tax of doing serious video encoding work
inside a browser sandbox. A browser's video pipeline was built for playback and modest
in-browser editing, not for sustained multi-hour encode sessions with hardware encoder handoffs,
and the watchdog/restart machinery this codebase has built (`WATCHDOG_MS`,
`FORWARD_PROGRESS_BOUND_MS`, the Round 28 encoder-restart investigation) is the shape of code that
results from working around that mismatch rather than removing it.

The timeline has its own ceiling, independent of export. At 500 to 1000 segments the timeline
stutters and the playhead drops to roughly 5 to 10 frames per second. This is a real limit a
channel-scale user will hit — a creator batching a month's worth of long-form content is well
within range of a timeline that size — and it is a rendering-architecture problem, not a
performance-tuning problem, for reasons covered below.

Neither of these costs is a reason to conclude the desktop application was a mistake. It got the
product to a working, sellable editor with real invariants (gapless segment timing, undo/redo,
sync/alignment) proven out in an environment fast to iterate in. The target state below keeps
everything about that shape that works and replaces only the two subsystems that have hit a wall:
timeline rendering and the video path (preview playback and export).

## The division of responsibility in the target state

React and TypeScript keep the entire application interface — every panel, inspector, dialog,
menu, and settings surface. The WebView is retained, and it is not the problem for interface
work; nothing about panels, forms, and dialogs stresses a WebView the way sustained video
encoding does. What leaves the WebView is the video path specifically: preview playback and
final export both move into the Rust core.

It is worth stating explicitly that removing the WebView entirely — rewriting the interface in a
native UI toolkit — is rejected as a direction. React depends on the DOM, so a native-toolkit
rewrite would mean re-implementing the entire application interface from scratch: every panel,
every modal, every inspector, the whole settings surface, all of it. That is roughly a year of
work by itself, and at the end of it the two actual problems — timeline rendering at scale and
video pipeline reliability — are still unsolved, because a native toolkit doesn't hand you a
GPU-canvas timeline or a native encoder pipeline for free; you'd still have to build both of
those, just now also without React underneath you. The canvas timeline and the native preview
engine described below solve both real problems directly, at a fraction of the cost, while
leaving the interface exactly as productive as it is today.

## Timeline rendering

The current timeline renders one absolutely-positioned DOM element per visual layer of a
segment — the block itself, its label, its thumbnail, its lock indicator, its drag handles, and
so on — which comes to roughly eight DOM elements per segment. At 1000 segments that is around
8,000 live elements the browser has to lay out, paint, and composite every frame, which exceeds
the per-frame layout budget well before 1000 segments is reached — this is the direct cause of
the 5–10 fps ceiling described above. The second contributor is state placement: the playhead
position lives in React state, so every playback frame's position update re-renders the timeline
component tree, which at any significant segment count means re-rendering thousands of elements
sixty times a second just to move one line.

The target design replaces the whole DOM-element-per-segment approach with a single GPU canvas
that the application draws directly, with four supporting pieces. First, the playhead loop never
touches React state — its position is driven by a render loop that reads and draws directly,
so moving it costs one draw call, not a tree re-render. Second, a spatial index means only the
segments actually visible in the current viewport are processed on a given frame, so cost scales
with what's on screen, not with total segment count. Third, audio waveform peaks are precomputed
in Rust at import time into a mip-mapped pyramid (successive levels of detail, the same idea as
a texture mipmap) and cached to disk beside the asset, so the timeline never re-analyzes raw
audio at draw time regardless of zoom level. Fourth, the fully-zoomed-out view — which today would
otherwise still try to draw every one of thousands of segments into a few hundred pixels — instead
draws from a precomputed density summary built once when the timeline structure changes, not
recomputed every frame.

Target performance is a smooth 60 frames per second at 1000 segments, with graceful (not
necessarily 60fps, but not degraded to a stutter) behaviour out to 10,000.

## Playback engine

Preview playback moves to a Rust playback engine built on wgpu (a cross-platform GPU API
abstraction) for compositing, running out of process from the main application, and presented as
a native surface positioned over the preview region of the interface rather than drawn into the
WebView. Editing playback is driven by proxy media generated automatically on import — a
lower-resolution, fast-to-decode version of each source asset — so that scrubbing and playback
stay responsive regardless of source resolution; full resolution is reserved for the export pass,
where quality matters and speed constraints are different. Effect chains cache their output so
that a frame region unaffected by an edit is not recomputed on the next frame — only what actually
changed re-renders. Effects themselves (filters, color grading, transitions, animations) are
written once as shaders shared between the preview engine and the export engine, which means
preview stops being an approximation of what export will produce and becomes an accurate
representation of it — what the user sees while editing is what they get in the final file,
because it is the literal same code path.

## Export engine

Export moves fully into the Rust core as well, out of process, built on FFmpeg/libav with
hardware encode and decode used where available — NVENC (NVIDIA), AMF (AMD), Quick Sync (Intel)
— and a software encode/decode fallback where it isn't. All media input and output is streaming:
no file, source or output, is ever held in memory in full, which is what makes the following
capacity targets possible rather than aspirational. The target is 4K exported comfortably at
real-time speed or faster on hardware encode, 8K supported on hardware whose encoder actually
supports 8K, and multi-gigabyte inputs and outputs bounded only by available disk space rather
than by memory.

The hardware caveat is worth recording explicitly rather than glossing over: the RX 580 in the
current validation machine supports 4K hardware encode but not 8K, so validating the 8K target
requires access to newer hardware than what this project has validated on to date.

## Reliability model

The organising principle for reliability in the target architecture is blast radius, not defect
count — the goal is failure tolerance, not failure prevention, because failure prevention alone
is a losing game against driver resets, disk exhaustion, and the long tail of hardware
variability a desktop encoding product has to survive across customers' machines. Concretely:
renders are broken into independent blocks, snapped to keyframe and segment boundaries, so that
any single failure costs at most one block rather than the whole export. Each block is
checkpointed as it completes. The render and export engines run out of process from the main
application, so a GPU driver reset kills a subprocess that the application can detect and retry,
rather than taking the whole interface down with it. Every operation on the failure-recovery path
itself is bounded — no retry or cleanup step is allowed to hang indefinitely and become its own
failure mode. Liveness is judged by disk-observable progress (bytes actually written, files
actually advancing) rather than by whether an expected message arrived on some channel, because a
stalled worker can still be technically "connected" while producing nothing. And correctness here
is validated continuously, not just reasoned about once: fault injection in CI covers killed
workers, dropped GPU contexts, stalled writes, and filled volumes, exercised across long renders
so that the failure classes this project has already hit in production (see the WS3 pipeline
audits) are represented as tests, not just as postmortems.

This reliability model is a generalization of the tiered failure-tolerance ordering already
recorded for the current crash-tolerance work — see `docs/ws3-export-pipeline/architecture-ledger.md`
and `docs/ws3-export-pipeline/recovery-architecture.md` for that ordering as it exists today; the
target state extends the same ordering to native, out-of-process rendering rather than replacing
its logic.

## Cloud layer

The cloud layer is deliberately thin. Its job is licensing and entitlements (who is on what
plan, what that unlocks), asset proxying and caching (so large source media doesn't have to move
through the client for every operation that needs it), generation API orchestration (the actual
calls out to third-party generation providers, kept server-side so API keys and usage aren't
exposed to the client), project synchronization (so a project is available across a user's
machines), and optional cloud rendering offered as a convenience, not a requirement. It is built
as Rust services backed by Postgres and object storage.

The strategic constraint behind keeping this layer thin is explicit: the desktop application must
remain fully capable of rendering entirely locally, with no cloud dependency for the core edit
and export loop. Local render is this product's cost advantage over cloud-only competitors, whose
unit economics are dominated by the compute cost of every render — going cloud-only here would
throw that advantage away for the sake of architectural convenience.

## Product capabilities that define the category

Several capabilities are what actually define "channel production infrastructure" as a category,
distinct from a general-purpose video editor, and the target architecture is built to support all
of them. Batch production: a creator queues fifty videos, walks away, and comes back to fifty
finished exports. Channel brand kits: fonts, caption styles, motion presets, color treatment, and
intro/outro templates bundled together and applied consistently across every video a channel
uploads, so brand consistency is enforced by the tool rather than re-specified by hand each time.
A caption and motion engine with word-level timing and animated caption styles, built on the
sync/alignment work this project already has. Multi-format output — one timeline exported to
16:9, 9:16, and 1:1 with reframing, rather than three separately edited projects. Asset sourcing
integrations, so stock and generated material can be pulled in without leaving the product. And
team accounts with review and approval workflows, for the point at which a channel operation
grows past a single person.

## SaaS operational requirements

None of the following exist in the product today, and they — not further video engineering — are
what currently stands between this product and being able to charge a monthly subscription:
licensing and entitlement enforcement, subscription billing and usage metering, crash reporting,
product telemetry, automatic update with staged rollout, and a security and compliance path that
includes single sign-on for team accounts. The video pipeline work described above is necessary
for the product to be good; this operational layer is necessary for the product to be a business.

## Migration phases

Four phases, each roughly a quarter, with generation continuing to be bought through third-party
APIs throughout — none of these phases involve building generation capability in-house.

Phase one is the native render core: moving preview and export into the Rust core, out of
process, with block checkpointing and fault injection built in from the start rather than
retrofitted. Phase two is the batch production queue and the brand kit system. Phase three is the
caption, motion, and multi-format engine, plus the asset sourcing integrations. Phase four is the
commercial and operational layer — billing, entitlements, telemetry, update, and the compliance
path.

## What carries forward from existing work

The recovery and storage work already built in the current codebase is not thrown away by this
migration — it survives it, largely as-is, because the reliability model above is a
generalization of the same ideas rather than a replacement for them. Specifically: the storage
root model, and the audited delete helper with its path guards, both in `src-tauri/src/storage_root.rs`;
the checkpoint and resume design recorded in `docs/archive/ws3/durable-state.md` and implemented
in `src-tauri/src/ffmpeg.rs`; the timeline hash invalidation model used by the sync/undo layer
(`src/services/history.ts` and its siblings); the failure classification taxonomy and the Ruling A
primary-action ladder (`src/services/exportFailure/resumeEligibility.ts`, cited from `docs/STATUS.md`'s
D2 entry); the disk preflight estimator with its frozen constants (`src/services/webcodecsExport/diskFull.ts`);
and the diagnostic log (`src-tauri/src/ffmpeg.rs`'s `export_log_event`, `src/services/exportDiagnosticLog.ts`).
All of this is infrastructure for surviving failure and tracking state durably, and none of it is
specific to running inside a WebView — it carries forward into the native render core unchanged
in design, even where the calling code around it is rewritten.

## Non-goals

No in-house generation models — generation stays bought through third-party APIs, permanently,
not just during the migration. No native-toolkit interface rewrite — the reasoning is in the
division-of-responsibility section above. No cloud-only architecture — local render stays the
cost advantage. No CapCut project interchange. If project interchange is built at all, it is FCP7
XML with consolidated media and a fidelity report, not a CapCut-specific format.

## Open questions

At minimum, three questions are open and unresolved as of this record. First, whether the encoder
restarts observed on the RX 580 (twenty encoder sessions, eighteen restarts, in one export) are a
designed rotation behaviour or actual driver resets is currently undetermined — answering it
requires the diagnostic fields already named in `docs/ws3-export-pipeline/pipeline-audit-round28.md`'s
Round 28 audit, which were identified but not yet added. Second, the choice between wgpu and
direct platform graphics APIs (Metal, Direct3D, Vulkan directly rather than through wgpu's
abstraction) for the native compositor is open — wgpu gives cross-platform reach at some
abstraction cost, direct APIs give more control at the cost of three separate backends to
maintain. Third, the proxy media format and resolution ladder used to drive editing playback is
not yet decided.
