#import "DAKokoroModule.h"
#import <DAKokoroSpec/DAKokoroSpec.h>
#import <AVFoundation/AVFoundation.h>
#include <atomic>
#include "sherpa-onnx/c-api/c-api.h"

// Ported from WorkFromCar's WFCKokoroModule. Changes:
//  - configurable AVAudioSession (category/options) so music from other apps can keep
//    playing and duck while the assistant talks, and so the mic route survives TTS
//  - speakerId parameter (Kokoro ships ~11 voices in voices.bin)
//  - serial TTS queue instead of the global concurrent queue

@interface DAKokoroModule () <NativeKokoroSpec>
@end

typedef struct {
  __unsafe_unretained DAKokoroModule *module;
  int32_t sampleRate;
  double speakStartMs;
  int32_t chunkCount;
  int64_t chunkSamples;
} KokoroStreamContext;

@implementation DAKokoroModule {
  const SherpaOnnxOfflineTts *_tts;
  AVAudioEngine *_engine;
  AVAudioPlayerNode *_playerNode;
  AVAudioFormat *_streamFormat;
  std::atomic<bool> _stopRequested;
  std::atomic<bool> _playbackStarted;
  dispatch_queue_t _ttsQueue;

  // audio session config
  NSString *_category;
  BOOL _duckOthers;
  BOOL _mixWithOthers;
  BOOL _defaultToSpeaker;
  BOOL _allowBluetooth;
}

RCT_EXPORT_MODULE(DAKokoro)

static double KokoroNowMs(void) {
  return CFAbsoluteTimeGetCurrent() * 1000.0;
}

// Split text into short speakable segments. sherpa-onnx only streams audio per
// sentence, so a long sentence means a long wait before the first sound. We cut
// at sentence ends, and additionally at commas / semicolons when a sentence is
// longer than kMaxWordsPerSegment words, then synthesize the pieces back to back
// into the same audio queue.
static const NSInteger kMaxWordsPerSegment = 9;

