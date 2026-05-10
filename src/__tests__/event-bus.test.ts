import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../observability/EventBus.js';
import { ObservabilityRecorder } from '../observability/ObservabilityRecorder.js';
import { createLogger } from '../types/index.js';
import type { RuntimeEvent, RunId, CorrelationId, AgentId, StepId } from '../types/index.js';

const logger = createLogger({ serviceName: 'test', logLevel: 'silent', environment: 'test' });

const makeEvent = (type: RuntimeEvent['type']): RuntimeEvent => ({
  type,
  timestamp: new Date(),
  correlationId: 'corr-1' as CorrelationId,
  runId: 'run-1' as RunId,
  agentId: 'agent-1' as AgentId,
  stepId: 'step-1' as StepId,
} as any);

describe('EventBus', () => {
  it('emits events to type-specific handlers', async () => {
    const bus = new EventBus(logger);
    const handler = vi.fn();
    bus.on('agent.started', handler);

    await bus.emit(makeEvent('agent.started'));
    expect(handler).toHaveBeenCalledTimes(1);

    await bus.emit(makeEvent('agent.completed'));
    expect(handler).toHaveBeenCalledTimes(1); // Not called for different type
  });

  it('emits events to global handlers', async () => {
    const bus = new EventBus(logger);
    const handler = vi.fn();
    bus.onAll(handler);

    await bus.emit(makeEvent('agent.started'));
    await bus.emit(makeEvent('tool.invoked'));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe works', async () => {
    const bus = new EventBus(logger);
    const handler = vi.fn();
    const unsub = bus.on('agent.started', handler);

    await bus.emit(makeEvent('agent.started'));
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    await bus.emit(makeEvent('agent.started'));
    expect(handler).toHaveBeenCalledTimes(1); // Not called after unsub
  });

  it('handles errors in handlers without crashing', async () => {
    const bus = new EventBus(logger);
    bus.on('agent.started', () => { throw new Error('handler error'); });
    // Should not throw
    await bus.emit(makeEvent('agent.started'));
  });

  it('clear removes all handlers', async () => {
    const bus = new EventBus(logger);
    const handler = vi.fn();
    bus.on('agent.started', handler);
    bus.onAll(handler);
    bus.clear();

    await bus.emit(makeEvent('agent.started'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('retains events, exposes stats, and supports waitFor', async () => {
    const bus = new EventBus(logger, { retainEvents: true });
    const wait = bus.waitFor((event) => event.type === 'agent.completed', { timeoutMs: 100 });

    await bus.emit(makeEvent('agent.started'));
    await bus.emit(makeEvent('agent.completed'));

    await expect(wait).resolves.toMatchObject({ type: 'agent.completed' });
    expect(bus.getEvents()).toHaveLength(2);
    expect(bus.getStats()).toMatchObject({ emittedCount: 2, retainedEventCount: 2 });
  });

  it('records traces and metrics through ObservabilityRecorder', async () => {
    const bus = new EventBus(logger);
    const recorder = new ObservabilityRecorder();
    bus.onAll(recorder.record);

    await bus.emit(makeEvent('agent.started'));
    await bus.emit(makeEvent('agent.completed'));

    expect(recorder.getTrace('run-1')).toHaveLength(2);
    expect(recorder.count('agent.started')).toBe(1);
    expect(recorder.getMetrics()).toContainEqual({
      name: 'runtime.events',
      value: 1,
      tags: { eventType: 'agent.completed' },
    });
  });
});
