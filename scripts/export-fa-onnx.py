#!/usr/bin/env python3
"""
export-fa-onnx.py — verified ONNX export for the five shipping FA models
(WS1, ruling R-Q). Formalizes the runtime spike's one-off English-only
export/verify pair (G4/G5,
docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md) into a
repeatable, per-language procedure covering all five: en, es, fr, de, pt.

WHAT THIS DOES
For a given --language, exports jonatasgrosman/wav2vec2-large-xlsr-53-<lang>
(Apache-2.0; barred MMS-FA alternative ruled out by Decision 3, R-Q) to ONNX,
then VERIFIES the export before declaring success: runs one forward pass
through both torch and onnxruntime on identical input and asserts the greedy
argmax path is identical — exactly the spike's G5 check
(.work-phase4/spike-runtime/g5_onnx_python_check.py's own comparison, not a
new methodology). If verification fails for a language, this script FAILS
for that language (nonzero exit for a single-language run; the failing
language is skipped, not silently accepted, under --all) rather than emit an
unverified model — a just-written .onnx file that fails verification is
deleted, not left behind looking like a successful export.

OUTPUT LOCATION (R-D)
Defaults to the same app_local_data_dir()/fa-models/<lang>/ convention the
Rust model resolver in src-tauri/src/fa.rs already expects — read directly
out of that file, not restated from memory:
  - fa.rs:194-207 (`fa_model_candidate_paths`) joins
    `<local_data_dir>/fa-models/<language_code>/<FA_MODEL_FILENAME_PLACEHOLDER>`
    as its first (managed/preferred) candidate.
  - fa.rs:232-233 (`fa_model_path`) resolves `local_data_dir` via
    `app.path().app_local_data_dir()`.
  - fa.rs:181 (`FA_MODEL_FILENAME_PLACEHOLDER = "model.bin"`) is explicitly a
    placeholder — "do not read meaning into '.bin' beyond 'some file'". This
    script writes `model.onnx` instead: the real filename for what it
    actually produces, in the same `fa-models/<lang>/` directory.
This script cannot call Tauri's own `app_local_data_dir()` (it isn't a Tauri
process), so it reproduces the same per-OS mapping Tauri's `dirs`-crate-based
resolver uses for this app's `identifier` (`com.kinetix.pro-studio`,
src-tauri/tauri.conf.json:5) — verified against this machine's own macOS
result, not assumed for the other two platforms. Override with --output-dir
when the default doesn't match your platform/Tauri version.

REFUSES to write into src-tauri/models/ (the whisper model's bundle-glob
location, tauri.conf.json's `resources` map — FA models are not part of that
glob) — fails loudly and does not write anything if --output-dir resolves
there.

This script and its manifest (scripts/fixtures/fa-onnx-manifest.json) are
groundwork only for a later step (Step T) — NO model weights are committed
by either, and this is explicitly NOT a download subsystem: it exports to a
local directory for local use, and the manifest records only hashes and
provenance metadata, not the weights themselves.

DEPENDENCIES (not stdlib; matches measure-forced-alignment-hf.py's pins,
installed into the existing .venv-phase4-fa venv on this machine)
torch==2.2.2, torchaudio==2.2.2 (last macOS x86_64/Intel wheels — already
pinned in .venv-phase4-fa), transformers==4.40.2 (a version still compatible
with torch 2.2.2 — an unpinned `pip install transformers` resolves 5.x,
which silently disables its own PyTorch backend since it requires
torch>=2.4; same caveat measure-forced-alignment-hf.py already documented),
onnx==1.16.2 (torch 2.2.2's TorchScript-based exporter needs the `onnx`
package installed to serialize the graph), onnxruntime==1.19.2 (Python CPU
execution provider, used only for this script's own verification pass — an
unrelated constraint from the runtime spike's finding that no onnxruntime
distribution exists for `ort`'s Rust-side macOS x86_64 target at any version
>=1.24, ruling R-M; that blocks native Rust inference, not this offline
Python export/verify step), soundfile (reads the verification WAV),
huggingface_hub (resolves each model's source revision/commit sha).

USAGE
  .venv-phase4-fa/bin/python3 scripts/export-fa-onnx.py --language en
  .venv-phase4-fa/bin/python3 scripts/export-fa-onnx.py --all \\
      --manifest-out scripts/fixtures/fa-onnx-manifest.json
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# src-tauri/tauri.conf.json:5 — "identifier": "com.kinetix.pro-studio"
APP_IDENTIFIER = "com.kinetix.pro-studio"

# jonatasgrosman publishes one Apache-2.0 fine-tune per language, all the
# same Wav2Vec2ForCTC architecture (R-Q).
REPO_IDS = {
    "en": "jonatasgrosman/wav2vec2-large-xlsr-53-english",
    "es": "jonatasgrosman/wav2vec2-large-xlsr-53-spanish",
    "fr": "jonatasgrosman/wav2vec2-large-xlsr-53-french",
    "de": "jonatasgrosman/wav2vec2-large-xlsr-53-german",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
}

# Same local-weights-first fallback the runtime spike's own G1/G4/G5 scripts
# used (e.g. g1_lang_check.py: "load_source = local_dir if has_local_weights
# else repo_id") — if a language's weights already exist on disk from a prior
# run, load them directly instead of hitting the network. Gitignored scratch
# location, so a fresh checkout with nothing here simply falls back to
# `repo_id` (hub cache, or a real download) unaffected.
SPIKE_LOCAL_MODELS_DIR = REPO_ROOT / ".work-phase4" / "spike-runtime" / "models"
LANG_FULL_NAMES = {
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "de": "german",
    "pt": "portuguese",
}

# Committed, real (not silence/synthetic) audio — the same clip the runtime
# spike's own G5 fidelity check used. Reused across all five languages
# deliberately: this check verifies the ONNX graph reproduces the SAME
# per-frame computation as the torch graph for identical input, a numerical
# equivalence property of the exporter, not a transcription-accuracy claim —
# the audio's language does not need to match the model under test, the same
# shortcut the spike's own g1_lang_check.py took reusing one Spanish clip
# across es/fr/de/pt sanity checks.
DEFAULT_VERIFY_AUDIO = (
    REPO_ROOT
    / "docs/ws1-sync-pipeline/measurements/rescued-2026-08-07-model-p-park"
    / "work-phase4/step-x-clips/C05_v6_it_trailing_word.wav"
)

FORBIDDEN_OUTPUT_DIR = (REPO_ROOT / "src-tauri" / "models").resolve()

TARGET_SAMPLE_RATE = 16000
VERIFY_INPUT_SAMPLES = 16000  # 1.0s @ 16kHz, matching the spike's own dummy/verify shape


def default_app_local_data_dir() -> Path:
    """Reproduces Tauri's app_local_data_dir() mapping for this app's
    identifier on the current OS — this script is not a Tauri process, so it
    cannot call the real resolver; verified against this dev machine's own
    macOS result rather than assumed for the other two platforms."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_IDENTIFIER
    if sys.platform.startswith("linux"):
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
        return base / APP_IDENTIFIER
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / APP_IDENTIFIER
    raise RuntimeError(
        f"no app_local_data_dir mapping for platform {sys.platform!r} — pass --output-dir explicitly"
    )