static NSInteger KokoroWordCount(NSString *s) {
  NSArray *parts = [s componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSInteger n = 0;
  for (NSString *p in parts) if (p.length > 0) n++;
  return n;
}

static NSArray<NSString *> *KokoroSegment(NSString *text) {
  NSMutableArray<NSString *> *sentences = [NSMutableArray array];
  NSMutableString *cur = [NSMutableString string];
  for (NSUInteger i = 0; i < text.length; i++) {
    unichar c = [text characterAtIndex:i];
    [cur appendFormat:@"%C", c];
    if (c == '.' || c == '!' || c == '?' || c == '\n') {
      // don't split decimals like 3.5 or abbreviations like "p.m."
      BOOL nextIsSpace = (i + 1 >= text.length) || [[NSCharacterSet whitespaceAndNewlineCharacterSet] characterIsMember:[text characterAtIndex:i + 1]];
      if (nextIsSpace) {
        [sentences addObject:[cur copy]];
        [cur setString:@""];
      }
    }
  }
  if (cur.length) [sentences addObject:[cur copy]];

  NSMutableArray<NSString *> *out = [NSMutableArray array];
  NSCharacterSet *ws = [NSCharacterSet whitespaceAndNewlineCharacterSet];
  for (NSString *sentence in sentences) {
    NSString *trimmed = [sentence stringByTrimmingCharactersInSet:ws];
    if (trimmed.length == 0) continue;
    if (KokoroWordCount(trimmed) <= kMaxWordsPerSegment) {
      [out addObject:trimmed];
      continue;
    }
    // long sentence: cut at clause punctuation, greedily merging short clauses
    NSMutableString *clause = [NSMutableString string];
    for (NSUInteger i = 0; i < trimmed.length; i++) {
      unichar c = [trimmed characterAtIndex:i];
      [clause appendFormat:@"%C", c];
      if ((c == ',' || c == ';' || c == ':') && KokoroWordCount(clause) >= 4) {
        [out addObject:[[clause copy] stringByTrimmingCharactersInSet:ws]];
        [clause setString:@""];
      }
    }
    NSString *rest = [clause stringByTrimmingCharactersInSet:ws];
    if (rest.length) {
      // a dangling 1-2 word tail sounds odd on its own; glue it to the previous piece
      if (KokoroWordCount(rest) <= 2 && out.count && [out.lastObject hasSuffix:@","]) {
        out[out.count - 1] = [NSString stringWithFormat:@"%@ %@", out.lastObject, rest];
      } else {
        [out addObject:rest];
      }
    }
  }
  return out;
}

- (instancetype)init {
  if ((self = [super init])) {
    _ttsQueue = dispatch_queue_create("app.drivingassistant.kokoro", DISPATCH_QUEUE_SERIAL);
    _category = @"playAndRecord";
    _duckOthers = YES;
    _mixWithOthers = YES;
    _defaultToSpeaker = YES;
    _allowBluetooth = YES;
  }
  return self;
}

- (void)dealloc {
  if (_tts) SherpaOnnxDestroyOfflineTts(_tts);
}

- (void)loadModel:(NSString *)modelDir
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_ttsQueue, ^{
    if (self->_tts) {
      SherpaOnnxDestroyOfflineTts(self->_tts);
      self->_tts = NULL;
    }

    NSFileManager *fm = [NSFileManager defaultManager];
    for (NSString *f in @[@"voices.bin", @"tokens.txt", @"espeak-ng-data"]) {
      NSString *path = [modelDir stringByAppendingPathComponent:f];
      if (![fm fileExistsAtPath:path]) {
        reject(@"MISSING_FILE", [NSString stringWithFormat:@"Kokoro model file missing: %@", path], nil);
        return;
      }
    }
    // sherpa-onnx ships fp32 as model.onnx and the quantized variant as model.int8.onnx.
    NSString *modelPath = [modelDir stringByAppendingPathComponent:@"model.onnx"];
    if (![fm fileExistsAtPath:modelPath]) {
      modelPath = [modelDir stringByAppendingPathComponent:@"model.int8.onnx"];
    }
    if (![fm fileExistsAtPath:modelPath]) {
      reject(@"MISSING_FILE", [NSString stringWithFormat:@"No model.onnx / model.int8.onnx in %@", modelDir], nil);
      return;
    }

    NSString *voicesPath = [modelDir stringByAppendingPathComponent:@"voices.bin"];
    NSString *tokensPath = [modelDir stringByAppendingPathComponent:@"tokens.txt"];
    NSString *dataDir    = [modelDir stringByAppendingPathComponent:@"espeak-ng-data"];

    SherpaOnnxOfflineTtsKokoroModelConfig kokoro = {};
    kokoro.model    = modelPath.UTF8String;
    kokoro.voices   = voicesPath.UTF8String;
    kokoro.tokens   = tokensPath.UTF8String;
    kokoro.data_dir = dataDir.UTF8String;
    kokoro.length_scale = 1.0;

    SherpaOnnxOfflineTtsModelConfig model_cfg = {};
    model_cfg.kokoro = kokoro;
    NSInteger cores = [[NSProcessInfo processInfo] activeProcessorCount];
    model_cfg.num_threads = (int)MAX(2, MIN(cores - 2, 4));
    model_cfg.provider = "cpu";

    SherpaOnnxOfflineTtsConfig cfg = {};
    cfg.model = model_cfg;
    cfg.max_num_sentences = 1; // stream sentence-by-sentence for low time-to-first-audio

    double t0 = KokoroNowMs();
    self->_tts = SherpaOnnxCreateOfflineTts(&cfg);
    NSLog(@"[DAKokoro] load %@ in %.0f ms -> %s", modelDir.lastPathComponent, KokoroNowMs() - t0, self->_tts ? "ok" : "NULL");
    self->_tts ? resolve(@YES)
               : reject(@"load_failed", @"SherpaOnnxCreateOfflineTts returned NULL", nil);
  });
}

- (void)configureAudioSession:(JS::NativeKokoro::AudioSessionOptions &)options
                      resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject {
  NSString *category = options.category();
  BOOL duck = options.duckOthers();
  BOOL mix = options.mixWithOthers();
  BOOL spk = options.defaultToSpeaker();
  BOOL bt = options.allowBluetooth();
  dispatch_async(_ttsQueue, ^{
    self->_category = category ?: @"playAndRecord";
    self->_duckOthers = duck;
    self->_mixWithOthers = mix;
    self->_defaultToSpeaker = spk;
    self->_allowBluetooth = bt;
    resolve(nil);
  });
}

