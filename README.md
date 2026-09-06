# Driving Assistant

Hands-free iOS voice assistant for the everyday things people do in the car: change the song, send a Slack or Discord message, text someone, make a call. You open the app, it listens, you talk, it does the thing and talks back. No touching the phone.

Work in progress. See the open **Updates** pull request for current status and open questions.

## How it works

1. **Capture** on-device: Silero VAD + whisper.cpp turn speech into text (native TurboModules, no audio leaves the phone).
2. **Plan** on the server: GPT-5.6 Luna picks a tool and fills parameters from the transcript. Lookups (contacts, channel names) run silently; messages and calls ask for a spoken yes first.
3. **Execute** on-device: Spotify, Slack, Contacts/Messages, and phone calls run directly from the phone with the user's own tokens. Discord goes through the server's bot. Results are summarized and spoken with Kokoro TTS (on-device).

## Layout

| Path | What |
|---|---|
| `app/` | React Native 0.83 iOS app |
| `packages/whisper/` | whisper.cpp STT + VAD TurboModule (`DAWhisper`) |
| `packages/kokoro/` | Kokoro TTS TurboModule via sherpa-onnx (`DAKokoro`) |
| `packages/tools/` | Shared tool catalog: schemas + planner instructions |
| `types/` | Shared TypeScript types |
| `server/` | Koa server: planning, confirmation, summaries, Slack/Discord OAuth, Discord bot proxy |
| `scripts/` | Model download + native build helpers |

## Setup

See [docs/SETUP.md](docs/SETUP.md).
