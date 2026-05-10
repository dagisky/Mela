import { describe, expect, it } from 'vitest';
import { DefaultRuntimeEngine } from '../../runtime/DefaultRuntimeEngine.js';
import { InMemoryStore } from '../../persistence/InMemoryStore.js';
import { createTerminalResult } from '../../runtime/TerminalResult.js';

describe('golden: simple runtime persisted result', () => {
  it('persists snapshot and terminal result for replay-oriented debugging', async () => {
    const store = new InMemoryStore();
    const engine = new DefaultRuntimeEngine({
      store,
      execute: async (context) => createTerminalResult({
        status: 'success',
        runId: context.runId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        message: 'persist me',
        metadata: { artifact: 'answer' },
      }),
    });

    const result = await engine.execute({
      runId: 'run-persisted',
      sessionId: 'session-persisted',
      userMessage: 'save this run',
      definitionVersions: { 'simple-agent': '1.0.0' },
    });
    const snapshot = await store.loadRunSnapshot('run-persisted');

    expect(snapshot?.context.definitionVersions).toEqual({ 'simple-agent': '1.0.0' });
    expect(snapshot?.context.metadata.runtimeConfig).toMatchObject({ version: 'phase-1' });
    expect(store.loadTerminalResult('run-persisted')).toEqual(result);
  });
});
