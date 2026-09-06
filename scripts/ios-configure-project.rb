#!/usr/bin/env ruby
# Idempotently wires the Xcode project:
#  - adds app/ios/Models/{whisper, vad, kokoro dir} as bundle resources
#  - sets bundle id / team / deployment target
# Run via: npm run ios:configure  (uses the Ruby that ships with Homebrew CocoaPods)
require 'xcodeproj'

root = File.expand_path('..', __dir__)
proj_path = File.join(root, 'app/ios/DrivingAssistant.xcodeproj')
project = Xcodeproj::Project.open(proj_path)
target = project.targets.find { |t| t.name == 'DrivingAssistant' }
raise 'target not found' unless target

models_group = project.main_group.find_subpath('Models', true)
models_group.set_source_tree('<group>')
models_group.set_path('Models')

resources = [
  ['ggml-tiny.en-q5_1.bin', 'archive.macbinary'],
  ['ggml-base.en-q5_1.bin', 'archive.macbinary'],
  ['ggml-silero-v6.2.0.bin', 'archive.macbinary'],
  ['sherpa-onnx-kokoro-en-v0_19', 'folder'],
  ['sherpa-onnx-kokoro-int8-en-v0_19', 'folder'],
]

resources.each do |name, type|
  existing = models_group.files.find { |f| f.path == name }
  present = File.exist?(File.join(root, 'app/ios/Models', name))
  unless present
    # optional model not downloaded: make sure a stale reference does not break the build
    if existing
      target.resources_build_phase.files.select { |bf| bf.file_ref == existing }.each(&:remove_from_project)
      existing.remove_from_project
      puts "resource: #{name} (removed, file missing)"
    else
      puts "resource: #{name} (skipped, file missing)"
    end
    next
  end
  ref = existing || models_group.new_reference(name)
  ref.last_known_file_type = type
  ref.source_tree = '<group>'
  already = target.resources_build_phase.files.any? { |bf| bf.file_ref == ref }
  target.resources_build_phase.add_file_reference(ref, true) unless already
  puts "resource: #{name} #{already ? '(present)' : '(added)'}"
end

target.build_configurations.each do |cfg|
  cfg.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.coloshword.drivingassistant'
  cfg.build_settings['DEVELOPMENT_TEAM'] = ENV.fetch('DA_DEVELOPMENT_TEAM', '4MXL258KK7')
  cfg.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
  cfg.build_settings['MARKETING_VERSION'] = '0.1.0'
  cfg.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
end

project.save
puts "saved #{proj_path}"
