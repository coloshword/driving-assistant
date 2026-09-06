import type { Context } from 'koa';
import * as z from 'zod';
import type { AgentPlanResponse, Message, ToolExecutionLog } from 'da-types';
import { generatePlan, toAgentTool } from './plan.js';
import { checkUserIntent, validateExecutableTool } from './permission.js';
import { summarizeToolResult } from './summarize.js';

const messageSchema = z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() });
const toolSchema = z.object({
  tool: z.string(),
  toolParameters: z.record(z.string(), z.any()).nullable(),
  silent: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
});
const integrationSchema = z.enum(['spotify', 'slack', 'discord', 'messenger', 'imessage', 'phone', 'maps']);

const planBody = z.object({
  messages: z.array(messageSchema).min(1),
  connectedIntegrations: z.array(integrationSchema).default([]),
  contextTool: toolSchema.optional(),
});

export async function planRoute(ctx: Context) {
  const { messages, connectedIntegrations, contextTool } = planBody.parse(ctx.request.body);
  const last = messages[messages.length - 1];
  const planning: Message[] = contextTool
    ? [
        ...messages.slice(0, -1),
        {
          role: 'system',
          content: `Pending tool awaiting confirmation: ${JSON.stringify(contextTool)}. The latest user message asked to revise it. Return the revised tool call with updated parameters; do not treat the message as permission to execute the old one.`,
        },
        last,
      ]
    : messages;
  const { plan, latencyMs, attempts } = await generatePlan(planning, connectedIntegrations);
  const response: AgentPlanResponse = {
    message: { role: 'assistant', content: plan.assistant },
    tool: toAgentTool(plan),
  };
  console.log(`[plan] integrations=[${connectedIntegrations.join(',')}] ${latencyMs}ms attempts=${attempts} tool=${response.tool.tool || '-'} silent=${!!response.tool.silent} "${plan.assistant.slice(0, 80)}"`);
  ctx.body = response;
}

const permissionBody = z.object({
  messages: z.array(messageSchema).min(1),
  tool: toolSchema,
});

export async function executePermissionRoute(ctx: Context) {
  const { messages, tool } = permissionBody.parse(ctx.request.body);
  validateExecutableTool(tool);
  const intent = await checkUserIntent(messages, tool);
  console.log(`[permission] ${tool.tool} -> ${intent.decision}`);
  ctx.body = {
    ...intent,
    executePermissionGranted: intent.decision === 'execute',
    tool,
  };
}

const summarizeBody = z.object({
  messages: z.array(messageSchema),
  toolLog: z.object({
    tool: z.string(),
    status: z.enum(['success', 'error']),
    result: z.record(z.string(), z.any()),
  }),
});

export async function summarizeRoute(ctx: Context) {
  const { messages, toolLog } = summarizeBody.parse(ctx.request.body);
  const summary = await summarizeToolResult(messages, toolLog as ToolExecutionLog);
  console.log(`[summarize] ${toolLog.tool} ${toolLog.status} -> "${summary.assistant.slice(0, 80)}"`);
  ctx.body = summary;
}
