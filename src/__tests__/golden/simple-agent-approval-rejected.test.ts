import { describe, expect, it } from 'vitest';
import { ApprovalManager } from '../../human/ApprovalManager.js';
import { DefaultRuntimeEngine } from '../../runtime/DefaultRuntimeEngine.js';
import { PolicyEngine } from '../../policy/PolicyEngine.js';
import { InMemoryStore } from '../../persistence/InMemoryStore.js';
import { createTerminalResult } from '../../runtime/TerminalResult.js';
import { createDefaultToolResultMapper, type RuntimeTool } from '../../tools/RuntimeTool.js';
import { ToolExecutor } from '../../tools/ToolExecutor.js';
import { RuntimeToolRegistry } from '../../tools/RuntimeToolRegistry.js';

describe('golden: simple runtime approval rejection', () => {
  it('rejects approval, prevents execution, and returns model-visible feedback', async () => {
    let executed = false;
    const tool: RuntimeTool<Record<string, unknown>, unknown> = {
      name: 'write-file',
      description: 'Write file',
      inputSchema: { type: 'object' },
      timeoutMs: 1000,
      validateInput: (input) => ({ ok: true, value: input as Record<string, unknown> }),
      checkPermissions: async () => ({ decision: 'allow' }),
      execute: async () => {
        executed = true;
        return { ok: true, output: { wrote: true } };
      },
      mapResultToModel: createDefaultToolResultMapper(),
    };
    const store = new InMemoryStore();
    const toolExecutor = new ToolExecutor({
      registry: new RuntimeToolRegistry([tool]),
      policyEngine: new PolicyEngine({ approvalRequiredTools: ['write-file'] }),
      approvalManager: new ApprovalManager('reject'),
      store,
    });
    const engine = new DefaultRuntimeEngine({
      store,
      execute: async (context) => {
        const toolResult = await toolExecutor.executeToolOrError(
          { id: 'call-write', name: 'write-file', input: { path: 'a.txt' } },
          context,
        );
        return createTerminalResult({
          status: 'approval_rejected',
          runId: context.runId,
          sessionId: context.sessionId,
          correlationId: context.correlationId,
          message: toolResult.content,
          errorCode: toolResult.errorCode,
        });
      },
    });

    const result = await engine.execute({ runId: 'run-approval', sessionId: 'session-approval' });
    const session = await store.loadSession('session-approval');

    expect(executed).toBe(false);
    expect(result.status).toBe('approval_rejected');
    expect(result.errorCode).toBe('tool_approval_rejected');
    expect(session.approvals).toHaveLength(1);
    expect(session.approvals[0]?.status).toBe('rejected');
    expect(store.loadToolCalls('run-approval')[0]?.status).toBe('failed');
  });
});

