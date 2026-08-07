# Kinetix Pro Studio

A desktop video slideshow compositor built with Tauri v2 and a React/Vite frontend.
Provide a script, scene details (bracketed asset references like `[IMAGE: hero.jpg]`),
and a voiceover audio file — Apply Sync maps the script to scenes and assets in one
pass, proportioning segment durations to character count. Edit segments on a visual
timeline (transitions, overlays, filters, animations), then export a full H.264/AAC MP4
rendered natively via a bundled ffmpeg sidecar. An optional Whisper-based transcription
pass can re-sync segment timing to the actual spoken audio.

Export is desktop-only and requires the Tauri app — there is no server component and no
AI/LLM dependency.

## Prerequisites

- **Node.js** 22+
- **Rust toolchain** (`rustup`) and your platform's [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- **ffmpeg and whisper-cli sidecar binaries**, plus the Whisper model file — these are
  gitignored and not included in the repo. See
  [src-tauri/binaries/README.md](src-tauri/binaries/README.md) for how to provision them
  and [src-tauri/models/README.md](src-tauri/models/README.md) for the Whisper model.

## Setup

```sh
npm install
```

Optionally copy `.env.example` to `.env` and fill in API keys for stock asset search
(Pexels, Pixabay, Coverr). All three are optional — stock search is silently disabled
for any provider whose key is missing.

## Development

```sh
npm run tauri:dev
```

Opens the app in a native Tauri window with hot reload. `npm run dev` alone starts just
the Vite frontend in a browser tab, without native export or other Tauri-only features —
useful for quick UI iteration, but not a substitute for testing in the real app.

## Build

```sh
npm run tauri:build
```

Produces a platform-native installer/bundle via Tauri. Native MP4 export (the ffmpeg
sidecar pipeline) only works inside the Tauri app — dev or built — never in a plain
browser tab.

## Testing & Linting

```sh
npm run lint   # tsc --noEmit
npm test       # vitest run
```

## Further Reading

- [CLAUDE.md](CLAUDE.md) — architecture, file map, conventions, and invariants
- `project-state.md` — current status, active tasks, and bug tracking
- `docs/history.md` — completed-work history and implementation records, once a body of work closes out
- `docs/decisions/` — dated rulings on open architectural questions (e.g. the `segments` gapless-partition vs. independent-slots question — see `project-state.md`'s Active Tasks for its current status)
