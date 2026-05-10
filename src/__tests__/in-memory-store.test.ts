import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../persistence/InMemoryStore.js';
import { createRunSnapshot } from '../persistence/SnapshotStore.js';
import { createRunContext } from '../runtime/RunContext.js';
import { createRuntimeEvent, RuntimeEventTypes } from '../runtime/RuntimeEvents.js';
import { createTerminalResult } from '../runtime/TerminalResult.js';
import { createErrorToolResult } from '../tools/RuntimeTool.js';

describe('in-memory store', () => {
  it('persists runtime records without filesystem dependencies', async () => {
    const store = new InMemoryStore();
    const context = createRunContext({ runId: 'run-1', sessionId: 'session-1', correlationId: 'corr-1' });
    const terminal = createTerminalResult({
      status: 'success',
      runId: context.runId,
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      message: 'done',
    });

    await store.appendMessage(context.sessionId, { role: 'user', content: 'hello' });
    await store.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunStarted, context, {}));
    await store.saveToolCall(context.runId, {
      id: 'call-1',
      toolName: 'missing',
      input: {},
      result: createErrorToolResult('call-1', 'tool_not_found', 'missing'),
      status: 'failed',
      errorCode: 'tool_not_found',
    });
    await store.saveRunSnapshot(createRunSnapshot(context));
    await store.saveTerminalResult(terminal);

    const session = await store.loadSession(context.sessionId);
    expect(session.messages).toHaveLength(1);
    expect(session.events).toHaveLength(1);
    expect(store.loadToolCalls(context.runId)).toHaveLength(1);
    expect(await store.loadRunSnapshot(context.runId)).toMatchObject({ runId: context.runId });
    expect(store.loadTerminalResult(context.runId)).toBe(terminal);
  });
});
