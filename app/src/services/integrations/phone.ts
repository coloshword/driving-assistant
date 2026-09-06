import { Linking } from 'react-native';
import type { AgentTool, ToolExecutionLog } from 'da-types';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/** Phone calls go through the system dialer via tel:; nothing to set up. */
export const phone: Integration = {
  id: 'phone',
  label: 'Phone',
  description: 'Call anyone in your contacts, or any number you say, hands-free.',
  examples: ['Call Mom', 'Call Jake on his mobile', 'Dial 555 0123'],
  urlScheme: null,
  requiresOAuth: false,

  async connect() {
    /* calls need no setup */
  },

  async disconnect() {
    /* nothing to clear */
  },

  async status(): Promise<ConnectionInfo> {
    return { connected: true };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      if (tool.tool !== 'phone.call') return fail(tool.tool, `Unknown Phone tool ${tool.tool}`);
      const raw = String(p.to ?? '');
      const to = (raw.trim().startsWith('+') ? '+' : '') + raw.replace(/\D/g, '');
      if (to.replace('+', '').length < 3) throw new Error('I need a phone number to call.');
      await Linking.openURL(`tel:${to}`);
      return ok(tool.tool, { status: 'calling', to: p.toName ?? to });
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
