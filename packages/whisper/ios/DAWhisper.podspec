require "json"

# whisper.cpp (STT + Silero VAD) as a React Native TurboModule.
#
# Compared to WorkFromCar's podspec this builds BOTH an iphoneos (arm64) and an
# iphonesimulator (arm64) static library and packages them as an xcframework so
# the app runs in the simulator as well as on device. The build is cached under
# ios/build-* and only re-runs when the directory is missing or DA_WHISPER_REBUILD=1.
Pod::Spec.new do |s|
  s.name = "DAWhisper"
  s.version = "1.0.0"
  s.summary = "whisper.cpp TurboModule for React Native (STT + VAD)"
  s.homepage = "https://github.com/coloshword/driving-assistant"
  s.license = { :type => "MIT" }
  s.author = "coloshword"
  s.platform = :ios, "15.1"
  s.source = { :path => "." }

  s.dependency "React-Codegen"
  s.dependency "ReactCommon/turbomodule/core"
  s.dependency "React-NativeModulesApple"
  s.dependency "React-Fabric"

  s.source_files = "DAWhisperModule.{h,mm}"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "OTHER_CPLUSPLUSFLAGS" => "$(inherited) -DGGML_USE_METAL=1",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/../../../app/ios/third_party/whisper.cpp/include\"",
      "\"$(PODS_TARGET_SRCROOT)/../../../app/ios/third_party/whisper.cpp/ggml/include\"",
      "\"$(PODS_ROOT)/Headers/Public/ReactCodegen\"",
      "\"$(PODS_ROOT)/Headers/Public/React-NativeModulesApple\"",
      "\"$(PODS_ROOT)/Headers/Private/React-NativeModulesApple\""
    ].join(" ")
  }

  s.frameworks = ["Accelerate", "Metal", "MetalKit", "Foundation"]

  s.prepare_command = "bash ../../../scripts/build-whisper.sh"

  s.vendored_frameworks = "whisper.xcframework"
end
