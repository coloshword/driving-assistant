#!/usr/bin/env bash
# Builds whisper.cpp (with Metal) for iphoneos + iphonesimulator and packages the
# result as packages/whisper/ios/whisper.xcframework. Invoked automatically by the
# DAWhisper podspec's prepare_command; safe to run by hand.
#
#   DA_WHISPER_REBUILD=1 scripts/build-whisper.sh   # force a rebuild
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="${ROOT}/app/ios/third_party/whisper.cpp"
POD_ROOT="${ROOT}/packages/whisper/ios"
OUT="${POD_ROOT}/whisper.xcframework"

if [ ! -f "${WHISPER_DIR}/CMakeLists.txt" ]; then
  echo "[build-whisper] whisper.cpp submodule missing; run: git submodule update --init --recursive" >&2
  exit 1
fi

if [ -d "${OUT}" ] && [ "${DA_WHISPER_REBUILD:-0}" != "1" ]; then
  echo "[build-whisper] using cached ${OUT} (set DA_WHISPER_REBUILD=1 to rebuild)"
  exit 0
fi

build_slice() {
  local sysroot="$1" archs="$2" dir="$3"
  rm -rf "${dir}"; mkdir -p "${dir}"
  cmake -S "${WHISPER_DIR}" -B "${dir}" \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT="${sysroot}" \
    -DCMAKE_OSX_ARCHITECTURES="${archs}" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=15.1 \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DGGML_METAL_USE_BF16=ON \
    -DGGML_OPENMP=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_EXAMPLES=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_SERVER=OFF
  cmake --build "${dir}" --config Release -j"$(sysctl -n hw.ncpu)"
  libtool -static -o "${dir}/libwhisper_all.a" \
    "${dir}/src/libwhisper.a" \
    "${dir}/ggml/src/libggml.a" \
    "${dir}/ggml/src/libggml-base.a" \
    "${dir}/ggml/src/libggml-cpu.a" \
    "${dir}/ggml/src/ggml-blas/libggml-blas.a" \
    "${dir}/ggml/src/ggml-metal/libggml-metal.a"
}

echo "[build-whisper] building iphoneos slice"
build_slice iphoneos arm64 "${POD_ROOT}/build-ios"
echo "[build-whisper] building iphonesimulator slice"
build_slice iphonesimulator arm64 "${POD_ROOT}/build-sim"

rm -rf "${OUT}"
xcodebuild -create-xcframework \
  -library "${POD_ROOT}/build-ios/libwhisper_all.a" -headers "${WHISPER_DIR}/include" \
  -library "${POD_ROOT}/build-sim/libwhisper_all.a" -headers "${WHISPER_DIR}/include" \
  -output "${OUT}"
echo "[build-whisper] built ${OUT}"
