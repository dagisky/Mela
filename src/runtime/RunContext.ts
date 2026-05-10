import { generateId } from '../types/index.js';
import type { RunContext, RuntimeBudgets } from '../types/index.js';

export { type RunContext, type RuntimeBudgets } from '../types/index.js';

const DEFAULT_BUDGETS: RuntimeBudgets = {
  maxTurns: 12,
  maxToolCalls: 40,
  maxContextTokens: 100_000,
};

export interface CreateRunContextInput {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly correlationId?: string;
  readonly parentRunId?: string;
  readonly userId?: string;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly workflowId?: string;
  readonly definitionVersions?: Record<string, string>;
  readonly toolNames?: readonly string[];
  readonly permissionContext?: unknown;
  readonly budgets?: Partial<RuntimeBudgets>;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export function createRunContext(input: CreateRunContextInput = {}): RunContext {
  const controller = input.signal ? undefined : new AbortController();
  return Object.freeze({
    runId: input.runId ?? generateId<string>(),
    sessionId: input.sessionId ?? generateId<string>(),
    correlationId: input.correlationId ?? generateId<string>(),
    parentRunId: input.parentRunId,
    userId: input.userId,
    projectId: input.projectId,
    agentId: input.agentId,
    workflowId: input.workflowId,
    definitionVersions: Object.freeze({ ...(input.definitionVersions ?? {}) }),
    toolNames: Object.freeze([...(input.toolNames ?? [])]),
    permissionContext: input.permissionContext,
    budgets: Object.freeze({ ...DEFAULT_BUDGETS, ...(input.budgets ?? {}) }),
    signal: input.signal ?? controller!.signal,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

