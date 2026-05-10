import type { RuntimeEventRecord, RunContext, TerminalResult } from '../types/index.js';
import type { LLMToolResult } from '../tools/RuntimeTool.js';

export interface ToolCallRecord {
  readonly id: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly result: LLMToolResult;
  readonly status: 'completed' | 'failed';
  readonly errorCode?: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly originalInput: unknown;
  readonly proposedInput: unknown;
  readonly finalInput?: unknown;
  readonly reason?: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly decidedBy?: string;
  readonly decidedAt?: Date;
  readonly createdAt: Date;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly sessionId: string;
  readonly context: Omit<RunContext, 'signal'>;
  readonly savedAt: Date;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly messages: readonly unknown[];
  readonly approvals: readonly ApprovalRecord[];
  readonly events: readonly RuntimeEventRecord[];
}

export interface PersistenceStore {
  appendEvent(event: RuntimeEventRecord): Promise<void>;
  appendMessage(sessionId: string, message: unknown): Promise<void>;
  saveToolCall(runId: string, record: ToolCallRecord): Promise<void>;
  saveApproval(sessionId: string, approval: ApprovalRecord): Promise<void>;
  saveRunSnapshot(snapshot: RunSnapshot): Promise<void>;
  saveTerminalResult(result: TerminalResult): Promise<void>;
  loadSession(sessionId: string): Promise<SessionRecord>;
  loadRunSnapshot(runId: string): Promise<RunSnapshot | undefined>;
}

