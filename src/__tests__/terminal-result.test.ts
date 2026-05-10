import { describe, expect, it } from 'vitest';
import { createTerminalResult, isSuccessfulTerminalResult } from '../runtime/TerminalResult.js';

describe('terminal result', () => {
  it('creates a successful terminal result with stable fields', () => {
    const createdAt = new Date('2026-05-09T00:00:00.000Z');
    const result = createTerminalResult({
      status: 'success',
      runId: 'run-1',
      sessionId: 'session-1',
      correlationId: 'corr-1',
      message: 'done',
      usage: { prompt: 10, completion: 5 },
      metadata: { answer: 42 },
      createdAt,
    });

    expect(result).toEqual({
      status: 'success',
      runId: 'run-1',
      sessionId: 'session-1',
      correlationId: 'corr-1',
      message: 'done',
      errorCode: undefined,
      usage: { prompt: 10, completion: 5 },
      createdAt,
      traceId: undefined,
      metadata: { answer: 42 },
    });
    expect(isSuccessfulTerminalResult(result)).toBe(true);
  });

  it('creates a failed terminal result with an error code', () => {
    const result = createTerminalResult({
      status: 'tool_error',
      runId: 'run-1',
      correlationId: 'corr-1',
      message: 'tool failed',
      errorCode: 'tool_execution_failed',
    });

    expect(result.status).toBe('tool_error');
    expect(result.errorCode).toBe('tool_execution_failed');
    expect(isSuccessfulTerminalResult(result)).toBe(false);
  });
});

