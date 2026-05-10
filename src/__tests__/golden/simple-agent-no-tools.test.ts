import { describe, expect, it } from 'vitest';
import { DefaultRuntimeEngine } from '../../runtime/DefaultRuntimeEngine.js';
import { InMemoryStore } from '../../persistence/InMemoryStore.js';

describe('golden: simple runtime run without tools', () => {
  it('completes, persists session events, and returns terminal success', async () => {
    const store = new InMemoryStore();
    const engine = new DefaultRuntimeEngine({ store });

    const result = await engine.execute({
      runId: 'run-no-tools',
      sessionId: 'session-no-tools',
      userMessage: 'hello',
      agentId: 'simple-agent',
    });
    const session = await store.loadSession('session-no-tools');

    expect(result.status).toBe('success');
    expect(result.message).toBe('Completed.');
    expect(session.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(session.events.map((event) => event.type)).toEqual([
      'session.started',
      'user.message.accepted',
      'run.started',
      'run.completed',
    ]);
    expect(store.loadTerminalResult('run-no-tools')).toEqual(result);
  });
});

