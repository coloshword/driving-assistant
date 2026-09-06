# Driving Assistant app

React Native 0.83 (new architecture) iOS app. See [../docs/SETUP.md](../docs/SETUP.md) for the full setup.

```
src/
  navigation/RootNavigator.tsx   Onboarding -> Dashboard -> Settings
  screens/                       Dashboard (voice loop UI), Settings, onboarding/
  components/                    VoiceListener (VAD gate), AudioVisualizer, ToolIndicator
  services/
    audio/voiceProcessor.ts      mic frames (Picovoice VoiceProcessor)
    models.ts                    loads whisper + VAD + Kokoro from the bundle
    tts.ts                       speak() via DAKokoro
    vocabulary.ts                whisper initial_prompt priming
    agent/api.ts                 server calls (plan / executePermission / summarize)
    agent/useAssistant.ts        the conversation loop
    tools/executor.ts            dispatch a planned tool to its integration
    integrations/                spotify, slack, discord, messenger, imessage(+contacts), phone
    storage.ts                   Keychain secrets + AsyncStorage prefs
```

Voice pipeline: `VoiceListener` streams 32 ms frames through Silero VAD; an utterance ends after ~0.9 s of silence and is transcribed by whisper.cpp on-device. `useAssistant` sends the transcript to the server planner, runs silent lookups immediately, executes complete tools (asking for a spoken yes first when the tool requires it), and speaks the result with Kokoro. The mic is paused while the assistant talks.
