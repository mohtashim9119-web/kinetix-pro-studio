# Runtime spike — forced-alignment (FA) native-runtime feasibility, 2026-08-11

**The spike code itself (`g1_lang_check.py`, `g2_romanization.py`, `g4_onnx_export.py`,
`g5_compare.py`, `g5_onnx_python_check.py`, `g5_torch_reference.py`, the `ort-spike`
Rust crate, the downloaded `onnxruntime-osx-x86_64-1.22.0` tarball, the wav2vec2
model weights, and the Python `venv`) was throwaway scratch work run from
`.work-phase4/spike-runtime/` (gitignored) and was **not** preserved — only the text
output captured below survives. Nothing here can be re-run without re-creating that
scratch environment.**

Findings feed WS1 rulings R-M and R-N (`project-state.md` §5) and the roadmap-fold
items in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`/`ws1-master-roadmap.md`.

---

## G1 — five-language load/inference feasibility (jonatasgrosman wav2vec2-large-xlsr-53)

**Command (per language):**
```
/usr/bin/time -l python g1_lang_check.py <lang> > g1_<lang>.json 2> g1_<lang>.time.txt
```
English loaded from the HF Hub cache (network-dominated load time); es/fr/de/pt loaded
from manually-placed local weight directories (`load_source: "local (manually placed)"`).

| Lang | Repo | Vocab size | Full vocab symbol set (beyond the shared 33 ASCII+special) | Head==vocab | On-disk bytes | Peak RSS | Frames/sec | Decoded sample |
|---|---|---|---|---|---|---|---|---|
| en | `jonatasgrosman/wav2vec2-large-xlsr-53-english` | 33 | `<pad> <s> </s> <unk> \| ' - a-z` (pure ASCII, no diacritics) | ✓ (33==33) | 1,261,944,910 | 3,456,167,936 B (3.22 GiB) | 49.714 (174 frames / 3.5s) | "ves on the other side of ityou fall asleep against he" |
| es | `jonatasgrosman/wav2vec2-large-xlsr-53-spanish` | 41 | +8: á é í ñ ó ö ú ü | ✓ (41==41) | 1,262,104,169 | 2,756,206,592 B (2.57 GiB) | 49.798 (148 frames / 2.972s) | "tes de llegar al zo aun así prepara suso" |
| fr | `jonatasgrosman/wav2vec2-large-xlsr-53-french` | 59 | +26: à á â ä ç è é ê ë í î ï ñ ó ô ö ù ú û ü ć č ō œ š ș | ✓ (59==59) | 1,262,178,141 | 2,756,186,112 B (2.57 GiB) | 49.798 (148 frames / 2.972s) | "ntèse de yegar alpsuco aunassi preparasu" |
| de | `jonatasgrosman/wav2vec2-large-xlsr-53-german` | 38 | +5: ä í ó ö ü (no ß) | ✓ (38==38) | 1,262,092,102 | 2,754,109,440 B (2.57 GiB) | 49.798 (148 frames / 2.972s) | "te der jäger deala pseuson aunasi preparasu" |
| pt | `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese` | 46 | +13: à á â ã ç é ê í ó ô õ ú ü | ✓ (46==46) | 1,262,125,010 | 2,756,747,264 B (2.57 GiB) | 49.798 (148 frames / 2.972s) | "ntes de lhegar a leposisão a ume assi prepara a su" |
| pt | | | | | | | | (native ã / lh digraph rendered correctly even though the source audio is a Spanish clip — proves tokenizer+forward-pass correctness, not transcription accuracy) |

`config.json` `vocab_size` matches `vocab.json` entry count exactly for all 5. All 5
share `conv_stride=[5,2,2,2,2,2,2]` (320x downsample at 16kHz = 20ms/frame = 50fps —
independently confirms the frame-rate assumption used elsewhere in the plan).
es/fr/de/pt load in 1.29–1.99s locally (representative real compute load time); en's
512.57s figure is network-download time, not representative.

**Peak RSS cross-check:** the Spanish 2.57 GiB figure nearly matches
`sync-pipeline-v2-plan.md`'s own prior Spanish jonatasgrosman measurement (N.2 table,
2.58 GiB).

