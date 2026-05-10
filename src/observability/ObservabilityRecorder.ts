import type { ObservableEvent } from './EventBus.js';

export interface TraceSpan {
  readonly eventType: string;
  readonly runId?: string;
  readonly correlationId?: string;
  readonly timestamp: Date;
  readonly payload?: unknown;
}

export interface RuntimeMetric {
  readonly name: string;
  readonly value: number;
  readonly tags: Readonly<Record<string, string>>;
}

export class ObservabilityRecorder {
  private readonly spans: TraceSpan[] = [];
  private readonly counters = new Map<string, number>();

  record = (event: ObservableEvent): void => {
    const payload = 'payload' in event ? event.payload : undefined;
    this.spans.push({
      eventType: event.type,
      runId: event.runId,
      correlationId: event.correlationId,
      timestamp: event.timestamp,
      payload,
    });
    this.counters.set(event.type, (this.counters.get(event.type) ?? 0) + 1);
  };

  getTrace(runId?: string): readonly TraceSpan[] {
    return runId ? this.spans.filter((span) => span.runId === runId) : [...this.spans];
  }

  getMetrics(): readonly RuntimeMetric[] {
    return Array.from(this.counters.entries()).map(([eventType, count]) => ({
      name: 'runtime.events',
      value: count,
      tags: { eventType },
    }));
  }

  count(eventType: string): number {
    return this.counters.get(eventType) ?? 0;
  }

  clear(): void {
    this.spans.length = 0;
    this.counters.clear();
  }
}
