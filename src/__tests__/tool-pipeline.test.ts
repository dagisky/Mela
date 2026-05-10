import { describe, expect, it } from 'vitest';
import { ApprovalManager } from '../human/ApprovalManager.js';
import { budgetToolOutput } from '../context/ToolOutputBudgeter.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';
import { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { ToolScheduler } from '../tools/ToolScheduler.js';
import { createDefaultToolResultMapper, type RuntimeTool } from '../tools/RuntimeTool.js';
import { createRunContext } from '../runtime/RunContext.js';

function createTool(overrides: Partial<RuntimeTool<Record<string, unknown>, unknown>> = {}): RuntimeTool<Record<string, unknown>, unknown> {
  return {
    name: 'echo',
    description: 'Echo input',
    inputSchema: { type: 'object' },
    timeoutMs: 1000,
    concurrencySafe: true,
    validateInput: (input) => {
      if (typeof input !== 'object' || input === null) {
        return { ok: false, message: 'input must be an object' };
      }
      return { ok: true, value: input as Record<string, unknown> };
    },
    checkPermissions: async () => ({ decision: 'allow' }),
    execute: async (input) => ({ ok: true, output: input }),
    mapResultToModel: createDefaultToolResultMapper(),
    ...overrides,
  };
}

describe('tool output budgeter', () => {
  it('keeps small output and replaces oversized output with preview', () => {
    expect(budgetToolOutput({ ok: true }, 1000).replaced).toBe(false);

    const budgeted = budgetToolOutput({ text: 'x'.repeat(1000) }, 100);
    expect(budgeted.replaced).toBe(true);
    expect(budgeted.output).toMatchObject({ replaced: true, reason: 'tool_output_too_large' });
  });
});

describe('runtime tool registry', () => {
  it('registers tools and resolves allow deny rules deterministically', () => {
    const registry = new RuntimeToolRegistry([createTool()]);

    expect(registry.has('echo')).toBe(true);
    expect(registry.names()).toEqual(['echo']);
    expect(registry.resolveAllowed(['echo', 'missing'], [])).toEqual(['echo']);
    expect(registry.resolveAllowed(['echo'], ['echo'])).toEqual([]);
    expect(() => registry.register(createTool())).toThrow('already registered');
  });
});

describe('tool executor', () => {
  it('returns one model-visible error for missing tools', async () => {
    const executor = new ToolExecutor({ registry: new RuntimeToolRegistry() });
    const result = await executor.executeToolOrError(
      { id: 'call-1', name: 'missing', input: {} },
      createRunContext({ runId: 'run-1', sessionId: 'session-1', correlationId: 'corr-1' }),
    );

    expect(result.toolCallId).toBe('call-1');
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_not_found');
  });

  it('returns model-visible validation errors', async () => {
    const executor = new ToolExecutor({ registry: new RuntimeToolRegistry([createTool()]) });
    const result = await executor.executeToolOrError(
      { id: 'call-1', name: 'echo', input: 'bad' },
      createRunContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_input_validation_failed');
  });

  it('denies tools through global policy before execution', async () => {
    let executed = false;
    const tool = createTool({ execute: async () => { executed = true; return { ok: true, output: {} }; } });
    const executor = new ToolExecutor({
      registry: new RuntimeToolRegistry([tool]),
      policyEngine: new PolicyEngine({ deniedTools: ['echo'] }),
    });

    const result = await executor.executeToolOrError({ id: 'call-1', name: 'echo', input: {} }, createRunContext());

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_policy_denied');
    expect(executed).toBe(false);
  });

  it('denies tools through tool-specific permissions before execution', async () => {
    let executed = false;
    const tool = createTool({
      checkPermissions: async () => ({ decision: 'deny', reasonCode: 'tool_permission_denied_by_test' }),
      execute: async () => { executed = true; return { ok: true, output: {} }; },
    });
    const executor = new ToolExecutor({ registry: new RuntimeToolRegistry([tool]) });

    const result = await executor.executeToolOrError({ id: 'call-1', name: 'echo', input: {} }, createRunContext());

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_permission_denied');
    expect(executed).toBe(false);
  });

  it('returns approval rejected as a model-visible tool result', async () => {
    let executed = false;
    const tool = createTool({ execute: async () => { executed = true; return { ok: true, output: {} }; } });
    const executor = new ToolExecutor({
      registry: new RuntimeToolRegistry([tool]),
      policyEngine: new PolicyEngine({ approvalRequiredTools: ['echo'] }),
      approvalManager: new ApprovalManager('reject'),
    });

    const result = await executor.executeToolOrError({ id: 'call-1', name: 'echo', input: {} }, createRunContext());

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_approval_rejected');
    expect(executed).toBe(false);
  });

  it('executes approved tools and maps output to model format', async () => {
    const executor = new ToolExecutor({
      registry: new RuntimeToolRegistry([createTool()]),
      policyEngine: new PolicyEngine({ approvalRequiredTools: ['echo'] }),
      approvalManager: new ApprovalManager('approve'),
    });

    const result = await executor.executeToolOrError(
      { id: 'call-1', name: 'echo', input: { value: 1 } },
      createRunContext(),
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, output: { value: 1 } });
  });

  it('turns thrown execution errors into model-visible results', async () => {
    const tool = createTool({ execute: async () => { throw new Error('boom'); } });
    const executor = new ToolExecutor({ registry: new RuntimeToolRegistry([tool]) });

    const result = await executor.executeToolOrError({ id: 'call-1', name: 'echo', input: {} }, createRunContext());

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('tool_execution_failed');
    expect(result.content).toContain('boom');
  });

  it('replaces oversized successful output before mapping to the model', async () => {
    const tool = createTool({
      maxResultSizeBytes: 100,
      execute: async () => ({ ok: true, output: { text: 'x'.repeat(1000) } }),
    });
    const executor = new ToolExecutor({ registry: new RuntimeToolRegistry([tool]) });

    const result = await executor.executeToolOrError({ id: 'call-1', name: 'echo', input: {} }, createRunContext());

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content).output).toMatchObject({ replaced: true });
  });
});

describe('tool scheduler', () => {
  it('runs non-concurrency-safe tools serially', async () => {
    const scheduler = new ToolScheduler();
    const order: string[] = [];

    await Promise.all([
      scheduler.schedule(false, async () => {
        order.push('a-start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a-end');
      }),
      scheduler.schedule(false, async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);

    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});

