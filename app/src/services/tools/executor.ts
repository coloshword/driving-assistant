import type { AgentTool, ToolExecutionLog } from 'da-types';
import { isToolExecutable } from 'da-tools';
import { integrationForTool } from '../integrations/registry';

/** Run a planned tool on the device. Never throws. */
export async function executeTool(tool: AgentTool): Promise<ToolExecutionLog> {
  const integration = integrationForTool(tool.tool);
  if (!integration) {
    return { tool: tool.tool, status: 'error', result: { message: `Unknown tool: ${tool.tool}` } };
  }
  if (!isToolExecutable(tool.tool, tool.toolParameters)) {
    return { tool: tool.tool, status: 'error', result: { message: 'Missing required parameters', parameters: tool.toolParameters } };
  }
  const status = await integration.status();
  if (!status.connected) {
    return { tool: tool.tool, status: 'error', result: { message: `${integration.label} is not connected. Connect it in Settings.` } };
  }
  const t0 = Date.now();
  const log = await integration.execute(tool);
  console.log(`[executeTool] ${tool.tool} -> ${log.status} in ${Date.now() - t0}ms`, JSON.stringify(log.result).slice(0, 300));
  return log;
}
