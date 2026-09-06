import { describe, expect, it } from 'vitest';
import { validatePlan, toAgentTool, normalizeNullStrings } from './plan.js';
import { parseJsonLoose } from './llm.js';
import { quickDecision } from './permission.js';

describe('validatePlan', () => {
  it('accepts a spotify.play plan and marks it non-silent, no confirmation', () => {
    const plan = validatePlan({ assistant: 'Playing Purple Haze', tool: 'spotify.play', toolParameters: { query: 'Purple Haze Jimi Hendrix', type: 'track' } });
    const tool = toAgentTool(plan);
    expect(tool.tool).toBe('spotify.play');
    expect(tool.silent).toBeUndefined();
    expect(tool.requiresConfirmation).toBeUndefined();
  });

  it('marks silent + confirmation tools', () => {
    expect(toAgentTool(validatePlan({ assistant: 'Looking up Sam', tool: 'slack.resolveTarget', toolParameters: { name: 'Sam' } })).silent).toBe(true);
    expect(toAgentTool(validatePlan({ assistant: 'Send it?', tool: 'slack.sendMessage', toolParameters: { targetId: null, targetName: null, text: 'hi' } })).requiresConfirmation).toBe(true);
  });

  it('rejects unknown tools', () => {
    expect(() => validatePlan({ assistant: 'x', tool: 'spotify.teleport', toolParameters: {} })).toThrow(/Unknown tool/);
  });

  it('normalizes "null" strings and empty tool', () => {
    expect(normalizeNullStrings({ a: 'null', b: 'x' })).toEqual({ a: null, b: 'x' });
    const plan = validatePlan({ assistant: 'hi', tool: '', toolParameters: null });
    expect(plan.tool).toBeNull();
  });
});

describe('parseJsonLoose', () => {
  it('strips fences and repairs trailing commas', () => {
    expect(parseJsonLoose('```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
  });
});

describe('quickDecision', () => {
  it('short-circuits obvious answers', () => {
    expect(quickDecision('Yes.')?.decision).toBe('execute');
    expect(quickDecision('send it')?.decision).toBe('execute');
    expect(quickDecision('no')?.decision).toBe('cancel');
    expect(quickDecision('yeah send it')?.decision).toBe('execute');
    expect(quickDecision('Yes, go ahead.')?.decision).toBe('execute');
    expect(quickDecision('okay send that please')?.decision).toBe('execute');
    expect(quickDecision('never mind')?.decision).toBe('cancel');
    expect(quickDecision('no wait')).toBeNull();
    expect(quickDecision('actually make it fifteen')).toBeNull();
    expect(quickDecision('yes but send it to Tom instead')).toBeNull();
  });
});
