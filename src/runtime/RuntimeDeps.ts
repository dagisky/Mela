import type { TerminalResult, RunContext } from '../types/index.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';

export type RuntimeExecutionHandler = (context: RunContext, input: RuntimeExecuteInput) => Promise<TerminalResult>;

export interface RuntimeExecuteInput {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly userMessage?: string;
  readonly userId?: string;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly workflowId?: string;
  readonly definitionVersions?: Record<string, string>;
  readonly toolNames?: readonly string[];
  readonly permissionContext?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface RuntimeDeps {
  readonly store?: PersistenceStore;
  readonly execute?: RuntimeExecutionHandler;
}
