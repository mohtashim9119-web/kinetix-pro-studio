# ONNX Runtime Provisioning (WS2 Step 13, Phase 4)

> Linked from `src-tauri/onnxruntime/onnxruntime.manifest.json`'s Windows
> entry and `src-tauri/onnxruntime/README.md`. Records what Phase 4 actually
> verified vs. what it could not, per target.

## Required onnxruntime version

`ort = "=2.0.0-rc.13"` (`src-tauri/Cargo.toml:41`), `default-features =
false, features = ["std", "load-dynamic"]` — no `api-NN` feature enabled, so
ort-sys's `version.rs` computes `ORT_API_VERSION = 17` (the floor). Since
onnxruntime's C API is backward-compatible, any runtime with minor version
>= 17 satisfies it. **1.23.2 is pinned for every target** —
`src-tauri/onnxruntime/onnxruntime.manifest.json`'s `apiVersionRationale`
field states this reasoning, and `scripts/onnxruntimeBundle.guard.test.ts`
enforces it (`apiVersion` == the required version, `minorVersion >=
apiVersion`) for every entry in the manifest's `targets` array.

## Per-target file list

| Target | Files | Source | sha256 |
|---|---|---|---|
| macos-x86_64 | `libonnxruntime.1.23.2.dylib` | `onnxruntime-osx-x86_64-1.23.2.tgz` | `8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054` |
| macos-aarch64 | `libonnxruntime.1.23.2.dylib` | `onnxruntime-osx-arm64-1.23.2.tgz` | `d306d2bc768540766c7ed8a1e0ff05d2870c77a934ebeee4a7bafa1b732ef299` |
| macos-universal (actually shipped) | `libonnxruntime.1.23.2.dylib` (fat, `lipo -create` of the two rows above) | local `lipo`, not a download | `7864118376c19ecd74227dd0b652b3ad4e10419a6782f7e200b2e78cc73bcf68` (MEASURED locally 2026-08-27, informational only — not CI-gated, see below) |
| windows-x86_64 | `onnxruntime.dll` | `onnxruntime-win-x64-1.23.2.zip` | `dec964ab1ee36cc9b0ae247d13b376627992fc57dec0454354017ab8fd84f1ea` |
| windows-x86_64 | `onnxruntime_providers_shared.dll` (dependency of the above, co-located) | same zip | `a2b3a50956aa75a9879c8472bc7df4f7a8072bcd2db19a1b7d988e7688f293ef` |

All hashes MEASURED 2026-08-27 by downloading the official Microsoft
`v1.23.2` GitHub release assets and hashing them directly — not copied from
any third-party source.

## macOS: universal (lipo), not ship-both-and-select

The app's own macOS bundle target is already `universal-apple-darwin` — one
fat main executable covering both x86_64 and arm64. Lipo-ing the onnxruntime
dylib into the same shape, at the same single filename, needs **zero**
runtime arch-selection code: dyld already picks the correct slice from a fat
Mach-O at load time, the same mechanism that already selects the correct
slice of the app's own executable. The alternative ("ship both, select at
runtime") would require `fa_onnx.rs`'s resolver to pick a filename based on
`std::env::consts::ARCH` even though both files would sit in the same
resource folder — strictly more code for no benefit, since a fat dylib
already does exactly that selection at the OS level.

**Verified this session:** `lipo -create` of the two per-arch dylibs above
(both sha256-confirmed against Microsoft's release) produces a file whose
`lipo -info` reports `x86_64 arm64` (both slices present), and that file
**`dlopen()`s successfully on this session's real Intel (x86_64) hardware**
(confirmed via Python's `ctypes.CDLL` — a real dynamic-linker load, not just
a well-formed-file check).

**NOT verified this session:** the arm64 slice's own runtime behavior — no
Apple Silicon hardware was available. The macOS leg of `build.yml`'s matrix
runs on GitHub's `macos-latest` runners, which are arm64 — that CI job is
what will first actually exercise the arm64 slice's dlopen path, but CI does
not run any FA inference against it (that would need a real per-language
model plus a real audio corpus, out of scope for the release build
workflow). A genuine "FA runs correctly on Apple Silicon" claim needs either
real Apple Silicon hardware or `fa-ort-matrix.yml` gaining an arm64 runner
cell with the `feature-on-ort-set` matrix leg pointed at the arm64 (not
universal) dylib.

The lipo output's own sha256 is recorded above and in the manifest, but is
**not** a CI hard-gate (see `build.yml`'s own comment on the step) — `lipo`
does not guarantee byte-identical output across Xcode/lipo tool versions
even from identical inputs, so pinning it would risk failing a legitimate
build over a toolchain difference rather than a real corruption. The two
INPUT dylibs (Microsoft's own signed release artifacts) are what's actually
integrity-checked; the lipo step only checks the output's *structure*
(`lipo -info` reports both architectures).

## Windows: MSVC redistributable prerequisite (OPERATOR-ATTESTED, not verified)

Microsoft's prebuilt `onnxruntime.dll` for Windows is built with MSVC and
dynamically links against the Visual C++ runtime (`vcruntime140.dll`,
`msvcp140.dll`, etc.) — these are **not** included in the release zip and
are **not** guaranteed present on a fresh Windows 10/11 install. This is
stated from onnxruntime's own published Windows system requirements, not
independently confirmed by running the DLL on a machine without the
redistributable installed (no Windows hardware available this session).

This is not a new risk this phase introduces in isolation: `build.yml`
already builds `whisper-cli.exe` with MSVC for the exact same Windows target
(`Provision whisper sidecar (Windows)` step), and that binary very likely
carries the identical prerequisite — whether it has ever actually failed on
an end-user machine without the redistributable is **NOT DETERMINED**; this
repo's history contains no report either way.

**What this means concretely:** a fresh Windows install that has never
installed anything requiring the VC++ runtime may fail to load
`onnxruntime.dll` (and possibly `whisper-cli.exe`) even after this phase's
provisioning is otherwise correct. Closing this gap needs one of:

1. Bundle/chain-install the redistributable from the installer (a custom
   NSIS `!include` step running `vc_redist.x64.exe /quiet /norestart`, or
   the WiX MSI's `Bundle` chaining support) — the standard fix for this
   class of problem, not yet implemented.
2. Statically link the CRT into a custom onnxruntime build instead of using
   Microsoft's prebuilt DLL — a much larger undertaking (build onnxruntime
   from source with `/MT`), not attempted this session.
3. Ship as-is and treat "install the VC++ redistributable" as an
   end-user/support instruction — the same posture (implicitly) already
   taken for `whisper-cli.exe`.

No option was implemented this session — this is the concrete blocker
recorded as still open for Windows FA, separate from and in addition to the
DLL provisioning itself (which IS complete and checksum-verified).

## What Phase 4 did NOT verify

- The Windows DLLs loading at all (no Windows hardware).
- The arm64 macOS slice loading or running real inference (no Apple Silicon
  hardware).
- A real forced-alignment run on either target — only the pre-existing
  macOS x86_64 path has ever been exercised end-to-end with real audio
  (WS2 Step 11, A5).
- A full built installer's size on Windows (no Windows CI run performed this
  session — see `docs/history-2.md`'s WS2 Step 13 entry for the component
  byte deltas that were measured instead).
