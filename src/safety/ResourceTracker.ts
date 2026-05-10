import type { ResourceLimits } from '../types/index.js';

export interface ResourceViolation {
  readonly type: 'timeout' | 'llm_call_limit' | 'tool_call_limit' | 'cost_limit' | 'cancelled';
  readonly message: string;
}

/**
 * Tracks resource usage and enforces limits.
 * Instantiated per-run or per-invocation.
 */
export class ResourceTracker {
  private llmCallCount = 0;
  private toolCallCount = 0;
  private totalCostUsd = 0;
  private readonly startTime = Date.now();

  constructor(
    private readonly limits: ResourceLimits['perInvocation'],
    private readonly signal?: AbortSignal,
  ) {}

  recordLLMCall(costUsd: number = 0): void {
    this.llmCallCount++;
    this.totalCostUsd += costUsd;
  }

  recordToolCall(): void {
    this.toolCallCount++;
  }

  /**
   * Check if any resource limits have been exceeded.
   * Returns null if within limits, or a ResourceViolation describing the breach.
   */
  checkLimits(): ResourceViolation | null {
    if (this.signal?.aborted) {
      return { type: 'cancelled', message: 'Execution was cancelled' };
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.limits.maxExecutionTimeMs) {
      return { type: 'timeout', message: `Execution exceeded ${this.limits.maxExecutionTimeMs}ms (actual: ${elapsed}ms)` };
    }

    if (this.llmCallCount > this.limits.maxLLMCalls) {
      return { type: 'llm_call_limit', message: `LLM calls exceeded limit of ${this.limits.maxLLMCalls}` };
    }

    if (this.toolCallCount > this.limits.maxToolCalls) {
      return { type: 'tool_call_limit', message: `Tool calls exceeded limit of ${this.limits.maxToolCalls}` };
    }

    return null;
  }

  getStats() {
    return {
      llmCallCount: this.llmCallCount,
      toolCallCount: this.toolCallCount,
      totalCostUsd: this.totalCostUsd,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}
