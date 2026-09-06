# Updates log

Running log of progress on the Driving Assistant. Newest first. The PR description carries the current status summary and open questions.

## 2026-09-06 (evening)

- **Spotify is wired up.** Client ID is in `app/.env`; the app was added to the Spotify developer app's user list (dev mode allows up to 5 test accounts). Tapping Connect Spotify opens the real `accounts.spotify.com` sign-in with the correct client ID and `drivingassistant://oauth/spotify` redirect. Full sign-in + playback needs the app on a phone with a Premium account signed in.
- Fixed: the Settings Connect button was greyed out for apps not installed on the phone; OAuth apps (Spotify/Slack/Discord) sign in through the browser, so they can now be connected regardless.
- Note on scope: Spotify playback control is per-user Premium, and the dev-mode app is limited to allow-listed accounts until Spotify grants production access.


- **Google Maps added** (per your ask): "navigate to X", "take me home", "directions to the nearest gas station" → `maps.navigate` opens Google Maps turn-by-turn (`comgooglemaps://?daddr=…`), Apple Maps when Google Maps is not installed. Verified by voice in the simulator (Apple Maps path). Google Maps has no public API to read ETA or reroute from another app, so this is start-directions only.

- **Simulator walkthrough of onboarding + settings passed** (automated: idb taps + screenshots). Onboarding correctly offers only installed apps (in the simulator that is Messages and Phone; Spotify/Slack/Discord/Messenger show as "Not on this phone"). Contacts permission sheet handled; Settings "Test connection" reports the Luna model; tapping a voice speaks a preview. Cosmetic fixes landed (clipped pill labels, voice picker hint, gear accessibility label).
- **Confirmation paths verified**: execute, revise ("actually say…" re-plans with the pending tool as context), cancel ("never mind"), and the no-model fast path for plain yes/no.
- **Device build succeeds** (arm64, Metal whisper, signed with the Apple Development identity). Not yet installed on a device; only an iPad is plugged in.
- **Real speech verified in the simulator** by playing macOS `say` through the Mac speaker into the simulator microphone: VAD → whisper → planner → Kokoro all the way, including a silent contacts lookup ("text mom I will be home by seven" → `contacts.resolve` → "I couldn't find Mom in your contacts, what number should I text?").
- **Whisper benchmark (simulator CPU, Metal off; device will be faster)**: tiny.en decodes 3.6 s of speech in ~0.65 s (rtf 0.17–0.22); base.en ~1.4 s (rtf 0.38). Both heard "Jimmy Hendrix" for "Jimi Hendrix" (Spotify search copes); base.en was not more accurate on these sentences, so tiny.en stays the default and base.en remains selectable in Settings.

- **Local model work**:
  - Kokoro int8 (v0.19) tried: 3.5x smaller but **~2x slower** on Apple silicon CPU (real-time factor 0.77 vs 0.37 for fp32). Kept optional (`KOKORO_INT8=1`), fp32 stays default.
  - Kokoro now synthesizes clause by clause (sentence ends, plus commas/colons in long sentences) so speech starts sooner: first audio ~1.0 s instead of ~1.7 s on the same reply; ~1.9 s on a reply whose first sentence has no clause breaks. Further gains need streaming inside sherpa-onnx or a smaller first-clause model.
  - `base.en` whisper is downloaded and selectable in Settings (Fast/Accurate); benchmarking it needs a real microphone.

## 2026-09-06 (afternoon)

- **App is running in the iOS Simulator end to end.** Injected command → planner → Kokoro speaks the reply (first audio ~1.3 s after the reply arrives). Confirmation flow verified: "call 555 123 4567" → spoken question → "yes" (fast path, no model call) → tool executes → spoken summary.
- **Onboarding, Dashboard, Settings, and all six integrations are implemented** (Spotify PKCE + playback, Slack user token, Discord bot proxy, Messenger draft, Contacts + iMessage draft/shortcut, phone). Onboarding scans installed apps via `LSApplicationQueriesSchemes` and connects them one at a time.
- **Bugs found by running in the simulator** (all fixed):
  - whisper's Metal backend traps in the simulator's Metal driver → CPU on simulator, Metal on device.
  - The RN 0.83 template `AppDelegate` never forwarded `openURL` to React Native, so no OAuth redirect or deep link would have reached JS.
  - `react-native-contacts` 8.x: on iOS 18+ its `checkPermission` never resolves while permission is undetermined → timeout workaround; connected-app detection now also has a per-app timeout.
  - Reply card clipped long text.
- **Dev tooling**: `scripts/sim.sh` (idb-based taps/screenshots/inject-a-command), dev deep links, and a dev remote console (RN 0.83 no longer prints JS logs in Metro). Documented in `docs/SETUP.md` / the script header.
- Fast path for spoken confirmations ("yeah send it", "never mind") skips the model round-trip.

## 2026-09-06 (morning)

- **Repo created** and scaffolded: React Native 0.83.1 iOS app, whisper.cpp + Silero VAD and Kokoro TTS TurboModules ported from WorkFromCar (renamed `DAWhisper` / `DAKokoro`).
- **Native builds now target the simulator too.** whisper.cpp is compiled for both `iphoneos` and `iphonesimulator` and packaged as an xcframework (`scripts/build-whisper.sh`); sherpa-onnx already ships simulator slices. This lets the whole voice pipeline be exercised in the iOS Simulator, not only on a physical phone.
- **Local model tweaks** (whisper): flash attention on Metal, thread count derived from core count, `single_segment` / `no_context` / `suppress_nst` for command-style utterances, vocabulary priming through `initial_prompt` (app names, artists, contacts), `temperature_inc = 0` to bound latency. Kokoro: configurable `AVAudioSession` (playAndRecord + duckOthers) so Spotify keeps playing and ducks while the assistant talks; voice selectable.
- **Shared tool catalog** (`packages/tools`): Spotify (play/pause/resume/next/previous/nowPlaying/volume/shuffle/like), Slack (resolveTarget/sendMessage/readMessages/setStatus), Discord (resolveTarget/sendMessage/readMessages), Messenger draft, Contacts resolve, iMessage send, phone call. Every tool declares `silent` (lookup) and `requiresConfirmation`.
- **Server** (Koa): `/api/agent/plan`, `/executePermission`, `/summarize` on **GPT-5.6 Luna** (`reasoning_effort=none`, JSON mode). Slack/Discord OAuth broker with one-shot token claim. Discord bot proxy (resolve/send/read).
- **Smoke test against the real model passes**: "switch the song to purple haze by jimi hendrix" → `spotify.play` in 2.5s; "tell sam on slack I'm running ten minutes late" → `slack.resolveTarget` (silent) → `slack.sendMessage` with confirmation → "yeah send it" → execute; revision ("actually say fifteen minutes") re-plans correctly; unsupported asks and chit-chat handled. All first-attempt valid JSON, 1.4 to 2.5s per call.
