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

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|send it|send|go ahead|go for it|confirm|confirmed|correct|that's right|thats right|please do|affirmative|call|call it|play it)[.!]?$/i;
const NO = /^(no|nope|nah|cancel|never mind|nevermind|don't|dont|stop|forget it|abort|no thanks)[.!]?$/i;

/** Fast path for one-word answers so we skip the model round-trip. */
export function quickDecision(utterance: string): PermissionResult | null {
  const u = utterance.trim().toLowerCase().replace(/[,.!?]+$/g, '');
  if (YES.test(u)) return { assistant: 'On it.', decision: 'execute' };
  if (NO.test(u)) return { assistant: 'Okay, cancelled.', decision: 'cancel' };
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
