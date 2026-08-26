# FA Model Acquisition (WS2 Step 12/13, A3)

> Linked from `ManageModelsModal.tsx`'s FA-pack Download explainer and from
> `SyncLogPanel.tsx`'s model-missing deep-link. Explains how a per-language
> `model.onnx` is acquired today (Download, the real path, and Import, the
> manual fallback) and what the modal validates either path against.

## Status

**Both Import and Download work today.** WS2 Step 13 Phase 3 shipped a real,
resumable FA download (`models::fa_model_download`, a generalization of
`model_download.rs`'s existing whisper downloader — `stream_download_verified`
— rather than a duplicate) against the owner's public HuggingFace repo
`mohtashim9/kinetix-fa-models`, pinned to revision
`f618960d71728eba5f12528d5571838a10d262bf` (`models.rs::FA_MODEL_REVISION`).
No auth token is needed — the repo is public, plain unauthenticated `GET`.
REAL END-TO-END VERIFICATION (`src-tauri/tests/fa_download_live.rs`,
`FA_LIVE_DOWNLOAD=1`, against production `app_local_data_dir`, 2026-08-27):
a fresh download of `en` completed at 1,262,512,711 bytes in 307.2s
(3.92 MiB/s), `.sha256` sidecar written, manifest-verified before the atomic
rename; a cancel-then-resume pass was cancelled at 28,793,177 real on-disk
bytes and resumed from 29,907,289 bytes (not from zero), completing to the
exact expected size in 325.9s with the resulting file confirmed
sha256-identical to the original. Full detail:
`docs/history-2.md#2026-08-27--ws2-step13-fa-download-engine-ort-provisioning`.
Import (below) remains the manual fallback — still useful for an operator who
already has a `model.onnx` from a prior `export-fa-onnx.py` run, or who needs
to place a model without a network transfer.

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

## How Download works

`services/models.ts`'s `downloadFaModel`/`cancelFaModelDownload` call
`models::fa_model_download`, which streams from the pinned HF revision above
via `stream_download_verified` (`.part` file, HTTP Range resume, sha256
verification against `fa-onnx-manifest.json` via the pre-existing
`fa_dev::verify_model_manifest`, atomic rename on success, disk-space
precheck via `fs4` with a 200 MiB margin). Cancellation is per-model
(`ModelDownloadState`'s cancel flag is keyed by `"whisper"`/`"fa-<lang>"`),
so a whisper and an FA download can be cancelled independently. The wire
format (`ModelDownloadEvent`/`ModelDownloadStatus`) is unchanged from the
existing whisper downloader, so `modelDownload.ts`'s consumer code needed no
change to support FA packs.

**Fallback path.** If the HF repo is ever unreachable or its content
changes shape, Import via a manually-run `export-fa-onnx.py` (above) remains
a working acquisition path independent of the network.
