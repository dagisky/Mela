import { RuntimeEventTypes, createRuntimeEvent } from '../runtime/RuntimeEvents.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import { ApprovalManager, type ApprovalRequester } from '../human/ApprovalManager.js';
import { budgetToolOutput } from '../context/ToolOutputBudgeter.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';
import type { RuntimeToolRegistry } from './RuntimeToolRegistry.js';
import { ToolScheduler } from './ToolScheduler.js';
import {
  type LLMToolResult,
  type RuntimeToolCall,
  createErrorToolResult,
  createToolUseContext,
} from './RuntimeTool.js';
import type { RunContext } from '../types/index.js';

export interface ToolExecutorConfig {
  readonly registry: RuntimeToolRegistry;
  readonly policyEngine?: PolicyEngine;
  readonly approvalManager?: ApprovalRequester;
  readonly scheduler?: ToolScheduler;
  readonly store?: PersistenceStore;
  readonly maxToolResultBytes?: number;
}

export class ToolExecutor {
  private readonly policyEngine: PolicyEngine;
  private readonly approvalManager: ApprovalRequester;
  private readonly scheduler: ToolScheduler;
  private readonly maxToolResultBytes: number;

  constructor(private readonly config: ToolExecutorConfig) {
    this.policyEngine = config.policyEngine ?? new PolicyEngine();
    this.approvalManager = config.approvalManager ?? new ApprovalManager('reject');
    this.scheduler = config.scheduler ?? new ToolScheduler();
    this.maxToolResultBytes = config.maxToolResultBytes ?? 50_000;
  }

  async executeToolOrError(toolCall: RuntimeToolCall, context: RunContext): Promise<LLMToolResult> {
    await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallRequested, context, { toolCall }));

    const tool = this.config.registry.get(toolCall.name);
    if (!tool) {
      return this.finishError(toolCall, context, 'tool_not_found', `Tool not found: ${toolCall.name}`);
    }

    if (context.signal.aborted) {
      return this.finishError(toolCall, context, 'tool_cancelled', 'Tool call cancelled before execution.');
    }

    const validation = tool.validateInput(toolCall.input);
    if (!validation.ok) {
      return this.finishError(toolCall, context, 'tool_input_validation_failed', validation.message);
    }

    const policyDecision = await this.policyEngine.checkTool(tool, validation.value, context);
    if (policyDecision.decision === 'deny') {
      await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallPermissionDenied, context, {
        toolName: tool.name,
        reasonCode: policyDecision.reasonCode,
      }));
      return this.finishError(toolCall, context, 'tool_policy_denied', policyDecision.reasonCode);
    }

    const toolDecision = await tool.checkPermissions(validation.value, context);
    if (toolDecision.decision === 'deny') {
      await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallPermissionDenied, context, {
        toolName: tool.name,
        reasonCode: toolDecision.reasonCode,
      }));
      return this.finishError(toolCall, context, 'tool_permission_denied', toolDecision.reasonCode);
    }

    let executableInput = validation.value;
    if (policyDecision.decision === 'require_approval' || toolDecision.decision === 'require_approval') {
      const approval = await this.approvalManager.requestApproval({
        context,
        toolCall,
        toolName: tool.name,
        input: executableInput,
        reason: policyDecision.reasonCode ?? toolDecision.reasonCode,
        store: this.config.store,
      });
      if (approval.status !== 'approved') {
        await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ApprovalRejected, context, {
          approvalId: approval.id,
          toolName: tool.name,
        }));
        return this.finishError(toolCall, context, 'tool_approval_rejected', 'Approval rejected.');
      }
      executableInput = approval.finalInput ?? executableInput;
      await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ApprovalApproved, context, {
        approvalId: approval.id,
        toolName: tool.name,
      }));
    }

    try {
      const executionResult = await this.scheduler.schedule(tool.concurrencySafe ?? true, async () => {
        return this.withTimeout(
          tool.execute(executableInput, createToolUseContext(context, this.config.store)),
          tool.timeoutMs,
          context.signal,
          tool.name,
        );
      });

      if (!executionResult.ok) {
        return this.finishError(
          toolCall,
          context,
          executionResult.errorCode ?? 'tool_execution_failed',
          executionResult.message,
        );
      }

      const budgeted = budgetToolOutput(
        executionResult.output,
        tool.maxResultSizeBytes ?? this.maxToolResultBytes,
      );
      if (budgeted.replaced) {
        await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallOutputReplaced, context, {
          toolName: tool.name,
          sizeBytes: budgeted.sizeBytes,
        }));
      }

      const modelResult = tool.mapResultToModel({ ...executionResult, output: budgeted.output }, toolCall.id);
      await this.config.store?.saveToolCall(context.runId, {
        id: toolCall.id,
        toolName: tool.name,
        input: executableInput,
        result: modelResult,
        status: 'completed',
      });
      await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallCompleted, context, {
        toolName: tool.name,
        toolCallId: toolCall.id,
      }));
      return modelResult;
    } catch (error) {
      if (context.signal.aborted) {
        return this.finishError(toolCall, context, 'tool_cancelled', 'Tool call cancelled during execution.');
      }
      return this.finishError(
        toolCall,
        context,
        'tool_execution_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async finishError(
    toolCall: RuntimeToolCall,
    context: RunContext,
    errorCode: string,
    message: string,
  ): Promise<LLMToolResult> {
    const result = createErrorToolResult(toolCall.id, errorCode, message);
    await this.config.store?.saveToolCall(context.runId, {
      id: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      result,
      status: 'failed',
      errorCode,
    });
    await this.config.store?.appendEvent(createRuntimeEvent(RuntimeEventTypes.ToolCallFailed, context, {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      errorCode,
    }));
    return result;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal, toolName: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`)), timeoutMs);
      const onAbort = () => reject(new Error('Tool execution aborted'));

      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
}
