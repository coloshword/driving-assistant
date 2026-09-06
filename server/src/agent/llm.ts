import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import type { Message } from 'da-types';
import { config } from '../config.js';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');
    client = new OpenAI({ apiKey: config.openaiApiKey, timeout: 30_000, maxRetries: 2 });
  }
  return client;
}

export type GenerateOptions = {
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
};

/**
 * One chat-completions call to the planner model (GPT-5.6 Luna by default).
 * Luna notes (from the Windmill harness): chat/completions wants
 * max_completion_tokens (not max_tokens) and only accepts tools with
 * reasoning_effort "none". We do not use function tools here (the planner emits
 * JSON directly, WorkFromCar-style), so any effort works; "none" is fastest.
 */
export async function generateText(
  messages: Message[],
  systemInstruction: string,
  opts: GenerateOptions = {},
): Promise<{ text: string; latencyMs: number; usage?: OpenAI.CompletionUsage }> {
  const model = opts.model ?? config.plannerModel;
  const effort = opts.reasoningEffort ?? config.plannerReasoningEffort;
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemInstruction },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const params: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    max_completion_tokens: 600,
    response_format: { type: 'json_object' },
  };
  if (model.startsWith('gpt-5') || model.startsWith('o')) {
    params.reasoning_effort = effort;
  } else {
    params.temperature = 0.2;
  }
  const t0 = Date.now();
  const completion = await getClient().chat.completions.create(
    params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  );
  const text = completion.choices[0]?.message?.content ?? '';
  return { text, latencyMs: Date.now() - t0, usage: completion.usage ?? undefined };
}

function formatZodError(err: any): string {
  if (err?.issues && Array.isArray(err.issues)) {
    return err.issues
      .slice(0, 10)
      .map((i: any) => `- ${(i.path ?? []).join('.') || '<root>'}: ${i.message}`)
      .join('\n');
  }
  return String(err?.message ?? err);
}

function buildFeedback(err: unknown): string {
  if (err instanceof SyntaxError) {
    return 'Your last response was not valid JSON. Return ONLY valid JSON (no markdown, no extra text).';
  }
  return [
    'Your last response was valid JSON but failed validation:',
    formatZodError(err as any),
    'Return ONLY corrected JSON that satisfies the schema and tool requirements.',
  ].join('\n');
}

/** Parse model output into JSON, repairing common slips (fences, trailing commas). */
export function parseJsonLoose(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return JSON.parse(jsonrepair(stripped));
  }
}

/**
 * Ask the model for JSON, validate it, and feed validation errors back for up
 * to `retries` attempts (WorkFromCar's generateJsonWithRetry).
 */
export async function generateJsonWithRetry<T>(
  messages: Message[],
  systemInstruction: string,
  validate: (json: unknown) => T,
  retries = 3,
  opts: GenerateOptions = {},
): Promise<{ value: T; latencyMs: number; attempts: number }> {
  const working: Message[] = [...messages];
  let lastErr: unknown;
  let latencyMs = 0;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { text, latencyMs: ms } = await generateText(working, systemInstruction, opts);
    latencyMs += ms;
    working.push({ role: 'assistant', content: text });
    try {
      const parsed = parseJsonLoose(text);
      return { value: validate(parsed), latencyMs, attempts: attempt };
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] attempt ${attempt} invalid:`, String((err as any)?.message ?? err).slice(0, 300));
      console.warn('[llm] raw:', text.slice(0, 500));
      working.push({ role: 'system', content: buildFeedback(err) });
    }
  }
  throw new Error(
    `Failed to produce valid output after ${retries} attempts. Last error: ${String((lastErr as any)?.message ?? lastErr)}`,
  );
}
