import type { LLMMessage } from '../models/LLMClient.js';
import { estimateTokens } from './TokenEstimator.js';

export interface ContextBudgetResult {
  readonly ok: boolean;
  readonly usedTokens: number;
  readonly maxContextTokens: number;
  readonly remainingTokens: number;
}

export class ContextBudgetManager {
  constructor(private readonly maxContextTokens = 100_000) {}

  check(messages: readonly LLMMessage[]): ContextBudgetResult {
    const usedTokens = estimateTokens(messages.map((message) => ({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
    })));

    return {
      ok: usedTokens <= this.maxContextTokens,
      usedTokens,
      maxContextTokens: this.maxContextTokens,
      remainingTokens: Math.max(0, this.maxContextTokens - usedTokens),
    };
  }
}
