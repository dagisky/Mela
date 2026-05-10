import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type {
  ApprovalRecord,
  PersistenceStore,
  RunSnapshot,
  SessionRecord,
  ToolCallRecord,
} from '../persistence/PersistenceStore.js';
import type { EventBus } from '../observability/EventBus.js';

export class EventedPersistenceStore implements PersistenceStore {
  constructor(
    private readonly deps: {
      readonly store: PersistenceStore;
      readonly eventBus: EventBus;
    },
  ) {}

  async appendEvent(event: RuntimeEventRecord): Promise<void> {
    await this.deps.store.appendEvent(event);
    await this.deps.eventBus.emit(event);
  }

  appendMessage(sessionId: string, message: unknown): Promise<void> {
    return this.deps.store.appendMessage(sessionId, message);
  }

  saveToolCall(runId: string, record: ToolCallRecord): Promise<void> {
    return this.deps.store.saveToolCall(runId, record);
  }

  saveApproval(sessionId: string, approval: ApprovalRecord): Promise<void> {
    return this.deps.store.saveApproval(sessionId, approval);
  }

  saveRunSnapshot(snapshot: RunSnapshot): Promise<void> {
    return this.deps.store.saveRunSnapshot(snapshot);
  }

  saveTerminalResult(result: TerminalResult): Promise<void> {
    return this.deps.store.saveTerminalResult(result);
  }

  loadSession(sessionId: string): Promise<SessionRecord> {
    return this.deps.store.loadSession(sessionId);
  }

  loadRunSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    return this.deps.store.loadRunSnapshot(runId);
  }
}

