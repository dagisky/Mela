import type { AgentDefinition, TerminalResult } from '../types/index.js';
import { createRuntimeEvent, RuntimeEventTypes } from './RuntimeEvents.js';
import { createRunContext } from './RunContext.js';
import { createTerminalResult } from './TerminalResult.js';
import type { LLMClient, LLMMessage, LLMToolSchema, ToolCallRequest } from '../models/LLMClient.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import { ContextBudgetManager } from '../context/ContextBudgetManager.js';
import type { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { createErrorToolResult, type LLMToolResult, type RuntimeToolCall } from '../tools/RuntimeTool.js';
import type { PolicyEngine } from '../policy/PolicyEngine.js';
import { ApprovalManager, type ApprovalRequester } from '../human/ApprovalManager.js';
import type { RuntimeConfig } from './RuntimeConfig.js';
import { DEFAULT_RUNTIME_CONFIG, createRuntimeConfigSnapshot } from './RuntimeConfig.js';
import { createRunSnapshot } from '../persistence/SnapshotStore.js';
import type { OutputValidator } from '../validation/OutputValidator.js';
import { ResourceTracker } from '../safety/ResourceTracker.js';
import type { AgentCircuitBreaker } from '../safety/AgentCircuitBreaker.js';

export interface ConversationEngineDeps {
  readonly llmClient: LLMClient;
  readonly toolRegistry: RuntimeToolRegistry;
  readonly toolExecutor?: ToolExecutor;
  readonly store?: PersistenceStore;
  readonly policyEngine?: PolicyEngine;
  readonly approvalManager?: ApprovalRequester;
  readonly contextBudgetManager?: ContextBudgetManager;
  readonly outputValidator?: OutputValidator;
  readonly circuitBreakers?: ReadonlyMap<string, AgentCircuitBreaker>;
}

export interface ConversationSubmitInput {
  readonly agentDefinition: AgentDefinition;
  readonly userMessage: string;
  readonly history?: readonly LLMMessage[];
  readonly runId?: string;
  readonly sessionId?: string;
  readonly userId?: string;
  readonly projectId?: string;
  readonly permissionContext?: { hardDenyTools?: readonly string[] } & Record<string, unknown>;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export class ConversationEngine {
  private readonly toolExecutor: ToolExecutor;
  private readonly contextBudgetManager: ContextBudgetManager;

  constructor(
    private readonly deps: ConversationEngineDeps,
    private readonly config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG,
  ) {
    this.toolExecutor = deps.toolExecutor ?? new ToolExecutor({
      registry: deps.toolRegistry,
      policyEngine: deps.policyEngine,
      approvalManager: deps.approvalManager ?? new ApprovalManager('reject'),
      store: deps.store,
    });
    this.contextBudgetManager = deps.contextBudgetManager
      ?? new ContextBudgetManager(config.defaultBudgets.maxContextTokens);
  }

  async submit(input: ConversationSubmitInput): Promise<TerminalResult> {
    const agent = input.agentDefinition;
    const allowedTools = this.deps.toolRegistry.resolveAllowed(
      agent.tools,
      input.permissionContext?.hardDenyTools,
    );
    const context = createRunContext({
      runId: input.runId,
      sessionId: input.sessionId,
      userId: input.userId,
      projectId: input.projectId,
      agentId: agent.id,
      definitionVersions: { [agent.id]: agent.version },
      toolNames: allowedTools,
      permissionContext: input.permissionContext,
      signal: input.signal,
      budgets: {
        ...this.config.defaultBudgets,
        maxTurns: agent.reactConfig.maxIterations,
        maxContextTokens: agent.limits.maxContextTokens,
      },
      metadata: {
        ...(input.metadata ?? {}),
        runtimeConfig: createRuntimeConfigSnapshot(this.config),
      },
    });
    const circuitBreaker = this.deps.circuitBreakers?.get(agent.id);
    const circuitDecision = circuitBreaker?.canInvoke();
    const finish = async (
      ...args: Parameters<ConversationEngine['finish']>
    ): Promise<TerminalResult> => {
      const result = await this.finish(...args);
      circuitBreaker?.recordOutcome(result.status === 'success');
      return result;
    };

    if (circuitDecision && !circuitDecision.allowed) {
      return finish('policy_denied', context, circuitDecision.reason ?? 'Agent circuit breaker is open.', {
        errorCode: 'circuit_breaker_open',
      });
    }

    const resourceTracker = new ResourceTracker(agent.limits, context.signal);

    const messages: LLMMessage[] = [
      { role: 'system', content: agent.systemPrompt },
      ...normalizeHistory(input.history),
      { role: 'user', content: input.userMessage },
    ];

    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.SessionStarted, context, { agentId: agent.id }));
    await this.deps.store?.appendMessage(context.sessionId, messages[1]);
    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.UserMessageAccepted, context, {}));
    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.AgentDefinitionLoaded, context, {
      id: agent.id,
      version: agent.version,
    }));
    await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.RunStarted, context, { agentId: agent.id }));
    await this.deps.store?.saveRunSnapshot(createRunSnapshot(context));

    let promptTokens = 0;
    let completionTokens = 0;
    let toolCallCount = 0;

    for (let turn = 1; turn <= context.budgets.maxTurns; turn++) {
      if (context.signal.aborted) {
        return finish('cancelled', context, 'Run cancelled.', { errorCode: 'cancelled', promptTokens, completionTokens });
      }

      const violation = resourceTracker.checkLimits();
      if (violation) {
        return finish('resource_limit_exceeded', context, violation.message, {
          errorCode: violation.type,
          promptTokens,
          completionTokens,
        });
      }

      const budget = this.contextBudgetManager.check(messages);
      if (!budget.ok) {
        return finish('max_context_budget', context, 'Context budget exceeded.', {
          errorCode: 'budget_exceeded',
          promptTokens,
          completionTokens,
          metadata: { budget },
        });
      }

      await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ModelRequestStarted, context, { turn }));
      const response = await this.deps.llmClient.call({
        model: agent.model.model,
        messages,
        maxTokens: agent.model.maxTokens,
        temperature: agent.model.temperature,
        tools: this.createToolSchemas(allowedTools),
        signal: context.signal,
      }).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ModelRequestFailed, context, {
          turn,
          errorCode: 'model_error',
        }));
        return finish('model_error_retry_exhausted', context, message, {
          errorCode: 'model_error',
          promptTokens,
          completionTokens,
        });
      });

      if ('status' in response) return response;

      promptTokens += response.usage.promptTokens;
      completionTokens += response.usage.completionTokens;
      resourceTracker.recordLLMCall();
      await this.deps.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ModelRequestCompleted, context, {
        turn,
        toolCallCount: response.toolCalls.length,
      }));

      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      };
      messages.push(assistantMessage);
      await this.deps.store?.appendMessage(context.sessionId, assistantMessage);

      if (response.toolCalls.length === 0) {
        const validation = await this.validateOutput(response.content, agent, input.projectId);
        if (validation === 'reject') {
          return finish('validation_failed', context, 'Output validation failed.', {
            errorCode: 'validation_failed',
            promptTokens,
            completionTokens,
          });
        }

        return finish('success', context, response.content || 'Completed.', {
          promptTokens,
          completionTokens,
          metadata: { turns: turn, toolCallCount, validation },
        });
      }

      const toolResults = await this.executeToolCalls(response.toolCalls, context);
      toolCallCount += toolResults.length;
      for (const _result of toolResults) resourceTracker.recordToolCall();
      for (const result of toolResults) {
        const toolMessage: LLMMessage = {
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
        };
        messages.push(toolMessage);
        await this.deps.store?.appendMessage(context.sessionId, toolMessage);
      }
    }

    return finish('max_turns', context, 'Maximum turns reached.', {
      errorCode: 'max_turns',
      promptTokens,
      completionTokens,
      metadata: { toolCallCount },
    });
  }

  private createToolSchemas(allowedTools: readonly string[]): readonly LLMToolSchema[] | undefined {
    const schemas = allowedTools.flatMap((name) => {
      const tool = this.deps.toolRegistry.get(name);
      if (!tool) return [];
      return [{
        name: tool.name,
        description: tool.description,
        parameters: asJsonSchema(tool.inputSchema),
      }];
    });
    return schemas.length > 0 ? schemas : undefined;
  }

  private async executeToolCalls(
    toolCalls: readonly ToolCallRequest[],
    context: ReturnType<typeof createRunContext>,
  ): Promise<readonly LLMToolResult[]> {
    const results: LLMToolResult[] = [];
    for (const call of toolCalls) {
      const runtimeCall = this.toRuntimeToolCall(call);
      if (!runtimeCall) {
        results.push(createErrorToolResult(call.id, 'tool_input_parse_failed', `Invalid tool arguments for "${call.name}".`));
        continue;
      }
      results.push(await this.toolExecutor.executeToolOrError(runtimeCall, context));
    }
    return results;
  }

  private toRuntimeToolCall(call: ToolCallRequest): RuntimeToolCall | undefined {
    try {
      return { id: call.id, name: call.name, input: JSON.parse(call.arguments || '{}') };
    } catch {
      return undefined;
    }
  }

  private async validateOutput(
    output: string,
    agent: AgentDefinition,
    projectId?: string,
  ): Promise<'accept' | 'review' | 'reject' | undefined> {
    if (!this.deps.outputValidator) return undefined;
    const result = await this.deps.outputValidator.validate(safeJson(output), {
      agentType: agent.id,
      projectId: projectId ?? '',
    });
    return result.decision;
  }

  private async finish(
    status: TerminalResult['status'],
    context: ReturnType<typeof createRunContext>,
    message: string,
    options: {
      readonly errorCode?: string;
      readonly promptTokens?: number;
      readonly completionTokens?: number;
      readonly metadata?: Record<string, unknown>;
    } = {},
  ): Promise<TerminalResult> {
    const result = createTerminalResult({
      status,
      runId: context.runId,
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      message,
      errorCode: options.errorCode,
      usage: {
        prompt: options.promptTokens ?? 0,
        completion: options.completionTokens ?? 0,
      },
      metadata: options.metadata,
    });
    await this.deps.store?.saveTerminalResult(result);
    await this.deps.store?.appendEvent(createRuntimeEvent(
      status === 'success' ? RuntimeEventTypes.RunCompleted : RuntimeEventTypes.RunFailed,
      context,
      { status, errorCode: options.errorCode },
    ));
    return result;
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: 'object' };
}

function normalizeHistory(history: readonly LLMMessage[] | undefined): readonly LLMMessage[] {
  if (!history?.length) return [];
  return history.filter((message) => message.role !== 'system');
}
