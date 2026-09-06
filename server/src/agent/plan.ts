import * as z from 'zod';
import type { AgentTool, LLMPlanResponse, Message } from 'da-types';
import { getToolSpec, isSilentTool, parsePlannedParameters, requiresConfirmation, type IntegrationId } from 'da-tools';
import { buildPlanInstruction } from './instructions.js';
import { generateJsonWithRetry } from './llm.js';

export const PLAN_SCHEMA = z.object({
  assistant: z.string(),
  tool: z.string().nullable().optional().transform((v) => (v === undefined || v === '' ? null : v)),
  toolParameters: z.record(z.string(), z.any()).nullable().optional().transform((v) => v ?? null),
});

/** "null" strings from the model become real nulls. */
export function normalizeNullStrings(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === 'null' || v === 'undefined' || v === '' ? null : v]),
  );
}

export function validatePlan(json: unknown): LLMPlanResponse {
  const plan = PLAN_SCHEMA.parse(json);
  if (plan.tool) {
    if (!getToolSpec(plan.tool)) {
      throw new Error(`Unknown tool "${plan.tool}". Use one of the listed tool names exactly, or null.`);
    }
    plan.toolParameters = parsePlannedParameters(plan.tool, normalizeNullStrings(plan.toolParameters ?? {}));
  } else {
    plan.toolParameters = null;
  }
  return plan;
}

export function toAgentTool(plan: LLMPlanResponse): AgentTool {
  const tool: AgentTool = {
    tool: plan.tool ?? '',
    toolParameters: plan.toolParameters,
  };
  if (plan.tool) {
    if (isSilentTool(plan.tool)) tool.silent = true;
    if (requiresConfirmation(plan.tool)) tool.requiresConfirmation = true;
  }
  return tool;
}

export async function generatePlan(
  messages: Message[],
  connected: IntegrationId[],
): Promise<{ plan: LLMPlanResponse; latencyMs: number; attempts: number }> {
  const instruction = buildPlanInstruction(connected);
  const { value, latencyMs, attempts } = await generateJsonWithRetry(messages, instruction, validatePlan);
  return { plan: value, latencyMs, attempts };
}
