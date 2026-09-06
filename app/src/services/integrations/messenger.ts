import { Linking } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { AgentTool, ToolExecutionLog } from 'da-types';
import { getPref, setPref } from '../storage';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Facebook Messenger has no API for sending as a person. The best we can do
 * hands-free is copy the text and open the app so the user pastes and taps
 * send. There is no reliable per-person deep link without a Facebook user id,
 * so `to` is only echoed back for the spoken summary.
 */

const PREF_ENABLED = 'pref.messengerEnabled';
const APP_URL = 'fb-messenger://';

export const messenger: Integration = {
  id: 'messenger',
  label: 'Messenger',
  description:
    'Draft Messenger texts by voice. Messenger has no API for sending as you, so the message is copied and Messenger opened for you to paste and tap send.',
  examples: [
    'Draft a Messenger message to Mom saying I will call tonight',
    'Message Alex on Messenger that I am on my way',
    'Open Messenger with "running late, sorry"',
  ],
  urlScheme: 'fb-messenger',
  requiresOAuth: false,

  async connect() {
    const installed = await Linking.canOpenURL(APP_URL).catch(() => false);
    if (!installed) throw new Error('Messenger is not installed on this phone.');
    await setPref(PREF_ENABLED, '1');
  },

  async disconnect() {
    await setPref(PREF_ENABLED, null);
  },

  async status(): Promise<ConnectionInfo> {
    return { connected: (await getPref(PREF_ENABLED)) === '1' };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      if (tool.tool !== 'messenger.draft') return fail(tool.tool, `Unknown Messenger tool ${tool.tool}`);
      const text = String(p.text ?? '');
      if (!text) throw new Error('There is no message text to draft.');
      Clipboard.setString(text);
      await Linking.openURL(APP_URL);
      return ok(tool.tool, {
        status: 'drafted',
        copiedToClipboard: true,
        to: p.to ?? null,
        text,
        note: 'Message copied. Messenger is open; paste and tap send.',
      });
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
