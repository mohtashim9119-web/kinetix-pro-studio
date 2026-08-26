# Bundled onnxruntime C runtime (forced alignment)

The forced-alignment path (`--features fa-inference`) runs its ONNX model through
the onnxruntime **C** library, loaded at runtime by the `ort` crate in
`load-dynamic` mode. This directory holds that library and the committed manifest
describing it.

- **`onnxruntime.manifest.json`** — committed. The source of truth for which
  runtime version the app ships and what `ort` requires of it, one entry per
  supported (os, arch) target (WS2 Step 13 Phase 4 widened this from a single
  macOS-x86_64 object to a `targets` array). A guard test
  (`scripts/onnxruntimeBundle.guard.test.ts`) fails if any entry drifts from
  the pinned `ort` in `src-tauri/Cargo.toml`, or from
  `fa_onnx.rs::SUPPORTED_ORT_TARGETS`.
- **`libonnxruntime.*.dylib` / `onnxruntime.dll` / `onnxruntime_providers_shared.dll`**
  — gitignored (tens of MB, platform-specific — same policy as the whisper
  `.bin` models and the ffmpeg/whisper sidecars). Provision on a fresh
  checkout with the steps below.

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

## Re-provisioning on a fresh checkout

`fa_onnx.rs::SUPPORTED_ORT_TARGETS` accepts three targets (WS2 Step 13 Phase
4). `build.yml` provisions all of them in CI; the recipes below reproduce
that locally. **Only macOS x86_64 has been runtime-verified in this repo's
own history** (real FA runs, real corpora) — the aarch64 and Windows recipes
are checksum-verified downloads only; see
`docs/ws2-fa-models/ort-provisioning.md` for what's still unverified on each.

### macOS (universal x86_64+arm64 — matches this app's own bundle target)

```bash
cd src-tauri/onnxruntime
curl -L -o onnxruntime-osx-x86_64-1.23.2.tgz \
  https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-x86_64-1.23.2.tgz
curl -L -o onnxruntime-osx-arm64-1.23.2.tgz \
  https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz
tar -xzf onnxruntime-osx-x86_64-1.23.2.tgz
tar -xzf onnxruntime-osx-arm64-1.23.2.tgz
shasum -a 256 onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.1.23.2.dylib
# must print: 8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054
shasum -a 256 onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib
# must print: d306d2bc768540766c7ed8a1e0ff05d2870c77a934ebeee4a7bafa1b732ef299
lipo -create \
  onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.1.23.2.dylib \
  onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib \
  -output libonnxruntime.1.23.2.dylib
lipo -info libonnxruntime.1.23.2.dylib
# must print both: x86_64 arm64
rm -rf onnxruntime-osx-x86_64-1.23.2 onnxruntime-osx-x86_64-1.23.2.tgz \
       onnxruntime-osx-arm64-1.23.2 onnxruntime-osx-arm64-1.23.2.tgz
```

The lipo OUTPUT's own sha256 is recorded in `onnxruntime.manifest.json`'s
`"arch": "universal"` entry for reference, but is NOT gated on — `lipo`'s
exact output bytes are not guaranteed reproducible across Xcode/lipo tool
versions from the same inputs. Trust `lipo -info` reporting both
architectures, not a byte-for-byte hash match against another machine's
build.

### Windows (x86_64) — one target, two DLLs

```powershell
cd src-tauri/onnxruntime
Invoke-WebRequest -Uri "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-win-x64-1.23.2.zip" -OutFile ort-win.zip
Expand-Archive -Path ort-win.zip -DestinationPath ort-windows -Force
Copy-Item ort-windows\onnxruntime-win-x64-1.23.2\lib\onnxruntime.dll .
Copy-Item ort-windows\onnxruntime-win-x64-1.23.2\lib\onnxruntime_providers_shared.dll .
Remove-Item -Recurse -Force ort-win.zip, ort-windows
Get-FileHash onnxruntime.dll -Algorithm SHA256
# must print: DEC964AB1EE36CC9B0AE247D13B376627992FC57DEC0454354017AB8FD84F1EA
Get-FileHash onnxruntime_providers_shared.dll -Algorithm SHA256
# must print: A2B3A50956AA75A9879C8472BC7DF4F7A8072BCD2DB19A1B7D988E7688F293EF
```

`onnxruntime_providers_shared.dll` is a same-directory dependency
`onnxruntime.dll` loads implicitly via the Windows DLL search order — both
files must sit in `onnxruntime/`, but only `onnxruntime.dll` is ever named by
path in code. The Windows target also needs the Microsoft Visual C++
Redistributable (x64) present on the END USER's machine — see
`docs/ws2-fa-models/ort-provisioning.md` for what is and isn't verified about
that.

The SHA-256 of every provisioned file must match its
`onnxruntime.manifest.json` entry. If you provision a different onnxruntime
version, update the manifest in the same commit — the guard test enforces
that the manifest and the pinned `ort` agree, not that any particular file is
present.
