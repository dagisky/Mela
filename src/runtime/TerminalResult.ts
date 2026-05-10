import type { TerminalResult, TerminalStatus, TerminalUsage } from '../types/index.js';

export { type TerminalResult, type TerminalStatus, type TerminalUsage } from '../types/index.js';

export interface CreateTerminalResultInput {
  readonly status: TerminalStatus;
  readonly runId: string;
  readonly correlationId: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly errorCode?: string;
  readonly usage?: TerminalUsage;
  readonly traceId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt?: Date;
}

export function createTerminalResult(input: CreateTerminalResultInput): TerminalResult {
  return {
    status: input.status,
    runId: input.runId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    message: input.message,
    errorCode: input.errorCode,
    usage: input.usage,
    createdAt: input.createdAt ?? new Date(),
    traceId: input.traceId,
    metadata: input.metadata,
  };
}

export function isSuccessfulTerminalResult(result: TerminalResult): boolean {
  return result.status === 'success';
}

