import type { AgentDefinition, TerminalResult } from '../types/index.js';
import { createRunContext } from '../runtime/RunContext.js';
import { createRuntimeEvent, RuntimeEventTypes } from '../runtime/RuntimeEvents.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import type { ConversationEngine } from '../runtime/ConversationEngine.js';

export interface ChildRunRequest {
  readonly agentId: string;
  readonly taskPrompt: string;
  readonly cancellation?: 'linked' | 'detached';
  readonly metadata?: Record<string, unknown>;
}

export interface AgentProvider {
  load(agentId: string): Promise<AgentDefinition>;
}

export class ChildRunManager {
  constructor(
    private readonly deps: {
      readonly conversationEngine: ConversationEngine;
      readonly agentProvider: AgentProvider;
      readonly store?: PersistenceStore;
    },
  ) {}

  async runChild(
    parentContext: ReturnType<typeof createRunContext>,
    request: ChildRunRequest,
  ): Promise<TerminalResult> {
    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ChildRunRequested, parentContext, {
      childAgentId: request.agentId,
      childRunRequested: true,
    }));

    const childAgent = await this.deps.agentProvider.load(request.agentId);
    const childSignal = request.cancellation === 'linked' ? parentContext.signal : undefined;
    const result = await this.deps.conversationEngine.submit({
      agentDefinition: childAgent,
      userMessage: request.taskPrompt,
      sessionId: parentContext.sessionId,
      userId: parentContext.userId,
      projectId: parentContext.projectId,
      permissionContext: parentContext.permissionContext as Record<string, unknown> | undefined,
      signal: childSignal,
      metadata: {
        ...(request.metadata ?? {}),
        parentRunId: parentContext.runId,
      },
    });

    await this.deps.store?.appendEvent(createRuntimeEvent(
      result.status === 'cancelled' ? RuntimeEventTypes.ChildRunCancelled : RuntimeEventTypes.ChildRunCompleted,
      parentContext,
      { childAgentId: request.agentId, childRunId: result.runId, status: result.status },
    ));
    return result;
  }
}
