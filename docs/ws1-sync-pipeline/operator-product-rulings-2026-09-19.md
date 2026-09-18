# Operator product rulings — 2026-09-19

Recorded verbatim, this pass, as the plan doc's source of truth. These are product
decisions from the operator, not code-derived findings — nothing below is backed by a
file:line citation because nothing below describes current code. Where a ruling
supersedes a prior document position, the superseded doc is named so the two don't
silently disagree.

- **Cloud is the default engine.** Local FA stops being the default sync path.
- **FA toggles are deleted entirely** — no `faHighPrecisionSync` project field, no
  high-precision-sync UI toggle. This directly supersedes **NR-2**
  (`docs/STATUS.md` NEW RULINGS — "Toggle default becomes ON for all builds and users")
  — NR-2 assumed the toggle persists and only its default changes; under this ruling no
  toggle exists to default. NR-2 is marked SUPERSEDED in `docs/STATUS.md`, not deleted,
  so the discovery trail (FA wiring audit `ebec58a`) stays intact.
- **Whisper-only exists solely as a flagged degraded state** — never a first-class,
  silently-selected engine. If cloud and local FA are both unavailable, the app may fall
  back to Whisper-only, but the UI must flag the run as degraded rather than presenting it
  as a normal sync.
- **Local is savable as the default once two conditions hold together:** Whisper is ready,
  AND at least one selected language pack is ready. This is evaluated per-pack — green
  packs are usable immediately; missing packs are offered on demand rather than blocking
  the whole feature on the slowest pack to finish downloading.
- **Offline behavior is pause-and-offer-local, never auto-switch.** Losing connectivity
  mid-job pauses and presents the local option to the user; it never silently reroutes the
  job to local without the user choosing that.
- **WPM sanity check: warn range 140–180, warn-only.** Outside that range the UI warns;
  it never blocks or auto-corrects.
- **Cloud mid-coverage abort:** on a script/audio mismatch discovered after transcription
  has already run, the cloud job aborts mid-coverage and the user bears the transcription
  cost already incurred. This is a deliberate cost-allocation decision, not a bug to route
  around.
- **One cloud job on the wire at a time, with two cached stages.** The cloud pipeline
  runs a single in-flight job per project; two pipeline stages are cached (not
  re-submitted) rather than the whole job being treated as atomic-or-nothing.
- **SaaS/credits are stripped from `docs/architecture/saas-target-architecture.md`'s
  scope for this pass** — the product is being planned as internal-product-first;
  subscription/credits mechanics are not part of the charter work this pass touches.
- **The partition invariant test is approved.** (Model P gapless partition — see
  `CLAUDE.md` §5 "Segment timing".) No further sign-off needed to rely on it in planning.
- **Both cache races must be fixed first, in Wave 1** — the `fa_dev.rs` digest-memo
  reset race and the `whisper.rs` 16-entry terminal-buffer eviction race (both registered
  as new defects in `docs/STATUS.md` this pass, draft wording from
  `docs/ws1-sync-pipeline/baseline-p1b-p3-2026-09-19.md`) are a prerequisite for the Wave 1
  work, not a someday-cleanup item.
- **fr/de/pt validate via public-domain native audio** — non-English validation for
  French, German, and Portuguese uses public-domain native-speaker recordings, not
  synthetic TTS or English-accented readings.

**Source:** operator instruction given directly in this pass's task brief (CC TASK — P4
lane re-charter + STATUS closure, T5), recorded here verbatim per that instruction. No
other document should be treated as authoritative over these rulings until a later dated
note supersedes this one.
