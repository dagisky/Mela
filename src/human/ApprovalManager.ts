import { generateId } from '../types/index.js';
import type { RunContext } from '../types/index.js';
import type { ApprovalRecord, PersistenceStore } from '../persistence/PersistenceStore.js';
import type { RuntimeToolCall } from '../tools/RuntimeTool.js';

export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalRequest {
  readonly context: RunContext;
  readonly toolCall: RuntimeToolCall;
  readonly toolName: string;
  readonly input: unknown;
  readonly reason?: string;
  readonly store?: PersistenceStore;
}

export interface ApprovalRequester {
  requestApproval(request: ApprovalRequest): Promise<ApprovalRecord>;
}

export class ApprovalManager {
  constructor(private readonly autoDecision: ApprovalDecision = 'reject') {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalRecord> {
    const now = new Date();
    const approved = this.autoDecision === 'approve';
    const record: ApprovalRecord = {
      id: generateId<string>(),
      sessionId: request.context.sessionId,
      runId: request.context.runId,
      toolCallId: request.toolCall.id,
      toolName: request.toolName,
      originalInput: request.input,
      proposedInput: request.input,
      finalInput: approved ? request.input : undefined,
      reason: request.reason,
      status: approved ? 'approved' : 'rejected',
      decidedBy: 'auto',
      decidedAt: now,
      createdAt: now,
    };
    await request.store?.saveApproval(request.context.sessionId, record);
    return record;
  }
}
