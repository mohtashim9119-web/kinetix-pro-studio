# FA Model Acquisition (WS2 Step 12, A3)

> Linked from `ManageModelsModal.tsx`'s FA-pack Download explainer and from
> `SyncLogPanel.tsx`'s model-missing deep-link. Explains how a per-language
> `model.onnx` is produced today, what the modal's Import path validates it
> against, and what is still missing before Download works over the network.

## Status

**Import works today.** Download is present in the UI (always enabled, per
the owner's ruling that a disabled-forever button is worse than an
enabled-but-explaining one) but is NOT wired to a real network transfer in
this build — clicking it surfaces an explainer pointing back to this page
instead of attempting a request. See "What Download needs" below for why.

## How to obtain a `model.onnx` file today (operator-run, not automated)

Each of the 5 supported languages' models was produced by exporting a
`jonatasgrosman/wav2vec2-large-xlsr-53-<lang>` HuggingFace checkpoint to ONNX
via `scripts/export-fa-onnx.py`. This script is NOT run by this modal, by CI,
or by any other automation — it is a one-time, operator-run export. Per-model
checkpoint ids, revisions, and expected byte sizes are pinned in the
committed `scripts/fixtures/fa-onnx-manifest.json`:

| Lang | HF repo id | Expected size (bytes) |
|---|---|---|
| en | `jonatasgrosman/wav2vec2-large-xlsr-53-english` | 1,262,512,711 |
| es | `jonatasgrosman/wav2vec2-large-xlsr-53-spanish` | 1,262,545,511 |
| fr | `jonatasgrosman/wav2vec2-large-xlsr-53-french` | 1,262,619,311 |
| de | `jonatasgrosman/wav2vec2-large-xlsr-53-german` | 1,262,533,211 |
| pt | `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese` | 1,262,566,011 |

Invocation (from the repo root, one language at a time):

```bash
python3 scripts/export-fa-onnx.py --language en \
  --repo-id jonatasgrosman/wav2vec2-large-xlsr-53-english \
  --out /tmp/fa-model-en.onnx
```

Consult the script's own `--help` for the exact current flag names — it is
the source of truth, not this table, if the two ever disagree. Do not
re-export the frozen fixture files (`scripts/fixtures/fa-vocab-*.json`,
`fa-onnx-manifest.json`) themselves; only produce the `.onnx` weight file.

**Do not quantize or substitute the model** — a different export changes
alignment output numerically and would invalidate the golden corpora
(`CLAUDE.md` §4's sync/Whisper invariants).

## Where to drop the file

Use the modal's **Import** button for the target language — it opens a
native file picker (`rfd::AsyncFileDialog`, not a browser file input) and
handles placement itself: copies to a `.part` file in the managed location
(`app_local_data_dir()/fa-models/<lang>/model.onnx`), validates, and
atomically renames. Do not place the file by hand into that directory
unless you also want to skip validation — a hand-placed file is picked up
by `check_installed_models`' fallback path (which hashes it against the
manifest once and writes a `.sha256` sidecar), but only Import gets an
immediate, in-UI rejection message if the file is wrong.

## What Import validates

`models.rs::validate_import` (via the pre-existing, already-tested
`fa_dev::verify_model_manifest`) checks the imported file's exact byte size
AND sha256 against the committed manifest entry for that language — not a
live ONNX graph/session inspection. This was a deliberate choice over
opening an ONNX session and inspecting `input_values`/`logits`/vocab-dim
metadata: session creation requires `ORT_DYLIB_PATH` to be set
(`fa_onnx.rs::load_session`), which is not the case in a plain
`tauri:dev`/`tauri:build` — the build this modal must work in regardless of
whether `fa-inference` is compiled in. An exact-hash check is strictly
stronger than a structural check for THIS threat model (it catches a
byte-identical-shape wrong-language file the structural check would miss)
and needs no ORT runtime, so it runs unconditionally.

## What Download needs before it can work

A real "Download" button needs, at minimum:

1. A real host URL per language. Q1's answer names "own-cdn (HuggingFace
   public model repo)" while Q2 names the repo **private** — these two
   answers conflict as recorded, and this session did not have a real repo
   id or bearer token to reconcile them with, so nothing was wired.
2. If the repo is private (Q2), a bearer token read from an environment
   variable at request time — never hardcoded, never baked into the client
   bundle (`CLAUDE.md`'s secret-handling rule). No such variable is defined
   yet.
3. A resumable-download command mirroring `model_download.rs`'s existing
   whisper downloader (`.part` + HTTP Range + sha256-against-manifest +
   atomic rename + progress `Channel` + cancel) — structurally this is a
   short, mechanical port once (1) and (2) are resolved, since
   `verify_model_manifest` already provides the exact per-language
   size/hash the downloader would verify against.

Until an operator supplies (1)/(2) and confirms which of Q1/Q2 is correct,
Import via a manually-run `export-fa-onnx.py` (above) is the only working
acquisition path.
