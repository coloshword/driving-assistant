import * as z from 'zod';
import type { AgentTool, ExecuteDecision, Message } from 'da-types';
import { getToolSpec } from 'da-tools';
import { EXECUTE_PERMISSION_INSTRUCTION } from './instructions.js';
import { generateJsonWithRetry } from './llm.js';

export const PERMISSION_SCHEMA = z.object({
  assistant: z.string(),
  decision: z.enum(['execute', 'revise', 'cancel']),
});

export type PermissionResult = { assistant: string; decision: ExecuteDecision };

/** Throws if the pending tool is not executable as-is. */
export function validateExecutableTool(tool: AgentTool): void {
  const spec = getToolSpec(tool.tool);
  if (!spec) throw new Error(`Unsupported tool: ${tool.tool}`);
  spec.executable.parse(tool.toolParameters ?? {});
}

const YES_WORDS = /^(yes|yeah|yep|yup|yea|sure|ok|okay|correct|confirm|confirmed|affirmative|please|do it|go ahead|go for it|send|send it|send that|call|call it|play it|that's right|thats right|sounds good|looks good|perfect|great|absolutely|of course|do that)$/i;
const NO_WORDS = /^(no|nope|nah|cancel|never mind|nevermind|don't|dont|do not|stop|forget it|abort|no thanks|not now|hold on|wait)$/i;
const YES_PHRASE = /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead and|go ahead|just)?[,\s]*(send|do|play|call|go|confirm|proceed|make the call|send it|send that|do it|go ahead)( it| that| the message| the text| ahead| now| please)*$/i;

function normalize(u: string): string {
  return u.trim().toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Fast path for one-word answers so we skip the model round-trip. */
export function quickDecision(utterance: string): PermissionResult | null {
  const u = normalize(utterance);
  if (!u || u.split(' ').length > 6) return null;
  if (NO_WORDS.test(u)) return { assistant: 'Okay, cancelled.', decision: 'cancel' };
  if (YES_WORDS.test(u) || YES_PHRASE.test(u)) return { assistant: 'On it.', decision: 'execute' };
  return null;
}

export async function checkUserIntent(messages: Message[], tool: AgentTool): Promise<PermissionResult> {
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    const quick = quickDecision(last.content);
    if (quick) return quick;
  }
  const augmented: Message[] = [
    ...messages.slice(0, -1),
    { role: 'system', content: `Pending action awaiting confirmation: ${JSON.stringify(tool)}` },
    ...(last ? [last] : []),
  ];
  const { value } = await generateJsonWithRetry(augmented, EXECUTE_PERMISSION_INSTRUCTION, (j) => PERMISSION_SCHEMA.parse(j));
  return value;
}
