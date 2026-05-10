import { describe, expect, it } from 'vitest';
import { createTerminalResult } from '../../runtime/TerminalResult.js';
import { DefaultRuntimeEngine } from '../../runtime/DefaultRuntimeEngine.js';
import { InMemoryStore } from '../../persistence/InMemoryStore.js';
import { ToolExecutor } from '../../tools/ToolExecutor.js';
import { RuntimeToolRegistry } from '../../tools/RuntimeToolRegistry.js';

describe('golden: simple runtime run with missing tool', () => {
  it('turns the missing tool into model-visible feedback and persists the failed call', async () => {
    const store = new InMemoryStore();
    const toolExecutor = new ToolExecutor({ registry: new RuntimeToolRegistry(), store });
    const engine = new DefaultRuntimeEngine({
      store,
      execute: async (context) => {
        const toolResult = await toolExecutor.executeToolOrError(
          { id: 'call-missing', name: 'missing-tool', input: {} },
          context,
        );
        return createTerminalResult({
          status: 'success',
          runId: context.runId,
          sessionId: context.sessionId,
          correlationId: context.correlationId,
          message: toolResult.content,
        });
      },
    });

    const result = await engine.execute({ runId: 'run-missing-tool', sessionId: 'session-missing-tool' });
    const calls = store.loadToolCalls('run-missing-tool');

    expect(result.status).toBe('success');
    expect(result.message).toContain('tool_not_found');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'call-missing',
      toolName: 'missing-tool',
      status: 'failed',
      errorCode: 'tool_not_found',
    });
  });
});

