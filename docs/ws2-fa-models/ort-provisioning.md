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

## Windows: MSVC redistributable prerequisite (WS2 Step 17 Part 1 — CI-VERIFIED provisioning, runtime NOT DETERMINED)

**MEASURED this session** (`pefile` against the real, hash-verified
`onnxruntime-win-x64-1.23.2` release — `.work-phase4/session-ws2-17/`):

| Binary | Non-OS-provided imports |
|---|---|
| `onnxruntime.dll` | `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `MSVCP140.dll`, `MSVCP140_1.dll` |
| `onnxruntime_providers_shared.dll` | `VCRUNTIME140.dll` |

(Both also import `api-ms-win-crt-*.dll` — Universal CRT, part of Windows
10+ itself since 1607 — and OS-provided `KERNEL32`/`ADVAPI32`/`SETUPAPI`/
`dbghelp`/`dxgi`; those need no action.) `whisper-cli.exe`, `ffmpeg.exe`,
`ffprobe.exe`, and the app's own `.exe` were **NOT DETERMINED** — no Windows
build of any of them was available to inspect this session (all are produced
by Windows-hosted CI steps or a Windows-only toolchain). `ffmpeg.exe`/
`ffprobe.exe` are gyan.dev "essentials" builds, documented as GCC/MinGW-w64
and typically not MSVC-CRT-dependent, but this is unverified against the
actual shipped binary. `whisper-cli.exe` is built by our own CI via CMake
with MSVC and no `CMAKE_MSVC_RUNTIME_LIBRARY` override, so it defaults to
`/MD` (dynamic CRT) — plausibly the same dependency, not measured. The app's
own Rust `.exe` targets `x86_64-pc-windows-msvc` without `crt-static`, which
also defaults to dynamic CRT linkage per Rust's own platform docs — also
plausible, not measured.

**Resolved (WS2 Step 17 Part 1): Option A, app-local deployment.**
`build.yml`'s `Provision MSVC C++ runtime DLLs app-local (Windows x86_64,
WS2 Step 17 Part 1)` step downloads the official `vc_redist.x64.exe` (pinned
URL + sha256 `cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b`,
the literal resolved target of `https://aka.ms/vs/17/release/vc_redist.x64.exe`,
MEASURED — the hash is embedded in the download's own CDN path and was
confirmed against the actual downloaded bytes), installs it on the disposable
CI runner (`/install /quiet /norestart`), and copies the 4 files above out of
`System32` into `src-tauri/onnxruntime/` — the same folder `onnxruntime.dll`
already ships from, which `tauri.conf.json`'s existing `"onnxruntime/*":
"onnxruntime/"` resource glob bundles with **no `tauri.conf.json` change
needed**. Windows resolves a loaded DLL's own dependent-DLL imports starting
from that DLL's own directory (standard search order — this is the whole
mechanism app-local CRT deployment relies on), so co-locating the 4 files
with `onnxruntime.dll` is sufficient; they do not need to sit next to the
main `.exe`.

**Why Option A over Option B (NSIS chain-install):** (1) no elevation/UAC
prompt or reboot, vs. Option B's `vc_redist.x64.exe` install requiring
admin rights; (2) ~1.5 MB delta vs. Option B's ~25 MB bundled payload or a
network dependency at install time; (3) Microsoft's own docs explicitly
sanction this exact deployment: learn.microsoft.com/en-us/cpp/windows/
redistributing-visual-cpp-files, "Install individual redistributable files"
— *"It's also possible to directly install the Redistributable DLLs in the
application local folder... For servicing reasons, we don't recommend that
you use this installation location"* (fetched and quoted verbatim this
session) — sanctioned with a known, accepted tradeoff (no automatic security
updates to these 4 files; a future OS-level VC++ CVE would need a new app
release, not a background OS update).

**License term cited:** learn.microsoft.com/en-us/visualstudio/releases/2022/
redistribution, "Distributable Code Files for Visual Studio 2022" →
"Visual C++ Runtime Files": *"Subject to the License Terms for the software,
you may copy and distribute with your program any of the files within the
following folder and its subfolders... [VisualStudioFolder]\VC\redist"* —
the same file tree `vc_redist.x64.exe` installs from contains
`vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll`, `msvcp140_1.dll`
as Distributable Code under the VS2022 Microsoft Software License Terms.
Fetched and quoted verbatim this session (not copied from a summary).

**Build guard (Part 1.4):** `Guard against missing app-local MSVC runtime
DLLs` (`build.yml`, Windows leg) fails the build if any of the 4 CRT files
or the 2 onnxruntime files are absent from `src-tauri/onnxruntime/` before
`tauri:build` runs — PowerShell `Test-Path` enumeration, no bash-3.2
globstar risk (the 5adbbf4 precedent). CI-VERIFIED status: NOT YET RUN (no
CI execution this session — the workflow is `workflow_dispatch`-only and was
not triggered, per this session's "do not trigger the installer workflow"
constraint). Locally confirmed only: the YAML parses (`python3 -c "import
yaml..."`), the step is correctly ordered before `Build Tauri app`, and the
guard's `Test-Path` logic mirrors the already-CI-proven "stray dev models"
guard pattern in the same file.

