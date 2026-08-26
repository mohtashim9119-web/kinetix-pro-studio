# WS2 Step 10 — Windows installer sync failure (voiceover fetch + FA error serialization)

> Session: `.work-phase4/session-ws2-10/`. Diagnosis of an operator-reported Windows-only sync
> failure (macOS installer worked, Windows installer did not). No boundary-placement code
> touched — see `CLAUDE.md`'s frozen-file list, reaffirmed for this session.

## Symptom (operator-attested, Windows build, not yet independently reproduced)

Windows sync log for a real project:
- `[SILENCE]` — silence detection failed, reason `voiceover fetch failed: Failed to fetch`.
- `[INFO]` — 117 cuts landed on audio that's still playing (consequence of the above, not a
  separate defect — see below).
- `[INFO]` — 226 of 229 segments matched, 3 skipped.
- `[TOKENS]` — 303 of 2855 tokens filtered (260 empty text, 43 zero/inverted duration).
- `[FA FALLBACK]` — `error: [object Object]`, high-precision sync did not run.
- `[FA PRE-FLIGHT]` — not ready: no bundled onnxruntime for `windows-x86_64` — **correct
  behaviour**, not a bug (Windows ORT was never provisioned; see the WS2 bug 2 correction note in
  `docs/history-2.md`).

## A1/A2 — the exact fetch call and its transport

`src/hooks/useWhisper.ts:27` (pre-fix), inside the module-private `fetchAndDetectSilences`:
```ts
const resp = await fetch(asset.url);
```
`asset.url` is **never** a Tauri asset-protocol URL, an IPC handle, or a data URL — grepped
(`grep -rn "createObjectURL" src/`, `grep -rn "asset://|asset.localhost|convertFileSrc" src/`,
zero hits for the latter): every `Asset.url` in this codebase is a `blob:` object URL minted by
`URL.createObjectURL()`, either directly from a `File` at stage time (`App.tsx:2641`,
`handleVoiceoverStaged`) or from an IndexedDB-cached `Blob` at project-rehydration time
(`App.tsx:4913`). No Tauri capability (`src-tauri/capabilities/default.json`) declares any
`core:asset:*` permission — the asset protocol is not wired into this app at all. So this is a
plain browser `fetch()` against a same-origin `blob:` URL, entirely inside the WebView; no Tauri
IPC or custom scheme is involved in the failing call itself.

## A3 — candidate ruling

| Candidate | Verdict | Evidence |
|---|---|---|
| `asset://`/`asset.localhost` scheme difference (Tauri v2 Windows serves `http://asset.localhost`, macOS serves a different scheme) | **RULED OUT** | The asset protocol is never used for `Asset.url` anywhere in the codebase (see A2) — there is no scheme for the two platforms to differ on. |
| CSP `connect-src` not permitting the URL | **RULED OUT (for the documented CSP)** | `tauri.conf.json`'s `connect-src` already includes `blob:` and `'self'`; the `blob:` URL's own origin is always `'self'` since `URL.createObjectURL()` inherits the creating document's origin. No platform-specific CSP branch exists in the config — same policy string ships to both builds. |
| `assetProtocol` enable/scope not covering the voiceover location | **RULED OUT** | No `assetProtocol` capability is declared at all (checked `src-tauri/capabilities/default.json` — only `core:default`, fullscreen, webview-focus, and the ffmpeg/whisper sidecar `shell:allow-execute` permissions). There is no scope to be wrong. |
| Windows path handling (drive letters, backslashes, UNC, URL-encoding) | **RULED OUT** | `asset.url` is an opaque `blob:<origin>/<uuid>` token, never a filesystem path string, at any point on the path from creation (`URL.createObjectURL`) to consumption (`fetch`). No path-parsing code sits between them. This also means **C1's originally-specified test shape (drive letter/backslash/UNC/non-ASCII path inputs) does not apply to the actual mechanism** — flagged explicitly rather than forcing a test that doesn't match the fix; see "Deviation from the operator's C1 spec" below. |
| The file genuinely not existing at the resolved Windows path | **RULED OUT for this failure specifically** | There is no filesystem path resolution in this call at all (see above) — nothing to "not exist" at. A genuinely missing/corrupt underlying `Blob` would surface as a `decodeAudioData` failure inside `detectSilences` (a different, later error text), not `fetch()`'s own `TypeError: Failed to fetch` at the network layer. |
| A `fetch()`-specific WebView2 quirk against a same-session `blob:` URL, sidestepped by DOM-native consumers (`<video src>`) of the identical URL | **NOT FULLY DETERMINED, but the strongest evidence-backed candidate** | See A4 below. No Windows machine was available this session to reproduce and instrument directly; the operator's promised macOS-vs-Windows comparison log (Q3) was still pending at write time. |

