import { generateId } from '../types/index.js';
import type { RunContext } from '../types/index.js';
import type { ApprovalRecord, PersistenceStore } from '../persistence/PersistenceStore.js';
import type { RuntimeToolCall } from '../tools/RuntimeTool.js';
import type { ApprovalRequest } from './ApprovalManager.js';

interface PendingApproval {
  readonly record: ApprovalRecord;
  readonly input: unknown;
  readonly store?: PersistenceStore;
  readonly resolve: (approval: ApprovalRecord) => void;
}

export class InteractiveApprovalManager {
  private pending?: PendingApproval;

  constructor(private readonly store?: PersistenceStore) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalRecord> {
    if (this.pending) {
      return this.createRejectedRecord(
        request.context,
        request.toolCall,
        request.toolName,
        request.input,
        'another_approval_pending',
      );
    }

    const now = new Date();
    const record: ApprovalRecord = {
      id: generateId<string>(),
      sessionId: request.context.sessionId,
      runId: request.context.runId,
      toolCallId: request.toolCall.id,
      toolName: request.toolName,
      originalInput: request.input,
      proposedInput: request.input,
      reason: request.reason,
      status: 'pending',
      createdAt: now,
    };

    await (request.store ?? this.store)?.saveApproval(request.context.sessionId, record);

    return new Promise<ApprovalRecord>((resolve) => {
      this.pending = { record, input: request.input, store: request.store ?? this.store, resolve };
    });
  }

  getPendingApproval(): ApprovalRecord | undefined {
    return this.pending?.record;
  }

  approve(finalInput?: unknown): ApprovalRecord {
    if (!this.pending) throw new Error('No pending approval.');
    const approval: ApprovalRecord = {
      ...this.pending.record,
      status: 'approved',
      finalInput: finalInput ?? this.pending.input,
      decidedBy: 'user',
      decidedAt: new Date(),
    };
    void this.pending.store?.saveApproval(approval.sessionId, approval);
    this.pending.resolve(approval);
    this.pending = undefined;
    return approval;
  }

  reject(reason = 'Rejected by user.'): ApprovalRecord {
    if (!this.pending) throw new Error('No pending approval.');
    const approval: ApprovalRecord = {
      ...this.pending.record,
      status: 'rejected',
      reason,
      decidedBy: 'user',
      decidedAt: new Date(),
    };
    void this.pending.store?.saveApproval(approval.sessionId, approval);
    this.pending.resolve(approval);
    this.pending = undefined;
    return approval;
  }

  private createRejectedRecord(
    context: RunContext,
    toolCall: RuntimeToolCall,
    toolName: string,
    input: unknown,
    reason: string,
  ): ApprovalRecord {
    const now = new Date();
    return {
      id: generateId<string>(),
      sessionId: context.sessionId,
      runId: context.runId,
      toolCallId: toolCall.id,
      toolName,
      originalInput: input,
      proposedInput: input,
      reason,
      status: 'rejected',
      decidedBy: 'runtime',
      decidedAt: now,
      createdAt: now,
    };
  }
}