def default_fa_models_dir() -> Path:
    return default_app_local_data_dir() / "fa-models"


def refuse_if_bundle_glob(output_dir: Path) -> None:
    resolved = output_dir.resolve()
    if resolved == FORBIDDEN_OUTPUT_DIR or FORBIDDEN_OUTPUT_DIR in resolved.parents:
        raise SystemExit(
            f"refusing to write into {resolved} — that is src-tauri/models/, the whisper "
            "model's bundle-glob location (tauri.conf.json's `resources` map). FA models "
            "are not part of that glob; pass a different --output-dir."
        )


def resolve_load_source(language: str) -> str:
    local_dir = SPIKE_LOCAL_MODELS_DIR / LANG_FULL_NAMES[language]
    has_local_weights = (local_dir / "pytorch_model.bin").exists() or (local_dir / "model.safetensors").exists()
    return str(local_dir) if has_local_weights else REPO_IDS[language]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_verify_audio(audio_path: Path):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    audio, sr = sf.read(str(audio_path), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SAMPLE_RATE:
        wav = torch.from_numpy(audio).unsqueeze(0)
        wav = torchaudio.functional.resample(wav, sr, TARGET_SAMPLE_RATE)
        audio = wav.squeeze(0).numpy()
        sr = TARGET_SAMPLE_RATE
    if len(audio) < VERIFY_INPUT_SAMPLES:
        audio = np.pad(audio, (0, VERIFY_INPUT_SAMPLES - len(audio)))
    else:
        audio = audio[:VERIFY_INPUT_SAMPLES]
    return audio, sr


def export_and_verify(
    language: str,
    output_dir: Path,
    opset: int,
    verify_audio_path: Path,
    model_filename: str = "model.onnx",
) -> dict:
    import numpy as np
    import torch
    import torchaudio
    from huggingface_hub import HfApi
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    refuse_if_bundle_glob(output_dir)
    repo_id = REPO_IDS[language]
    load_source = resolve_load_source(language)

    result = {
        "language": language,
        "repo_id": repo_id,
        "load_source": load_source,
        "opset": opset,
        "torch_version": torch.__version__,
        "torchaudio_version": torchaudio.__version__,
    }

    try:
        revision = HfApi().model_info(repo_id).sha
    except Exception as e:  # network hiccup shouldn't hide behind a generic export failure
        revision = None
        result["revision_lookup_error"] = repr(e)
    result["revision"] = revision

    t_load = time.time()
    processor = Wav2Vec2Processor.from_pretrained(load_source)
    model = Wav2Vec2ForCTC.from_pretrained(load_source)
    model.eval()
    result["load_sec"] = round(time.time() - t_load, 2)

    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = output_dir / model_filename

    dummy_input = torch.randn(1, VERIFY_INPUT_SAMPLES, dtype=torch.float32)
    t_export = time.time()
    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_path),
        input_names=["input_values"],
        output_names=["logits"],
        dynamic_axes={
            "input_values": {0: "batch", 1: "sequence"},
            "logits": {0: "batch", 1: "frames"},
        },
        opset_version=opset,
    )
    result["export_sec"] = round(time.time() - t_export, 2)
    result["export_wall_clock_sec"] = round(result["load_sec"] + result["export_sec"], 2)

    # --- Verify: identical input through torch and onnxruntime, greedy argmax must match (G5) ---
    import onnxruntime as ort

    audio, sr = load_verify_audio(verify_audio_path)
    inputs = processor(audio, sampling_rate=sr, return_tensors="pt")
    with torch.no_grad():
        torch_logits = model(inputs.input_values).logits.numpy()  # (1, T, C)

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    onnx_logits = sess.run(None, {"input_values": inputs.input_values.numpy()})[0]

    t = torch_logits.squeeze(0)
    o = onnx_logits.squeeze(0)
    if t.shape != o.shape:
        onnx_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"{language}: torch/onnx logits shape mismatch {t.shape} vs {o.shape} — "
            "export not verified, .onnx file removed"
        )

    diff = np.abs(t - o)
    torch_argmax = t.argmax(axis=-1)
    onnx_argmax = o.argmax(axis=-1)
    n_mismatch = int((torch_argmax != onnx_argmax).sum())

    result["fidelity"] = {
        "max_abs_diff": float(diff.max()),
        "p95_abs_diff": float(np.percentile(diff, 95)),
        "argmax_path_identical": bool(n_mismatch == 0),
        "n_argmax_frame_mismatches": n_mismatch,
        "total_frames": int(t.shape[0]),
    }

    if n_mismatch != 0:
        onnx_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"{language}: greedy argmax path differs between torch and onnxruntime "
            f"({n_mismatch}/{t.shape[0]} frames) — export not verified, .onnx file removed"
        )

    result["output_path"] = str(onnx_path)
    result["byte_size"] = onnx_path.stat().st_size
    result["sha256"] = sha256_of(onnx_path)
    return result