- (NSError *)activateAudioSession {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *err = nil;
  BOOL playAndRecord = [_category isEqualToString:@"playAndRecord"];
  AVAudioSessionCategory cat = playAndRecord ? AVAudioSessionCategoryPlayAndRecord : AVAudioSessionCategoryPlayback;
  AVAudioSessionCategoryOptions opts = 0;
  if (_duckOthers) opts |= AVAudioSessionCategoryOptionDuckOthers;
  if (_mixWithOthers) opts |= AVAudioSessionCategoryOptionMixWithOthers;
  if (playAndRecord) {
    if (_defaultToSpeaker) opts |= AVAudioSessionCategoryOptionDefaultToSpeaker;
    if (_allowBluetooth) opts |= AVAudioSessionCategoryOptionAllowBluetooth;
  }
  if (_allowBluetooth) opts |= AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  [session setCategory:cat mode:AVAudioSessionModeDefault options:opts error:&err];
  if (err) return err;
  [session setActive:YES error:&err];
  return err;
}

- (void)enqueueAudioChunk:(NSData *)chunk sampleRate:(int32_t)sampleRate speakStartMs:(double)speakStartMs {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_stopRequested.load() || !self->_playerNode || !self->_streamFormat) return;

    AVAudioFrameCount frameCount = (AVAudioFrameCount)(chunk.length / sizeof(float));
    if (frameCount == 0) return;

    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:self->_streamFormat frameCapacity:frameCount];
    if (!buffer) return;
    buffer.frameLength = frameCount;
    memcpy(buffer.floatChannelData[0], chunk.bytes, chunk.length);
    [self->_playerNode scheduleBuffer:buffer completionHandler:nil];

    if (!self->_playbackStarted.load()) {
      NSError *engineErr = nil;
      if (!self->_engine.isRunning) [self->_engine startAndReturnError:&engineErr];
      if (engineErr) {
        NSLog(@"[DAKokoro] engine start error: %@", engineErr.localizedDescription);
        return;
      }
      [self->_playerNode play];
      self->_playbackStarted.store(true);
      NSLog(@"[DAKokoro][Benchmark] ttfa_ms=%.0f sample_rate=%d", KokoroNowMs() - speakStartMs, sampleRate);
    }
  });
}

static int32_t KokoroStreamCallbackWithArg(const float *samples, int32_t n, void *arg) {
  KokoroStreamContext *ctx = (KokoroStreamContext *)arg;
  if (!ctx || !ctx->module) return 0;
  if (ctx->module->_stopRequested.load()) return 0;
  if (!samples || n <= 0) return 1;

  NSData *chunk = [NSData dataWithBytes:samples length:(NSUInteger)n * sizeof(float)];
  ctx->chunkCount += 1;
  ctx->chunkSamples += n;
  [ctx->module enqueueAudioChunk:chunk sampleRate:ctx->sampleRate speakStartMs:ctx->speakStartMs];
  return 1;
}