### Per-language vocab letters destroyed by `textNormalize.ts`'s `canonicalize()` step 10 (`[^a-z0-9\s-]` → space)

| Lang | Destroyed / total non-ASCII-shared letters | Letters destroyed |
|---|---|---|
| es | 8/34 | á é í ñ ó ö ú ü |
| fr | 26/52 | à á â ä ç è é ê ë í î ï ñ ó ô ö ù ú û ü ć č ō œ š ș |
| de | 5/31 | ä í ó ö ü |
| pt | 13/39 | à á â ã ç é ê í ó ô õ ú ü |

(Denominator = that language's `vocab_size` minus the 7 shared special/ASCII-punctuation
symbols `<pad> <s> </s> <unk> | ' -`; en excluded, its vocab is pure ASCII already.)

---

## G2 — uroman vs. naive-lowercase-keep-in-vocab disagreement

**Command:** `python g2_romanization.py` (reads `cv-targets/<lang>.txt`, 300 real
Common Voice target sentences per language, writes `g2_results.json`).

| Lang | Sentences | Total words | Disagreeing words | Disagree % |
|---|---|---|---|---|
| en | 300 | 2,676 | 0 | 0.00% |
| es | 300 | 2,121 | 149 | 7.02% |
| fr | 300 | 2,714 | 382 | 14.08% |
| de | 300 | 2,329 | 163 | 7.00% |
| pt | 300 | 2,060 | 317 | 15.39% |