**If none of these is it, say what is:** the leading, evidence-backed candidate is the last row.
It is not proven down to the exact WebView2-internal mechanism (no Windows hardware available
this session), but the fix in Phase B does not depend on knowing that mechanism — it removes the
`fetch(blob:)` round-trip in the one case that matters (a freshly-staged voiceover, which is
exactly the operator's scenario), independent of which WebView2 behavior caused it.

## A4 — cross-signal contrast (the strongest available evidence)

The operator's own log proves the video asset **decoded successfully** on the same Windows build
in the same run. Tracing how each asset type is consumed:
- **Video preview** (`src/components/PreviewStage.tsx:1297`): `<video src={asset.url}>` — the
  DOM's native media loader reads the `blob:` URL directly. Governed by CSP's `media-src`
  directive, not `connect-src`, and never goes through the Fetch API at all.
- **Voiceover silence scan** (`src/hooks/useWhisper.ts:27`, pre-fix): `fetch(asset.url)` — an
  explicit Fetch API call against the identical `blob:` URL scheme. Governed by `connect-src`.

Both directives permit `blob:` in this app's CSP, and both are reading the same kind of URL from
the same webview session — the one concrete code-level difference between the succeeding and
failing consumer is **DOM-native media loading vs. an explicit `fetch()` call**. This is
consistent with — though does not by itself prove — a Fetch-API-specific WebView2 behavior around
`blob:` URLs that the `<video>` element's own resource loader does not share.

## A5 — is 303/2855 filtered tokens Windows-specific?

**NOT DETERMINED.** Requires the same project's macOS transcription run for comparison, which
the operator is generating (Q3: "may take up to 30 minutes... I'll inform as logs are ready").
**Exact ask:** the full `[TOKENS]` line from the macOS Sync Log for the identical project/script/
voiceover, plus the total token count Whisper produced (so the ratio, not just the filtered
count, can be compared — different total transcript lengths from timing differences would also
shift this number without meaning anything is broken).

## A6 — cross-platform sweep (read-only; NOT fixed this session, per operator instruction)

**Unguarded `fetch(blob:)` calls with no in-memory-Blob fallback** — the same class of defect as
the one fixed in Phase B, present at 8 other call sites. Two call sites (`App.tsx:272`,
`App.tsx:4032`) and one in `forcedAlignmentRun.ts:132` already carry the `asset.file ??
fetch(...)` guard (introduced in commit `0aac444`, "universal audio-format support for voiceover
upload + transcription" — for a different original reason, reload losing the `File` reference,
but it happens to be the same shape of fix). The following do **not**:

- `src/App.tsx:3781` — dev-only `[calibrate]` instrumentation (`window.__transcriptInspector`
  family, `CLAUDE.md`/WIP Phase 1b). Not reachable from the shipped production sync path.
- `src/App.tsx:3901` — dev-only `[inspector]` instrumentation, same family as above.
- `src/services/videoDemuxer.ts:66` — generic `fetch(url)`; caller passes video asset URLs.
- `src/services/waveformPipeline.ts:81` — `fetch(input.url)`, waveform peak extraction.
- `src/services/segmentEncoder.ts:416` — `fetch(asset.url)`, legacy per-frame export path.
- `src/services/whisperService.ts:1686` — `fetch(audioAsset.url)`.
- `src/services/exportPipeline.ts:277` — `fetch(voiceoverAsset.url)`, legacy export audio mux.
- `src/services/webcodecsExport/exportWorker.ts:301` — `fetch(asset.url)`, **runs inside a Web
  Worker** (`self.onmessage`), a different execution context than the main thread that minted the
  `blob:` URL via `URL.createObjectURL()` — a materially different (and more commonly
  cross-engine-fragile) case than the same-thread fetch this session fixed. Flagged with extra
  weight for whoever picks this up.
- `src/services/webcodecsExport/exportPipelineWebCodecs.ts:1031` — `fetch(voiceoverAsset.url)`.

**Other candidate classes checked, no hits:**
- `asset://`/`asset.localhost` literals in TS: zero (`grep -rn "asset://|asset\.localhost|tauri\.localhost|convertFileSrc" src/`).
- Hardcoded POSIX-only path separators in production TS: zero — the only `'/'`-only
  `.split()` calls (`App.tsx:371`, `App.tsx:4267`) operate on **ZIP archive internal paths**,
  which are `/`-separated by the ZIP spec itself regardless of host OS, not filesystem paths;
  `App.tsx:5795` already splits on both `/` and `\`.
- Hardcoded `/` path concatenation in Rust: zero — every path build in `src-tauri/src/*.rs` goes
  through `PathBuf::join`, which is separator-correct per-platform. (`fa_onnx.rs`'s few
  `format!("{...}.work-phase4/replay/{corpus}/...")` calls are `#[cfg(test)]`-only fixture
  loaders, not shipped runtime code.)

**Export-path exposure:** every unguarded `fetch(asset.url)` above except the two dev-only ones
sits on the export path (legacy canvas pipeline, WebCodecs pipeline, or both), not just sync — if
the Fetch-vs-blob: hypothesis in A4 is correct, Windows export of any project could be similarly
exposed. Not verified this session (export was outside the operator's reported failure and is not
authorized for a code change here).

## Deviation from the operator's C1 spec

Section 5 (Proof) asked for "a regression test for the resolution logic covering Windows-style
inputs (drive letter, backslashes, spaces, non-ASCII) and POSIX inputs." Per A3 above, the
confirmed root cause has **no filesystem-path-resolution component at all** — `asset.url` is
always an opaque `blob:` object-URL token, never a path string. Building a test around
drive-letter/backslash/UNC/non-ASCII *path* inputs would not exercise the actual code changed and
would misrepresent what was verified. The regression test actually written
(`src/hooks/useWhisper.test.ts`) instead locks the real mechanism: `fetchAndDetectSilences` must
prefer `asset.file` and never call `fetch()` when a `File` is already in memory, falling back to
`fetch(asset.url)` only when `.file` is absent — confirmed to fail against the pre-fix code (3 of
4 cases: the export didn't exist, and the fetch-avoidance assertion failed) and pass after
(`git stash`/`git stash pop` bisection, see this session's commit message for the exact command
output). Flagging this explicitly rather than silently substituting the test shape, per the
evidence rules ("a wrong confident answer here costs another build cycle").

## B3 — Windows onnxruntime provisioning: scoped plan (not built this session)

Not authorized this session (operator instruction: "Do NOT provision Windows onnxruntime... and
do NOT touch the `fa_onnx.rs` platform gate"). Sizing only.

**Current state:** `fa_onnx.rs:319`'s `resolve_bundled_ort_dylib` hard-gates on
`cfg!(all(target_os = "macos", target_arch = "x86_64"))` — every other target, including **macOS
arm64** (Q1 confirms the operator's own dev Mac is Intel, so this has never been exercised
locally either), fails loudly by design. `build.yml`'s macOS leg builds `universal-apple-darwin`
(a fat binary covering both Intel and Apple Silicon) but its ORT provisioning step
(`build.yml:124-148`) fetches only `onnxruntime-osx-x86_64-1.23.2.tgz` — an x86_64-only dylib. So
**Apple Silicon Macs are affected today, independent of Windows**: the universal binary runs, but
`ensure_ort_dylib` will refuse to load an x86_64 dylib process running under arm64's own Rosetta
translation is a separate question the gate doesn't even reach — the `target_arch` check trips
first for a native arm64 build, and CI never produces one to test against.

**What full Windows + arm64 provisioning costs:**

1. **Windows DLL provisioning** (mirrors the existing macOS recipe, `build.yml:124-148` /
   `src-tauri/onnxruntime/README.md`): fetch
   `onnxruntime-win-x64-1.23.2.zip` from the same GitHub release, extract `onnxruntime.dll`
   (not `.dylib`), sha256-gate it against a new committed manifest entry, wire it into
   `build.yml`'s Windows leg (`matrix.os == 'windows-latest'`, alongside the existing
   `if: matrix.os == 'windows-latest'` steps at lines 165/175/224). `tauri.conf.json`'s
   `bundle.resources` already maps `onnxruntime/*` generically — no change needed there once the
   file exists at that path.
2. **Generalize the `fa_onnx.rs:319` gate**: replace the single hard-coded
   `(macos, x86_64)` tuple with a per-`(os, arch)` table (mirroring
   `onnxruntime.manifest.json`'s existing `os`/`arch` fields, which are already structured for
   this — just not yet consulted for more than one platform), each entry naming its own
   `filename`/`sha256`/`sizeBytes`. `onnxruntimeBundle.guard.test.ts` (its own `apiVersion`/
   `minorVersion` check) generalizes the same way — per-manifest-entry, not per-file.
3. **macOS arm64 slice**: either (a) provision a second, arm64-specific dylib and lipo/thin the
   universal binary's resource bundling so each arch's build picks its own file, or (b) provision
   a universal (`lipo`-merged) onnxruntime dylib if Microsoft ships one — needs checking against
   the 1.23.2 release assets; not confirmed this session either way.
4. **Verification**: a Windows CI leg producing FA-executes-end-to-end evidence (the existing
   `[CLAIM-UNVERIFIED]` WIP item already asks for this on the current x86_64-only gate — it grows
   to cover the new platforms too), plus the same live-run confirmation on a real arm64 Mac (no
   arm64 hardware available in any session to date, per `docs/history.md`'s repeated
   "macOS arm64... unverified" notes across the WebGL2/WebCodecs feasibility work).

Rough sizing: step 1 (Windows DLL + CI wiring + manifest) is a same-shape repeat of the already-
shipped macOS x86_64 work (WS2 bug 2, `docs/history-2.md`'s `d8baef5` entry) — comparable size.
Step 2 (generalizing the gate) is small and mechanical once the manifest shape is decided. Step 3
(arm64) carries unknown cost until it's confirmed whether Microsoft ships an arm64 or universal
onnxruntime macOS binary for 1.23.2 — that lookup itself is out of this session's scope. None of
this is started; `Project.faHighPrecisionSync` stays capability-gated to fail clean (never a
crash) on every unprovisioned target in the meantime, on both Windows and Apple Silicon.
