import type { RunContext } from '../types/index.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import type { PermissionDecision } from '../policy/PolicyEngine.js';

export interface RuntimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface LLMToolResult {
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
  readonly errorCode?: string;
}

export interface ToolUseContext {
  readonly runContext: RunContext;
  readonly store?: PersistenceStore;
}

export interface ToolDisplay<TInput = unknown, TOutput = unknown> {
  readonly name?: string;
  activity?(input: TInput): string;
  result?(output: TOutput): string;
}

export type ValidationResult<TInput> =
  | { readonly ok: true; readonly value: TInput }
  | { readonly ok: false; readonly message: string };

export type ToolExecutionResult<TOutput = unknown> =
  | { readonly ok: true; readonly output: TOutput; readonly metadata?: Record<string, unknown> }
  | { readonly ok: false; readonly errorCode?: string; readonly message: string; readonly output?: unknown };

export interface RuntimeTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly timeoutMs: number;
  readonly maxResultSizeBytes?: number;
  readonly concurrencySafe?: boolean;
  readonly display?: ToolDisplay<TInput, TOutput>;
  validateInput(input: unknown): ValidationResult<TInput>;
  checkPermissions(input: TInput, context: RunContext): Promise<PermissionDecision>;
  execute(input: TInput, context: ToolUseContext): Promise<ToolExecutionResult<TOutput>>;
  mapResultToModel(result: ToolExecutionResult<TOutput>, toolCallId: string): LLMToolResult;
}

export function createErrorToolResult(toolCallId: string, errorCode: string, message: string): LLMToolResult {
  return {
    toolCallId,
    content: JSON.stringify({ ok: false, errorCode, message }),
    isError: true,
    errorCode,
  };
}

export function createDefaultToolResultMapper<TOutput>() {
  return (result: ToolExecutionResult<TOutput>, toolCallId: string): LLMToolResult => {
    if (!result.ok) {
      return createErrorToolResult(toolCallId, result.errorCode ?? 'tool_execution_failed', result.message);
    }
    return {
      toolCallId,
      content: JSON.stringify({ ok: true, output: result.output, metadata: result.metadata }),
    };
  };
}

export function createToolUseContext(runContext: RunContext, store?: PersistenceStore): ToolUseContext {
  return { runContext, store };
}
