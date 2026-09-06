export type Role = 'system' | 'user' | 'assistant';

export type Message = {
  role: Role;
  content: string;
};

/** A tool call the planner wants the device to run. */
export type AgentTool = {
  tool: string;
  toolParameters: Record<string, any> | null;
  /** Read-only / lookup tool: run immediately and feed the result back to the planner. */
  silent?: boolean;
  /** Ask the user to confirm before executing (messages, calls). */
  requiresConfirmation?: boolean;
};

export type LLMPlanResponse = {
  assistant: string;
  tool: string | null;
  toolParameters: Record<string, any> | null;
};

export type ExecuteDecision = 'execute' | 'revise' | 'cancel';

export type AgentPlanResponse = {
  message: Message;
  tool: AgentTool;
  executePermissionGranted?: boolean;
  executeDecision?: ExecuteDecision;
};

export type ExecutePermissionRouteResponseBody = {
  assistant: string;
  decision: ExecuteDecision;
  executePermissionGranted: boolean;
  tool: AgentTool;
};

export type ToolExecutionLog = {
  tool: string;
  status: 'success' | 'error';
  result: Record<string, any>;
};

export type SummarizeRouteRequestBody = {
  messages: Message[];
  toolLog: ToolExecutionLog;
};

export type SummarizeRouteResponseBody = {
  assistant: string;
};

/** Which integrations the device has connected; sent with every plan request so the planner only offers available tools. */
export type IntegrationId = 'spotify' | 'slack' | 'discord' | 'messenger' | 'imessage' | 'phone';

export type PlanRequestBody = {
  messages: Message[];
  connectedIntegrations: IntegrationId[];
  contextTool?: AgentTool;
};