def cmd_export(args) -> int:
    languages = list(REPO_IDS.keys()) if args.all else [args.language]
    verify_audio_path = Path(args.verify_audio) if args.verify_audio else DEFAULT_VERIFY_AUDIO
    if not verify_audio_path.exists():
        raise SystemExit(f"verification audio not found: {verify_audio_path}")

    # --output-dir, if given, is the base "fa-models"-equivalent root — the
    # per-language subdirectory is always appended, so --all never collides
    # every language's export into one directory.
    fa_models_dir = Path(args.output_dir) if args.output_dir else default_fa_models_dir()

    results = []
    failures = []
    for lang in languages:
        output_dir = fa_models_dir / lang
        print(f"=== {lang}: {REPO_IDS[lang]} -> {output_dir} ===", file=sys.stderr)
        try:
            r = export_and_verify(lang, output_dir, args.opset, verify_audio_path)
            results.append(r)
            print(json.dumps(r, indent=2))
        except Exception as e:
            print(f"FAILED ({lang}): {e}", file=sys.stderr)
            failures.append({"language": lang, "error": str(e)})
            if not args.all:
                raise

    if args.manifest_out and results:
        update_manifest(Path(args.manifest_out), results)

    summary = {"succeeded": [r["language"] for r in results], "failed": failures}
    print(json.dumps(summary, indent=2), file=sys.stderr)
    return 1 if failures else 0


def update_manifest(manifest_path: Path, results: list) -> None:
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest.setdefault("_provenance", {
        "generatedBy": "scripts/export-fa-onnx.py",
        "note": "Hashes and provenance only — no model weights committed. Consumed by Step T (deferred).",
    })
    manifest.setdefault("models", {})
    for r in results:
        manifest["models"][r["language"]] = {
            "repoId": r["repo_id"],
            "revision": r["revision"],
            "opset": r["opset"],
            "byteSize": r["byte_size"],
            "sha256": r["sha256"],
            "torchVersion": r["torch_version"],
            "torchaudioVersion": r["torchaudio_version"],
            "fidelity": r["fidelity"],
        }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"-> {manifest_path}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--language", choices=sorted(REPO_IDS.keys()), help="export a single language")
    group.add_argument("--all", action="store_true", help="export all five languages, continuing past a per-language failure")
    p.add_argument("--output-dir", default=None,
                    help="base directory standing in for app_local_data_dir()/fa-models/ — this language's model.onnx is written to <output-dir>/<lang>/; defaults to the real R-D convention (see module docstring)")
    p.add_argument("--opset", type=int, default=14, help="ONNX opset version (matches the runtime spike's G4 export)")
    p.add_argument("--verify-audio", default=None,
                    help=f"real WAV used for the torch-vs-onnxruntime fidelity check; defaults to the committed {DEFAULT_VERIFY_AUDIO.relative_to(REPO_ROOT)}")
    p.add_argument("--manifest-out", default=None,
                    help="path to a JSON manifest to create/update with this run's provenance (e.g. scripts/fixtures/fa-onnx-manifest.json)")
    p.set_defaults(func=cmd_export)
    return p


def main():
    args = build_parser().parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
