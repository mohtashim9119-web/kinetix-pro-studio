# Wave 3 — operator rulings and unit designs (2026-09-27)

Recorded at Wave 3 U3; U4, U4.5 and U4.6 appended. Extends plan-v3's Wave 3 section
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

## U4 — retry once, then pause and offer local (as built)

Plan-v3 Wave 3 item 4 plus the G3 offline contract (`docs/architecture/cloud-asr-plan.md`,
"Offline contract").

- **Retry once, transient failures only** (`runStageCacheFirst`, `isRetryableCloudError`):
  unreachable, timeout, gateway 5xx, a lost/crashed worker. After a 3 s cancellable wait the
  whole cache-first stage runs again from its lookup, so anything that finished meanwhile is a
  free hit. **Not retried:** auth, too-long, refusals, `worker-error` and the job-time cap. A
  retry can't change those and would re-bill. *Operator-vetoable default:* `worker-error` is
  treated as deterministic.
- **No double billing on retry:** the gateway re-attaches a resubmit to the member's job still
  in flight for that cache key (`inflight_key` / `reusable_inflight`). A retry after a lost
  poll never spawns a second GPU run.
- **Pause-and-ask:** a cloud failure past its retry maps to one typed reason
  (`cloudPauseReason`): `offline`, `cloud-auth` (new, split out of `inference-failed`), or
  `inference-failed`.
  - *Apply Sync* (alignment, or the engine-switch re-transcription): the restart-safe
    `SyncPausedDialog` records `host` + `audioHash` and adds **"Run this sync on this
    computer"**. The re-transcription pause omits "continue with Whisper", because no
    transcript for that engine exists yet.
  - *Staging transcription:* the new `CloudTranscriptionPausedDialog` offers try the cloud
    again, transcribe on this computer, or cancel. It replaces the inline error strip for
    these failures.
- **Per-run local override** (`hostForRun`, `RunHostOverride`): one project plus one voiceover
  hash, carried from staging through Apply Sync, cleared when that Apply Sync commits. It lives
  in memory only and never writes the standing Cloud/Local choice. The Sync Log records it,
  and the spine stamps the local engine key, so a later cloud run reads as a real change.
- **Quota:** the gateway has no quota today (the $25 Wave 3 cap is monitored by the operator,
  not enforced). A quota pause needs a server-side quota first. Not built.

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

### U4.5 — as built

- **One boot = a held transcription + an atomic hand-off.** A cloud staging transcription is
  submitted with `hold: true`. After its transcript is written, the worker keeps the container
  for at most `HOLD_FOR_PLAN_SEC` (30 s), polling for a hand-off. The alignment names it
  (`holdJobId`), and the gateway hands it over with one put-if-absent on `handoff:<jobId>`.
  The worker closing the hold and the gateway handing it a job can't both win, so a plan is
  never lost: a closed hold just means a normal spawn. The idle seconds get their own `held`
  meter line. Live proof (`cloud/smoke_one_boot.py`): transcribe and align ran in the same
  task id; the hand-off idled 3.7 s; a released hold idled 2.5 s; an unanswered hold closed
  at 30.1 s and the late alignment still completed in its own container.
- **The coverage gate runs in the session, on the client.** The intent
  (`src/services/cloudSyncIntent.ts`) runs Apply Sync's own `parseProjectData` →
  `applyAnchorBasedTiming` → `runForcedAlignmentForSync(..., 'cloud')` against the cloud
  transcript while the container is held. The G4 check and the chunk planner are the same
  code as local; nothing is ported to Python. A mismatch pauses (`hopeless-local-coverage`)
  and releases the container before any alignment is submitted. *Mechanism note, open to
  operator veto:* "inside the job" is met as "inside the one held session, before FA
  compute". The check itself executes in the app.
- **The GPU never waits for files.** The App's spine effect releases a held container on every
  "nothing to align" path: not Cloud, spine incomplete, FA gate closed, already synced, no
  duration.
- **Spine complete → the intent starts on its own**, one per spine (`audioHash|scriptHash|engineKey`),
  and a spine change aborts the stale intent. A background pause raises the same restart-safe
  `SyncPausedDialog` and Sync Log entry as Apply Sync.
- **Reveal:** Apply Sync on Cloud waits on a running intent for its spine, showing the
  gateway's own phase (checking / waiting for a GPU / aligning / building). It then runs the
  normal pipeline, where both stages are cache hits. Cancel stops the wait.
- **Scope held to the recorded split:** the rename, 4-slot gating and progress-bar removal
  are U4.6. Until then Apply Sync stays disabled while staging transcription runs, so an early
  click can only land during planning/alignment, not transcription.

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

### U4.6 — as built

*Rename note:* this document's earlier sections say "Apply Sync". The button is now
**Build Timeline**; internal identifiers (`handleApplySyncFromFiles`, `onApplySync`,
`applySync*` files) keep their names.

- **Rename:** every user-facing string (button, recovery banner, pause dialog, FA pack notice,
  Sync Log empty state and fix hints, gapless-export message, empty Segments tab) says Build
  Timeline. The button's copy lives in `BUILD_TIMELINE_COPY` (`src/services/buildTimelineGate.ts`).
- **Post-sync label: NOT swapped.** "Timeline ready" had not been signed when this unit shipped,
  so the signed Wave 2 label "Already synced" stays. It's a one-line swap
  (`BUILD_TIMELINE_COPY.syncedLabel`) once the operator signs.
- **4-slot gate:** a slot counts as filled if it's staged or persisted, so a bundle zip fills all
  four at once. The reason is visible above the button and in its tooltip ("Add a voiceover and
  media to build the timeline"). The sync intent still fires at spine complete, and a pin makes
  sure the spine effect never gates on media. The `no-asset` attention kind is unchanged.
- **Early click on the cloud:** while the staged voiceover is still transcribing on the cloud, the
  button stays enabled. A click waits for the transcript and shows the cloud's own phase through
  `onCloudPhase` (waiting for a GPU / transcribing). The ordinary pipeline then runs, and its
  alignment takes the held container, so there is still one boot. The wait sits before step 2
  on purpose: persisting the voiceover clears the pending reference, and the staging run writes
  its tokens back only while it owns that reference. A staging failure (cloud pause or model
  dialog) wakes the wait as `paused`, so the click never hangs. That path and cancel both end
  with the staged files kept (`holdStaged`).
- **Local keeps click-to-run:** the button is greyed with "Transcribing…" while local staging
  transcription runs. A restored voiceover that needs an explicit Transcribe greys the button on
  both engines.
- **Progress bar removed (both engines):** `TranscriptionBar` renders nothing while transcribing.
  Warning and error strips, the cloud pause dialog and the model dialogs are unchanged. With the
  bar gone, its ✕ ("cancel transcription") is gone too. Removing or replacing the voiceover still
  supersedes a run. *Operator-vetoable.*
- **Known residue:** if an early click's pipeline aborts after the transcript lands but before
  alignment (e.g. an empty scene doc), the held container isn't released explicitly. The worker
  closes it at `HOLD_FOR_PLAN_SEC` (≤ 30 s of `held` meter). The spine effect releases it
  earlier if it runs first.
