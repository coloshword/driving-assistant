require "json"

# Kokoro TTS via sherpa-onnx as a React Native TurboModule.
# sherpa-onnx.xcframework (device + simulator slices) is fetched by
# scripts/fetch-models.sh into this directory; it is not committed.
Pod::Spec.new do |s|
  s.name         = "DAKokoro"
  s.version      = "1.0.0"
  s.summary      = "Kokoro TTS TurboModule for React Native via sherpa-onnx"
  s.homepage     = "https://github.com/coloshword/driving-assistant"
  s.license      = { :type => "Apache-2.0" }
  s.author       = "coloshword"
  s.platform     = :ios, "15.1"
  s.source       = { :path => "." }

  s.source_files = "DAKokoroModule.{h,mm}"

  s.vendored_frameworks = "sherpa-onnx.xcframework"

  s.frameworks = ["AVFoundation", "Foundation"]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/sherpa-onnx.xcframework/ios-arm64/Headers\"",
      "\"$(PODS_ROOT)/Headers/Public/ReactCodegen\"",
      "\"$(PODS_ROOT)/Headers/Public/React-NativeModulesApple\"",
      "\"$(PODS_ROOT)/Headers/Private/React-NativeModulesApple\""
    ].join(" ")
  }

  s.dependency "React-Codegen"
  s.dependency "ReactCommon/turbomodule/core"
  s.dependency "React-NativeModulesApple"
  s.dependency "React-Fabric"
  s.dependency "onnxruntime-c", "~> 1.19.0"
end
