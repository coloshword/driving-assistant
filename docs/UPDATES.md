# Updates log

Running log of progress on the Driving Assistant. Newest first. The PR description carries the current status summary and open questions.

## 2026-09-06

- **Repo created** and scaffolded: React Native 0.83.1 iOS app, whisper.cpp + Silero VAD and Kokoro TTS TurboModules ported from WorkFromCar (renamed `DAWhisper` / `DAKokoro`).
- **Native builds now target the simulator too.** whisper.cpp is compiled for both `iphoneos` and `iphonesimulator` and packaged as an xcframework (`scripts/build-whisper.sh`); sherpa-onnx already ships simulator slices. This lets the whole voice pipeline be exercised in the iOS Simulator, not only on a physical phone.
- **Local model tweaks** (whisper): flash attention on Metal, thread count derived from core count, `single_segment` / `no_context` / `suppress_nst` for command-style utterances, vocabulary priming through `initial_prompt` (app names, artists, contacts), `temperature_inc = 0` to bound latency. Kokoro: configurable `AVAudioSession` (playAndRecord + duckOthers) so Spotify keeps playing and ducks while the assistant talks; voice selectable.
- **Shared tool catalog** (`packages/tools`): Spotify (play/pause/resume/next/previous/nowPlaying/volume/shuffle/like), Slack (resolveTarget/sendMessage/readMessages/setStatus), Discord (resolveTarget/sendMessage/readMessages), Messenger draft, Contacts resolve, iMessage send, phone call. Every tool declares `silent` (lookup) and `requiresConfirmation`.
- **Server** (Koa): `/api/agent/plan`, `/executePermission`, `/summarize` on **GPT-5.6 Luna** (`reasoning_effort=none`, JSON mode). Slack/Discord OAuth broker with one-shot token claim. Discord bot proxy (resolve/send/read).
- **Smoke test against the real model passes**: "switch the song to purple haze by jimi hendrix" → `spotify.play` in 2.5s; "tell sam on slack I'm running ten minutes late" → `slack.resolveTarget` (silent) → `slack.sendMessage` with confirmation → "yeah send it" → execute; revision ("actually say fifteen minutes") re-plans correctly; unsupported asks and chit-chat handled. All first-attempt valid JSON, 1.4 to 2.5s per call.
