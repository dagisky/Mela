import type { RuntimeEventRecord, RunContext } from '../types/index.js';

export { type RuntimeEventRecord } from '../types/index.js';

export const RuntimeEventTypes = {
  SessionStarted: 'session.started',
  UserMessageAccepted: 'user.message.accepted',
  RunStarted: 'run.started',
  RunCompleted: 'run.completed',
  RunFailed: 'run.failed',
  RunCancelled: 'run.cancelled',
  AgentDefinitionLoaded: 'agent.definition.loaded',
  SkillDefinitionLoaded: 'skill.definition.loaded',
  ModelRequestStarted: 'model.request.started',
  ModelRequestCompleted: 'model.request.completed',
  ModelRequestFailed: 'model.request.failed',
  ModelTokenDelta: 'model.token.delta',
  ToolCallRequested: 'tool.call.requested',
  ToolCallCompleted: 'tool.call.completed',
  ToolCallFailed: 'tool.call.failed',
  ToolCallPermissionDenied: 'tool.call.permission_denied',
  ToolCallOutputReplaced: 'tool.call.output_replaced',
  ApprovalRequested: 'approval.requested',
  ApprovalApproved: 'approval.approved',
  ApprovalRejected: 'approval.rejected',
  ChildRunRequested: 'child_run.requested',
  ChildRunCompleted: 'child_run.completed',
  ChildRunCancelled: 'child_run.cancelled',
  ReviewRequested: 'review.requested',
  ReviewApproved: 'review.approved',
  ReviewRejected: 'review.rejected',
  ValidationStarted: 'validation.started',
  ValidationCompleted: 'validation.completed',
  ValidationFailed: 'validation.failed',
} as const;

export type RuntimeEventType = typeof RuntimeEventTypes[keyof typeof RuntimeEventTypes];

export function createRuntimeEvent<TPayload extends Record<string, unknown>>(
  type: RuntimeEventType,
  context: Pick<RunContext, 'runId' | 'sessionId' | 'correlationId'>,
  payload: TPayload,
): RuntimeEventRecord<TPayload> {
  return {
    type,
    timestamp: new Date(),
    runId: context.runId,
    sessionId: context.sessionId,
    correlationId: context.correlationId,
    payload,
  };
}
