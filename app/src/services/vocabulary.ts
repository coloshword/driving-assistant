import NativeWhisper from 'da-whisper/src/NativeWhisper';
import type { IntegrationId } from 'da-tools';

/**
 * whisper's initial_prompt biases decoding toward words it contains. We feed it
 * the names of the connected apps plus a few contact names so "send Sam a
 * message on Slack" is not heard as "send Sam a massage on slack".
 */
export async function primeVocabulary(connected: IntegrationId[], contactNames: string[] = []): Promise<void> {
  const apps: Record<IntegrationId, string> = {
    spotify: 'Spotify',
    slack: 'Slack',
    discord: 'Discord',
    messenger: 'Messenger',
    imessage: 'iMessage, text message',
    phone: 'call',
  };
  const words = [
    'Hands-free driving assistant.',
    ...connected.map((id) => apps[id]),
    'play, pause, skip, next song, previous, volume, shuffle, like this song',
    ...contactNames.slice(0, 40),
  ];
  const prompt = words.join(', ').slice(0, 800);
  try {
    await NativeWhisper.setVocabulary(prompt);
  } catch (e) {
    console.log('[vocabulary] failed', e);
  }
}
