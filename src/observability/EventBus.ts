import type { Logger } from '../types/index.js';
import type { RuntimeEvent as SharedRuntimeEvent, RuntimeEventRecord } from '../types/index.js';

export type ObservableEvent = SharedRuntimeEvent | RuntimeEventRecord | {
  readonly type: string;
  readonly timestamp: Date;
  readonly runId?: string;
  readonly correlationId?: string;
};

/** Handler function for runtime events. */
export type EventHandler<TEvent extends ObservableEvent = ObservableEvent> = (event: TEvent) => void | Promise<void>;

export interface EventBusStats {
  readonly emittedCount: number;
  readonly handlerErrorCount: number;
  readonly registeredHandlerCount: number;
  readonly retainedEventCount: number;
}

/**
 * In-process event bus for runtime lifecycle events.
 *
 * Events are dispatched synchronously to all registered handlers.
 * For external consumers (Pub/Sub), a handler can bridge to the Publisher.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly globalHandlers = new Set<EventHandler>();
  private readonly retainedEvents: ObservableEvent[] = [];
  private emittedCount = 0;
  private handlerErrorCount = 0;

  constructor(
    private readonly logger: Logger,
    private readonly options: { readonly retainEvents?: boolean; readonly maxRetainedEvents?: number } = {},
  ) {}

  /** Subscribe to a specific event type. */
  on<TEvent extends ObservableEvent = ObservableEvent>(eventType: TEvent['type'], handler: EventHandler<TEvent>): () => void {
    let handlers = this.handlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(eventType, handlers);
    }
    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => { handlers!.delete(handler as EventHandler); };
  }

  /** Subscribe to ALL events. */
  onAll(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => { this.globalHandlers.delete(handler); };
  }

  /** Emit an event to all matching handlers. */
  async emit<TEvent extends ObservableEvent>(event: TEvent): Promise<void> {
    this.emittedCount++;
    this.retain(event);
    const typeHandlers = this.handlers.get(event.type);
    const allHandlers = [
      ...(typeHandlers ?? []),
      ...this.globalHandlers,
    ];

    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        this.handlerErrorCount++;
        this.logger.error('Event handler error', {
          eventType: event.type,
          error: String(error),
        });
      }
    }
  }

  /** Remove all handlers (for cleanup). */
  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
    this.retainedEvents.length = 0;
    this.emittedCount = 0;
    this.handlerErrorCount = 0;
  }

  getEvents(): readonly ObservableEvent[] {
    return [...this.retainedEvents];
  }

  getStats(): EventBusStats {
    return {
      emittedCount: this.emittedCount,
      handlerErrorCount: this.handlerErrorCount,
      registeredHandlerCount: this.globalHandlers.size + Array.from(this.handlers.values()).reduce((sum, handlers) => sum + handlers.size, 0),
      retainedEventCount: this.retainedEvents.length,
    };
  }

  waitFor(
    predicate: (event: ObservableEvent) => boolean,
    options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
  ): Promise<ObservableEvent> {
    const existing = this.retainedEvents.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const unsubscribe = this.onAll((event) => {
        if (!predicate(event)) return;
        cleanup();
        resolve(event);
      });
      const timer = options.timeoutMs
        ? setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for runtime event after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : undefined;
      const onAbort = () => {
        cleanup();
        reject(new Error('Event wait aborted'));
      };
      const cleanup = () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private retain(event: ObservableEvent): void {
    if (!this.options.retainEvents) return;
    this.retainedEvents.push(event);
    const max = this.options.maxRetainedEvents ?? 1_000;
    if (this.retainedEvents.length > max) {
      this.retainedEvents.splice(0, this.retainedEvents.length - max);
    }
  }
}
