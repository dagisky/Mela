import type { TerminalResult } from '../types/index.js';
import { createRunContext } from './RunContext.js';
import { createRuntimeEvent, RuntimeEventTypes } from './RuntimeEvents.js';
import { createTerminalResult } from './TerminalResult.js';
import { createRunSnapshot } from '../persistence/SnapshotStore.js';
import type { RuntimeConfig } from './RuntimeConfig.js';
import { DEFAULT_RUNTIME_CONFIG, createRuntimeConfigSnapshot } from './RuntimeConfig.js';
import type { RuntimeDeps, RuntimeExecuteInput } from './RuntimeDeps.js';

export interface RuntimeEngine {
  execute(input: RuntimeExecuteInput): Promise<TerminalResult>;
  resume(runId: string): Promise<TerminalResult>;
  cancel(runId: string, reason?: string): Promise<void>;
}

export class DefaultRuntimeEngine implements RuntimeEngine {
  private readonly cancelledRuns = new Map<string, string | undefined>();

  constructor(
    private readonly deps: RuntimeDeps = {},
    private readonly config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG,
  ) {}

  async execute(input: RuntimeExecuteInput): Promise<TerminalResult> {
    const configSnapshot = createRuntimeConfigSnapshot(this.config);
    const context = createRunContext({
      runId: input.runId,
      sessionId: input.sessionId,
      userId: input.userId,
      projectId: input.projectId,
      agentId: input.agentId,
      workflowId: input.workflowId,
      definitionVersions: input.definitionVersions,
      toolNames: input.toolNames,
      permissionContext: input.permissionContext,
      signal: input.signal,
      metadata: {
        ...(input.metadata ?? {}),
        runtimeConfig: configSnapshot,
      },
      budgets: configSnapshot.defaultBudgets,
    });

    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.SessionStarted, context, {
      agentId: input.agentId,
      workflowId: input.workflowId,
    }));
    if (input.userMessage) {
      await this.deps.store?.appendMessage(context.sessionId, { role: 'user', content: input.userMessage });
      await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.UserMessageAccepted, context, {}));
    }
    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunStarted, context, {
      agentId: input.agentId,
      workflowId: input.workflowId,
    }));
    await this.deps.store?.saveRunSnapshot(createRunSnapshot(context));

    const cancellationReason = this.cancelledRuns.get(context.runId);
    if (context.signal.aborted || cancellationReason !== undefined) {
      const result = createTerminalResult({
        status: 'cancelled',
        runId: context.runId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        message: cancellationReason ?? 'Run cancelled.',
        errorCode: 'cancelled',
      });
      await this.persistTerminal(result);
      await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunCancelled, context, { status: result.status }));
      return result;
    }

    try {
      const result = this.deps.execute
        ? await this.deps.execute(context, input)
        : createTerminalResult({
            status: 'success',
            runId: context.runId,
            sessionId: context.sessionId,
            correlationId: context.correlationId,
            message: 'Completed.',
          });
      await this.persistTerminal(result);
      await this.deps.store?.appendEvent(createRuntimeEvent(
        result.status === 'success' ? RuntimeEventTypes.RunCompleted : RuntimeEventTypes.RunFailed,
        context,
        { status: result.status, errorCode: result.errorCode },
      ));
      return result;
    } catch (error) {
      const result = createTerminalResult({
        status: 'unknown_error',
        runId: context.runId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        message: error instanceof Error ? error.message : String(error),
        errorCode: 'unknown_error',
      });
      await this.persistTerminal(result);
      await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunFailed, context, {
        status: result.status,
        errorCode: result.errorCode,
      }));
      return result;
    }
  }

  async resume(runId: string): Promise<TerminalResult> {
    const snapshot = await this.deps.store?.loadRunSnapshot(runId);
    if (!snapshot) {
      return createTerminalResult({
        status: 'definition_load_failed',
        runId,
        correlationId: runId,
        message: `Run snapshot "${runId}" not found.`,
        errorCode: 'snapshot_not_found',
      });
    }
    return createTerminalResult({
      status: 'success',
      runId,
      sessionId: snapshot.sessionId,
      correlationId: snapshot.context.correlationId,
      message: 'Run snapshot loaded.',
    });
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    this.cancelledRuns.set(runId, reason);
  }

  getCancellationReason(runId: string): string | undefined {
    return this.cancelledRuns.get(runId);
  }

  private async persistTerminal(result: TerminalResult): Promise<void> {
    await this.deps.store?.saveTerminalResult(result);
  }
}
