import { describe, expect, it } from 'vitest';
import { TOOL_SPECS, isToolExecutable, renderToolInstructions, toolsForIntegrations } from 'da-tools';

describe('tool catalog', () => {
  it('has unique, namespaced names', () => {
    const names = TOOL_SPECS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });

  it('silent tools never require confirmation', () => {
    for (const t of TOOL_SPECS) if (t.silent) expect(t.requiresConfirmation).toBe(false);
  });

  it('readiness follows the executable schema', () => {
    expect(isToolExecutable('spotify.play', { query: null, type: null })).toBe(false);
    expect(isToolExecutable('spotify.play', { query: 'Purple Haze', type: null })).toBe(true);
    expect(isToolExecutable('slack.sendMessage', { targetId: 'U1', targetName: 'Sam', text: null })).toBe(false);
    expect(isToolExecutable('slack.sendMessage', { targetId: 'U1', targetName: 'Sam', text: 'hi' })).toBe(true);
    expect(isToolExecutable('spotify.pause', {})).toBe(true);
    expect(isToolExecutable('nope.tool', {})).toBe(false);
  });

  it('only offers tools for connected integrations', () => {
    const names = toolsForIntegrations(['phone']).map((t) => t.name);
    expect(names).toEqual(['phone.call']);
    const text = renderToolInstructions(['spotify']);
    expect(text).toContain('spotify.play');
    expect(text).not.toContain('slack.');
    expect(renderToolInstructions([])).toMatch(/No integrations/);
  });
});
