#!/usr/bin/env bash
# Downloads the on-device models and the sherpa-onnx xcframework.
#
#   scripts/fetch-models.sh                 # tiny.en whisper + silero VAD + kokoro v0.19 + sherpa-onnx
#   scripts/fetch-models.sh --whisper base  # also grab base.en (more accurate, ~2x slower)
#   scripts/fetch-models.sh --from /path/to/work_from_car   # copy from a local WorkFromCar checkout instead of downloading
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="${ROOT}/app/ios/Models"
KOKORO_POD="${ROOT}/packages/kokoro/ios"
SHERPA_VERSION="${SHERPA_VERSION:-1.12.15}"
WHISPER_EXTRA=""
FROM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --whisper) WHISPER_EXTRA="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done

mkdir -p "${MODELS}"

dl() { # url dest
  if [ -f "$2" ]; then echo "  have $(basename "$2")"; return; fi
  echo "  fetching $(basename "$2")"
  curl -fL --progress-bar "$1" -o "$2.part" && mv "$2.part" "$2"
}

if [ -n "${FROM}" ]; then
  echo "[fetch-models] copying from ${FROM}"
  cp -n "${FROM}/app/ios/Models/ggml-tiny.en-q5_1.bin" "${MODELS}/" 2>/dev/null || true
  cp -n "${FROM}/app/ios/Models/ggml-silero-v6.2.0.bin" "${MODELS}/" 2>/dev/null || true
  [ -d "${MODELS}/sherpa-onnx-kokoro-en-v0_19" ] || cp -R "${FROM}/app/ios/Models/sherpa-onnx-kokoro-en-v0_19" "${MODELS}/"
  [ -d "${KOKORO_POD}/sherpa-onnx.xcframework" ] || cp -R "${FROM}/app/ios/third_party/sherpa-onnx/sherpa-onnx.xcframework" "${KOKORO_POD}/"
  find "${MODELS}" -name .DS_Store -delete
  echo "[fetch-models] done"
  exit 0
fi

echo "[fetch-models] whisper"
dl "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin" "${MODELS}/ggml-tiny.en-q5_1.bin"
if [ "${WHISPER_EXTRA}" = "base" ]; then
  dl "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin" "${MODELS}/ggml-base.en-q5_1.bin"
fi

echo "[fetch-models] silero VAD"
dl "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin" "${MODELS}/ggml-silero-v6.2.0.bin"

echo "[fetch-models] kokoro v0.19 (sherpa-onnx packaging, includes espeak-ng-data)"
if [ ! -d "${MODELS}/sherpa-onnx-kokoro-en-v0_19" ]; then
  TMP="$(mktemp -d)"
  dl "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2" "${TMP}/kokoro.tar.bz2"
  tar -xjf "${TMP}/kokoro.tar.bz2" -C "${TMP}"
  mv "${TMP}/kokoro-en-v0_19" "${MODELS}/sherpa-onnx-kokoro-en-v0_19"
  rm -rf "${TMP}"
else
  echo "  have sherpa-onnx-kokoro-en-v0_19/"
fi

echo "[fetch-models] sherpa-onnx ${SHERPA_VERSION} ios xcframework"
if [ ! -d "${KOKORO_POD}/sherpa-onnx.xcframework" ]; then
  TMP="$(mktemp -d)"
  dl "https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-v${SHERPA_VERSION}-ios.tar.bz2" "${TMP}/sherpa.tar.bz2"
  tar -xjf "${TMP}/sherpa.tar.bz2" -C "${TMP}"
  FOUND="$(find "${TMP}" -type d -name 'sherpa-onnx.xcframework' | head -1)"
  [ -n "${FOUND}" ] || { echo "sherpa-onnx.xcframework not found in archive" >&2; exit 1; }
  mv "${FOUND}" "${KOKORO_POD}/sherpa-onnx.xcframework"
  rm -rf "${TMP}"
else
  echo "  have sherpa-onnx.xcframework"
fi

find "${MODELS}" -name .DS_Store -delete 2>/dev/null || true
echo "[fetch-models] done"
