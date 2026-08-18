# Bundled onnxruntime C runtime (forced alignment)

The forced-alignment path (`--features fa-inference`) runs its ONNX model through
the onnxruntime **C** library, loaded at runtime by the `ort` crate in
`load-dynamic` mode. This directory holds that library and the committed manifest
describing it.

- **`onnxruntime.manifest.json`** — committed. The source of truth for which
  runtime version the app ships and what `ort` requires of it. A guard test
  (`scripts/onnxruntimeBundle.guard.test.ts`) fails if it drifts from the pinned
  `ort` in `src-tauri/Cargo.toml`.
- **`libonnxruntime.*.dylib`** — gitignored (≈39 MB, platform-specific — same
  policy as the whisper `.bin` models and the ffmpeg/whisper sidecars). Provision
  it on a fresh checkout with the steps below.

## Why this exists (WS1 Session M)

Before Session M, forced alignment resolved its onnxruntime library **only** via
the `ORT_DYLIB_PATH` environment variable. Nothing in the shipped app ever set
it, so every in-app FA run failed with `failed to initialize onnxruntime:
ORT_DYLIB_PATH not set` and fell back to Whisper timing — forced alignment had
never once executed inside the application. The env var was set only by the
`cargo test` / Python-spike driver, pointing into `.work-phase4/` (gitignored
scratch, outside the repo's control).

The fix (ruling R-N: `load-dynamic` **plus bundle the dylib**): the app resolves
this bundled library itself, at a stable location, with no dependency on any
shell-set variable. `ORT_DYLIB_PATH` is kept **only** as a test/override escape
hatch — when it is set, the resolver honors it and skips the bundled lookup
(the entire existing test-skip convention rests on that). See
`src-tauri/src/fa_onnx.rs::ensure_ort_dylib`.

## How it is bundled

`tauri.conf.json`'s `bundle.resources` maps `onnxruntime/*` into the app's
resource directory. At runtime `ensure_ort_dylib` resolves
`resource_dir()/onnxruntime/<filename>` (with dev/exe-dir fallbacks mirroring
`whisper.rs::model_path`), verifies the running target is the one the bundled
binary was built for, and sets `ORT_DYLIB_PATH` to that path before the first
`ort::init_from`. On a target with no matching bundled binary it fails **loudly**
with actionable text rather than silently loading an incompatible library.

## Re-provisioning on a fresh checkout (macOS x86_64)

```bash
cd src-tauri/onnxruntime
curl -L -o onnxruntime-osx-x86_64-1.23.2.tgz \
  https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-x86_64-1.23.2.tgz
tar -xzf onnxruntime-osx-x86_64-1.23.2.tgz
cp onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.1.23.2.dylib .
rm -rf onnxruntime-osx-x86_64-1.23.2 onnxruntime-osx-x86_64-1.23.2.tgz
shasum -a 256 libonnxruntime.1.23.2.dylib
# must print: 8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054
```

The SHA-256 must match `onnxruntime.manifest.json`'s `sha256`. If you provision a
different onnxruntime version, update the manifest in the same commit — the guard
test enforces that the manifest and the pinned `ort` agree, not that any
particular file is present.
