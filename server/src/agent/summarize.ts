import * as z from 'zod';
import type { Message, ToolExecutionLog } from 'da-types';
import { SUMMARY_INSTRUCTION } from './instructions.js';
import { generateJsonWithRetry } from './llm.js';

export const SUMMARY_SCHEMA = z.object({ assistant: z.string() });

export async function summarizeToolResult(messages: Message[], toolLog: ToolExecutionLog): Promise<{ assistant: string }> {
  const augmented: Message[] = [...messages, { role: 'user', content: `Tool result: ${JSON.stringify(toolLog)}` }];
  const { value } = await generateJsonWithRetry(augmented, SUMMARY_INSTRUCTION, (j) => SUMMARY_SCHEMA.parse(j));
  return value;
}