- (void)speak:(NSString *)text
        speed:(double)speed
    speakerId:(double)speakerId
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_ttsQueue, ^{
    double speakStartMs = KokoroNowMs();
    if (!self->_tts) {
      reject(@"NO_MODEL", @"Call loadModel first", nil);
      return;
    }
    if (text.length == 0) {
      resolve(nil);
      return;
    }

    self->_stopRequested.store(false);
    self->_playbackStarted.store(false);
    int32_t ttsSampleRate = SherpaOnnxOfflineTtsSampleRate(self->_tts);
    if (ttsSampleRate <= 0) ttsSampleRate = 24000;

    __block NSError *setupErr = nil;
    dispatch_sync(dispatch_get_main_queue(), ^{
      if (self->_playerNode) [self->_playerNode stop];
      if (self->_engine) [self->_engine stop];

      self->_engine = [[AVAudioEngine alloc] init];
      self->_playerNode = [[AVAudioPlayerNode alloc] init];
      self->_streamFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                                              sampleRate:ttsSampleRate
                                                                channels:1
                                                             interleaved:NO];
      [self->_engine attachNode:self->_playerNode];
      [self->_engine connect:self->_playerNode to:self->_engine.mainMixerNode format:self->_streamFormat];

      setupErr = [self activateAudioSession];
      if (!setupErr) {
        [self->_engine prepare];
        if (![self->_engine startAndReturnError:&setupErr] && !setupErr) {
          setupErr = [NSError errorWithDomain:@"DAKokoro" code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to start AVAudioEngine"}];
        }
      }
    });
    if (setupErr) {
      reject(@"PLAY_SETUP_ERROR", setupErr.localizedDescription, setupErr);
      return;
    }

    KokoroStreamContext ctx = {};
    ctx.module = self;
    ctx.sampleRate = ttsSampleRate;
    ctx.speakStartMs = speakStartMs;

    double generateStartMs = KokoroNowMs();
    NSArray<NSString *> *segments = KokoroSegment(text);
    int64_t totalSamples = 0;
    for (NSString *segment in segments) {
      if (self->_stopRequested.load()) break;
      const SherpaOnnxGeneratedAudio *audio =
        SherpaOnnxOfflineTtsGenerateWithCallbackWithArg(
          self->_tts, segment.UTF8String, (int32_t)speakerId, (float)speed, KokoroStreamCallbackWithArg, &ctx);
      if (audio) {
        totalSamples += audio->n;
        SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
      }
    }
    double generateMs = KokoroNowMs() - generateStartMs;

    if (totalSamples == 0 || ctx.chunkCount == 0) {
      if (self->_stopRequested.load()) {
        resolve(nil);
        return;
      }
      reject(@"TTS_ERROR", @"Audio generation failed or returned empty", nil);
      return;
    }

    double audioMs = 1000.0 * (double)totalSamples / (double)ttsSampleRate;
    NSLog(@"[DAKokoro][Benchmark] generate_ms=%.0f audio_ms=%.0f rtf=%.3f segments=%lu chunks=%d",
          generateMs, audioMs, audioMs > 0 ? generateMs / audioMs : -1, (unsigned long)segments.count, ctx.chunkCount);

    // Wait for queued playback to drain before resolving so the caller can hold
    // the mic closed for the whole utterance.
    dispatch_semaphore_t playbackDone = dispatch_semaphore_create(0);
    dispatch_sync(dispatch_get_main_queue(), ^{
      if (self->_stopRequested.load() || !self->_playerNode || !self->_streamFormat) {
        dispatch_semaphore_signal(playbackDone);
        return;
      }
      AVAudioPCMBuffer *sentinel = [[AVAudioPCMBuffer alloc] initWithPCMFormat:self->_streamFormat frameCapacity:1];
      if (!sentinel) {
        dispatch_semaphore_signal(playbackDone);
        return;
      }
      sentinel.frameLength = 1;
      sentinel.floatChannelData[0][0] = 0.0f;
      [self->_playerNode scheduleBuffer:sentinel completionHandler:^{
        dispatch_semaphore_signal(playbackDone);
      }];
    });

    int64_t waitMs = (int64_t)MAX(1000.0, audioMs + 2000.0);
    if (dispatch_semaphore_wait(playbackDone, dispatch_time(DISPATCH_TIME_NOW, waitMs * NSEC_PER_MSEC)) != 0) {
      NSLog(@"[DAKokoro] playback wait timeout after %lld ms", waitMs);
    }

    // Give ducked apps their volume back.
    dispatch_sync(dispatch_get_main_queue(), ^{
      if (self->_duckOthers) {
        [[AVAudioSession sharedInstance] setActive:NO
                                       withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                             error:nil];
      }
    });

    NSLog(@"[DAKokoro][Benchmark] speak total_ms=%.0f", KokoroNowMs() - speakStartMs);
    resolve(nil);
  });
}

- (void)stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  self->_stopRequested.store(true);
  void (^stopBlock)(void) = ^{
    [self->_playerNode stop];
    [self->_engine stop];
  };
  if ([NSThread isMainThread]) stopBlock(); else dispatch_sync(dispatch_get_main_queue(), stopBlock);
  resolve(nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeKokoroSpecJSI>(params);
}

@end
