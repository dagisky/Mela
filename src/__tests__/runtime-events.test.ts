import { describe, expect, it } from 'vitest';
import { RuntimeEventTypes, createRuntimeEvent } from '../runtime/RuntimeEvents.js';
import { createRunContext } from '../runtime/RunContext.js';

describe('runtime events', () => {
  it('creates serializable runtime events with context ids', () => {
    const context = createRunContext({
      runId: 'run-1',
      sessionId: 'session-1',
      correlationId: 'corr-1',
    });

    const event = createRuntimeEvent(RuntimeEventTypes.ToolCallRequested, context, {
      toolName: 'read',
    });

    expect(event.type).toBe('tool.call.requested');
    expect(event.runId).toBe('run-1');
    expect(event.sessionId).toBe('session-1');
    expect(event.correlationId).toBe('corr-1');
    expect(event.payload).toEqual({ toolName: 'read' });
    expect(JSON.parse(JSON.stringify(event)).type).toBe('tool.call.requested');
  });
});

