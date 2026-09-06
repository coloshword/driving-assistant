# On-device models

Populated by `scripts/fetch-models.sh` (not committed):

| File | Purpose | Size |
|---|---|---|
| `ggml-tiny.en-q5_1.bin` | whisper.cpp speech-to-text (default, fastest) | 31 MB |
| `ggml-base.en-q5_1.bin` | whisper.cpp speech-to-text (optional, more accurate; `--whisper base`) | 57 MB |
| `ggml-silero-v6.2.0.bin` | Silero voice activity detection (via whisper.cpp) | 0.9 MB |
| `sherpa-onnx-kokoro-en-v0_19/` | Kokoro text-to-speech (model.onnx, voices.bin, tokens.txt, espeak-ng-data/) | 353 MB |

The Xcode project references these paths as bundle resources, so the files must exist before building.