Sampled disagreements (all five follow the same pattern — uroman strips a diacritic the
model's own vocab natively contains):
- es: `qué`→`que`, `asomó`→`asomo`, `parecéis`→`pareceis`, `muchísimo`→`muchisimo`, `calló`→`callo`, `preferí`→`preferi`, `pájaros`→`pajaros`, `función`→`funcion`, `telón`→`telon`, `párpados`→`parpados`, `niño`→`nino`
- fr: `intéressant`→`interessant`, `être`→`etre`, `mené`→`mene`, `réforme`→`reforme`, `ça`→`sa`, `comité`→`comite`, `à`→`a`, `numéro`→`numero`, `jupitérien`→`jupiterien`, `expérience`→`experience`, `années`→`annees`
- de: `mückenstiche`→`mueckenstiche`, `für`→`fuer`, `rückgängig`→`rueckgaengig`, `können`→`koennen`, `ändern`→`aendern`, `gehören`→`gehoeren`, `sondermüll`→`sondermuell`, `wäre`→`waere`, `läuft`→`laeuft`, `schwäbisch`→`schwaebisch`
- pt: `graças`→`grasas`, `você`→`voce`, `está`→`esta`, `inovação`→`inovasao`, `estão`→`estao`, `começou`→`comesou`, `alguém`→`alguem`, `relação`→`relasao`, `alça`→`alsa`

**Verdict:** uroman is unnecessary — actively harmful if applied — for the
jonatasgrosman per-language-model path, since every disagreement is uroman throwing
away a diacritic the model's vocab expects natively. uroman only made sense for MMS-FA's
single shared romanized vocab (already rejected on license grounds, Decision 3). Same
underlying gap as G1's `canonicalize()` finding — two symptoms of one ASCII-only
text-handling root cause.

---

## G4 — `ort`/onnxruntime version-deadlock evidence

**Commands:**
```
python g4_onnx_export.py                     # ONNX export of the English model
cargo new ort-spike && cargo fetch            # ort-spike crate, isolated Cargo.toml,
                                               # not touching src-tauri/Cargo.toml
cargo build --release                         # default (auto-download prebuilt) path
ORT_DYLIB_PATH=<onnxruntime-1.22.0 dylib> cargo build --release --features load-dynamic
```

**ONNX export result** (`g4_export_result.json`): `load_sec: 4.54`, `export_ok: true`,
`export_sec: 24.98`, `onnx_size_bytes: 1,262,512,711` (~1.176 GiB — same float32 param
count as the source weights, just repackaged). Only cosmetic TracerWarnings.

**`ort` crate version:** no stable v2 release exists; only release candidates on
crates.io (tried up to `2.0.0-rc.13`). Must pin an exact prerelease
(`ort = "=2.0.0-rc.13"`), not a semver `^2` range.

**Default (auto-download prebuilt) build — FAILS on `x86_64-apple-darwin`:**
```
[ort-sys] [WARN] can't do xcframework linking for target 'x86_64-apple-darwin'
error: ort-sys@2.0.0-rc.13: no prebuilt binaries available for target x86_64-apple-darwin
```
`ort`'s xcframework covers `arm64-apple-darwin` (macOS + iOS) but not Intel macOS. This
project's own CI builds a universal `arm64+x86_64` binary via `lipo`
(`src-tauri`'s `build.yml`), and the spike machine itself is Intel x86_64 — so `ort`'s
default path cannot even be built/tested here, and cannot ship a universal binary as-is.
Build time to the link failure: 2:39 total (mostly registry/crate download, ~40s actual
compile).

**Load-dynamic workaround — builds, but hits a runtime version gate three ways:**

1. **`ort` 2.0.0-rc.13's own version gate** (`LoadError::BadVersion`), live error text:
   > `ort 2.0.0-rc.13 is not compatible... expected version >= '1.27.x', but got '1.22.0'`
2. **GitHub releases** — bisected: `onnxruntime` v1.22.0/v1.22.x is the *last* GitHub
   release shipping an `osx-x86_64` asset; v1.26.0 onward ships `osx-arm64` only. This is
   a macOS-Intel-specific drop — `win-x64` and `linux-x64` still ship x86_64 fine at
   v1.28.0 (latest).
3. **PyPI wheels** — `pip install onnxruntime` on this Intel Mac resolved to 1.23.2
   (pip's newest compatible); PyPI's actual latest (1.28.0) publishes macOS wheels for
   `arm64` only (cp311–cp314, `macosx_14_0_arm64`), zero x86_64 macOS wheel at any recent
   version.

**Conclusion:** as of this spike, no onnxruntime distribution (GitHub or PyPI) exists for
macOS x86_64 at any version ≥1.24, and the `ort` Rust crate requires ≥1.27 — an
unresolvable-without-a-source-build dead end for Intel Mac specifically. Mirrors
PyTorch's own documented macOS-x86_64 wheel drop (already noted in
`scripts/measure-forced-alignment.md`). Only remaining path: build onnxruntime from
source at ≥1.27 for `x86_64-apple-darwin` — bounded but nontrivial, same category of
work as the whisper.cpp from-source builds already in this project's CI. Not attempted
here (out of spike scope).

**Binary sizes:** `ort-spike` release binary (load-dynamic, no onnxruntime linked in) =
721,176 bytes (~700 KB, just `ort`'s Rust wrapper). The onnxruntime dylib itself
(v1.22.0, x86_64) = 37,411,816 bytes (~35.7 MiB) — a separate file, shipped alongside
like the ffmpeg/whisper-cli sidecars today, except `dlopen`'d in-process rather than
spawned as a subprocess. Static-link size (the cleanest reading of R-L) was not
measured — would need a from-source static onnxruntime build, out of spike scope.

---

## G5 — ONNX export fidelity

**Commands:**
```
python g5_torch_reference.py       # torch reference emission matrix, real audio input
python g5_onnx_python_check.py     # same input through Python onnxruntime 1.23.2 (CPU EP)
```
Validates the ONNX **export** itself (Python `onnxruntime` CPUExecutionProvider still
works on Intel Mac — only the Rust `ort` crate's version gate is the blocker; the Rust
binding path itself could not be exercised on this machine, see G4).

Input: 1.0s silence-padded English clip (C05), 16,000 samples. Emission shape
`(1, 49, 33)` (49 frames, 33-symbol vocab).

| Metric | Value |
|---|---|
| `max_abs_diff` | 0.000269 |
| `p95_abs_diff` | 0.0000635 |
| `argmax_path_identical` | `TRUE` (0/49 frame mismatches) |
| Frame count | 49 |

Both diff figures are float32 kernel noise. The ONNX graph export is fidelity-viable —
decoding-equivalent to torch, not merely close. Since `ort` links the same underlying
onnxruntime C API/kernels, a matching onnxruntime build on a platform where `ort` DOES
load (Windows x86_64, or Apple Silicon macOS at any current onnxruntime version) would be
expected to show the same fidelity — inferred from the shared C library, not directly
verified for the Rust binding path itself on this machine.
