import { describe, expect, it } from 'vitest';
import { createRunContext } from '../runtime/RunContext.js';

describe('run context', () => {
  it('creates generated ids and default budgets', () => {
    const context = createRunContext();

    expect(context.runId).toBeTruthy();
    expect(context.sessionId).toBeTruthy();
    expect(context.correlationId).toBeTruthy();
    expect(context.budgets.maxTurns).toBe(12);
    expect(context.budgets.maxToolCalls).toBe(40);
    expect(context.signal.aborted).toBe(false);
  });

  it('preserves supplied ids, definition versions, tools, and signal', () => {
    const controller = new AbortController();
    const context = createRunContext({
      runId: 'run-1',
      sessionId: 'session-1',
      correlationId: 'corr-1',
      agentId: 'agent-1',
      definitionVersions: { 'agent-1': '1.0.0' },
      toolNames: ['read'],
      budgets: { maxTurns: 3 },
      signal: controller.signal,
      metadata: { mode: 'test' },
    });

    expect(context.runId).toBe('run-1');
    expect(context.sessionId).toBe('session-1');
    expect(context.agentId).toBe('agent-1');
    expect(context.definitionVersions).toEqual({ 'agent-1': '1.0.0' });
    expect(context.toolNames).toEqual(['read']);
    expect(context.budgets.maxTurns).toBe(3);
    expect(context.budgets.maxToolCalls).toBe(40);
    expect(context.signal).toBe(controller.signal);
    expect(context.metadata).toEqual({ mode: 'test' });
  });
});

