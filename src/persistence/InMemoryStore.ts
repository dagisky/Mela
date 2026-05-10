import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type {
  ApprovalRecord,
  PersistenceStore,
  RunSnapshot,
  SessionRecord,
  ToolCallRecord,
} from './PersistenceStore.js';

interface MutableSessionRecord {
  messages: unknown[];
  approvals: ApprovalRecord[];
  events: RuntimeEventRecord[];
}

export class InMemoryStore implements PersistenceStore {
  readonly sessions = new Map<string, MutableSessionRecord>();
  readonly snapshots = new Map<string, RunSnapshot>();
  readonly terminalResults = new Map<string, TerminalResult>();
  readonly toolCalls = new Map<string, ToolCallRecord[]>();

  async appendEvent(event: RuntimeEventRecord): Promise<void> {
    this.ensureSession(event.sessionId ?? event.runId).events.push(event);
  }

  async appendMessage(sessionId: string, message: unknown): Promise<void> {
    this.ensureSession(sessionId).messages.push(message);
  }

  async saveToolCall(runId: string, record: ToolCallRecord): Promise<void> {
    const records = this.toolCalls.get(runId) ?? [];
    records.push(record);
    this.toolCalls.set(runId, records);
  }

  async saveApproval(sessionId: string, approval: ApprovalRecord): Promise<void> {
    this.ensureSession(sessionId).approvals.push(approval);
  }

  async saveRunSnapshot(snapshot: RunSnapshot): Promise<void> {
    this.snapshots.set(snapshot.runId, snapshot);
  }

  async saveTerminalResult(result: TerminalResult): Promise<void> {
    this.terminalResults.set(result.runId, result);
  }

  async loadSession(sessionId: string): Promise<SessionRecord> {
    const session = this.ensureSession(sessionId);
    return {
      sessionId,
      messages: [...session.messages],
      approvals: [...session.approvals],
      events: [...session.events],
    };
  }

  async loadRunSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    return this.snapshots.get(runId);
  }

  loadTerminalResult(runId: string): TerminalResult | undefined {
    return this.terminalResults.get(runId);
  }

  loadToolCalls(runId: string): readonly ToolCallRecord[] {
    return [...(this.toolCalls.get(runId) ?? [])];
  }

  private ensureSession(sessionId: string): MutableSessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: MutableSessionRecord = { messages: [], approvals: [], events: [] };
    this.sessions.set(sessionId, created);
    return created;
  }
}
