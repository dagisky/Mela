import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DefaultRuntimeEngine } from '../runtime/DefaultRuntimeEngine.js';
import { InMemoryStore } from '../persistence/InMemoryStore.js';
import { FileStore } from '../persistence/FileStore.js';
import { createTerminalResult } from '../runtime/TerminalResult.js';

async function tempRoot(name: string): Promise<string> {
  const root = path.join('C:\\tmp', `mela-engine-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe('runtime engine', () => {
  it('returns a success terminal result when no executor is supplied', async () => {
    const root = await tempRoot('success');
    const store = new FileStore(root);
    const engine = new DefaultRuntimeEngine({ store });

    const result = await engine.execute({ sessionId: 'session-1', userMessage: 'hello' });
    const session = await store.loadSession('session-1');

    expect(result.status).toBe('success');
    expect(result.sessionId).toBe('session-1');
    expect(session.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(session.events.map((event) => event.type)).toEqual([
      'session.started',
      'user.message.accepted',
      'run.started',
      'run.completed',
    ]);

    await rm(root, { recursive: true, force: true });
  });

  it('delegates to an injected executor and persists the terminal result', async () => {
    const root = await tempRoot('delegate');
    const store = new FileStore(root);
    const engine = new DefaultRuntimeEngine({
      store,
      execute: async (context) => createTerminalResult({
        status: 'success',
        runId: context.runId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        message: 'custom executor done',
      }),
    });

    const result = await engine.execute({ sessionId: 'session-1' });
    const snapshot = await store.loadRunSnapshot(result.runId);

    expect(result.message).toBe('custom executor done');
    expect(snapshot?.runId).toBe(result.runId);

    await rm(root, { recursive: true, force: true });
  });

  it('maps thrown executor errors to unknown_error terminal results', async () => {
    const engine = new DefaultRuntimeEngine({
      execute: async () => {
        throw new Error('executor failed');
      },
    });

    const result = await engine.execute({});

    expect(result.status).toBe('unknown_error');
    expect(result.errorCode).toBe('unknown_error');
    expect(result.message).toBe('executor failed');
  });

  it('returns cancelled when the supplied signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = new DefaultRuntimeEngine();

    const result = await engine.execute({ signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(result.errorCode).toBe('cancelled');
  });

  it('loads snapshots through resume and reports missing snapshots fail-closed', async () => {
    const root = await tempRoot('resume');
    const store = new FileStore(root);
    const engine = new DefaultRuntimeEngine({ store });

    const executed = await engine.execute({ sessionId: 'session-1' });
    const resumed = await engine.resume(executed.runId);
    const missing = await engine.resume('missing-run');

    expect(resumed.status).toBe('success');
    expect(resumed.message).toBe('Run snapshot loaded.');
    expect(missing.status).toBe('definition_load_failed');
    expect(missing.errorCode).toBe('snapshot_not_found');

    await rm(root, { recursive: true, force: true });
  });

  it('records cancellation requests for compatibility with future run controllers', async () => {
    const engine = new DefaultRuntimeEngine();

    await engine.cancel('run-1', 'user requested');

    expect(engine.getCancellationReason('run-1')).toBe('user requested');
  });

  it('honors pre-registered cancellation for caller-supplied run ids', async () => {
    const store = new InMemoryStore();
    const engine = new DefaultRuntimeEngine({ store });

    await engine.cancel('run-1', 'stop now');
    const result = await engine.execute({ runId: 'run-1', sessionId: 'session-1' });
    const session = await store.loadSession('session-1');

    expect(result.status).toBe('cancelled');
    expect(result.message).toBe('stop now');
    expect(session.events.map((event) => event.type)).toContain('run.cancelled');
  });

  it('stores an immutable runtime config snapshot in run metadata', async () => {
    const store = new InMemoryStore();
    const engine = new DefaultRuntimeEngine({ store }, {
      version: 'test-runtime',
      executionMode: 'batch',
      defaultBudgets: {
        maxTurns: 1,
        maxToolCalls: 2,
        maxContextTokens: 3,
      },
    });

    const result = await engine.execute({ runId: 'run-1', sessionId: 'session-1' });
    const snapshot = await store.loadRunSnapshot(result.runId);

    expect(snapshot?.context.metadata.runtimeConfig).toEqual({
      version: 'test-runtime',
      executionMode: 'batch',
      defaultBudgets: {
        maxTurns: 1,
        maxToolCalls: 2,
        maxContextTokens: 3,
      },
    });
  });
});
