import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore } from '../persistence/FileStore.js';
import { createRunSnapshot } from '../persistence/SnapshotStore.js';
import { createRunContext } from '../runtime/RunContext.js';
import { createRuntimeEvent, RuntimeEventTypes } from '../runtime/RuntimeEvents.js';
import { createTerminalResult } from '../runtime/TerminalResult.js';
import { createErrorToolResult } from '../tools/RuntimeTool.js';

async function tempRoot(name: string): Promise<string> {
  const root = path.join('C:\\tmp', `mela-runtime-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe('file store', () => {
  it('persists and reloads messages, events, approvals, snapshots, and terminal results', async () => {
    const root = await tempRoot('file-store');
    const store = new FileStore(root);
    const context = createRunContext({ runId: 'run-1', sessionId: 'session-1', correlationId: 'corr-1' });

    await store.appendMessage(context.sessionId, { role: 'user', content: 'hello' });
    await store.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunStarted, context, {}));
    await store.saveApproval(context.sessionId, {
      id: 'approval-1',
      sessionId: context.sessionId,
      runId: context.runId,
      toolCallId: 'tool-call-1',
      toolName: 'write',
      originalInput: { path: 'a' },
      proposedInput: { path: 'a' },
      status: 'rejected',
      createdAt: new Date(),
    });
    await store.saveToolCall(context.runId, {
      id: 'tool-call-1',
      toolName: 'missing',
      input: {},
      result: createErrorToolResult('tool-call-1', 'tool_not_found', 'missing'),
      status: 'failed',
      errorCode: 'tool_not_found',
    });
    await store.saveRunSnapshot(createRunSnapshot(context));
    await store.saveTerminalResult(createTerminalResult({
      status: 'success',
      runId: context.runId,
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      message: 'done',
    }));

    const session = await store.loadSession(context.sessionId);
    const snapshot = await store.loadRunSnapshot(context.runId);

    expect(session.messages).toHaveLength(1);
    expect(session.events).toHaveLength(1);
    expect(session.approvals).toHaveLength(1);
    expect(snapshot?.runId).toBe(context.runId);

    await rm(root, { recursive: true, force: true });
  });

  it('returns empty records for missing sessions and snapshots', async () => {
    const root = await tempRoot('missing');
    const store = new FileStore(root);

    await expect(store.loadSession('missing')).resolves.toEqual({
      sessionId: 'missing',
      messages: [],
      approvals: [],
      events: [],
    });
    await expect(store.loadRunSnapshot('missing')).resolves.toBeUndefined();

    await rm(root, { recursive: true, force: true });
  });
});

