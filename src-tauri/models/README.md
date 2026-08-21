# Kinetix Pro Studio — Whisper Models

The model files in this directory are gitignored (too large for git).

## Re-provisioning

Download the multilingual model (used by the app since Phase 2a,
2026-08-04 — see `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` H.1):
```bash
curl -L -o src-tauri/models/ggml-large-v3-turbo.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
```

File: `ggml-large-v3-turbo.bin` (measured 2026-08-04: 1,624,555,275 bytes,
~1.51 GiB) — multilingual (99+ languages), ~2.1-2.2 GiB peak/resident memory
during inference (measured, see the plan doc's H.9 for the full table).
Source: https://huggingface.co/ggerganov/whisper.cpp

`ggml-base.en.bin` (~141 MB, English-only) is no longer referenced by the app
as of Phase 2a — `whisper.rs`'s `model_path()` resolves `ggml-large-v3-turbo.bin`
exclusively. It is safe to delete if present; **it MUST be removed before any
distribution `tauri build`** — `tauri.conf.json`'s `bundle.resources` glob-bundles
every file in this directory, so leaving both models present would ship ~1.65 GiB
of unused model weight. Download-on-first-use (replacing bundling for the ~1.5
GiB turbo model) is a planned follow-up, not yet built — see project-state.md's
SaaS Readiness Tasks.

## Binary re-provisioning

See `src-tauri/binaries/README.md` for whisper-cli binary instructions.
