# Bug Report: Preview Video Playback — Cold-Start Clock Freeze

**Status:** Unresolved. Reverted to clean base `213c3e1` (Phase 1 committed).
**Component:** `src/components/PreviewStage.tsx`
**Environment:** Tauri webview (Chromium-based)

---

## 1. Symptom

During timeline playback, video segments frequently fail to start. At a segment boundary the preview shows a frozen first frame (or black), the video element reports it is playing, yet its `currentTime` never advances. Playback either stalls, shows the wrong clip lingering, or briefly freezes before finally moving. Short (~1.3s) clips are hit hardest because their whole duration can elapse before they ever start.

## 2. Confirmed Root Cause

A `<video>` element that has been prepared but has **never yet advanced through real playback** will not start its media clock when `.play()` is later called — even though it reports `paused=false`, `seeking=false`, and `readyState=4`. The clock stays pinned at the seek target indefinitely (until a ~1.5s recovery kicks in).

The decisive proof came from the final experiment: warm slots that went through a full `el.load()` and reached `readyState=4` were **still pinned at 0.000** on reveal. High readyState is not the cure. The only elements that played cleanly (`via=raf` in 30–90ms) were those that had **already run through a prior playback cycle** — e.g. slots recovered after an ended-reset that had just finished playing.

**Restated in plain terms:** it isn't loading or decoding that un-sticks the clock — it's having played before. Any freshly prepared, paused-at-seek element is in a "cold" state the webview refuses to start.

## 3. What We Confirmed Along the Way (facts, not theories)

The clock genuinely doesn't advance — this is not a detection artifact. The rAF poll fired 13–74 times per stall while `currentTime` stayed exactly at 0.000, and the app's own `PAUSE ct=3.37` logs prove the video *did* advance once it was active, so the element and codec are healthy.

It is not decoder starvation. `readyState=4`, `networkState=1` (idle), fully buffered throughout every freeze; failures did not degrade progressively across slots (uniform, not contention-shaped).

It is not caused by per-frame `currentTime` writes or `.pause()` interference. Static analysis ruled these out; video is free-play, driven by the audio clock, never seeked per frame.

It is not the first-frame cover layer (System 1). The cover is a static image on top and does not pin the clock; removing it would only unmask the frozen video, not fix it.

## 4. Fixes Attempted

**Boundary-rounding gap (Bug 2 original hypothesis)** — Rejected. Timing gaps were IEEE-754 noise (~10⁻¹² ms), not functional. *(This did lead to a genuine, separate fix — the locked-overlap early-cutoff bug — which was committed successfully and is unrelated to this freeze.)*

**Honest warm-marker + gated reveal (v2)** — Marked slots warm only at `readyState≥2`, gated reveal on live readyState. Did not fix the freeze. Discarded.

**Play-state seek split (v3)** — Precise seek when paused, accept-first when playing. Fixed a separate 1s seek-lag regression but not the freeze. Discarded.

**`ensureSlotReady` + hold mechanism** — Held outgoing slot until incoming ready. Masked the problem behind a delay; revealed the preload was too late for short clips. Discarded.

**Ended-reset guard** — *Partially successful and genuinely correct for its case.* Detected `el.ended`/at-duration slots and reloaded them before replay. This works because those slots had already played. It correctly fixed the "won't restart after reaching the end" variant, but does not address cold first-start.

**Three-detector motion sensing (rVFC + timeupdate + rAF poll)** — Correctly diagnosed and fixed a real defect (rVFC suppressed on `opacity-0` elements). Proven working — resolves in <100ms *when the clock actually runs*. Kept conceptually valid but revealed the clock itself wasn't starting.

**Clock-kick watchdog** — After `.play()`, if not advancing within ~2 frames, re-`play()`; if still pinned, full `load()`→ready→seek→play reset. **Result:** the cheap re-`play()` almost never recovered; nearly every cold slot fell through to the ~1500ms reload. It *worked* (no black frames, cover held) but paid a 1.5s hitch at each boundary. Reset only worked because the reloaded element then... still often didn't play unless it had prior playback. Discarded.

**Load-based warm (final experiment)** — Moved the `load()` into the warm phase so reveals would be instant. **This is the experiment that disproved our model:** freshly loaded `readyState=4` slots were *still* pinned. Confirmed load/readyState is not the cure. Reverted in full.

## 5. Where We Stand

Clean base restored at `213c3e1` (first-frame cache + cover layer). Working tree clean, `tsc` clean, `vitest` 60/60. All Phase 2 experimental work (5-slot pool, detectors, ended-reset, clock-kick, load-based warm) discarded — it lived only as a staged diff and was never committed. The one durable win from this whole effort, the locked-overlap early-cutoff fix, was committed earlier and is safe.

We now have an accurate model of the bug for the first time: **the webview will not start the clock on a cold (never-played) paused element.** Every prior fix failed because it targeted loading, decoding, detection, or recovery — none of which address "has it played before."

## 6. Recommended Next Move

The model change points to a fundamentally different strategy. Rather than trying to make a cold element start on demand, we should ensure elements are never cold at reveal — by pre-playing them.

Two candidate directions, to decide before writing any code:

**Direction A — Silent pre-roll during warm.** When warming a slot, actually `play()` it muted for a few frames (letting the clock genuinely start), then `pause()` and seek back to the entry point. The element is now "warm" in the real sense — it has played — so the reveal `play()` should start instantly. Risk: whether a played-then-paused-then-seeked element stays warm, or re-enters the cold state on the seek. This needs a targeted diagnostic before committing to it.

**Direction B — Reveal-first, hide-after-motion.** Accept that cold start needs real play, and never show the element until it has actually moved. Keep the first-frame cover up, `play()` the incoming element while still covered, and only swap cover→live once motion is confirmed (the three-detector logic, which we know works). This keeps the cover doing the heavy lifting and never shows a frozen frame — the freeze becomes invisible rather than fixed. Simpler, lower-risk, but the underlying start latency remains (just hidden).

Recommendation: **run one small diagnostic first** to answer the single open question — *does an element that has played, then been paused and seeked back, start instantly on the next `play()`?* If yes, Direction A is the clean fix. If no, Direction B is the pragmatic one. That one test decides the architecture, and it's cheap to run.

**Caveat:** several confident root-cause calls in this investigation were overturned by the next log. This model is the best-supported yet and directly explains every observation, but the pre-roll diagnostic should be treated as a hypothesis test, not a foregone conclusion.
