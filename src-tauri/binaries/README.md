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

## Current binary (macOS x86_64)

```
Source:   evermeet.cx static ffmpeg build (x86_64-apple-darwin)
Version:  ffmpeg version 8.1.1-tessus  https://evermeet.cx/ffmpeg/
Linkage:  static (only system libs per otool -L verification)
License:  GPL (includes --enable-libx264)
```

For internal distribution this is fine. Before public SaaS launch,
swap for an LGPL-only build (no GPL components, e.g., OpenH264 for
H.264 encode, or commercial x264 license) — see deferred SaaS
readiness items in CLAUDE.md.

## Re-provisioning on a fresh checkout

```sh
curl -L -o /tmp/ffmpeg.zip https://evermeet.cx/ffmpeg/getrelease/zip
unzip /tmp/ffmpeg.zip -d /tmp/
cp /tmp/ffmpeg src-tauri/binaries/ffmpeg-x86_64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-x86_64-apple-darwin
```

Verify portability before committing any built artifact:
```sh
otool -L src-tauri/binaries/ffmpeg-x86_64-apple-darwin
# Must show ONLY /System/Library/ and /usr/lib/ paths.
# Any /usr/local/, /opt/homebrew/, or @rpath entries = NOT portable.
```

## Apple Silicon (aarch64)

Download the arm64 build from the same source:
```sh
# Note: evermeet.cx currently ships x86_64 only.
# For aarch64, use a BtbN static build or build from source:
#   https://github.com/BtbN/FFmpeg-Builds/releases
#   (pick ffmpeg-n8.x-macos-arm64-gpl-shared — then relink statically)
# Or build: ./configure --enable-static --disable-shared --enable-gpl --enable-libx264 ...
cp /path/to/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

## Why not committed?

These binaries are large (~76 MB for x86_64 static) and platform-specific.
They are excluded via `.gitignore` (`src-tauri/binaries/ffmpeg-*`).
CI/CD pipelines should download or build the appropriate binary before running
`npm run tauri:build`.

## License

ffmpeg is licensed under LGPL 2.1+. Builds compiled with `--enable-gpl` (which
includes libx264) are licensed under GPL 2+. The evermeet.cx static build used
here is GPL-licensed. For public distribution, ensure your license obligations
are met or switch to an LGPL-only build.