**Runtime failure diagnosis (Part 1.6):** `src-tauri/src/fa_onnx.rs`'s
`augment_ort_load_error` (`fa_onnx.rs:433`, added this session;
`probe_ort_runtime` at `fa_onnx.rs:460` and `load_session` at
`fa_onnx.rs:484` both route through it) appends the 4 file names and a
redistributable download link to
any `ort::init_from` failure on Windows — a raw Windows `LoadLibrary`
failure (error 126, "the specified module could not be found") does not
name which dependency is missing, so before this change a missing CRT file
and a corrupted bundle were indistinguishable in the Sync Log. This is the
diagnostic that would have caught bug 2's 117-cut regression (Step 15) on
day one instead of requiring a real Windows operator log to root-cause.

**Installer size:** NOT DETERMINED — no Windows hardware to run
`tauri:build` and measure a real installer this session. Expected delta is
~1.5 MB (4 files, each 100 KB–1.2 MB per typical VC++ 14.x redistributable
DLL sizes) added to whatever `src-tauri/onnxruntime/` already contributes;
this must be measured against a real CI-built artifact before the claim can
move past NOT DETERMINED.

### Operator checklist: verifying on a genuinely clean Windows machine

**Cannot be run this session — no Windows hardware available.** This is the
verification WS2 Step 17 Part 1 could not itself perform; run it verbatim on
a Windows 10/11 VM or PC that has **never** had Visual Studio, the VC++
Redistributable, or any other software bundling `vcruntime140.dll`/
`msvcp140.dll` installed (a fresh VM image, not a dev machine — a dev
machine almost certainly already has the redistributable from some other
install, which is exactly what silently masked this bug through Step 15).

1. Confirm the machine is clean: open PowerShell, run
   `Test-Path "$env:SystemRoot\System32\vcruntime140.dll"` — expect `False`.
   If `True`, this machine is not a valid test and another must be found.
2. Download and run the built installer (`.msi` or NSIS `.exe`, from a CI
   artifact of the `windows-latest` / `x86_64-pc-windows-msvc` matrix leg).
   Complete installation normally.
3. Launch the app. Open a project (or create one) and start Apply Sync with
   a language whose FA model is installed.
4. Open the Sync Log. Expect a line reading **"FA pre-flight: ready"** (or
   equivalent per current UI wording) — NOT a fallback-to-Whisper message,
   and NOT a raw `os error 126` with no named cause (if this still appears,
   Part 1.6's error augmentation did not reach this build — report as a
   regression, not as "expected until verified").
5. Confirm the sync actually used forced-alignment timing, not Whisper
   fallback — check the Sync Log for FA-specific entries (chunk plan,
   ONNX session, or equivalent) rather than inferring from output quality
   alone (timestamps alone don't reliably distinguish the two paths).
6. Report pass/fail plainly. A pass here is what moves this bug from
   Finished-but-pending-verification to Finished — nothing else does.

## CI build status (WS2 Step 14, 2026-08-27)

CI run `33017398678` (commit `5adbbf4`, the day after Phase 4 landed) built
BOTH matrix legs successfully for the first time: `windows-latest`/
`x86_64-pc-windows-msvc` and `macos-latest`/`universal-apple-darwin`. This is
CI-VERIFIED evidence that the ORT provisioning steps above (download, hash
check, lipo) complete cleanly in CI on both targets — it is NOT evidence that
either DLL/dylib loads or that FA runs correctly at runtime; no Windows or
Apple Silicon hardware has run the built artifact. See
`docs/history-2.md#2026-08-27--correction--ws2-ci-installer-artifacts-now-exist`.

## What Phase 4 / Step 17 Part 1 did NOT verify

- The Windows DLLs loading on a genuinely clean machine (never installed the
  VC++ redistributable) — WS2 Step 15 confirmed FA runs on the test
  machine, but that machine was already provisioned; the operator checklist
  above is the remaining, not-yet-run step for Part 1's app-local fix.
- The `Provision MSVC C++ runtime DLLs app-local` and its guard step have
  never executed in CI (the workflow is `workflow_dispatch`-only, not
  triggered this session) — YAML-valid and correctly ordered, confirmed
  locally; CI-VERIFIED status pending an actual run.
- `whisper-cli.exe`, `ffmpeg.exe`/`ffprobe.exe`, and the app's own `.exe`'s
  MSVC-CRT dependency — no Windows binary available to inspect (see the
  per-binary table above).
- The arm64 macOS slice loading or running real inference (no Apple Silicon
  hardware).
- A real forced-alignment run on either target — only the pre-existing
  macOS x86_64 path has ever been exercised end-to-end with real audio
  (WS2 Step 11, A5).
- A full built installer's size on Windows (no Windows hardware to install
  and measure it on — see `docs/history-2.md`'s WS2 Step 13 entry for the
  component byte deltas that were measured instead).
