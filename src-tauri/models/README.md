# Kinetix Pro Studio — Whisper Models

The model files in this directory are gitignored (too large for git).

## Re-provisioning

Download the base.en model:
```bash
curl -L -o src-tauri/models/ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
```

File: `ggml-base.en.bin` (~141 MB)
Source: https://huggingface.co/ggerganov/whisper.cpp

## Binary re-provisioning

See `src-tauri/binaries/README.md` for whisper-cli binary instructions.
