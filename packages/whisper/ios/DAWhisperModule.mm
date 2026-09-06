#import "DAWhisperModule.h"
#import <DAWhisperSpec/DAWhisperSpec.h>
#include "whisper.h"
#include <TargetConditionals.h>
#include <algorithm>
#include <string>
#include <vector>

// Ported from WorkFromCar's WFCWhisperModule with a few efficiency tweaks:
//  - flash attention on the Metal backend
//  - thread count derived from the device's core count instead of a fixed 8
//  - single_segment / no_context / suppress_nst for short command-style utterances
//  - optional initial_prompt (vocabulary priming) settable from JS
//  - PCM conversion done once in native code via std::vector (no NSNumber boxing on the hot path
//    beyond what the bridge already imposes)

@interface DAWhisperModule () <NativeWhisperSpec>
@end

@implementation DAWhisperModule {
  struct whisper_context *_ctx;
  struct whisper_vad_context *_vctx;
  std::string _vocabulary;
  dispatch_queue_t _sttQueue;
  dispatch_queue_t _vadQueue;
}

RCT_EXPORT_MODULE(DAWhisper)

- (instancetype)init {
  if ((self = [super init])) {
    _sttQueue = dispatch_queue_create("app.drivingassistant.whisper.stt", DISPATCH_QUEUE_SERIAL);
    _vadQueue = dispatch_queue_create("app.drivingassistant.whisper.vad", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)dealloc {
  if (_ctx) whisper_free(_ctx);
  if (_vctx) whisper_vad_free(_vctx);
}

static int DAWhisperThreadCount(void) {
  NSInteger cores = [[NSProcessInfo processInfo] activeProcessorCount];
  // Leave headroom for the audio thread + UI; whisper scales poorly past ~6 threads on phones.
  return (int)std::max<NSInteger>(2, std::min<NSInteger>(cores - 1, 6));
}

static std::vector<float> DAWhisperToFloat(NSArray<NSNumber *> *pcm) {
  std::vector<float> out;
  out.resize(pcm.count);
  NSUInteger i = 0;
  for (NSNumber *n in pcm) {
    out[i++] = n.floatValue / 32768.0f;
  }
  return out;
}

- (void)loadModel:(NSString *)modelPath
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_sttQueue, ^{
    struct whisper_context_params params = whisper_context_default_params();
#if TARGET_OS_SIMULATOR
    // The simulator's Metal driver (MTLSimDriver) traps in ggml_metal_buffer_set_tensor; run on CPU there.
    params.use_gpu = false;
    params.flash_attn = false;
#else
    params.use_gpu = true;
    params.flash_attn = true;
#endif
    struct whisper_context *ctx = whisper_init_from_file_with_params(modelPath.UTF8String, params);
    if (ctx == NULL) {
      reject(@"load_failed", [NSString stringWithFormat:@"whisper_init_from_file returned NULL for %@", modelPath], nil);
      return;
    }
    if (self->_ctx) whisper_free(self->_ctx);
    self->_ctx = ctx;
    NSLog(@"[DAWhisper] model loaded: %@ (threads=%d)", modelPath.lastPathComponent, DAWhisperThreadCount());
    resolve(@YES);
  });
}

- (void)setVocabulary:(NSString *)prompt
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_sttQueue, ^{
    self->_vocabulary = std::string(prompt.UTF8String ?: "");
    resolve(nil);
  });
}

- (void)pcmBufferToText:(NSArray<NSNumber *> *)pcmBuffer
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_sttQueue, ^{
    if (self->_ctx == NULL) {
      reject(@"NO_MODEL", @"You need to load the model first", nil);
      return;
    }
    if (pcmBuffer.count == 0) {
      resolve(@"");
      return;
    }

    std::vector<float> buffer = DAWhisperToFloat(pcmBuffer);

    struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wparams.print_progress = false;
    wparams.print_timestamps = false;
    wparams.print_special = false;
    wparams.print_realtime = false;
    wparams.language = "en";
    wparams.translate = false;
    wparams.no_timestamps = true;
    wparams.single_segment = true;   // one utterance per call
    wparams.no_context = true;       // never condition on the previous command
    wparams.suppress_blank = true;
    wparams.suppress_nst = true;     // drop non-speech tokens like (music), [BLANK_AUDIO]
    wparams.temperature_inc = 0.0f;  // no fallback sampling; keeps latency bounded
    wparams.n_threads = DAWhisperThreadCount();
    if (!self->_vocabulary.empty()) {
      wparams.initial_prompt = self->_vocabulary.c_str();
    }

    CFAbsoluteTime t0 = CFAbsoluteTimeGetCurrent();
    int rc = whisper_full(self->_ctx, wparams, buffer.data(), (int)buffer.size());
    if (rc != 0) {
      reject(@"WHISPER_ERROR", [NSString stringWithFormat:@"whisper_full returned %d", rc], nil);
      return;
    }

    int nSegments = whisper_full_n_segments(self->_ctx);
    NSMutableString *transcription = [NSMutableString string];
    for (int i = 0; i < nSegments; i++) {
      const char *segmentText = whisper_full_get_segment_text(self->_ctx, i);
      if (segmentText == NULL) continue;
      NSString *s = [NSString stringWithUTF8String:segmentText];
      if (s == nil) continue;
      [transcription appendString:s];
    }
    NSString *trimmed = [transcription stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    double audioMs = 1000.0 * (double)buffer.size() / 16000.0;
    double wallMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000.0;
    NSLog(@"[DAWhisper][Benchmark] audio_ms=%.0f decode_ms=%.0f rtf=%.3f text=\"%@\"",
          audioMs, wallMs, audioMs > 0 ? wallMs / audioMs : -1, trimmed);
    resolve(trimmed);
  });
}

- (void)initVad:(NSString *)vadPath
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_vadQueue, ^{
    struct whisper_vad_context_params vparams = whisper_vad_default_context_params();
    vparams.n_threads = 2;
    vparams.use_gpu = false; // Silero is tiny; CPU avoids Metal contention with the STT model
    struct whisper_vad_context *vctx = whisper_vad_init_from_file_with_params(vadPath.UTF8String, vparams);
    if (vctx == NULL) {
      reject(@"VAD_INIT_ERROR", @"whisper_vad_init_from_file_with_params returned NULL", nil);
      return;
    }
    if (self->_vctx) whisper_vad_free(self->_vctx);
    self->_vctx = vctx;
    NSLog(@"[DAWhisper] VAD initialized");
    resolve(@YES);
  });
}

- (void)vadProcessBuffer:(NSArray<NSNumber *> *)pcmBuffer
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_vadQueue, ^{
    if (self->_vctx == NULL) {
      reject(@"VAD_NOT_INITIALIZED", @"VAD not initialized", nil);
      return;
    }
    std::vector<float> buffer = DAWhisperToFloat(pcmBuffer);
    bool isSpeech = whisper_vad_detect_speech(self->_vctx, buffer.data(), (int)buffer.size());
    float prob = 0.0f;
    const int nProbs = whisper_vad_n_probs(self->_vctx);
    const float *probs = whisper_vad_probs(self->_vctx);
    if (nProbs > 0 && probs) prob = probs[nProbs - 1];
    resolve(@{ @"isSpeech": @(isSpeech), @"prob": @(prob) });
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeWhisperSpecJSI>(params);
}

@end
