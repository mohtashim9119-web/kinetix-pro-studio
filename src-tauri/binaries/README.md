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

## Obtaining the binary

Use a **statically linked** ffmpeg build to avoid shared-library dependencies on the
end user's machine:

### macOS (Homebrew static build, for dev/testing only)
```sh
cp $(which ffmpeg) src-tauri/binaries/ffmpeg-x86_64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-x86_64-apple-darwin
```

> **Note:** The system Homebrew ffmpeg is dynamically linked and depends on
> Homebrew dylibs. It works for development but is not portable for distribution.
> For a shippable app, use a static build from <https://evermeet.cx/ffmpeg/> or
> build ffmpeg with `--enable-static --disable-shared`.

### macOS Apple Silicon (static)
Download a universal / arm64 static build:
```sh
curl -L https://evermeet.cx/ffmpeg/ffmpeg-<version>.zip -o /tmp/ffmpeg.zip
unzip /tmp/ffmpeg.zip -d /tmp/ffmpeg-bin
cp /tmp/ffmpeg-bin/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin
chmod +x src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

## Why not committed?

These binaries are large (typically 80–120 MB) and platform-specific.
They are excluded via `.gitignore` (`src-tauri/binaries/ffmpeg-*`).
CI/CD pipelines should download or build the appropriate binary before running
`npm run tauri:build`.

## License

ffmpeg is licensed under LGPL 2.1+ (or GPL 2+ with optional components enabled).
A statically linked build that includes GPL components (e.g. libx264) is GPL-licensed.
Review the ffmpeg build flags to confirm compliance for your distribution use case.
A license-clean LGPL-only static build is deferred to the SaaS readiness phase.
