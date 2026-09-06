# iMessage: how sending works (and the plan for true hands-free)

Apple gives third-party apps no API to send an iMessage on the user's behalf. The app therefore has two strategies, chosen in Settings > Voice > iMessage:

## 1. Draft (default)

The tool opens Messages with the recipient and text pre-filled through the `sms:` URL:

```
sms:+15551234567&body=I%20will%20be%20home%20by%20seven
```

The user has to tap **Send**. On CarPlay/Bluetooth this is one glance; still not fully hands-free.

## 2. Shortcut

iOS Shortcuts can send an iMessage without showing the compose sheet when the "Send Message" action is configured with *Show When Run* turned off. The app runs a user-created shortcut named **DA Send Message** through the URL scheme:

```
shortcuts://run-shortcut?name=DA%20Send%20Message&input=text&text={"to":"+15551234567","text":"I will be home by seven"}
```

Create it once in the Shortcuts app:

1. New shortcut, name it `DA Send Message`.
2. Add **Get Dictionary from Input** (Shortcut Input).
3. Add **Get Dictionary Value** `text` → variable *Body*; **Get Dictionary Value** `to` → variable *Recipient*.
4. Add **Send Message**: message = *Body*, recipient = *Recipient*, and turn **Show When Run** off.
5. Optionally add **Open App** → Driving Assistant at the end so the assistant returns to the foreground.

Caveats: Shortcuts still switches to the Shortcuts app briefly (the assistant keeps listening thanks to the audio background mode), and iOS may ask "Allow this shortcut to send messages?" the very first time. After that it is genuinely hands-free.

## 3. Ideas not implemented

- **Siri via voice**: the assistant could speak "Hey Siri, text Sam I'm late" through the phone speaker. Fragile and loud; rejected.
- **MessageKit / MFMessageComposeViewController**: same tap-to-send limitation as `sms:`.
- **Mac relay**: a companion on a signed-in Mac could send through AppleScript (`tell application "Messages"`), turning the phone into a client. Works but needs a Mac awake at home; possible later.
