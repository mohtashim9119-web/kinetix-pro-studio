# Wave 3 — operator rulings and unit designs (2026-09-27)

Recorded at Wave 3 U3. Extends plan-v3's Wave 3 section
([`sync-pipeline-plan-v3.md`](sync-pipeline-plan-v3.md)) without editing its signed body:
item 2 (one job, two cached stages) is where U3 and U4.5 land; items 3–5 still govern
everything below.

Unit order after this ruling: **U3 → U4 → U4.5 → U4.6 → U5 → … → U7 → bulk queue → … → U10.**

---

## U3 — server-side two-stage cache, client asks first (as built)

- **Transcript key:** `audioHash + TRANSCRIBE_ENGINE_REV + language`
  (`cloud/sync_core.py` `transcript_cache_key`). The revision folds the pinned model commit,
  faster-whisper/CTranslate2 versions and the decode parameters.
- **Alignment key:** `audioHash + chunk-plan hash + language + pack revision + ALIGN_ENGINE_REV`.
  **Pack revision** = the FA model repo commit AND a digest of that language's vocab + cardinal
  files (`pack_digests`, `pack_revision`). Those files steer the decoder and change in this
  repo without the model repo moving. Before U3 an edit to them would have served stale
  alignments. The gateway image carries the same files the worker decodes with.
- **Ask first:** `POST /v1/cache/lookup` takes the same body as a job submit and goes through
  the same key derivation (`resolve`). A hit returns the result. No job, no GPU, **no meter
  line.** Hits are counted in a separate `kinetix-sync-hits` dict for the billing report, and
  hold hashes only. A miss says `audioPresent`, so the client knows whether it has anything to
  send.
- **Client:** `runStageCacheFirst` (`src/services/cloudSyncEngine.ts`). Lookup, then encode +
  upload only on a miss for audio the gateway lacks, then submit. If retention purges the audio
  between lookup and submit, the typed `audio-missing` refusal triggers one re-upload +
  resubmit. U2's unconditional encode + upload at voiceover-add is removed.
- **Latency:** results are 200–500 KB of JSON, and on a high-RTT link TCP slow start sets a
  hit's time. The gateway gzips (≈5.5×) and Rust negotiates it (`reqwest` `gzip`: adds
  `async-compression`, `compression-codecs`, `compression-core`). One pooled HTTP client is
  shared across commands.
- **Honest trace:** a cache-served alignment says so in the Sync Log engine line ("served from
  the cloud cache — nothing uploaded, no GPU charge").

**Finding for U5 (cancel is zero-charge, plan item 5):** a job cancelled while still `queued`
meters 0 s, correctly. But Modal may already have started the GPU container, and that
container's boot and 2 s scaledown are billed. Zero-charge holds at the job level, not the
container level. U5 must decide whether that residue is acceptable or needs a pre-spawn hold.

---

## U4.5 — single-process cloud sync ("sync intent") — design requirements

Operator-designed, approved. Scope: **cloud path only**.

1. **One cloud job:** boot → transcribe → coverage check → align → return fully synced
   timings. **One cold start** for the whole flow.
2. **Coverage gate inside the job:** the G4 check's logic runs against the cloud transcript
   before any FA compute. It hard-blocks **only** on a real script/audio mismatch. On a match
   the job continues to alignment. No second click, no second boot.
3. **Pause-and-ask inside the job:** offline/auth/quota failures pause with the existing typed
   reasons. A mid-job pause keeps completed stages cached, and resume does not re-bill them:
   the transcript stays cached, and a retry charges only the alignment stage.
4. **Extends the U3 cache, doesn't replace it:** same keys, same rule that a cache hit is
   free, chained automatically.
5. **Queue-ready interface:** the post-U7 bulk queue submits N intents back-to-back through
   the same job shape.
6. **Local path unchanged:** local keeps its two-moment flow (transcription at staging is local
   UX). *Logged here as the U4.5 scope note.*

## U4.6 — flow UI (new unit) — slot and rulings

**Slot choice (logged):** after U4.5, adjacent to U5. U4.6's background pipeline is U4.5's
design extended, so it needs the intent job to exist. Its failure surfaces (pause dialogs
firing from a background job) are exactly what U5's failure handling hardens, so the two
units sit next to each other.

1. **Rename "Apply Sync" → "Build Timeline"** everywhere the button renders (copy, tests,
   source-scan pins; doc references touched get a rename note). Copy lives in a swappable COPY
   block. **Post-sync disabled label:** proposed "Timeline ready" (replacing "Already synced").
   *Pending operator sign-off. Does not ship until signed.*
2. **Gating (operator product ruling):** Build Timeline stays disabled until all 4 slots are
   filled (script, scene doc, voiceover, media), via individual slots or one bundle zip. The
   disabled state says what's missing ("Add a voiceover to build the timeline").
   *Design note:* the sync engine itself only needs the spine (script + scene + voiceover).
   Requiring media is the operator's product ruling for the ready-timeline promise, not an
   engine constraint. The `no-asset` attention kind (media removed after sync) stays; it is
   not retired.
3. **Background auto-pipeline (cloud; extends U4.5):**
   - Voiceover arrival → cloud transcription starts immediately in the background.
   - Spine complete → the sync intent fires automatically in the background. No click starts
     it. Media upload does not block it: media is local presentation, and assignment is local
     and instant.
   - Build Timeline click = **reveal**. If the background job is done, the ready timeline
     appears instantly. If it's still running, a loading overlay shows the honest current
     phase. It never waits on anything that isn't actually pending.
   - **One-session physics (stated honestly):** files arriving close together (a bundle zip
     guarantees it) chain transcription → FA in one cloud session with one boot. Uploads
     minutes apart hit a scaled-down transcription container (2 s window), so FA pays its own
     boot (~$0.01). The GPU is never held idle waiting for files: idle billing costs more than
     the second boot.
   - Script/scene edited after the background job ran → the spine changes and the intent
     re-runs. The cache stages absorb it: the transcript is cached by `audioHash`, so only
     alignment re-bills. Engine switch/cancel honesty rules are unchanged.
   - **Local path keeps click-to-run** (renamed, honest states), with no auto-start locally.
     *Logged as an operator-vetoable default.*
4. **Progress bar removal (both engines):** the purple 0–100% transcription bar no longer
   renders, and progress is silent in the background. **Failures still surface loudly** exactly
   as ruled: offline/auth/quota pause dialogs, model-failure dialogs, findings. The on-click
   overlay shows the phase: waiting for cloud GPU / transcribing / aligning / building.
5. **Bulk queue (post-U7):** identical flow. A project must fill all 4 slots before it enters
   the queue, and the queue submits the same intents back-to-back.
