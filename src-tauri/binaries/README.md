# src-tauri/binaries

This directory holds platform-specific ffmpeg sidecar binaries bundled inside the
Kinetix Pro Studio desktop app (Tauri Phase 6.5).

## Naming convention

Tauri appends the Rust target triple at build time. The file on disk must be named:

```
ffmpeg-<target-triple>
```

Examples:
- macOS x86_64: `ffmpeg-x86_64-apple-darwin`
- macOS Apple Silicon: `ffmpeg-aarch64-apple-darwin`
- Windows x64: `ffmpeg-x86_64-pc-windows-msvc.exe`
- Linux x64: `ffmpeg-x86_64-unknown-linux-gnu`

`tauri.conf.json` declares `"externalBin": ["binaries/ffmpeg"]`; Tauri selects the
correct triple automatically for the current build target.

## macOS (Intel — x86_64)

```
Source:   evermeet.cx static ffmpeg build (x86_64-apple-darwin)
Version:  ffmpeg version 8.1.1-tessus  https://evermeet.cx/ffmpeg/
Linkage:  static (only system libs per otool -L verification)
License:  GPL (includes --enable-libx264)
```

To re-provision on a fresh checkout:
```sh
curl -L -o /tmp/ffmpeg.zip https://evermeet.cx/ffmpeg/getrelease/zip
unzip /tmp/ffmpeg.zip -d /tmp/
cp /tmp/ffmpeg src-tauri/binaries/ffmpeg-x86_64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-x86_64-apple-darwin
```

Verify portability before use:
```sh
otool -L src-tauri/binaries/ffmpeg-x86_64-apple-darwin
# Must show ONLY /System/Library/ and /usr/lib/ paths.
# Any /usr/local/, /opt/homebrew/, or @rpath entries = NOT portable.
```

## Windows (x86_64)

```
Source:   gyan.dev essentials build (x86_64-pc-windows-msvc)
Version:  ffmpeg 8.1.1-essentials_build  https://www.gyan.dev/ffmpeg/builds/
Linkage:  static (PE32+ verified via `file` — no external DLL dependencies)
License:  GPL (includes libx264)
```

To re-provision on a fresh checkout:
```sh
curl -L -o /tmp/ffmpeg-win.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
unzip /tmp/ffmpeg-win.zip -d /tmp/ffmpeg-windows
cp /tmp/ffmpeg-windows/ffmpeg-*-essentials_build/bin/ffmpeg.exe \
   src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
```

Or on Windows (PowerShell):
```pwsh
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "$env:TEMP\ffmpeg-win.zip"
Expand-Archive -Path "$env:TEMP\ffmpeg-win.zip" -DestinationPath "$env:TEMP\ffmpeg-windows" -Force
$ffmpegExe = Get-ChildItem -Path "$env:TEMP\ffmpeg-windows" -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
Copy-Item -Path $ffmpegExe.FullName -Destination "src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe"
```

## macOS (Apple Silicon — aarch64)

```
Source:   osxexperts.net static ffmpeg build (aarch64-apple-darwin)
Version:  ffmpeg 7.1.1  https://www.osxexperts.net/ffmpeg711arm.zip
Linkage:  static (only /System/Library/ and /usr/lib/ per otool -L verification)
License:  GPL (includes libx264)
```

To re-provision on a fresh checkout:
```sh
curl -L -o /tmp/ffmpeg.zip https://www.osxexperts.net/ffmpeg711arm.zip
unzip /tmp/ffmpeg.zip -d /tmp/ffmpeg-arm64/
cp /tmp/ffmpeg-arm64/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

Verify portability before use (run on an Apple Silicon Mac):
```sh
otool -L src-tauri/binaries/ffmpeg-aarch64-apple-darwin
# Must show ONLY /System/Library/ and /usr/lib/ paths.
# Any /usr/local/, /opt/homebrew/, or @rpath entries = NOT portable.
```

## Why not committed?

These binaries are large (48–97 MB) and platform-specific.
They are excluded via `.gitignore` (`src-tauri/binaries/ffmpeg-*`).
The CI workflow (`.github/workflows/build.yml`) downloads the appropriate binary
fresh before each build.

## License

Both binaries are GPL-licensed (include libx264). Acceptable for internal use.
Before public SaaS launch, swap for LGPL-only builds (e.g. OpenH264 for H.264
encode, or a commercial x264 license) — see deferred SaaS readiness items in
CLAUDE.md.

---

## Whisper CLI Binaries

The whisper-cli binaries are gitignored. Re-provision by building from source:

### macOS (Intel x86_64)

```sh
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper-cpp
cd /tmp/whisper-cpp
cmake -B build-static -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF
cmake --build build-static --config Release --target whisper-cli -j$(sysctl -n hw.logicalcpu)
cp build-static/bin/whisper-cli src-tauri/binaries/whisper-x86_64-apple-darwin
chmod +x src-tauri/binaries/whisper-x86_64-apple-darwin
```

### macOS (Apple Silicon arm64)

Same as above but add `-DCMAKE_OSX_ARCHITECTURES=arm64` to the cmake configure step.
Output: `src-tauri/binaries/whisper-aarch64-apple-darwin`

### Windows

```powershell
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git C:\whisper-cpp
cd C:\whisper-cpp
cmake -B build-static -DBUILD_SHARED_LIBS=OFF -DGGML_VULKAN=OFF -DGGML_CUDA=OFF
cmake --build build-static --config Release --target whisper-cli
copy build-static\bin\Release\whisper-cli.exe src-tauri\binaries\whisper-x86_64-pc-windows-msvc.exe
```

Model file: see `src-tauri/models/README.md`
