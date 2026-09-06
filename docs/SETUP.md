# Setup

Requires macOS with Xcode 26+, Node 20+, CMake, Homebrew CocoaPods (`brew install cocoapods cmake`).

## 1. Clone with the whisper.cpp submodule

```bash
git clone --recurse-submodules git@github.com:coloshword/driving-assistant.git
cd driving-assistant
```

## 2. Models + native libs (~400 MB, one time)

```bash
scripts/fetch-models.sh               # whisper tiny.en, Silero VAD, Kokoro v0.19, sherpa-onnx xcframework
scripts/fetch-models.sh --whisper base   # optional: also base.en (more accurate, ~2x slower)
```

whisper.cpp itself is compiled by `scripts/build-whisper.sh` the first time `pod install` runs (device + simulator slices, cached under `packages/whisper/ios/`).

## 3. Server

```bash
cd server
cp .env.example .env     # set OPENAI_API_KEY; Slack/Discord keys optional
npm install
npm run dev              # http://localhost:3000
npm test                 # unit tests
npm run smoke            # end-to-end against the real planner model
```

## 4. App

```bash
cd app
cp .env.example .env     # API_BASE_URL, SPOTIFY_CLIENT_ID
npm install
npm run ios:configure    # wires model files into the Xcode project (idempotent)
npm run pods             # pod install (builds whisper.cpp the first time, several minutes)
npm run ios              # simulator
npm run ios:device       # physical iPhone (needs a signing team; see scripts/ios-configure-project.rb)
```

When testing on a phone, set `API_BASE_URL` to your Mac's LAN IP (e.g. `http://192.168.1.20:3000`) or change it at runtime in Settings.

## Integration credentials

| Integration | What you need | Where it goes |
|---|---|---|
| Spotify | A Spotify Developer app with redirect URI `drivingassistant://oauth/spotify` | `SPOTIFY_CLIENT_ID` in `app/.env` (PKCE, no secret) |
| Slack | A Slack app with user-token scopes (see `SLACK_USER_SCOPES`) and redirect `https://<server>/oauth/slack/callback` | `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` in `server/.env` |
| Discord | A Discord application + bot invited to your servers; redirect `https://<server>/oauth/discord/callback` | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` in `server/.env` |
| Messenger | nothing (deep-link draft) | |
| Messages / Phone | Contacts permission (asked during onboarding) | |

Slack and Discord redirect URIs must be HTTPS, so those two need the server on a public URL (a tunnel like `cloudflared tunnel --url http://localhost:3000` works for development).

## Troubleshooting

- `pod install` fails in codegen with `showColumn`: react-native-screens must stay at 4.23.x for RN 0.83.1 (pinned in package.json).
- "Model error: … MISSING_FILE": run `scripts/fetch-models.sh`, then `npm run ios:configure`, then rebuild.
- No audio in the simulator: the simulator uses the Mac's default input/output devices; check System Settings > Sound.

## Dev tooling (simulator without a mic or hands)

- `scripts/sim.sh say "play purple haze"` injects a transcript as if whisper had produced it (dev builds only); `scripts/sim.sh tap X Y`, `shot`, `relaunch`, `log` wrap idb / simctl. Custom-scheme URLs from `simctl openurl` trigger an iOS "Open in…?" prompt that needs a tap (`scripts/sim.sh tap 275 473` on an iPhone 17 Pro).
- Dev deep links: `drivingassistant://dev/say?text=…`, `…/dev/onboarding-complete`, `…/dev/onboarding-reset`.
- JS console output is mirrored to the server in dev builds (`POST /api/dev/log`, printed as `[app:log] …`), since RN 0.83 no longer shows it in the Metro terminal.
- idb setup: see the header of `scripts/sim.sh` (the Homebrew formula needs a newer CLT than Xcode 26.2 ships, so use the prebuilt release).
